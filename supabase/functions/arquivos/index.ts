// Supabase Edge Function: arquivos
// Gera links temporários (assinados) para o Cloudflare R2, onde ficam os PDFs e as miniaturas.
// O navegador nunca recebe a chave do R2: só links que expiram.
//
// Ações:
//   ler     { itens: [{ doc, pagina }] }  pagina: -1 = PDF, 0 = capa, n = miniatura da página n
//           → { urls: (string|null)[] }   null quando a pessoa não pode ver aquele documento
//   enviar  { doc, paginas }              (admin) links de envio do PDF, da capa e de cada miniatura
//   apagar  { doc }                       (admin) apaga do R2 todos os arquivos do documento
//
// Segredos (Supabase → Edge Functions → Secrets):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import { AwsClient } from 'npm:aws4fetch@1.0.20'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const VALIDADE_PDF = 60 * 60 // o visualizador lê o PDF aos pedaços enquanto está aberto
const VALIDADE_IMAGEM = 60 * 60
const VALIDADE_ENVIO = 30 * 60

function chaveSecreta(): string {
  const antiga = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (antiga) return antiga
  try {
    const s = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}')
    return s.default || Object.values(s)[0] || ''
  } catch {
    return ''
  }
}

// chave pública: a antiga (anon) ou a nova (publishable)
function chavePublica(): string {
  const antiga = Deno.env.get('SUPABASE_ANON_KEY')
  if (antiga) return antiga
  try {
    const s = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}')
    return s.default || Object.values(s)[0] || ''
  } catch {
    return ''
  }
}

const r2 = new AwsClient({
  accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID') ?? '',
  secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY') ?? '',
  service: 's3',
  region: 'auto',
})
const base = `https://${Deno.env.get('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com/${Deno.env.get('R2_BUCKET')}`

/** Onde cada arquivo de um documento fica no R2. */
function chave(doc: string, pagina: number): string {
  if (pagina === -1) return `${doc}/original.pdf`
  if (pagina === 0) return `${doc}/capa.webp`
  return `${doc}/p${pagina}.webp`
}

async function assinar(caminho: string, metodo: 'GET' | 'PUT', segundos: number): Promise<string> {
  const url = new URL(`${base}/${caminho}`)
  url.searchParams.set('X-Amz-Expires', String(segundos))
  const req = await r2.sign(new Request(url, { method: metodo }), { aws: { signQuery: true } })
  return req.url
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    if (!Deno.env.get('R2_BUCKET') || !Deno.env.get('R2_ACCESS_KEY_ID')) {
      return json({ error: 'Armazenamento de arquivos ainda não configurado (segredos do R2).' }, 500)
    }
    const url = Deno.env.get('SUPABASE_URL')!
    const authorization = req.headers.get('Authorization') ?? ''
    // cliente "como a pessoa": as regras de acesso do banco (RLS) decidem o que ela vê
    const comoUsuario = createClient(url, chavePublica(), {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    })
    const servico = createClient(url, chaveSecreta(), { auth: { persistSession: false } })

    const { data: quem } = await servico.auth.getUser(authorization.replace(/^Bearer\s+/i, ''))
    if (!quem?.user) return json({ error: 'Sua sessão expirou. Entre de novo.' }, 401)

    const b = await req.json()

    // ---------- ler ----------
    if (b.acao === 'ler') {
      const itens: { doc: string; pagina: number }[] = Array.isArray(b.itens) ? b.itens.slice(0, 300) : []
      const docs = [...new Set(itens.map((i) => i.doc).filter((d) => UUID.test(d)))]
      if (!docs.length) return json({ urls: itens.map(() => null) })
      const { data: visiveis, error } = await comoUsuario.from('documentos').select('id, paginas').in('id', docs)
      if (error) return json({ error: error.message }, 400)
      const pode = new Map((visiveis ?? []).map((d) => [d.id as string, d.paginas as number]))
      const urls = await Promise.all(
        itens.map((i) => {
          const pags = pode.get(i.doc)
          if (pags === undefined || !Number.isInteger(i.pagina) || i.pagina < -1 || i.pagina > pags) return null
          return assinar(chave(i.doc, i.pagina), 'GET', i.pagina === -1 ? VALIDADE_PDF : VALIDADE_IMAGEM)
        }),
      )
      return json({ urls })
    }

    // daqui para baixo, só o administrador
    const { data: eu } = await servico.from('perfis').select('papel, ativo').eq('id', quem.user.id).single()
    if (!eu?.ativo || eu.papel !== 'admin') return json({ error: 'Só o administrador pode fazer isso.' }, 403)

    const doc = String(b.doc ?? '')
    if (!UUID.test(doc)) return json({ error: 'Documento inválido.' }, 400)

    // ---------- enviar ----------
    if (b.acao === 'enviar') {
      const paginas = Number(b.paginas)
      if (!Number.isInteger(paginas) || paginas < 1 || paginas > 5000) return json({ error: 'Número de páginas inválido.' }, 400)
      const { data: existe } = await servico.from('documentos').select('id').eq('id', doc).maybeSingle()
      if (!existe) return json({ error: 'Documento não encontrado.' }, 404)
      const [pdf, capa, ...miniaturas] = await Promise.all([
        assinar(chave(doc, -1), 'PUT', VALIDADE_ENVIO),
        assinar(chave(doc, 0), 'PUT', VALIDADE_ENVIO),
        ...Array.from({ length: paginas }, (_, i) => assinar(chave(doc, i + 1), 'PUT', VALIDADE_ENVIO)),
      ])
      return json({ pdf, capa, miniaturas })
    }

    // ---------- apagar ----------
    if (b.acao === 'apagar') {
      const { data: d } = await servico.from('documentos').select('paginas').eq('id', doc).maybeSingle()
      const total = Math.max(Number(b.paginas) || 0, d?.paginas ?? 0)
      const caminhos = [chave(doc, -1), chave(doc, 0), ...Array.from({ length: total }, (_, i) => chave(doc, i + 1))]
      for (let i = 0; i < caminhos.length; i += 25) {
        await Promise.all(caminhos.slice(i, i + 25).map(async (c) => {
          const r = await r2.fetch(`${base}/${c}`, { method: 'DELETE' })
          if (!r.ok && r.status !== 404) throw new Error(`R2 recusou apagar ${c}: ${r.status}`)
        }))
      }
      return json({ ok: true, apagados: caminhos.length })
    }

    return json({ error: 'Ação desconhecida.' }, 400)
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})

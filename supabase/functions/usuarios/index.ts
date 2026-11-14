// Supabase Edge Function: usuarios
// Cria contas e gera senhas provisórias (precisa da chave de serviço, que só existe aqui no servidor).
//
// Regras (as mesmas do protótipo):
//   admin   → cria cliente ou leitor de qualquer organização (e outro admin); altera qualquer um, menos a si
//   cliente → cria e altera só leitores da própria organização
//   leitor  → nada
//
// Ações:
//   criar      { nome, email, papel, organizacao_id } → { usuario, senha }
//   nova-senha { id }                                 → { email, senha }
//   ativo      { id, ativo }                          → { ok }
import { createClient } from 'npm:@supabase/supabase-js@2.57.4'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

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

// fácil de ditar por telefone: acervo-1234-abcd
function senhaProvisoria() {
  const letras = 'abcdefghjkmnpqrstuvwxyz'
  const r = crypto.getRandomValues(new Uint32Array(5))
  const num = String(1000 + (r[0] % 9000))
  const txt = Array.from(r.slice(1, 5), (x) => letras[x % letras.length]).join('')
  return `acervo-${num}-${txt}`
}

interface Perfil {
  id: string
  nome: string
  email: string
  papel: 'admin' | 'cliente' | 'leitor'
  organizacao_id: string | null
  ativo: boolean
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, chaveSecreta(), { auth: { persistSession: false } })
    const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    const { data: quem } = await admin.auth.getUser(jwt)
    if (!quem?.user) return json({ error: 'Sua sessão expirou. Entre de novo.' }, 401)
    const { data: eu } = await admin.from('perfis').select('*, organizacoes(ativo)').eq('id', quem.user.id).single()
    const orgAtiva = !eu?.organizacao_id || eu?.organizacoes?.ativo
    if (!eu?.ativo || !orgAtiva || !['admin', 'cliente'].includes(eu.papel)) return json({ error: 'Seu usuário não pode gerenciar contas.' }, 403)

    const registrar = (acao: string, detalhe: string) =>
      admin.from('auditoria').insert({ usuario_id: eu.id, acao, detalhe })

    const b = await req.json()

    // ---------- criar ----------
    if (b.acao === 'criar') {
      const nome = String(b.nome || '').trim()
      const email = String(b.email || '').trim().toLowerCase()
      const papel = String(b.papel || '')
      let org: string | null = b.organizacao_id || null
      if (!nome) return json({ error: 'Informe o nome.' }, 400)
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Informe um e-mail válido.' }, 400)
      if (!['admin', 'cliente', 'leitor'].includes(papel)) return json({ error: 'Papel inválido.' }, 400)
      if (eu.papel === 'cliente') {
        if (papel !== 'leitor' || (org && org !== eu.organizacao_id)) return json({ error: 'Você só pode criar leitores da sua organização.' }, 403)
        org = eu.organizacao_id
      }
      if (papel === 'admin') org = null
      else if (!org) return json({ error: 'Escolha a organização do usuário.' }, 400)
      if (org) {
        const { data: o } = await admin.from('organizacoes').select('id').eq('id', org).maybeSingle()
        if (!o) return json({ error: 'Organização não encontrada.' }, 404)
      }

      const senha = senhaProvisoria()
      const { data: criado, error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { nome } })
      if (error) return json({ error: /already|registered|exists/i.test(error.message) ? 'Já existe um usuário com esse e-mail.' : error.message }, 400)
      const { data: perfil, error: e2 } = await admin.from('perfis')
        .insert({ id: criado.user.id, nome, email, papel, organizacao_id: org, criado_por: eu.id, trocar_senha: true })
        .select('*').single()
      if (e2) {
        await admin.auth.admin.deleteUser(criado.user.id)
        return json({ error: e2.message }, 400)
      }
      await registrar('criou_usuario', `${nome} (${papel})`)
      return json({ usuario: perfil, senha })
    }

    // ---------- ações sobre alguém que já existe ----------
    const { data: alvo } = await admin.from('perfis').select('*').eq('id', String(b.id || '')).maybeSingle<Perfil>()
    if (!alvo) return json({ error: 'Usuário não encontrado.' }, 404)
    if (alvo.id === eu.id) return json({ error: 'Você não pode alterar o próprio acesso por aqui.' }, 400)
    if (eu.papel === 'cliente' && (alvo.papel !== 'leitor' || alvo.organizacao_id !== eu.organizacao_id)) {
      return json({ error: 'Você não tem permissão para alterar esse usuário.' }, 403)
    }

    if (b.acao === 'nova-senha') {
      const senha = senhaProvisoria()
      const { error } = await admin.auth.admin.updateUserById(alvo.id, { password: senha })
      if (error) return json({ error: error.message }, 400)
      await admin.from('perfis').update({ trocar_senha: true }).eq('id', alvo.id)
      await registrar('alterou_usuario', `${alvo.nome}: nova senha provisória`)
      return json({ email: alvo.email, senha })
    }

    if (b.acao === 'ativo') {
      const ativo = !!b.ativo
      // bloqueia também o login (não só os dados), e desbloqueia ao reativar
      const { error } = await admin.auth.admin.updateUserById(alvo.id, { ban_duration: ativo ? 'none' : '876000h' })
      if (error) return json({ error: error.message }, 400)
      await admin.from('perfis').update({ ativo }).eq('id', alvo.id)
      await registrar('alterou_usuario', `${alvo.nome}: ${ativo ? 'reativado' : 'desativado'}`)
      return json({ ok: true })
    }

    return json({ error: 'Ação desconhecida.' }, 400)
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})

// Camada de dados da F1: Supabase (banco, login, regras) + Cloudflare R2 (arquivos, via função `arquivos`).
// Tem exatamente as mesmas funções do modo demonstração (../mock); as telas não sabem qual está em uso.
// A permissão de verdade fica no banco (RLS); as checagens daqui só dão mensagens melhores.
import { createClient, type PostgrestError } from '@supabase/supabase-js'
import type { mockApi } from '../mock'
import type {
  AcaoAuditoria, AcertoPagina, AcessoDetalhado, Caixa, Catalogo, ContaDemo, DocResumo, Documento, Entidade,
  EscopoAcesso, EventoDetalhado, Filtros, ItemEnvio, Municipio, Organizacao, OrganizacaoResumo, Papel, Progresso,
  ResultadoBusca, TipoDocumento, Usuario,
} from '../types'
import { criarAvisos, montarResultado, nomeAlvo, partesDeTrecho, resumir, type DadosCatalogo, type ExtraBusca, type Topico } from '../comum'
import { compilarTermos } from '../../lib/termos'
import { comprimirSePreciso, LIMITE_ARQUIVO } from '../../lib/comprimir'
import { idbApagarDoc, idbGet, idbPut } from '../mock/idb'
import { calcularSha256, processarPdf } from '../mock/ingestao'

type Api = typeof mockApi
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Linha = Record<string, any>

// ---------- conversão banco (snake_case) → app (camelCase) ----------
const paraUsuario = (r: Linha): Usuario => ({
  id: r.id, nome: r.nome, email: r.email, papel: r.papel, organizacaoId: r.organizacao_id, criadoPor: r.criado_por,
  ativo: r.ativo, criadoEm: r.criado_em, trocarSenha: r.trocar_senha,
})
const paraOrg = (r: Linha): Organizacao => ({ id: r.id, nome: r.nome, cnpj: r.cnpj, ativo: r.ativo, criadoEm: r.criado_em })
const paraMunicipio = (r: Linha): Municipio => ({ id: r.id, nome: r.nome, uf: r.uf })
const paraEntidade = (r: Linha): Entidade => ({ id: r.id, municipioId: r.municipio_id, nome: r.nome, sigla: r.sigla })
const paraCaixa = (r: Linha): Caixa => ({ id: r.id, municipioId: r.municipio_id, codigo: r.codigo, anoInicial: r.ano_inicial, anoFinal: r.ano_final, descricao: r.descricao })
const paraTipo = (r: Linha): TipoDocumento => ({ id: r.id, nome: r.nome })
const paraDoc = (r: Linha): Documento => ({
  id: r.id, titulo: r.titulo, numero: r.numero, municipioId: r.municipio_id, entidadeId: r.entidade_id, caixaId: r.caixa_id,
  tipoId: r.tipo_id, ano: r.ano, mes: r.mes, paginas: r.paginas, status: r.status, erro: r.erro, arquivoNome: r.arquivo_nome,
  caminho: r.caminho, tamanhoKb: r.tamanho_kb, sha256: r.sha256, enviadoPor: r.enviado_por ?? '', criadoEm: r.criado_em,
})

function traduzir(e: PostgrestError | { message: string; code?: string }): Error {
  const code = (e as PostgrestError).code
  if (code === '23505') return new Error('Já existe um cadastro igual.')
  if (code === '23503') return new Error('Não dá para remover: há documentos ou outros cadastros usando este.')
  if (code === '42501' || /row-level security/i.test(e.message)) return new Error('Você não tem permissão para fazer isso.')
  if (code === 'PGRST301' || /JWT/i.test(e.message)) return new Error('Sua sessão terminou. Entre novamente.')
  return new Error(e.message)
}

// o cliente não tem os tipos gerados do banco; as linhas chegam soltas e são convertidas acima
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dados<T = any>(r: { data: unknown; error: PostgrestError | null }): T {
  if (r.error) throw traduzir(r.error)
  return r.data as T
}

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e))

async function emParalelo(tarefas: (() => Promise<unknown>)[], limite: number) {
  let i = 0
  const trabalhador = async () => {
    while (i < tarefas.length) await tarefas[i++]()
  }
  await Promise.all(Array.from({ length: Math.min(limite, tarefas.length) }, trabalhador))
}

// Onde cada arquivo de um documento fica no bucket `acervo` (Supabase Storage).
const BUCKET = 'acervo'
function caminho(doc: string, pagina: number): string {
  if (pagina === -1) return `${doc}/original.pdf`
  if (pagina === 0) return `${doc}/capa.webp`
  return `${doc}/p${pagina}.webp`
}

export function criarApiSupabase(url: string, chave: string): Api {
  const sb = createClient(url, chave)
  const avisos = criarAvisos()
  const avisar = avisos.avisar

  // ---------- sessão ----------
  let perfil: Usuario | null = null
  let org: Organizacao | null = null
  let iniciado = false

  async function carregarSessao() {
    const { data } = await sb.auth.getSession()
    const uid = data.session?.user.id
    perfil = null
    org = null
    if (!uid) return
    const { data: p } = await sb.from('perfis').select('*').eq('id', uid).maybeSingle()
    if (!p || !p.ativo) return
    if (p.organizacao_id) {
      // se o cliente estiver suspenso, a regra do banco esconde a organização
      const { data: o } = await sb.from('organizacoes').select('*').eq('id', p.organizacao_id).maybeSingle()
      if (!o?.ativo) return
      org = paraOrg(o)
    }
    perfil = paraUsuario(p)
  }

  function eu(): Usuario {
    if (!perfil) throw new Error('Sua sessão terminou. Entre novamente.')
    return perfil
  }
  function exigirAdmin(): Usuario {
    const u = eu()
    if (u.papel !== 'admin') throw new Error('Só o administrador pode fazer isso.')
    return u
  }

  async function registrar(acao: AcaoAuditoria, documentoId: string | null = null, detalhe = '') {
    const { error } = await sb.rpc('registrar', { p_acao: acao, p_documento: documentoId, p_detalhe: detalhe })
    if (error) throw traduzir(error)
  }

  // ---------- caches (recarregados quando algo muda ou a cada minuto) ----------
  let cat: { valor: DadosCatalogo; em: number } | null = null
  let docs: { valor: Documento[]; em: number } | null = null
  const VALIDADE_CACHE = 60_000

  async function catalogoAtual(): Promise<DadosCatalogo> {
    if (cat && Date.now() - cat.em < VALIDADE_CACHE) return cat.valor
    const [m, e, c, t] = await Promise.all([
      sb.from('municipios').select('*').order('nome'),
      sb.from('entidades').select('*').order('sigla'),
      sb.from('caixas').select('*').order('codigo'),
      sb.from('tipos_documento').select('*').order('nome'),
    ])
    const valor = {
      municipios: dados(m).map(paraMunicipio), entidades: dados(e).map(paraEntidade),
      caixas: dados(c).map(paraCaixa), tipos: dados(t).map(paraTipo),
    }
    cat = { valor, em: Date.now() }
    return valor
  }

  /** Todos os documentos que a pessoa pode ver (o banco filtra). */
  async function documentosVisiveis(): Promise<Documento[]> {
    if (docs && Date.now() - docs.em < VALIDADE_CACHE) return docs.valor
    const todos: Documento[] = []
    for (let de = 0; ; de += 1000) {
      const lote = dados(await sb.from('documentos').select('*').order('criado_em', { ascending: false }).range(de, de + 999))
      todos.push(...lote.map(paraDoc))
      if (lote.length < 1000) break
    }
    docs = { valor: todos, em: Date.now() }
    return todos
  }

  function mudou(topico: Topico = 'dados') {
    if (topico === 'dados') {
      cat = null
      docs = null
    }
    avisar(topico)
  }

  // ---------- links temporários (em lote: uma chamada para várias miniaturas) ----------
  const links = new Map<string, { url: string; ate: number }>()
  let lote: { doc: string; pagina: number; ok: (u: string | null) => void; falha: (e: unknown) => void }[] = []
  let agendado: ReturnType<typeof setTimeout> | null = null

  async function chamar<T>(funcao: 'usuarios', corpo: Record<string, unknown>): Promise<T> {
    const { data, error } = await sb.functions.invoke(funcao, { body: corpo })
    if (error) {
      let msg = error.message
      try {
        const j = await (error as { context?: Response }).context?.json()
        if (j?.error) msg = j.error
      } catch {
        /* resposta sem corpo */
      }
      throw new Error(msg)
    }
    if (data?.error) throw new Error(data.error)
    return data as T
  }

  async function enviarLote() {
    agendado = null
    const atual = lote
    lote = []
    for (let i = 0; i < atual.length; i += 300) {
      const parte = atual.slice(i, i + 300)
      try {
        // links assinados em lote; o Storage só assina o que a regra deixa a pessoa ver
        const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(parte.map((p) => caminho(p.doc, p.pagina)), 3600)
        if (error) throw new Error(error.message)
        parte.forEach((p, j) => {
          const u = data?.[j]?.signedUrl ?? null
          if (u) links.set(`${p.doc}:${p.pagina}`, { url: u, ate: Date.now() + 50 * 60_000 })
          p.ok(u)
        })
      } catch (e) {
        parte.forEach((p) => p.falha(e))
      }
    }
  }

  function link(doc: string, pagina: number): Promise<string | null> {
    const pronto = links.get(`${doc}:${pagina}`)
    if (pronto && pronto.ate > Date.now()) return Promise.resolve(pronto.url)
    return new Promise((ok, falha) => {
      lote.push({ doc, pagina, ok, falha })
      if (!agendado) agendado = setTimeout(enviarLote, 25)
    })
  }

  function esquecerLinks(doc: string) {
    for (const k of links.keys()) if (k.startsWith(`${doc}:`)) links.delete(k)
  }

  // ---------- processamento dos envios (no navegador do admin) ----------
  const progresso = new Map<string, Progresso>()
  let fila: string[] = []
  let processando = false
  const TRAVA = 'acervo-fila'

  function enfileirar(id: string) {
    if (!fila.includes(id)) fila.push(id)
    if (!processando) void rodarFila()
  }

  async function rodarFila() {
    processando = true
    try {
      const executar = async () => {
        while (fila.length) await processarUm(fila.shift()!)
      }
      if (navigator.locks) await navigator.locks.request(TRAVA, executar)
      else await executar()
    } finally {
      processando = false
    }
  }

  async function atualizarDoc(id: string, campos: Linha) {
    dados(await sb.from('documentos').update(campos).eq('id', id))
  }

  async function processarUm(id: string) {
    try {
      await atualizarDoc(id, { status: 'processando', erro: null })
      mudou()
      // arquivo guardado neste computador no envio; no reprocessamento, vem do armazenamento
      let arquivo = await idbGet<Blob>('arquivos', id)
      if (!arquivo) {
        const u = await link(id, -1)
        const r = u ? await fetch(u) : null
        if (!r?.ok) throw new Error('O arquivo não está neste computador nem no armazenamento. Remova e envie de novo.')
        arquivo = await r.blob()
      }
      const bytes = new Uint8Array(await arquivo.arrayBuffer())
      const sha = await calcularSha256(bytes)
      const { data: dup } = await sb.from('documentos').select('id, titulo').eq('sha256', sha).neq('id', id).maybeSingle()
      if (dup) throw new Error(`Arquivo idêntico a "${dup.titulo}".`)

      // acima do limite do armazenamento: reduz as imagens das páginas até caber (o texto não muda)
      let aviso: string | null = null
      if (arquivo.size > LIMITE_ARQUIVO) {
        const c = await comprimirSePreciso(arquivo, () => {
          progresso.set(id, { feitas: 0, total: 1 })
          avisar('progresso')
        })
        arquivo = c.arquivo
        aviso = `Comprimido de ${(c.antes / 1048576).toFixed(1)} MB para ${(c.depois / 1048576).toFixed(1)} MB para caber no armazenamento.`
      }
      const paraLer = aviso ? new Uint8Array(await arquivo.arrayBuffer()) : bytes

      const r = await processarPdf(paraLer, (feitas, total) => {
        progresso.set(id, { feitas, total })
        avisar('progresso')
      })
      const total = r.textos.length
      const guardar = async (pagina: number, corpo: Blob, tipo: string) => {
        const { error } = await sb.storage.from(BUCKET).upload(caminho(id, pagina), corpo, { contentType: tipo, upsert: true })
        if (error) {
          if (/exceeded|too large|size/i.test(error.message)) throw new Error('O arquivo passa do limite de tamanho do armazenamento (50 MB por arquivo no plano grátis).')
          throw new Error(`O armazenamento recusou o arquivo: ${error.message}`)
        }
      }
      await guardar(-1, arquivo, 'application/pdf')
      await guardar(0, r.capa, 'image/webp')
      await emParalelo(r.miniaturas.map((b, i) => () => guardar(i + 1, b, 'image/webp')), 6)

      dados(await sb.from('paginas').delete().eq('documento_id', id))
      for (let i = 0; i < total; i += 100) {
        const linhas = r.textos.slice(i, i + 100).map((texto, j) => ({ documento_id: id, numero: i + j + 1, texto }))
        dados(await sb.from('paginas').insert(linhas))
      }
      await atualizarDoc(id, {
        paginas: total, sha256: sha, status: 'pronto',
        erro: r.textos.every((t) => t.length < 20) ? 'O PDF não tem texto reconhecível. A busca por palavras não vai encontrar nada nele até passar por OCR.' : aviso,
      })
      await idbApagarDoc('arquivos', id) // já está no armazenamento; libera o espaço local
      esquecerLinks(id)
    } catch (e) {
      await atualizarDoc(id, { status: 'erro', erro: mensagem(e) }).catch(() => undefined)
    } finally {
      progresso.delete(id)
      mudou()
    }
  }

  /** Retoma envios que ficaram pela metade neste computador. */
  async function retomarFila() {
    if (navigator.locks) {
      const q = await navigator.locks.query()
      if (q.held?.some((l) => l.name === TRAVA)) return
    }
    const { data } = await sb.from('documentos').select('id').in('status', ['na_fila', 'processando'])
    for (const d of data ?? []) {
      if (await idbGet('arquivos', d.id)) enfileirar(d.id)
    }
  }

  // =====================================================================
  const api: Api = {
    modo: 'supabase',

    iniciar() {
      sb.auth.onAuthStateChange((evento) => {
        if (evento === 'INITIAL_SESSION' || evento === 'TOKEN_REFRESHED') return
        // fora do callback: o supabase-js não deixa chamar o banco de dentro dele
        setTimeout(async () => {
          await carregarSessao()
          mudou()
          mudou('auditoria')
        }, 0)
      })
      void carregarSessao()
        .catch(() => undefined)
        .finally(() => {
          iniciado = true
          avisar('dados')
          if (perfil?.papel === 'admin') void retomarFila()
        })
    },

    pronto: () => iniciado,
    assinar: (fn, topicos) => avisos.assinar(fn, topicos),

    async definirSenha(nova: string) {
      eu()
      if (nova.length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.')
      const { error } = await sb.auth.updateUser({ password: nova })
      if (error) throw new Error(/different|same/i.test(error.message) ? 'Escolha uma senha diferente da provisória.' : error.message)
      dados(await sb.rpc('senha_trocada'))
      if (perfil) perfil = { ...perfil, trocarSenha: false }
      mudou()
    },

    // ---------- sessão ----------
    contasDemo: (): ContaDemo[] => [],
    usuarioAtual: () => perfil,
    organizacaoDoUsuario: () => org,

    async entrar(email: string, senha: string) {
      const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password: senha })
      if (error) {
        if (/banned/i.test(error.message)) throw new Error('Este acesso foi desativado. Fale com quem cadastrou você.')
        throw new Error(/invalid/i.test(error.message) ? 'E-mail ou senha incorretos.' : error.message)
      }
      await carregarSessao()
      if (!perfil) {
        await sb.auth.signOut()
        throw new Error('Este acesso está desativado ou a sua organização está suspensa.')
      }
      await registrar('entrou').catch(() => undefined)
      mudou()
      if (perfil.papel === 'admin') void retomarFila()
      return perfil
    },

    async sair() {
      await sb.auth.signOut()
      perfil = null
      org = null
      mudou()
    },

    // ---------- catálogo ----------
    async catalogo(): Promise<Catalogo> {
      eu()
      const c = await catalogoAtual()
      return { municipios: [...c.municipios], entidades: [...c.entidades], caixas: [...c.caixas], tipos: [...c.tipos] }
    },

    // ---------- busca e leitura ----------
    async buscar(f: Filtros): Promise<ResultadoBusca> {
      const t0 = performance.now()
      eu()
      const [c, todos] = await Promise.all([catalogoAtual(), documentosVisiveis()])
      let base = todos.filter((d) => d.status === 'pronto')
      let extra: ExtraBusca | null = null
      if (f.texto?.trim() && compilarTermos(f.texto).length) {
        const linhas = dados(await sb.rpc('buscar_texto', { p_consulta: f.texto.trim() })) as Linha[]
        extra = new Map(linhas.map((l) => [l.documento_id as string, {
          paginasComAcerto: l.paginas_com_acerto, relevancia: l.relevancia,
          trecho: { pagina: l.primeira_pagina, partes: partesDeTrecho(l.trecho) },
        }]))
        base = base.filter((d) => extra!.has(d.id))
      }
      return montarResultado(base, f, c, extra, t0)
    },

    async registrarBusca(termo: string) {
      await registrar('buscou', null, termo)
      mudou('auditoria')
    },

    async documento(id: string): Promise<DocResumo> {
      eu()
      const r = dados(await sb.from('documentos').select('*').eq('id', id).maybeSingle())
      if (!r) throw new Error('Documento não encontrado ou sem permissão de acesso.')
      return resumir(paraDoc(r), await catalogoAtual())
    },

    async buscarNoDocumento(id: string, termo: string): Promise<AcertoPagina[]> {
      eu()
      if (!compilarTermos(termo).length) return []
      const linhas = dados(await sb.rpc('buscar_no_documento', { p_documento: id, p_consulta: termo })) as Linha[]
      return linhas.map((l) => ({
        pagina: l.pagina,
        ocorrencias: l.ocorrencias,
        trechos: String(l.trechos).split('|||').map((t) => partesDeTrecho(t)),
      }))
    },

    async urlDoArquivo(id: string) {
      eu()
      const u = await link(id, -1)
      if (!u) throw new Error('Documento não encontrado ou sem permissão de acesso.')
      return u
    },

    async miniatura(id: string, pagina: number) {
      eu()
      return link(id, pagina)
    },

    async registrarUso(acao: 'viu' | 'baixou' | 'imprimiu', id: string, detalhe = '') {
      await registrar(acao, id, detalhe)
      mudou('auditoria')
    },

    progresso: (id: string) => progresso.get(id),

    // ---------- administração de documentos ----------
    async listarDocumentos(): Promise<DocResumo[]> {
      exigirAdmin()
      const [c, todos] = await Promise.all([catalogoAtual(), documentosVisiveis()])
      return todos.map((d) => resumir(d, c))
    },

    async enviar(itens: ItemEnvio[]) {
      const u = exigirAdmin()
      const ids: string[] = []
      try {
        await navigator.storage?.persist?.().catch(() => undefined)
        for (const it of itens) {
          if (!it.titulo.trim()) throw new Error(`Informe o título de ${it.arquivo.name}.`)
          if (!it.municipioId || !it.tipoId || !it.ano) throw new Error(`Complete município, tipo e ano de ${it.arquivo.name}.`)
          let caixaId = it.caixaId
          if (caixaId?.startsWith('nova:')) {
            const codigo = caixaId.slice(5)
            const existente = dados(await sb.from('caixas').select('id').eq('municipio_id', it.municipioId).eq('codigo', codigo).maybeSingle())
            caixaId = existente?.id ?? dados(await sb.from('caixas').insert({ municipio_id: it.municipioId, codigo }).select('id').single()).id
          }
          const novo = dados(await sb.from('documentos').insert({
            titulo: it.titulo.trim(), numero: it.numero.trim(), municipio_id: it.municipioId, entidade_id: it.entidadeId,
            caixa_id: caixaId, tipo_id: it.tipoId, ano: it.ano, mes: it.mes, status: 'na_fila', arquivo_nome: it.arquivo.name,
            caminho: it.caminho, tamanho_kb: Math.round(it.arquivo.size / 1024), enviado_por: u.id,
          }).select('id').single())
          await idbPut('arquivos', novo.id, it.arquivo) // fica aqui até subir para o armazenamento
          await registrar('enviou', novo.id, it.arquivo.name)
          ids.push(novo.id)
        }
      } finally {
        mudou()
        ids.forEach(enfileirar)
      }
      return ids
    },

    async atualizarDocumento(id, d) {
      exigirAdmin()
      if (!d.titulo.trim()) throw new Error('O título é obrigatório.')
      if (!d.ano || d.ano < 1900 || d.ano > 2100) throw new Error('Ano inválido.')
      await atualizarDoc(id, {
        titulo: d.titulo.trim(), numero: d.numero.trim(), municipio_id: d.municipioId, entidade_id: d.entidadeId,
        caixa_id: d.caixaId, tipo_id: d.tipoId, ano: d.ano, mes: d.mes,
      })
      await registrar('editou', id, d.titulo.trim())
      mudou()
    },

    async removerDocumento(id: string) {
      exigirAdmin()
      const d = dados(await sb.from('documentos').select('titulo, paginas').eq('id', id).maybeSingle())
      if (!d) return
      fila = fila.filter((x) => x !== id)
      const caminhos = [caminho(id, -1), caminho(id, 0), ...Array.from({ length: d.paginas }, (_, i) => caminho(id, i + 1))]
      for (let i = 0; i < caminhos.length; i += 500) {
        const { error } = await sb.storage.from(BUCKET).remove(caminhos.slice(i, i + 500))
        if (error) throw new Error(`Não foi possível apagar os arquivos: ${error.message}`)
      }
      dados(await sb.from('documentos').delete().eq('id', id))
      await registrar('removeu', null, d.titulo)
      await idbApagarDoc('arquivos', id)
      esquecerLinks(id)
      mudou()
    },

    async reprocessar(id: string) {
      exigirAdmin()
      await atualizarDoc(id, { status: 'na_fila', erro: null, sha256: null })
      mudou()
      enfileirar(id)
    },

    // ---------- cadastros ----------
    async criarMunicipio(nome: string, uf: string) {
      exigirAdmin()
      if (!nome.trim() || !/^[A-Za-z]{2}$/.test(uf.trim())) throw new Error('Informe o nome e a UF com 2 letras.')
      const r = dados(await sb.from('municipios').insert({ nome: nome.trim(), uf: uf.trim().toUpperCase() }).select('*').single())
      await registrar('cadastro', null, `Município ${r.nome}/${r.uf}`)
      mudou()
      return paraMunicipio(r)
    },

    async criarEntidade(municipioId: string, nome: string, sigla: string) {
      exigirAdmin()
      if (!municipioId || !nome.trim() || !sigla.trim()) throw new Error('Informe município, nome e sigla.')
      const r = dados(await sb.from('entidades').insert({ municipio_id: municipioId, nome: nome.trim(), sigla: sigla.trim() }).select('*').single())
      await registrar('cadastro', null, `Entidade ${r.sigla}`)
      mudou()
      return paraEntidade(r)
    },

    async criarCaixa(d: Omit<Caixa, 'id'>) {
      exigirAdmin()
      const codigo = d.codigo.trim().toUpperCase()
      if (!d.municipioId || !codigo) throw new Error('Informe o município e o código da caixa.')
      if (d.anoInicial && d.anoFinal && d.anoInicial > d.anoFinal) throw new Error('O ano inicial não pode ser maior que o final.')
      const r = await sb.from('caixas').insert({ municipio_id: d.municipioId, codigo, ano_inicial: d.anoInicial, ano_final: d.anoFinal, descricao: d.descricao }).select('*').single()
      if (r.error?.code === '23505') throw new Error('Já existe uma caixa com esse código neste município.')
      const c = dados(r)
      await registrar('cadastro', null, `Caixa ${c.codigo}`)
      mudou()
      return paraCaixa(c)
    },

    async criarTipo(nome: string) {
      exigirAdmin()
      if (!nome.trim()) throw new Error('Informe o nome do tipo.')
      const r = await sb.from('tipos_documento').insert({ nome: nome.trim() }).select('*').single()
      if (r.error?.code === '23505') throw new Error('Esse tipo já existe.')
      const t = dados(r)
      await registrar('cadastro', null, `Tipo ${t.nome}`)
      mudou()
      return paraTipo(t)
    },

    async removerCadastro(tipo, id) {
      exigirAdmin()
      const { count } = await sb.from('acessos').select('id', { count: 'exact', head: true }).or(`alvo_id.eq.${id},tipo_id.eq.${id}`)
      if (count) throw new Error('Não dá para remover: existe acesso concedido usando este cadastro.')
      const tabela = { municipio: 'municipios', entidade: 'entidades', caixa: 'caixas', tipo: 'tipos_documento' }[tipo]
      const r = await sb.from(tabela).delete().eq('id', id)
      if (r.error?.code === '23503') {
        throw new Error(tipo === 'municipio' ? 'Não dá para remover: há entidades, caixas ou documentos deste município.' : 'Não dá para remover: há documentos usando este cadastro.')
      }
      dados(r)
      mudou()
    },

    // ---------- clientes e acessos ----------
    async listarOrganizacoes(): Promise<OrganizacaoResumo[]> {
      exigirAdmin()
      const [o, r] = await Promise.all([sb.from('organizacoes').select('*').order('nome'), sb.rpc('resumo_organizacoes')])
      const resumo = new Map((dados(r) as Linha[]).map((x) => [x.organizacao_id as string, x]))
      return dados<Linha[]>(o).map((x) => {
        const s = resumo.get(x.id)
        return { ...paraOrg(x), usuarios: s?.usuarios ?? 0, acessos: s?.acessos ?? 0, documentosVisiveis: s?.documentos_visiveis ?? 0 }
      })
    },

    async organizacao(id: string): Promise<OrganizacaoResumo> {
      const u = eu()
      if (u.papel !== 'admin' && u.organizacaoId !== id) throw new Error('Sem permissão.')
      const o = dados(await sb.from('organizacoes').select('*').eq('id', id).maybeSingle())
      if (!o) throw new Error('Cliente não encontrado.')
      let s: Linha | undefined
      if (u.papel === 'admin') s = (dados(await sb.rpc('resumo_organizacoes')) as Linha[]).find((x) => x.organizacao_id === id)
      return { ...paraOrg(o), usuarios: s?.usuarios ?? 0, acessos: s?.acessos ?? 0, documentosVisiveis: s?.documentos_visiveis ?? 0 }
    },

    async criarOrganizacao(nome: string, cnpj: string) {
      exigirAdmin()
      if (!nome.trim()) throw new Error('Informe o nome do cliente.')
      if (cnpj && cnpj.replace(/\D/g, '').length !== 14) throw new Error('O CNPJ precisa ter 14 dígitos.')
      const o = paraOrg(dados(await sb.from('organizacoes').insert({ nome: nome.trim(), cnpj }).select('*').single()))
      await registrar('criou_cliente', null, o.nome)
      mudou()
      return o
    },

    async atualizarOrganizacao(id, d) {
      exigirAdmin()
      if (!d.nome.trim()) throw new Error('Informe o nome do cliente.')
      if (d.cnpj && d.cnpj.replace(/\D/g, '').length !== 14) throw new Error('O CNPJ precisa ter 14 dígitos.')
      dados(await sb.from('organizacoes').update({ nome: d.nome.trim(), cnpj: d.cnpj, ativo: d.ativo }).eq('id', id))
      await registrar('alterou_cliente', null, `${d.nome.trim()}${d.ativo ? '' : ' (suspenso)'}`)
      mudou()
    },

    async listarAcessos(orgId: string): Promise<AcessoDetalhado[]> {
      exigirAdmin()
      const [linhas, c, todos] = await Promise.all([sb.from('acessos').select('*').eq('organizacao_id', orgId).order('em'), catalogoAtual(), documentosVisiveis()])
      return dados<Linha[]>(linhas).map((a) => ({
        id: a.id, organizacaoId: a.organizacao_id, escopo: a.escopo, alvoId: a.alvo_id, tipoId: a.tipo_id,
        concedidoPor: a.concedido_por ?? '', em: a.em,
        alvoNome: nomeAlvo(a.escopo, a.alvo_id, c, todos),
        tipoNome: a.tipo_id ? c.tipos.find((t) => t.id === a.tipo_id)?.nome ?? null : null,
      }))
    },

    async conceder(orgId: string, escopo: EscopoAcesso, alvoId: string, tipoId: string | null) {
      const u = exigirAdmin()
      if (!alvoId) throw new Error('Escolha o que será liberado.')
      const r = await sb.from('acessos').insert({ organizacao_id: orgId, escopo, alvo_id: alvoId, tipo_id: tipoId, concedido_por: u.id })
      if (r.error?.code === '23505') throw new Error('Esse acesso já foi concedido.')
      dados(r)
      const [c, todos, o] = await Promise.all([catalogoAtual(), documentosVisiveis(), sb.from('organizacoes').select('nome').eq('id', orgId).single()])
      await registrar('concedeu', escopo === 'documento' ? alvoId : null, `${o.data?.nome ?? ''}: ${nomeAlvo(escopo, alvoId, c, todos)}`)
      mudou()
    },

    async revogar(acessoId: string) {
      exigirAdmin()
      const a = dados(await sb.from('acessos').select('*, organizacoes(nome)').eq('id', acessoId).maybeSingle())
      if (!a) return
      dados(await sb.from('acessos').delete().eq('id', acessoId))
      const [c, todos] = await Promise.all([catalogoAtual(), documentosVisiveis()])
      await registrar('revogou', null, `${a.organizacoes?.nome ?? ''}: ${nomeAlvo(a.escopo, a.alvo_id, c, todos)}`)
      mudou()
    },

    // ---------- usuários ----------
    async listarUsuarios(orgId?: string): Promise<Usuario[]> {
      const u = eu()
      if (u.papel === 'leitor') throw new Error('Sem permissão.')
      let q = sb.from('perfis').select('*').order('nome')
      if (orgId) q = q.eq('organizacao_id', orgId)
      return dados(await q).map(paraUsuario)
    },

    async criarUsuario(d: { nome: string; email: string; papel: Papel; organizacaoId: string | null }) {
      eu()
      const r = await chamar<{ usuario: Linha; senha: string }>('usuarios', { acao: 'criar', nome: d.nome, email: d.email, papel: d.papel, organizacao_id: d.organizacaoId })
      mudou()
      mudou('auditoria')
      return { usuario: paraUsuario(r.usuario), senha: r.senha }
    },

    async definirUsuarioAtivo(id: string, ativo: boolean) {
      eu()
      await chamar('usuarios', { acao: 'ativo', id, ativo })
      mudou()
    },

    async redefinirSenha(id: string) {
      eu()
      const r = await chamar<{ senha: string }>('usuarios', { acao: 'nova-senha', id })
      mudou('auditoria')
      return r.senha
    },

    // ---------- auditoria ----------
    async listarAuditoria(): Promise<EventoDetalhado[]> {
      exigirAdmin()
      const [ev, ps, os, todos] = await Promise.all([
        sb.from('auditoria').select('*').order('em', { ascending: false }).limit(3000),
        sb.from('perfis').select('id, nome, papel, organizacao_id'),
        sb.from('organizacoes').select('id, nome'),
        documentosVisiveis(),
      ])
      const pessoas = new Map(dados<Linha[]>(ps).map((p) => [p.id as string, p]))
      const orgs = new Map(dados<Linha[]>(os).map((o) => [o.id as string, o.nome as string]))
      const titulos = new Map(todos.map((d) => [d.id, d.titulo]))
      return dados<Linha[]>(ev).map((e) => {
        const p = pessoas.get(e.usuario_id)
        return {
          id: String(e.id), usuarioId: e.usuario_id ?? '', acao: e.acao, documentoId: e.documento_id, detalhe: e.detalhe, em: e.em,
          usuarioNome: p?.nome ?? '(removido)', papel: p?.papel ?? 'leitor',
          organizacao: p?.organizacao_id ? orgs.get(p.organizacao_id) ?? null : null,
          documentoTitulo: e.documento_id ? titulos.get(e.documento_id) ?? null : null,
        }
      })
    },

    async resetar() {
      throw new Error('Apagar tudo só existe no modo demonstração.')
    },
  }
  return api
}

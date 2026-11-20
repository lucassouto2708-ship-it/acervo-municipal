// Camada de dados da F0: roda inteira no navegador.
// Metadados ficam no localStorage; PDFs, textos e miniaturas no IndexedDB.
// Na F1 este arquivo é trocado por uma implementação Supabase com as mesmas funções.
import type {
  Acesso, AcessoDetalhado, AcaoAuditoria, AcertoPagina, Caixa, Catalogo, ContaDemo, DocResumo, Documento,
  Entidade, EscopoAcesso, EventoAuditoria, EventoDetalhado, Filtros, ItemEnvio, Municipio, Organizacao,
  OrganizacaoResumo, Papel, Progresso, ResultadoBusca, TipoDocumento, Trecho, Usuario,
} from '../types'
import { criarAvisos, montarResultado, nomeAlvo as nomeDoAlvo, resumir, type ExtraBusca, type Topico } from '../comum'
import { normalizar, senhaProvisoria, uid } from '../../lib/util'
import { casaAlgum, compilarTermos, contar, trechos } from '../../lib/termos'
import { idbApagarDoc, idbGet, idbLimparTudo, idbPut, idbPutVarios } from './idb'
import { calcularSha256, processarPdf } from './ingestao'

type UsuarioInterno = Usuario & { senha: string }

interface Estado {
  versao: 1
  organizacoes: Organizacao[]
  usuarios: UsuarioInterno[]
  municipios: Municipio[]
  entidades: Entidade[]
  caixas: Caixa[]
  tipos: TipoDocumento[]
  documentos: Documento[]
  acessos: Acesso[]
  auditoria: EventoAuditoria[]
  sessao: string | null
}

const CHAVE = 'acervo.f0.estado.v1'

const CONTAS_DEMO: ContaDemo[] = [
  { nome: 'Lucas Souto', email: 'admin@acervo.local', senha: 'admin123', papel: 'admin' },
  { nome: 'Usuário do IPREMA', email: 'cliente@iprema.local', senha: 'cliente123', papel: 'cliente' },
  { nome: 'Leitor do IPREMA', email: 'leitor@iprema.local', senha: 'leitor123', papel: 'leitor' },
]

function estadoInicial(): Estado {
  const em = new Date().toISOString()
  const mun: Municipio = { id: 'mun_alpercata', nome: 'Alpercata', uf: 'MG' }
  const tipos = ['Movimento contábil', 'Minuta contábil', 'Balancete', 'Lei', 'Decreto', 'Portaria', 'Contrato']
  return {
    versao: 1,
    organizacoes: [{ id: 'org_iprema', nome: 'IPREMA · Instituto de Previdência de Alpercata', cnpj: '', ativo: true, criadoEm: em }],
    usuarios: [
      { id: 'usr_admin', nome: CONTAS_DEMO[0].nome, email: CONTAS_DEMO[0].email, senha: CONTAS_DEMO[0].senha, papel: 'admin', organizacaoId: null, criadoPor: null, ativo: true, criadoEm: em },
      { id: 'usr_cliente', nome: CONTAS_DEMO[1].nome, email: CONTAS_DEMO[1].email, senha: CONTAS_DEMO[1].senha, papel: 'cliente', organizacaoId: 'org_iprema', criadoPor: 'usr_admin', ativo: true, criadoEm: em },
      { id: 'usr_leitor', nome: CONTAS_DEMO[2].nome, email: CONTAS_DEMO[2].email, senha: CONTAS_DEMO[2].senha, papel: 'leitor', organizacaoId: 'org_iprema', criadoPor: 'usr_cliente', ativo: true, criadoEm: em },
    ],
    municipios: [mun],
    entidades: [
      { id: 'ent_iprema', municipioId: mun.id, nome: 'Instituto de Previdência Municipal de Alpercata', sigla: 'IPREMA' },
      { id: 'ent_prefeitura', municipioId: mun.id, nome: 'Prefeitura Municipal de Alpercata', sigla: 'Prefeitura' },
      { id: 'ent_camara', municipioId: mun.id, nome: 'Câmara Municipal de Alpercata', sigla: 'Câmara' },
    ],
    caixas: [],
    tipos: tipos.map((nome) => ({ id: `tipo_${normalizar(nome).replace(/[^a-z]+/g, '_')}`, nome })),
    documentos: [],
    acessos: [{ id: 'ace_iprema', organizacaoId: 'org_iprema', escopo: 'entidade', alvoId: 'ent_iprema', tipoId: null, concedidoPor: 'usr_admin', em }],
    auditoria: [],
    sessao: null,
  }
}

function carregar(): Estado {
  try {
    const s = localStorage.getItem(CHAVE)
    if (s) return JSON.parse(s) as Estado
  } catch {
    /* sem localStorage: começa do zero */
  }
  return estadoInicial()
}

let estado: Estado = carregar()

function salvar() {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(estado))
  } catch {
    /* cota cheia ou bloqueado: segue só em memória */
  }
}

// ---------- avisos para as telas ----------
const avisos = criarAvisos()
const avisar = avisos.avisar
function mudou(topico: Topico = 'dados') {
  salvar()
  avisar(topico)
}

// ---------- utilidades internas ----------
function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function publico(u: UsuarioInterno): Usuario {
  return { id: u.id, nome: u.nome, email: u.email, papel: u.papel, organizacaoId: u.organizacaoId, criadoPor: u.criadoPor, ativo: u.ativo, criadoEm: u.criadoEm }
}

const org = (id: string | null) => estado.organizacoes.find((o) => o.id === id)
const doc = (id: string) => estado.documentos.find((d) => d.id === id)

function eu(): UsuarioInterno {
  const u = estado.usuarios.find((x) => x.id === estado.sessao)
  if (!u || !u.ativo) throw new Error('Sua sessão terminou. Entre novamente.')
  if (u.organizacaoId && !org(u.organizacaoId)?.ativo) throw new Error('O acesso da sua organização está suspenso.')
  return u
}

function exigirAdmin(): UsuarioInterno {
  const u = eu()
  if (u.papel !== 'admin') throw new Error('Só o administrador pode fazer isso.')
  return u
}

function registrar(acao: AcaoAuditoria, documentoId: string | null, detalhe = '') {
  const usuarioId = estado.sessao
  if (!usuarioId) return
  estado.auditoria.unshift({ id: uid('aud'), usuarioId, acao, documentoId, detalhe, em: new Date().toISOString() })
  if (estado.auditoria.length > 5000) estado.auditoria.length = 5000
}

function cobre(a: Acesso, d: Documento): boolean {
  if (a.tipoId && a.tipoId !== d.tipoId) return false
  switch (a.escopo) {
    case 'municipio': return a.alvoId === d.municipioId
    case 'entidade': return a.alvoId === d.entidadeId
    case 'caixa': return a.alvoId === d.caixaId
    case 'documento': return a.alvoId === d.id
  }
}

function orgVe(orgId: string, d: Documento): boolean {
  return d.status === 'pronto' && estado.acessos.some((a) => a.organizacaoId === orgId && cobre(a, d))
}

/** Mesma regra que a função `pode_ver` vai ter no Postgres (RLS). */
function podeVer(u: UsuarioInterno, d: Documento): boolean {
  if (u.papel === 'admin') return true
  return !!u.organizacaoId && orgVe(u.organizacaoId, d)
}

const resumo = (d: Documento): DocResumo => resumir(d, estado)

function docVisivel(id: string): Documento {
  const u = eu()
  const d = doc(id)
  if (!d || !podeVer(u, d)) throw new Error('Documento não encontrado ou sem permissão de acesso.')
  return d
}

// ---------- texto das páginas (cache em memória) ----------
const textos = new Map<string, { orig: string[]; norm: string[] }>()
async function textosDe(id: string) {
  let t = textos.get(id)
  if (!t) {
    const orig = (await idbGet<string[]>('textos', id)) ?? []
    t = { orig, norm: orig.map(normalizar) }
    textos.set(id, t)
  }
  return t
}

// ---------- URLs de arquivos e miniaturas ----------
const urls = new Map<string, string>()
async function urlDe(loja: 'arquivos' | 'miniaturas', chave: string): Promise<string | null> {
  const k = `${loja}|${chave}`
  const pronta = urls.get(k)
  if (pronta) return pronta
  const blob = await idbGet<Blob>(loja, chave)
  if (!blob) return null
  const url = URL.createObjectURL(blob)
  urls.set(k, url)
  return url
}
function esquecerUrls(docId: string) {
  for (const [k, url] of urls) {
    if (k.includes(`|${docId}`)) {
      URL.revokeObjectURL(url)
      urls.delete(k)
    }
  }
}

// ---------- fila de processamento ----------
const progresso = new Map<string, Progresso>()
let fila: string[] = []
let processandoFila = false

function enfileirar(id: string) {
  if (!fila.includes(id)) fila.push(id)
  if (!processandoFila) void rodarFila()
}

// Só uma aba processa por vez (Web Locks); as outras esperam.
const TRAVA_FILA = 'acervo-f0-fila'

async function rodarFila() {
  processandoFila = true
  try {
    const executar = async () => {
      while (fila.length) await processarUm(fila.shift()!)
    }
    if (navigator.locks) await navigator.locks.request(TRAVA_FILA, executar)
    else await executar()
  } finally {
    processandoFila = false
  }
}


function falhar(id: string, erro: string) {
  const d = doc(id)
  if (!d) return
  d.status = 'erro'
  d.erro = erro
}

async function processarUm(id: string) {
  const d = doc(id)
  if (!d) return
  d.status = 'processando'
  d.erro = null
  mudou()
  try {
    const blob = await idbGet<Blob>('arquivos', id)
    if (!blob) return falhar(id, 'O arquivo não está mais no armazenamento. Envie de novo.')
    const dados = new Uint8Array(await blob.arrayBuffer())
    const sha = await calcularSha256(dados)
    const dup = estado.documentos.find((o) => o.id !== id && o.sha256 === sha)
    if (dup) return falhar(id, `Arquivo idêntico a "${dup.titulo}".`)
    const r = await processarPdf(dados, (feitas, total) => {
      progresso.set(id, { feitas, total })
      avisar('progresso')
    })
    if (!doc(id)) return // removido (ou dados apagados) durante o processamento
    await idbPut('textos', id, r.textos)
    await idbPutVarios('miniaturas', [[`${id}:capa`, r.capa], ...r.miniaturas.map((b, i): [string, Blob] => [`${id}:${i + 1}`, b])])
    textos.delete(id)
    esquecerUrls(id)
    const atual = doc(id)
    if (!atual) {
      await Promise.all([idbApagarDoc('textos', id), idbApagarDoc('miniaturas', id)])
      return
    }
    atual.paginas = r.textos.length
    atual.sha256 = sha
    atual.status = 'pronto'
    atual.erro = r.textos.every((t) => t.length < 20)
      ? 'O PDF não tem texto reconhecível. A busca por palavras não vai encontrar nada nele até passar por OCR.'
      : null
  } catch (e) {
    falhar(id, `Não foi possível ler o PDF: ${mensagem(e)}`)
  } finally {
    progresso.delete(id)
    mudou()
  }
}


const nomeAlvo = (escopo: EscopoAcesso, alvoId: string) => nomeDoAlvo(escopo, alvoId, estado, estado.documentos)

function validarEmail(email: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Informe um e-mail válido.')
  if (estado.usuarios.some((u) => u.email.toLowerCase() === email.toLowerCase())) throw new Error('Já existe um usuário com esse e-mail.')
}

function podeGerirUsuario(alvo: UsuarioInterno): void {
  const u = eu()
  if (u.papel === 'admin') {
    if (alvo.id === u.id) throw new Error('Você não pode alterar o próprio acesso por aqui.')
    return
  }
  if (u.papel === 'cliente' && alvo.papel === 'leitor' && alvo.organizacaoId === u.organizacaoId) return
  throw new Error('Você não tem permissão para alterar esse usuário.')
}

// =====================================================================
export const mockApi = {
  modo: 'demonstracao' as 'demonstracao' | 'supabase',

  /** Liga o que só faz sentido quando este modo está em uso. */
  iniciar(): void {
    // Outra aba mudou os dados: recarrega para não sobrescrever o trabalho dela.
    window.addEventListener('storage', (e) => {
      if (e.key !== CHAVE) return
      try {
        estado = e.newValue ? (JSON.parse(e.newValue) as Estado) : estadoInicial()
      } catch {
        return
      }
      avisar('dados')
      avisar('auditoria')
    })
    // retoma o que ficou pela metade quando a página foi fechada (se outra aba já processa, deixa com ela)
    setTimeout(async () => {
      const pendentes = estado.documentos.filter((d) => d.status === 'na_fila' || d.status === 'processando')
      if (!pendentes.length) return
      if (navigator.locks) {
        const q = await navigator.locks.query()
        if (q.held?.some((l) => l.name === TRAVA_FILA)) return
      }
      pendentes.forEach((d) => enfileirar(d.id))
    }, 300)
  },

  /** true quando a sessão já foi verificada (no Supabase isso leva um instante). */
  pronto(): boolean {
    return true
  },

  assinar(fn: () => void, topicos: Topico[] = ['dados']): () => void {
    return avisos.assinar(fn, topicos)
  },

  /** Troca da senha provisória. No modo demonstração não há senha provisória. */
  async definirSenha(_nova: string): Promise<void> {
    eu()
  },

  // ---------- sessão ----------
  contasDemo(): ContaDemo[] {
    return CONTAS_DEMO
  },

  usuarioAtual(): Usuario | null {
    const u = estado.usuarios.find((x) => x.id === estado.sessao)
    if (!u || !u.ativo) return null
    if (u.organizacaoId && !org(u.organizacaoId)?.ativo) return null
    return publico(u)
  },

  organizacaoDoUsuario(): Organizacao | null {
    const u = this.usuarioAtual()
    return u?.organizacaoId ? org(u.organizacaoId) ?? null : null
  },

  async entrar(email: string, senha: string): Promise<Usuario> {
    const u = estado.usuarios.find((x) => x.email.toLowerCase() === email.trim().toLowerCase())
    if (!u || u.senha !== senha) throw new Error('E-mail ou senha incorretos.')
    if (!u.ativo) throw new Error('Este acesso foi desativado. Fale com quem cadastrou você.')
    if (u.organizacaoId && !org(u.organizacaoId)?.ativo) throw new Error('O acesso da sua organização está suspenso.')
    estado.sessao = u.id
    registrar('entrou', null)
    mudou()
    return publico(u)
  },

  async sair(): Promise<void> {
    estado.sessao = null
    mudou()
  },

  // ---------- catálogo ----------
  async catalogo(): Promise<Catalogo> {
    eu()
    return { municipios: [...estado.municipios], entidades: [...estado.entidades], caixas: [...estado.caixas], tipos: [...estado.tipos] }
  },

  // ---------- busca e leitura ----------
  async buscar(f: Filtros): Promise<ResultadoBusca> {
    const t0 = performance.now()
    const u = eu()
    let base = estado.documentos.filter((d) => d.status === 'pronto' && podeVer(u, d))
    const termos = f.texto?.trim() ? compilarTermos(f.texto) : []
    let extra: ExtraBusca | null = null
    if (termos.length) {
      extra = new Map()
      const casados: Documento[] = []
      for (const d of base) {
        const r = resumo(d)
        const meta = normalizar(`${d.titulo} ${d.arquivoNome} ${d.numero} ${d.descricao ?? ''} ${r.tipo} ${r.entidade ?? ''} ${r.caixa ?? ''}`)
        const t = await textosDe(d.id)
        let total = 0
        let todos = true
        for (const re of termos) {
          let n = contar(meta, re)
          for (const p of t.norm) n += contar(p, re)
          if (!n) {
            todos = false
            break
          }
          total += n
        }
        if (!todos) continue
        let trecho: Trecho | undefined
        let paginasComAcerto = 0
        for (let i = 0; i < t.norm.length; i++) {
          if (!casaAlgum(t.norm[i], termos)) continue
          paginasComAcerto++
          if (!trecho) trecho = { pagina: i + 1, partes: trechos(t.orig[i], t.norm[i], termos, 1).trechos[0] }
        }
        extra.set(d.id, { ocorrencias: total, paginasComAcerto, relevancia: total, trecho })
        casados.push(d)
      }
      base = casados
    }
    return montarResultado(base, f, estado, extra, t0)
  },

  async registrarBusca(termo: string): Promise<void> {
    eu()
    const ultimo = estado.auditoria[0]
    if (ultimo?.acao === 'buscou' && ultimo.detalhe === termo && ultimo.usuarioId === estado.sessao) return
    registrar('buscou', null, termo)
    mudou('auditoria')
  },

  async documento(id: string): Promise<DocResumo> {
    return resumo(docVisivel(id))
  },

  async buscarNoDocumento(id: string, termo: string): Promise<AcertoPagina[]> {
    docVisivel(id)
    const termos = compilarTermos(termo)
    if (!termos.length) return []
    const t = await textosDe(id)
    const out: AcertoPagina[] = []
    t.norm.forEach((norm, i) => {
      if (!casaAlgum(norm, termos)) return
      const r = trechos(t.orig[i], norm, termos, 2)
      out.push({ pagina: i + 1, ocorrencias: r.ocorrencias, trechos: r.trechos })
    })
    return out
  },

  async urlDoArquivo(id: string): Promise<string> {
    docVisivel(id)
    const url = await urlDe('arquivos', id)
    if (!url) throw new Error('O arquivo deste documento não foi encontrado.')
    return url
  },

  /** pagina 0 = capa */
  async miniatura(id: string, pagina: number): Promise<string | null> {
    docVisivel(id)
    return urlDe('miniaturas', pagina === 0 ? `${id}:capa` : `${id}:${pagina}`)
  },

  async registrarUso(acao: 'viu' | 'baixou' | 'imprimiu', id: string, detalhe = ''): Promise<void> {
    docVisivel(id)
    // evita registro dobrado (ex.: a mesma abertura contada duas vezes em menos de 5 s)
    const ultimo = estado.auditoria[0]
    if (ultimo && ultimo.acao === acao && ultimo.documentoId === id && ultimo.detalhe === detalhe && ultimo.usuarioId === estado.sessao && Date.now() - Date.parse(ultimo.em) < 5000) return
    registrar(acao, id, detalhe)
    mudou('auditoria')
  },

  progresso(id: string): Progresso | undefined {
    return progresso.get(id)
  },

  // ---------- administração de documentos ----------
  async listarDocumentos(): Promise<DocResumo[]> {
    exigirAdmin()
    return estado.documentos.map(resumo).sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))
  },

  async enviar(itens: ItemEnvio[]): Promise<string[]> {
    const u = exigirAdmin()
    const ids: string[] = []
    // F0 guarda os PDFs no navegador: confere o espaço e pede para não serem apagados
    try {
      await navigator.storage?.persist?.()
      const est = await navigator.storage?.estimate?.()
      const precisa = itens.reduce((s, it) => s + it.arquivo.size, 0) * 1.15
      if (est?.quota && est.usage !== undefined && est.usage + precisa > est.quota) {
        throw new Error(`Espaço insuficiente no navegador: faltam cerca de ${Math.ceil((est.usage + precisa - est.quota) / 1048576)} MB. Remova documentos ou envie menos arquivos.`)
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('Espaço insuficiente')) throw e
    }
    try {
    for (const it of itens) {
      if (!it.titulo.trim()) throw new Error(`Informe o título de ${it.arquivo.name}.`)
      if (!it.municipioId || !it.tipoId || !it.ano) throw new Error(`Complete município, tipo e ano de ${it.arquivo.name}.`)
      let caixaId = it.caixaId
      if (caixaId?.startsWith('nova:')) {
        const codigo = caixaId.slice(5)
        let cx = estado.caixas.find((c) => c.municipioId === it.municipioId && c.codigo === codigo)
        if (!cx) {
          cx = { id: uid('cx'), municipioId: it.municipioId, codigo, anoInicial: null, anoFinal: null, descricao: '' }
          estado.caixas.push(cx)
        }
        caixaId = cx.id
      }
      const id = uid('doc')
      await idbPut('arquivos', id, it.arquivo)
      estado.documentos.push({
        id, titulo: it.titulo.trim(), numero: it.numero.trim(), descricao: it.descricao.trim(), municipioId: it.municipioId, entidadeId: it.entidadeId,
        caixaId, tipoId: it.tipoId, ano: it.ano, mes: it.mes, paginas: 0, status: 'na_fila', erro: null,
        arquivoNome: it.arquivo.name, caminho: it.caminho, tamanhoKb: Math.round(it.arquivo.size / 1024),
        sha256: null, enviadoPor: u.id, criadoEm: new Date().toISOString(),
      })
      registrar('enviou', id, it.arquivo.name)
      ids.push(id)
    }
    } finally {
      // mesmo se um arquivo falhar no meio, os que já entraram seguem para a fila
      mudou()
      ids.forEach(enfileirar)
    }
    return ids
  },

  async atualizarDocumento(id: string, dados: Pick<Documento, 'titulo' | 'numero' | 'descricao' | 'municipioId' | 'entidadeId' | 'caixaId' | 'tipoId' | 'ano' | 'mes'>): Promise<void> {
    exigirAdmin()
    const d = doc(id)
    if (!d) throw new Error('Documento não encontrado.')
    if (!dados.titulo.trim()) throw new Error('O título é obrigatório.')
    if (!dados.ano || dados.ano < 1900 || dados.ano > 2100) throw new Error('Ano inválido.')
    Object.assign(d, { ...dados, titulo: dados.titulo.trim(), numero: dados.numero.trim(), descricao: (dados.descricao ?? '').trim() })
    registrar('editou', id, d.titulo)
    mudou()
  },

  async removerDocumento(id: string): Promise<void> {
    exigirAdmin()
    const d = doc(id)
    if (!d) return
    fila = fila.filter((x) => x !== id)
    estado.documentos = estado.documentos.filter((x) => x.id !== id)
    estado.acessos = estado.acessos.filter((a) => !(a.escopo === 'documento' && a.alvoId === id))
    registrar('removeu', null, d.titulo)
    mudou()
    textos.delete(id)
    esquecerUrls(id)
    await Promise.all([idbApagarDoc('arquivos', id), idbApagarDoc('textos', id), idbApagarDoc('miniaturas', id)])
  },

  async reprocessar(id: string): Promise<void> {
    exigirAdmin()
    const d = doc(id)
    if (!d) throw new Error('Documento não encontrado.')
    d.status = 'na_fila'
    d.erro = null
    d.sha256 = null
    mudou()
    enfileirar(id)
  },

  // ---------- cadastros ----------
  async criarMunicipio(nome: string, uf: string): Promise<Municipio> {
    exigirAdmin()
    if (!nome.trim() || !/^[A-Za-z]{2}$/.test(uf.trim())) throw new Error('Informe o nome e a UF com 2 letras.')
    if (estado.municipios.some((m) => normalizar(m.nome) === normalizar(nome.trim()) && m.uf === uf.toUpperCase())) throw new Error('Esse município já está cadastrado.')
    const m = { id: uid('mun'), nome: nome.trim(), uf: uf.trim().toUpperCase() }
    estado.municipios.push(m)
    registrar('cadastro', null, `Município ${m.nome}/${m.uf}`)
    mudou()
    return m
  },

  async criarEntidade(municipioId: string, nome: string, sigla: string): Promise<Entidade> {
    exigirAdmin()
    if (!municipioId || !nome.trim() || !sigla.trim()) throw new Error('Informe município, nome e sigla.')
    const e = { id: uid('ent'), municipioId, nome: nome.trim(), sigla: sigla.trim() }
    estado.entidades.push(e)
    registrar('cadastro', null, `Entidade ${e.sigla}`)
    mudou()
    return e
  },

  async criarCaixa(dados: Omit<Caixa, 'id'>): Promise<Caixa> {
    exigirAdmin()
    const codigo = dados.codigo.trim().toUpperCase()
    if (!dados.municipioId || !codigo) throw new Error('Informe o município e o código da caixa.')
    if (estado.caixas.some((c) => c.municipioId === dados.municipioId && c.codigo === codigo)) throw new Error('Já existe uma caixa com esse código neste município.')
    if (dados.anoInicial && dados.anoFinal && dados.anoInicial > dados.anoFinal) throw new Error('O ano inicial não pode ser maior que o final.')
    const c = { ...dados, codigo, id: uid('cx') }
    estado.caixas.push(c)
    registrar('cadastro', null, `Caixa ${c.codigo}`)
    mudou()
    return c
  },

  async criarTipo(nome: string): Promise<TipoDocumento> {
    exigirAdmin()
    if (!nome.trim()) throw new Error('Informe o nome do tipo.')
    if (estado.tipos.some((t) => normalizar(t.nome) === normalizar(nome.trim()))) throw new Error('Esse tipo já existe.')
    const t = { id: uid('tipo'), nome: nome.trim() }
    estado.tipos.push(t)
    registrar('cadastro', null, `Tipo ${t.nome}`)
    mudou()
    return t
  },

  async removerCadastro(tipo: 'municipio' | 'entidade' | 'caixa' | 'tipo', id: string): Promise<void> {
    exigirAdmin()
    const campo = { municipio: 'municipioId', entidade: 'entidadeId', caixa: 'caixaId', tipo: 'tipoId' } as const
    const emUso = estado.documentos.filter((d) => d[campo[tipo]] === id).length
    if (emUso) throw new Error(`Não dá para remover: ${emUso} documento(s) usam este cadastro.`)
    if (estado.acessos.some((a) => (a.escopo === tipo && a.alvoId === id) || (tipo === 'tipo' && a.tipoId === id))) throw new Error('Não dá para remover: existe acesso concedido usando este cadastro.')
    if (tipo === 'municipio' && (estado.entidades.some((e) => e.municipioId === id) || estado.caixas.some((c) => c.municipioId === id))) throw new Error('Remova antes as entidades e caixas deste município.')
    if (tipo === 'municipio') estado.municipios = estado.municipios.filter((x) => x.id !== id)
    if (tipo === 'entidade') estado.entidades = estado.entidades.filter((x) => x.id !== id)
    if (tipo === 'caixa') estado.caixas = estado.caixas.filter((x) => x.id !== id)
    if (tipo === 'tipo') estado.tipos = estado.tipos.filter((x) => x.id !== id)
    mudou()
  },

  // ---------- clientes e acessos ----------
  async listarOrganizacoes(): Promise<OrganizacaoResumo[]> {
    exigirAdmin()
    return estado.organizacoes
      .map((o) => ({
        ...o,
        usuarios: estado.usuarios.filter((u) => u.organizacaoId === o.id).length,
        acessos: estado.acessos.filter((a) => a.organizacaoId === o.id).length,
        documentosVisiveis: estado.documentos.filter((d) => orgVe(o.id, d)).length,
      }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  },

  async organizacao(id: string): Promise<OrganizacaoResumo> {
    const u = eu()
    if (u.papel !== 'admin' && u.organizacaoId !== id) throw new Error('Sem permissão.')
    const o = org(id)
    if (!o) throw new Error('Cliente não encontrado.')
    return {
      ...o,
      usuarios: estado.usuarios.filter((x) => x.organizacaoId === id).length,
      acessos: estado.acessos.filter((a) => a.organizacaoId === id).length,
      documentosVisiveis: estado.documentos.filter((d) => orgVe(id, d)).length,
    }
  },

  async criarOrganizacao(nome: string, cnpj: string): Promise<Organizacao> {
    exigirAdmin()
    if (!nome.trim()) throw new Error('Informe o nome do cliente.')
    if (cnpj && cnpj.replace(/\D/g, '').length !== 14) throw new Error('O CNPJ precisa ter 14 dígitos.')
    const o = { id: uid('org'), nome: nome.trim(), cnpj, ativo: true, criadoEm: new Date().toISOString() }
    estado.organizacoes.push(o)
    registrar('criou_cliente', null, o.nome)
    mudou()
    return o
  },

  async atualizarOrganizacao(id: string, dados: { nome: string; cnpj: string; ativo: boolean }): Promise<void> {
    exigirAdmin()
    const o = org(id)
    if (!o) throw new Error('Cliente não encontrado.')
    if (!dados.nome.trim()) throw new Error('Informe o nome do cliente.')
    if (dados.cnpj && dados.cnpj.replace(/\D/g, '').length !== 14) throw new Error('O CNPJ precisa ter 14 dígitos.')
    Object.assign(o, { ...dados, nome: dados.nome.trim() })
    registrar('alterou_cliente', null, `${o.nome}${o.ativo ? '' : ' (suspenso)'}`)
    mudou()
  },

  async listarAcessos(orgId: string): Promise<AcessoDetalhado[]> {
    exigirAdmin()
    return estado.acessos
      .filter((a) => a.organizacaoId === orgId)
      .map((a) => ({ ...a, alvoNome: nomeAlvo(a.escopo, a.alvoId), tipoNome: a.tipoId ? estado.tipos.find((t) => t.id === a.tipoId)?.nome ?? null : null }))
  },

  async conceder(orgId: string, escopo: EscopoAcesso, alvoId: string, tipoId: string | null): Promise<void> {
    exigirAdmin()
    if (!org(orgId)) throw new Error('Cliente não encontrado.')
    if (!alvoId) throw new Error('Escolha o que será liberado.')
    if (estado.acessos.some((a) => a.organizacaoId === orgId && a.escopo === escopo && a.alvoId === alvoId && a.tipoId === tipoId)) throw new Error('Esse acesso já foi concedido.')
    estado.acessos.push({ id: uid('ace'), organizacaoId: orgId, escopo, alvoId, tipoId, concedidoPor: estado.sessao!, em: new Date().toISOString() })
    registrar('concedeu', escopo === 'documento' ? alvoId : null, `${org(orgId)!.nome}: ${nomeAlvo(escopo, alvoId)}`)
    mudou()
  },

  async revogar(acessoId: string): Promise<void> {
    exigirAdmin()
    const a = estado.acessos.find((x) => x.id === acessoId)
    if (!a) return
    estado.acessos = estado.acessos.filter((x) => x.id !== acessoId)
    registrar('revogou', null, `${org(a.organizacaoId)?.nome ?? ''}: ${nomeAlvo(a.escopo, a.alvoId)}`)
    mudou()
  },

  // ---------- usuários ----------
  async listarUsuarios(orgId?: string): Promise<Usuario[]> {
    const u = eu()
    let lista = estado.usuarios
    if (u.papel === 'admin') lista = orgId ? lista.filter((x) => x.organizacaoId === orgId) : lista
    else if (u.papel === 'cliente') lista = lista.filter((x) => x.organizacaoId === u.organizacaoId)
    else throw new Error('Sem permissão.')
    return lista.map(publico).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  },

  async criarUsuario(dados: { nome: string; email: string; papel: Papel; organizacaoId: string | null }): Promise<{ usuario: Usuario; senha: string }> {
    const u = eu()
    if (u.papel === 'leitor') throw new Error('Leitores não podem criar usuários.')
    if (u.papel === 'cliente' && (dados.papel !== 'leitor' || dados.organizacaoId !== u.organizacaoId)) throw new Error('Você só pode criar leitores da sua organização.')
    if (dados.papel !== 'admin' && !dados.organizacaoId) throw new Error('Escolha a organização do usuário.')
    if (!dados.nome.trim()) throw new Error('Informe o nome.')
    validarEmail(dados.email.trim())
    const senha = senhaProvisoria()
    const novo: UsuarioInterno = {
      id: uid('usr'), nome: dados.nome.trim(), email: dados.email.trim().toLowerCase(), senha, papel: dados.papel,
      organizacaoId: dados.papel === 'admin' ? null : dados.organizacaoId, criadoPor: u.id, ativo: true, criadoEm: new Date().toISOString(),
    }
    estado.usuarios.push(novo)
    registrar('criou_usuario', null, `${novo.nome} (${novo.papel})`)
    mudou()
    return { usuario: publico(novo), senha }
  },

  async definirUsuarioAtivo(id: string, ativo: boolean): Promise<void> {
    const alvo = estado.usuarios.find((x) => x.id === id)
    if (!alvo) throw new Error('Usuário não encontrado.')
    podeGerirUsuario(alvo)
    alvo.ativo = ativo
    registrar('alterou_usuario', null, `${alvo.nome}: ${ativo ? 'reativado' : 'desativado'}`)
    mudou()
  },

  async redefinirSenha(id: string): Promise<string> {
    const alvo = estado.usuarios.find((x) => x.id === id)
    if (!alvo) throw new Error('Usuário não encontrado.')
    podeGerirUsuario(alvo)
    alvo.senha = senhaProvisoria()
    registrar('alterou_usuario', null, `${alvo.nome}: nova senha provisória`)
    mudou()
    return alvo.senha
  },

  // ---------- auditoria ----------
  async listarAuditoria(): Promise<EventoDetalhado[]> {
    exigirAdmin()
    return estado.auditoria.map((e) => {
      const u = estado.usuarios.find((x) => x.id === e.usuarioId)
      return {
        ...e,
        usuarioNome: u?.nome ?? '(removido)',
        papel: u?.papel ?? 'leitor',
        organizacao: u?.organizacaoId ? org(u.organizacaoId)?.nome ?? null : null,
        documentoTitulo: e.documentoId ? doc(e.documentoId)?.titulo ?? null : null,
      }
    })
  },

  // ---------- demonstração ----------
  async resetar(): Promise<void> {
    fila = []
    textos.clear()
    for (const url of urls.values()) URL.revokeObjectURL(url)
    urls.clear()
    await idbLimparTudo()
    estado = estadoInicial()
    mudou()
  },
}

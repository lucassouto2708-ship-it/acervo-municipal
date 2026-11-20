// Tipos compartilhados entre as telas e a camada de dados.
// Na F1 estes mesmos tipos passam a ser preenchidos pelo Supabase.

export type Papel = 'admin' | 'cliente' | 'leitor'

export interface Organizacao {
  id: string
  nome: string
  cnpj: string
  ativo: boolean
  criadoEm: string
}

export interface OrganizacaoResumo extends Organizacao {
  usuarios: number
  acessos: number
  documentosVisiveis: number
}

export interface Usuario {
  id: string
  nome: string
  email: string
  papel: Papel
  organizacaoId: string | null
  criadoPor: string | null
  ativo: boolean
  criadoEm: string
  /** precisa trocar a senha provisória no próximo acesso */
  trocarSenha?: boolean
}

export interface Municipio {
  id: string
  nome: string
  uf: string
}

/** Órgão dentro do município: prefeitura, câmara, instituto de previdência… */
export interface Entidade {
  id: string
  municipioId: string
  nome: string
  sigla: string
}

export interface Caixa {
  id: string
  municipioId: string
  codigo: string
  anoInicial: number | null
  anoFinal: number | null
  descricao: string
}

export interface TipoDocumento {
  id: string
  nome: string
}

export type StatusDoc = 'na_fila' | 'processando' | 'pronto' | 'erro'

export interface Documento {
  id: string
  titulo: string
  numero: string
  /** descrição / palavras-chave digitadas no envio; entram na busca */
  descricao: string
  municipioId: string
  entidadeId: string | null
  caixaId: string | null
  tipoId: string
  ano: number
  mes: number | null
  paginas: number
  status: StatusDoc
  erro: string | null
  arquivoNome: string
  caminho: string
  tamanhoKb: number
  sha256: string | null
  enviadoPor: string
  criadoEm: string
}

/** Documento com os nomes resolvidos, pronto para a tela. */
export interface DocResumo extends Documento {
  municipio: string
  uf: string
  entidade: string | null
  caixa: string | null
  tipo: string
  /** em quantas páginas o termo pesquisado aparece */
  paginasComAcerto?: number
  ocorrencias?: number
  trecho?: Trecho
}

export interface ParteTrecho {
  t: string
  hl: boolean
}

export interface Trecho {
  pagina: number
  partes: ParteTrecho[]
}

export interface AcertoPagina {
  pagina: number
  ocorrencias: number
  trechos: ParteTrecho[][]
}

export type EscopoAcesso = 'municipio' | 'entidade' | 'caixa' | 'documento'

export interface Acesso {
  id: string
  organizacaoId: string
  escopo: EscopoAcesso
  alvoId: string
  tipoId: string | null
  concedidoPor: string
  em: string
}

export interface AcessoDetalhado extends Acesso {
  alvoNome: string
  tipoNome: string | null
}

export type AcaoAuditoria =
  | 'entrou'
  | 'viu'
  | 'baixou'
  | 'imprimiu'
  | 'buscou'
  | 'enviou'
  | 'editou'
  | 'removeu'
  | 'concedeu'
  | 'revogou'
  | 'criou_usuario'
  | 'alterou_usuario'
  | 'criou_cliente'
  | 'alterou_cliente'
  | 'cadastro'

export interface EventoAuditoria {
  id: string
  usuarioId: string
  acao: AcaoAuditoria
  documentoId: string | null
  detalhe: string
  em: string
}

export interface EventoDetalhado extends EventoAuditoria {
  usuarioNome: string
  papel: Papel
  organizacao: string | null
  documentoTitulo: string | null
}

export interface Filtros {
  texto?: string
  municipioId?: string
  entidadeId?: string
  caixaId?: string
  tipoId?: string
  anoDe?: number
  anoAte?: number
}

export interface Faceta {
  id: string
  nome: string
  qtd: number
}

export interface ResultadoBusca {
  documentos: DocResumo[]
  total: number
  facetas: {
    municipios: Faceta[]
    entidades: Faceta[]
    caixas: Faceta[]
    tipos: Faceta[]
    anos: { ano: number; qtd: number }[]
  }
  ms: number
}

export interface Catalogo {
  municipios: Municipio[]
  entidades: Entidade[]
  caixas: Caixa[]
  tipos: TipoDocumento[]
}

export interface ItemEnvio {
  arquivo: File
  caminho: string
  titulo: string
  numero: string
  descricao: string
  municipioId: string
  entidadeId: string | null
  /** id de caixa existente, "nova:CX-012" para criar, ou null */
  caixaId: string | null
  tipoId: string
  ano: number
  mes: number | null
}

export interface Progresso {
  feitas: number
  total: number
}

export interface ContaDemo {
  nome: string
  email: string
  senha: string
  papel: Papel
}

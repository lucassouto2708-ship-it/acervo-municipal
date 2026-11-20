// Sugere metadados a partir do caminho do arquivo no envio em lote.
// Ex.: "Iprema/Movimento Contabil 012026.pdf" → IPREMA, Alpercata, Movimento contábil, jan/2026.
import type { Catalogo } from '../api/types'
import { competencia, normalizar } from './util'

export interface Sugestao {
  titulo: string
  numero: string
  descricao: string
  municipioId: string
  entidadeId: string | null
  caixaId: string | null
  tipoId: string
  ano: number
  mes: number | null
}

const PALAVRAS_TIPO: [RegExp, string][] = [
  [/movimento/, 'movimento'],
  [/minuta/, 'minuta'],
  [/balancete/, 'balancete'],
  [/\blei\b|\blei[ _-]?\d/, 'lei'],
  [/decreto/, 'decreto'],
  [/portaria/, 'portaria'],
  [/contrato/, 'contrato'],
]

function semExtensao(nome: string): string {
  return nome.replace(/\.pdf$/i, '')
}

export function sugerir(caminho: string, cat: Catalogo, padrao: Partial<Sugestao> = {}): Sugestao {
  const norm = normalizar(caminho)
  const segmentos = norm.split(/[\\/]/)
  const nomeArquivo = caminho.split(/[\\/]/).pop() ?? caminho

  // entidade e município
  let entidadeId: string | null = null
  let municipioId = ''
  for (const e of cat.entidades) {
    const sigla = normalizar(e.sigla)
    if (segmentos.some((s) => s === sigla || s.split(/[^a-z0-9]+/).includes(sigla)) || norm.includes(normalizar(e.nome))) {
      entidadeId = e.id
      municipioId = e.municipioId
      break
    }
  }
  if (!municipioId) {
    const m = cat.municipios.find((x) => norm.includes(normalizar(x.nome)))
    if (m) municipioId = m.id
  }
  if (!municipioId) municipioId = padrao.municipioId ?? (cat.municipios.length === 1 ? cat.municipios[0].id : '')
  if (!entidadeId && padrao.entidadeId && cat.entidades.find((e) => e.id === padrao.entidadeId)?.municipioId === municipioId) {
    entidadeId = padrao.entidadeId
  }

  // tipo
  let tipoId = ''
  const porNome = [...cat.tipos].sort((a, b) => b.nome.length - a.nome.length).find((t) => norm.includes(normalizar(t.nome)))
  if (porNome) tipoId = porNome.id
  else {
    for (const [re, chave] of PALAVRAS_TIPO) {
      if (re.test(norm)) {
        tipoId = cat.tipos.find((t) => normalizar(t.nome).includes(chave))?.id ?? ''
        if (tipoId) break
      }
    }
  }
  if (!tipoId) tipoId = padrao.tipoId ?? ''

  // competência (mês+ano) ou só ano
  const arq = normalizar(nomeArquivo)
  let mes: number | null = null
  let ano = 0
  const mm = arq.match(/(?<!\d)(0[1-9]|1[0-2])[ ._-]?((?:19|20)\d{2})(?!\d)/)
  if (mm) {
    mes = Number(mm[1])
    ano = Number(mm[2])
  } else {
    const aa = arq.match(/(?<!\d)((?:19|20)\d{2})(?!\d)/) ?? norm.match(/(?<!\d)((?:19|20)\d{2})(?!\d)/)
    if (aa) ano = Number(aa[1])
  }
  if (!ano) ano = padrao.ano ?? new Date().getFullYear()

  // caixa
  let caixaId: string | null = padrao.caixaId ?? null
  const cx = norm.match(/\b(?:cx|caixa)[ ._-]?(\d{1,4})\b/)
  if (cx && municipioId) {
    const codigo = `CX-${cx[1].padStart(3, '0')}`
    caixaId = cat.caixas.find((c) => c.municipioId === municipioId && c.codigo === codigo)?.id ?? `nova:${codigo}`
  }

  // número do ato (lei 45/2016, decreto nº 210-2017)
  let numero = ''
  const nm = arq.match(/(?:n[o°º]?[ .]*)?(\d{1,5})[ ._/-]((?:19|20)\d{2})(?!\d)/)
  if (nm && !mm) numero = `${nm[1].padStart(3, '0')}/${nm[2]}`

  const tipoNome = cat.tipos.find((t) => t.id === tipoId)?.nome
  let titulo = semExtensao(nomeArquivo)
  if (tipoNome && mes) titulo = `${tipoNome} · ${competencia(mes, ano)}`
  else if (tipoNome && numero) titulo = `${tipoNome} nº ${numero}`

  return { titulo, numero, descricao: padrao.descricao ?? '', municipioId, entidadeId, caixaId, tipoId, ano, mes }
}

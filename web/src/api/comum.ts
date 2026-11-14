// Lógica compartilhada entre o modo demonstração (mock) e o Supabase:
// avisos para as telas, filtros, contagens por filtro e nomes.
import type { Caixa, Documento, DocResumo, Entidade, EscopoAcesso, Filtros, Municipio, ParteTrecho, ResultadoBusca, TipoDocumento, Trecho } from './types'

// ---------- avisos ----------
// Tópicos separados: progresso do processamento e auditoria não recarregam a busca à toa.
export type Topico = 'dados' | 'progresso' | 'auditoria'

export function criarAvisos() {
  const ouvintes = new Map<Topico, Set<() => void>>()
  const pendentes = new Set<Topico>()
  let agendado = false
  function avisar(topico: Topico = 'dados') {
    pendentes.add(topico)
    if (agendado) return
    agendado = true
    setTimeout(() => {
      agendado = false
      const chamar = new Set<() => void>()
      for (const t of pendentes) for (const f of ouvintes.get(t) ?? []) chamar.add(f)
      pendentes.clear()
      chamar.forEach((f) => f())
    }, 50)
  }
  function assinar(fn: () => void, topicos: Topico[] = ['dados']): () => void {
    for (const t of topicos) {
      if (!ouvintes.has(t)) ouvintes.set(t, new Set())
      ouvintes.get(t)!.add(fn)
    }
    return () => {
      for (const t of topicos) ouvintes.get(t)?.delete(fn)
    }
  }
  return { avisar, assinar }
}

// ---------- catálogo e nomes ----------
export interface DadosCatalogo {
  municipios: Municipio[]
  entidades: Entidade[]
  caixas: Caixa[]
  tipos: TipoDocumento[]
}

export function resumir(d: Documento, c: DadosCatalogo): DocResumo {
  const m = c.municipios.find((x) => x.id === d.municipioId)
  const e = c.entidades.find((x) => x.id === d.entidadeId)
  const cx = c.caixas.find((x) => x.id === d.caixaId)
  const t = c.tipos.find((x) => x.id === d.tipoId)
  return { ...d, municipio: m?.nome ?? '—', uf: m?.uf ?? '', entidade: e?.sigla ?? null, caixa: cx?.codigo ?? null, tipo: t?.nome ?? '—' }
}

export function nomeAlvo(escopo: EscopoAcesso, alvoId: string, c: DadosCatalogo, docs: { id: string; titulo: string }[]): string {
  switch (escopo) {
    case 'municipio': {
      const m = c.municipios.find((x) => x.id === alvoId)
      return m ? `${m.nome}/${m.uf}` : '(município removido)'
    }
    case 'entidade': {
      const e = c.entidades.find((x) => x.id === alvoId)
      const m = c.municipios.find((x) => x.id === e?.municipioId)
      return e ? `${e.sigla} · ${m?.nome ?? ''}` : '(entidade removida)'
    }
    case 'caixa': {
      const cx = c.caixas.find((x) => x.id === alvoId)
      const m = c.municipios.find((x) => x.id === cx?.municipioId)
      return cx ? `${cx.codigo} · ${m?.nome ?? ''}` : '(caixa removida)'
    }
    case 'documento':
      return docs.find((d) => d.id === alvoId)?.titulo ?? '(documento removido)'
  }
}

// ---------- filtros e contagens ----------
type Ignorar = 'municipio' | 'entidade' | 'caixa' | 'tipo' | 'ano'

export function aplica(d: Documento, f: Filtros, ignorar?: Ignorar): boolean {
  if (ignorar !== 'municipio' && f.municipioId && d.municipioId !== f.municipioId) return false
  if (ignorar !== 'entidade' && f.entidadeId && d.entidadeId !== f.entidadeId) return false
  if (ignorar !== 'caixa' && f.caixaId && d.caixaId !== f.caixaId) return false
  if (ignorar !== 'tipo' && f.tipoId && d.tipoId !== f.tipoId) return false
  if (ignorar !== 'ano' && f.anoDe && d.ano < f.anoDe) return false
  if (ignorar !== 'ano' && f.anoAte && d.ano > f.anoAte) return false
  return true
}

function contarPor(docs: Documento[], chave: (d: Documento) => string | null, nome: (id: string) => string) {
  const m = new Map<string, number>()
  for (const d of docs) {
    const k = chave(d)
    if (k) m.set(k, (m.get(k) ?? 0) + 1)
  }
  return [...m].map(([id, qtd]) => ({ id, nome: nome(id), qtd })).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

export type ExtraBusca = Map<string, { ocorrencias?: number; paginasComAcerto: number; relevancia: number; trecho?: Trecho }>

/** Aplica filtros, ordena e conta por filtro. `base` = documentos visíveis (e que casaram com o texto, se houver). */
export function montarResultado(base: Documento[], f: Filtros, c: DadosCatalogo, extra: ExtraBusca | null, t0: number): ResultadoBusca {
  const docs = base.filter((d) => aplica(d, f))
  if (extra) docs.sort((a, b) => extra.get(b.id)!.relevancia - extra.get(a.id)!.relevancia || b.ano - a.ano)
  else docs.sort((a, b) => b.ano - a.ano || (b.mes ?? 0) - (a.mes ?? 0) || a.titulo.localeCompare(b.titulo, 'pt-BR'))

  const anos = new Map<number, number>()
  for (const d of base.filter((d) => aplica(d, f, 'ano'))) anos.set(d.ano, (anos.get(d.ano) ?? 0) + 1)

  return {
    documentos: docs.map((d) => ({ ...resumir(d, c), ...(extra?.get(d.id) ?? {}) })),
    total: docs.length,
    facetas: {
      municipios: contarPor(base.filter((d) => aplica(d, f, 'municipio')), (d) => d.municipioId, (id) => {
        const m = c.municipios.find((x) => x.id === id)
        return m ? `${m.nome}/${m.uf}` : id
      }),
      entidades: contarPor(base.filter((d) => aplica(d, f, 'entidade')), (d) => d.entidadeId, (id) => c.entidades.find((x) => x.id === id)?.sigla ?? id),
      caixas: contarPor(base.filter((d) => aplica(d, f, 'caixa')), (d) => d.caixaId, (id) => c.caixas.find((x) => x.id === id)?.codigo ?? id),
      tipos: contarPor(base.filter((d) => aplica(d, f, 'tipo')), (d) => d.tipoId, (id) => c.tipos.find((x) => x.id === id)?.nome ?? id),
      anos: [...anos].map(([ano, qtd]) => ({ ano, qtd })).sort((a, b) => b.ano - a.ano),
    },
    ms: Math.round(performance.now() - t0),
  }
}

/** "… o [[[termo]]] aparece …" (formato do banco) → partes destacadas para a tela. */
export function partesDeTrecho(marcado: string): ParteTrecho[] {
  const out: ParteTrecho[] = []
  const re = /\[\[\[(.*?)\]\]\]/g
  let ultimo = 0
  let m: RegExpExecArray | null
  const limpo = marcado.replace(/\s+/g, ' ').trim()
  while ((m = re.exec(limpo))) {
    if (m.index > ultimo) out.push({ t: limpo.slice(ultimo, m.index), hl: false })
    out.push({ t: m[1], hl: true })
    ultimo = m.index + m[0].length
  }
  if (ultimo < limpo.length) out.push({ t: limpo.slice(ultimo), hl: false })
  return [{ t: '… ', hl: false }, ...out, { t: ' …', hl: false }]
}

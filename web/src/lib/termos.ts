// Regras de correspondência de termos: sem acento, sem maiúsculas,
// singular/plural aproximados (dotação ↔ dotações). Equivale ao que o
// Postgres faz com a configuração portuguese + unaccent na F1.
import type { ParteTrecho } from '../api/types'
import { normalizar } from './util'

// palavras que aparecem em quase toda página e só atrapalham a busca
const VAZIAS = new Set(['de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na', 'nos', 'nas', 'para', 'por', 'pela', 'pelo', 'com', 'que', 'os', 'as', 'um', 'uma', 'ao', 'aos', 'se', 'ou'])

const SUFIXOS = ['oes', 'aes', 'eis', 'ao', 'as', 'os', 'es', 'is', 's', 'a', 'o', 'e']

function radical(t: string): string {
  for (const suf of SUFIXOS) {
    if (t.endsWith(suf) && t.length - suf.length >= 4) return t.slice(0, -suf.length)
  }
  return t
}

function escapar(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Converte a consulta digitada em expressões que casam com o texto normalizado. */
export function compilarTermos(consulta: string): RegExp[] {
  const palavras = normalizar(consulta)
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 2 && !VAZIAS.has(p))
  const unicas = [...new Set(palavras.map(radical))]
  return unicas.map((r) => new RegExp(`(?<![a-z0-9])${escapar(r)}[a-z0-9]*`, 'g'))
}

export function contar(norm: string, re: RegExp): number {
  re.lastIndex = 0
  let n = 0
  while (re.exec(norm)) n++
  return n
}

export function casaAlgum(norm: string, termos: RegExp[]): boolean {
  return termos.some((re) => {
    re.lastIndex = 0
    return re.test(norm)
  })
}

interface Faixa {
  ini: number
  fim: number
}

function faixas(norm: string, termos: RegExp[]): Faixa[] {
  const out: Faixa[] = []
  for (const re of termos) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(norm))) out.push({ ini: m.index, fim: m.index + m[0].length })
  }
  return out.sort((a, b) => a.ini - b.ini)
}

function montarPartes(orig: string, ini: number, fim: number, hits: Faixa[]): ParteTrecho[] {
  const partes: ParteTrecho[] = []
  let cur = ini
  for (const h of hits) {
    if (h.fim <= ini || h.ini >= fim || h.ini < cur) continue
    if (h.ini > cur) partes.push({ t: orig.slice(cur, h.ini), hl: false })
    partes.push({ t: orig.slice(h.ini, Math.min(h.fim, fim)), hl: true })
    cur = Math.min(h.fim, fim)
  }
  if (cur < fim) partes.push({ t: orig.slice(cur, fim), hl: false })
  const limpas = partes.map((p) => ({ ...p, t: p.t.replace(/\s+/g, ' ') }))
  if (ini > 0) limpas.unshift({ t: '… ', hl: false })
  if (fim < orig.length) limpas.push({ t: ' …', hl: false })
  return limpas
}

/** Até `max` trechos de ~170 caracteres em volta das ocorrências. */
export function trechos(orig: string, norm: string, termos: RegExp[], max = 2): { ocorrencias: number; trechos: ParteTrecho[][] } {
  const hits = faixas(norm, termos)
  const out: ParteTrecho[][] = []
  let usadoAte = -1
  for (const h of hits) {
    if (out.length >= max) break
    if (h.ini < usadoAte) continue
    let ini = Math.max(0, h.ini - 60)
    const espaco = orig.lastIndexOf(' ', ini)
    if (ini > 0 && espaco > h.ini - 90) ini = espaco + 1
    let fim = Math.min(orig.length, ini + 170)
    const espacoFim = orig.indexOf(' ', fim)
    if (fim < orig.length && espacoFim !== -1 && espacoFim - fim < 20) fim = espacoFim
    out.push(montarPartes(orig, ini, fim, hits))
    usadoAte = fim
  }
  return { ocorrencias: hits.length, trechos: out }
}

// Seleção de páginas no formato que as pessoas digitam: "1-3, 7, 10-12".

export function lerIntervalos(texto: string, total: number): { paginas: number[]; erro: string | null } {
  const set = new Set<number>()
  const partes = texto.split(/[,;\s]+/).map((p) => p.trim()).filter(Boolean)
  if (!partes.length) return { paginas: [], erro: null }
  for (const parte of partes) {
    const m = parte.match(/^(\d+)(?:\s*[-–a]\s*(\d+))?$/)
    if (!m) return { paginas: [], erro: `Não entendi "${parte}". Use números e intervalos, como 1-3, 7.` }
    const ini = Number(m[1])
    const fim = m[2] ? Number(m[2]) : ini
    if (ini < 1 || fim < 1) return { paginas: [], erro: 'As páginas começam em 1.' }
    if (ini > total || fim > total) return { paginas: [], erro: `O documento tem ${total} páginas.` }
    const [a, b] = ini <= fim ? [ini, fim] : [fim, ini]
    for (let p = a; p <= b; p++) set.add(p)
  }
  return { paginas: [...set].sort((x, y) => x - y), erro: null }
}

/** [1,2,3,7,10,11] → "1-3, 7, 10-11" */
export function escreverIntervalos(paginas: number[]): string {
  const ord = [...new Set(paginas)].sort((a, b) => a - b)
  const out: string[] = []
  for (let i = 0; i < ord.length; i++) {
    const ini = ord[i]
    while (i + 1 < ord.length && ord[i + 1] === ord[i] + 1) i++
    out.push(ini === ord[i] ? String(ini) : `${ini}-${ord[i]}`)
  }
  return out.join(', ')
}

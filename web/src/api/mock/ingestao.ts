// Processamento de um PDF na F0, dentro do navegador.
// Faz o mesmo que o worker Python fará na F2: hash, texto por página e miniaturas.
import { carregarPdf, extrairTexto, paginaParaImagem } from '../../lib/pdf'

export const LARGURA_CAPA = 360
export const LARGURA_MINIATURA = 180

export async function calcularSha256(dados: Uint8Array): Promise<string> {
  const dig = await crypto.subtle.digest('SHA-256', dados as unknown as BufferSource)
  return [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface ResultadoIngestao {
  textos: string[]
  capa: Blob
  miniaturas: Blob[]
}

/** Atenção: o pdf.js toma posse de `dados` (o buffer fica inutilizável depois). */
export async function processarPdf(dados: Uint8Array, aoAvancar: (feitas: number, total: number) => void): Promise<ResultadoIngestao> {
  const pdf = await carregarPdf(dados)
  try {
    const total = pdf.numPages
    const textos: string[] = []
    const miniaturas: Blob[] = []
    let capa: Blob | null = null
    aoAvancar(0, total)
    for (let i = 1; i <= total; i++) {
      const page = await pdf.getPage(i)
      textos.push(await extrairTexto(page))
      if (i === 1) capa = await paginaParaImagem(page, LARGURA_CAPA)
      miniaturas.push(await paginaParaImagem(page, LARGURA_MINIATURA))
      page.cleanup()
      aoAvancar(i, total)
    }
    if (!capa) throw new Error('O PDF não tem páginas.')
    return { textos, capa, miniaturas }
  } finally {
    await pdf.destroy()
  }
}

// Acesso ao pdf.js. Usado pelo visualizador (F0 e depois) e pela ingestão da F0.
// O pdf.js (~400 KB) só é baixado quando alguém abre um PDF ou envia arquivos.
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'

export type PdfDoc = PDFDocumentProxy
export type PdfPage = PDFPageProxy

let modulo: Promise<typeof import('pdfjs-dist')> | null = null
function pdfjs() {
  if (!modulo) {
    modulo = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([m, w]) => {
      m.GlobalWorkerOptions.workerSrc = w.default
      return m
    })
  }
  return modulo
}

export async function carregarPdf(fonte: Uint8Array | string): Promise<PdfDoc> {
  const m = await pdfjs()
  if (typeof fonte !== 'string') return m.getDocument({ data: fonte }).promise
  // arquivo na nuvem: baixa só os pedaços das páginas que forem abertas (não os 45 MB inteiros)
  const remoto = /^https?:/.test(fonte)
  return m.getDocument({ url: fonte, disableAutoFetch: remoto, disableStream: remoto }).promise
}

interface ItemTexto {
  str: string
  hasEOL: boolean
  transform: number[]
  width: number
}

function itensDeTexto(items: unknown[]): ItemTexto[] {
  return items.filter((it): it is ItemTexto => typeof (it as ItemTexto).str === 'string')
}

export async function extrairTexto(page: PdfPage): Promise<string> {
  const tc = await page.getTextContent()
  let s = ''
  for (const it of itensDeTexto(tc.items)) {
    s += it.str
    s += it.hasEOL ? '\n' : ' '
  }
  return s.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim()
}

/** Desenha a página num canvas com a largura pedida (em px CSS).
 *  `foraDaTela`: para gerar imagens (miniaturas). O modo normal do pdf.js desenha no ritmo da tela
 *  (requestAnimationFrame), que o navegador congela quando a aba está escondida; o modo de impressão não. */
export async function renderizar(page: PdfPage, canvas: HTMLCanvasElement, largura: number, dpr = 1, foraDaTela = false) {
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: (largura / base.width) * dpr })
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  canvas.style.width = `${largura}px`
  canvas.style.height = `${Math.floor(viewport.height / dpr)}px`
  const tarefa = page.render({ canvas, viewport, intent: foraDaTela ? 'print' : 'display' })
  await tarefa.promise
  return { largura, altura: viewport.height / dpr }
}

export async function paginaParaImagem(page: PdfPage, largura: number, tipo = 'image/webp', qualidade = 0.72): Promise<Blob> {
  const canvas = document.createElement('canvas')
  await renderizar(page, canvas, largura, 1, true)
  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, tipo, qualidade))
  canvas.width = 0
  canvas.height = 0
  if (!blob) throw new Error('Não foi possível gerar a imagem da página.')
  return blob
}

export interface CaixaTexto {
  x: number
  y: number
  w: number
  h: number
  texto: string
}

/** Posição de cada trecho de texto na página, em px CSS para a largura dada. */
export async function caixasDeTexto(page: PdfPage, largura: number): Promise<CaixaTexto[]> {
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: largura / base.width })
  const tc = await page.getTextContent()
  const { Util } = await pdfjs()
  const out: CaixaTexto[] = []
  for (const it of itensDeTexto(tc.items)) {
    if (!it.str.trim()) continue
    const tx = Util.transform(viewport.transform, it.transform)
    const altura = Math.hypot(tx[2], tx[3])
    out.push({ x: tx[4], y: tx[5] - altura, w: it.width * viewport.scale, h: altura * 1.15, texto: it.str })
  }
  return out
}

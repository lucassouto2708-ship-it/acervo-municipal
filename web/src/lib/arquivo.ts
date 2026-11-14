import type { Papel } from '../api/types'
import { escreverIntervalos } from './paginas'

/** Quem pode baixar e imprimir. Decisão de 11/11/2026: todos os papéis podem. */
export const PODE_BAIXAR: Record<Papel, boolean> = { admin: true, cliente: true, leitor: true }
export const PODE_IMPRIMIR: Record<Papel, boolean> = { admin: true, cliente: true, leitor: true }

export function baixarArquivo(url: string, nome: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** Abre a janela de impressão do navegador com um PDF. */
export function imprimirPdf(url: string): Promise<void> {
  return new Promise((ok, falha) => {
    const f = document.createElement('iframe')
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0'
    f.onload = () => {
      // o leitor de PDF do navegador precisa de um instante para montar as páginas
      setTimeout(() => {
        try {
          f.contentWindow?.focus()
          f.contentWindow?.print()
          ok()
        } catch (e) {
          falha(e)
        }
        setTimeout(() => f.remove(), 60_000)
      }, 700)
    }
    f.src = url
    document.body.appendChild(f)
  })
}

/** Monta um PDF novo só com as páginas pedidas (1 = primeira). */
export async function recortarPdf(url: string, paginas: number[]): Promise<Blob> {
  const { PDFDocument } = await import('pdf-lib')
  const bytes = await (await fetch(url)).arrayBuffer()
  const origem = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })
  const novo = await PDFDocument.create()
  const copias = await novo.copyPages(origem, paginas.map((p) => p - 1))
  copias.forEach((p) => novo.addPage(p))
  const saida = await novo.save()
  return new Blob([saida as unknown as BlobPart], { type: 'application/pdf' })
}

/** "Movimento Contabil 042026.pdf" + [3,4,5,9] → "Movimento Contabil 042026 - pags 3-5, 9.pdf" */
export function nomeRecorte(arquivoNome: string, paginas: number[], total: number): string {
  if (paginas.length === total) return arquivoNome
  const base = arquivoNome.replace(/\.pdf$/i, '')
  const rot = escreverIntervalos(paginas).replace(/, /g, '_')
  return `${base} - ${paginas.length === 1 ? 'pag' : 'pags'} ${rot}.pdf`
}

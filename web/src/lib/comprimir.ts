// Compressor de PDF digitalizado, no navegador.
// Reduz só as imagens das páginas (JPEG): o texto do OCR, a estrutura e as páginas ficam intactos,
// então a busca continua funcionando. Vai do mais leve ao mais forte e para no primeiro que couber.
import type { PDFDocument as PDFDoc, PDFNumber as TNum, PDFRawStream as TRaw, PDFRef } from 'pdf-lib'

export const LIMITE_ARQUIVO = 50 * 1024 * 1024 // plano grátis do Supabase

const NIVEIS = [
  { escala: 1, qualidade: 0.82 },
  { escala: 0.9, qualidade: 0.8 },
  { escala: 0.8, qualidade: 0.78 },
  { escala: 0.7, qualidade: 0.75 },
  { escala: 0.6, qualidade: 0.72 },
]

export interface ResultadoCompressao {
  arquivo: Blob
  antes: number
  depois: number
  nivel: number // 0 = não precisou
}

async function reduzirImagens(bytes: Uint8Array, escala: number, qualidade: number, aoAvancar?: (f: number, t: number) => void): Promise<Uint8Array> {
  const { PDFDocument, PDFName, PDFNumber, PDFRawStream } = await import('pdf-lib')
  const doc: PDFDoc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true })
  const ctx = doc.context
  const N = (n: string) => PDFName.of(n)
  const imagens: [PDFRef, TRaw][] = []
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue
    const d = obj.dict
    if (d.get(N('Subtype')) !== N('Image') || d.get(N('Filter')) !== N('DCTDecode')) continue
    if (d.get(N('ColorSpace')) === N('DeviceCMYK')) continue
    const w = (d.get(N('Width')) as TNum)?.asNumber?.() ?? 0
    if (w < 600) continue // logos e carimbos pequenos ficam como estão
    imagens.push([ref, obj])
  }
  let feitas = 0
  for (const [ref, obj] of imagens) {
    const d = obj.dict
    const w = (d.get(N('Width')) as TNum).asNumber()
    const h = (d.get(N('Height')) as TNum).asNumber()
    const bmp = await createImageBitmap(new Blob([obj.contents as unknown as BlobPart], { type: 'image/jpeg' }))
    const nw = Math.max(1, Math.round(w * escala))
    const nh = Math.max(1, Math.round(h * escala))
    const canvas = new OffscreenCanvas(nw, nh)
    const g = canvas.getContext('2d')!
    g.imageSmoothingQuality = 'high'
    g.drawImage(bmp, 0, 0, nw, nh)
    bmp.close()
    const novo = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: qualidade })).arrayBuffer())
    if (novo.length < obj.contents.length) {
      const dict = d.clone(ctx)
      dict.set(N('Width'), PDFNumber.of(nw))
      dict.set(N('Height'), PDFNumber.of(nh))
      dict.set(N('ColorSpace'), N('DeviceRGB')) // o navegador sempre gera JPEG colorido
      dict.set(N('BitsPerComponent'), PDFNumber.of(8))
      dict.set(N('Length'), PDFNumber.of(novo.length))
      dict.delete(N('DecodeParms'))
      dict.delete(N('Decode'))
      ctx.assign(ref, PDFRawStream.of(dict, novo))
    }
    aoAvancar?.(++feitas, imagens.length)
  }
  return doc.save({ useObjectStreams: true })
}

/** Se o PDF passar do limite, reduz as imagens até caber. Se já couber, devolve o mesmo arquivo. */
export async function comprimirSePreciso(arquivo: Blob, aoAvancar?: (texto: string) => void, limite = LIMITE_ARQUIVO): Promise<ResultadoCompressao> {
  const antes = arquivo.size
  const alvo = limite * 0.97 // folga para não ficar raspando
  if (antes <= limite) return { arquivo, antes, depois: antes, nivel: 0 }
  const original = new Uint8Array(await arquivo.arrayBuffer())
  for (let i = 0; i < NIVEIS.length; i++) {
    const { escala, qualidade } = NIVEIS[i]
    const saida = await reduzirImagens(original, escala, qualidade, (f, t) => aoAvancar?.(`comprimindo (nível ${i + 1}) ${f}/${t}`))
    if (saida.length <= alvo) {
      return { arquivo: new Blob([saida as unknown as BlobPart], { type: 'application/pdf' }), antes, depois: saida.length, nivel: i + 1 }
    }
  }
  throw new Error(`Mesmo comprimido, o PDF passa de ${Math.round(limite / 1048576)} MB. Divida o arquivo em partes.`)
}

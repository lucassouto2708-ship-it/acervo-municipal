export const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

export function uid(prefixo: string): string {
  return `${prefixo}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/** Minúsculas e sem acento, mantendo o mesmo comprimento do texto original
 *  (necessário para destacar o trecho certo no texto original). */
export function normalizar(s: string): string {
  let out = ''
  for (const c of s) {
    const n = c.normalize('NFD')[0].toLowerCase()
    out += n.length === 1 ? n : c
    if (c.length === 2) out += ' ' // par substituto: preserva o comprimento
  }
  return out
}

export function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function nomeMes(mes: number | null | undefined): string {
  return mes ? capitalizar(MESES[mes - 1]) : ''
}

export function competencia(mes: number | null, ano: number): string {
  return mes ? `${nomeMes(mes)}/${ano}` : String(ano)
}

export function formatarTamanho(kb: number): string {
  if (kb < 1024) return `${kb} KB`
  return `${(kb / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
}

export function formatarDataHora(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function formatarData(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR')
}

export function formatarNumero(n: number): string {
  return n.toLocaleString('pt-BR')
}

export function plural(n: number, um: string, varios: string): string {
  return `${formatarNumero(n)} ${n === 1 ? um : varios}`
}

export function senhaProvisoria(): string {
  const letras = 'abcdefghjkmnpqrstuvwxyz'
  const nums = '23456789'
  let s = ''
  for (let i = 0; i < 4; i++) s += letras[Math.floor(Math.random() * letras.length)]
  for (let i = 0; i < 4; i++) s += nums[Math.floor(Math.random() * nums.length)]
  return s
}

export function mascararCnpj(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 14)
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

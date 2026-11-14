import type { Usuario } from '../api'
import { PODE_BAIXAR, PODE_IMPRIMIR } from '../lib/arquivo'

export function podeBaixar(u: Usuario | null) {
  return !!u && PODE_BAIXAR[u.papel]
}
export function podeImprimir(u: Usuario | null) {
  return !!u && PODE_IMPRIMIR[u.papel]
}

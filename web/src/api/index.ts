// Ponto único de acesso a dados. As telas só importam daqui.
// Com VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no arquivo .env → Supabase (F1).
// Sem elas → modo demonstração, tudo no navegador (F0).
import { mockApi } from './mock'
import { criarApiSupabase } from './supabase'

export type Api = typeof mockApi

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const chave = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const api: Api = url && chave ? criarApiSupabase(url, chave) : mockApi
api.iniciar()

export type * from './types'

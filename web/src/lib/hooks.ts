import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { api } from '../api'
import type { Topico } from '../api/comum'

/** Executa uma consulta e repete sempre que os dados (dos tópicos indicados) mudarem. */
export function useConsulta<T>(fn: () => Promise<T>, deps: unknown[], topicos: Topico[] = ['dados']) {
  const [data, setData] = useState<T | undefined>(undefined)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const seq = useRef(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const executar = useCallback(fn, deps)

  const rodar = useCallback(() => {
    const meu = ++seq.current
    setCarregando(true)
    executar()
      .then((r) => {
        if (meu !== seq.current) return
        setData(r)
        setErro(null)
      })
      .catch((e: unknown) => {
        if (meu !== seq.current) return
        setErro(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (meu === seq.current) setCarregando(false)
      })
  }, [executar])

  const chaveTopicos = topicos.join(',')
  useEffect(() => {
    rodar()
    return api.assinar(rodar, chaveTopicos.split(',') as Topico[])
  }, [rodar, chaveTopicos])

  return { data, erro, carregando, recarregar: rodar }
}

/** Re-renderiza quando dados ou progresso mudam (para leituras síncronas, como a sessão e o progresso). */
let versao = 0
const assinarVersao = (cb: () => void) =>
  api.assinar(() => {
    versao++
    cb()
  }, ['dados', 'progresso'])
export function useVersaoDados(): number {
  return useSyncExternalStore(assinarVersao, () => versao)
}

export function useDebounce<T>(valor: T, ms: number): T {
  const [v, setV] = useState(valor)
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms)
    return () => clearTimeout(t)
  }, [valor, ms])
  return v
}

/** Executa uma ação com estado de "enviando" e captura de erro. */
export function useAcao() {
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const executar = useCallback(async <R,>(fn: () => Promise<R>): Promise<R | undefined> => {
    setOcupado(true)
    setErro(null)
    try {
      return await fn()
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
      return undefined
    } finally {
      setOcupado(false)
    }
  }, [])
  return { ocupado, erro, setErro, executar }
}

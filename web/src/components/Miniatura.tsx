import { useEffect, useRef, useState } from 'react'
import { api } from '../api'

/** Imagem de uma página (0 = capa), carregada só quando aparece na tela. */
export function Miniatura({ docId, pagina, rotulo, largura }: { docId: string; pagina: number; rotulo?: string; largura?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [visivel, setVisivel] = useState(false)
  const [falhou, setFalhou] = useState(false)
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver((e) => {
      if (e.some((x) => x.isIntersecting)) {
        setVisivel(true)
        obs.disconnect()
      }
    }, { rootMargin: '200px' })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    if (!visivel) return
    let vivo = true
    setFalhou(false)
    if (tentativa === 0) setUrl(null)
    api.miniatura(docId, pagina)
      .then((u) => {
        if (!vivo) return
        setUrl(u)
        if (!u) setFalhou(true)
      })
      .catch(() => vivo && setFalhou(true))
    return () => {
      vivo = false
    }
  }, [docId, pagina, visivel, tentativa])

  return (
    <div className="miniatura" ref={ref} style={largura ? { width: largura } : undefined}>
      {url ? <img src={url} alt={pagina === 0 ? 'Capa do documento' : `Página ${pagina}`} draggable={false} decoding="async" onError={() => (tentativa < 1 ? setTentativa((t) => t + 1) : setFalhou(true))} /> : falhou ? <span className="falta small">sem imagem</span> : null}
      {rotulo && <span className="pag">{rotulo}</span>}
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { podeBaixar, podeImprimir } from '../components/acoesArquivo'
import { Icone } from '../components/Icone'
import { Miniatura } from '../components/Miniatura'
import { SaidaPaginas, type ModoSaida } from '../components/SaidaPaginas'
import { Alerta, Carregando, TextoTrecho } from '../components/ui'
import { useConsulta, useDebounce } from '../lib/hooks'
import { caixasDeTexto, carregarPdf, renderizar, type CaixaTexto, type PdfDoc } from '../lib/pdf'
import { casaAlgum, compilarTermos } from '../lib/termos'
import { competencia, normalizar, plural } from '../lib/util'

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3]

export function Documento() {
  const { id = '' } = useParams()
  const [sp, setSp] = useSearchParams()
  const navegar = useNavigate()
  const usuario = api.usuarioAtual()
  const [saida, setSaida] = useState<ModoSaida | null>(null)

  const { data: doc, erro: erroDoc } = useConsulta(() => api.documento(id), [id])
  const total = doc?.paginas ?? 0
  const pagina = Math.min(Math.max(1, Number(sp.get('p')) || 1), Math.max(1, total))
  const irPara = (p: number) => {
    const n = new URLSearchParams(sp)
    n.set('p', String(Math.min(Math.max(1, p), total || 1)))
    setSp(n, { replace: true })
  }

  // termo de busca dentro do documento
  const [termo, setTermo] = useState(sp.get('q') ?? '')
  const termoDeb = useDebounce(termo.trim(), 200)
  useEffect(() => {
    const n = new URLSearchParams(sp)
    if (termoDeb) n.set('q', termoDeb)
    else n.delete('q')
    if (n.toString() !== sp.toString()) setSp(n, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termoDeb])
  const { data: acertos } = useConsulta(() => (termoDeb ? api.buscarNoDocumento(id, termoDeb) : Promise.resolve(null)), [id, termoDeb])
  const termos = useMemo(() => (termoDeb ? compilarTermos(termoDeb) : []), [termoDeb])
  const hitsPorPagina = useMemo(() => new Map((acertos ?? []).map((a) => [a.pagina, a.ocorrencias])), [acertos])
  const totalOcorrencias = acertos?.reduce((s, a) => s + a.ocorrencias, 0) ?? 0

  // carrega o PDF
  const [pdf, setPdf] = useState<PdfDoc | null>(null)
  const [erroPdf, setErroPdf] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    let carregado: PdfDoc | null = null
    setPdf(null)
    setErroPdf(null)
    api.urlDoArquivo(id)
      .then((url) => carregarPdf(url))
      .then((p) => {
        carregado = p
        if (vivo) setPdf(p)
        else void p.loadingTask.destroy()
      })
      .catch((e: unknown) => vivo && setErroPdf(e instanceof Error ? e.message : String(e)))
    void api.registrarUso('viu', id).catch(() => undefined)
    return () => {
      vivo = false
      void carregado?.loadingTask.destroy()
    }
  }, [id])

  // largura disponível × zoom
  const palcoRef = useRef<HTMLDivElement>(null)
  const [larguraPalco, setLarguraPalco] = useState(800)
  const [zoom, setZoom] = useState(1)
  useEffect(() => {
    const el = palcoRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setLarguraPalco(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const largura = Math.round(Math.min(Math.max(larguraPalco - 40, 280), 900) * zoom)

  // renderiza a página atual
  const folhaRef = useRef<HTMLDivElement>(null)
  const [caixas, setCaixas] = useState<CaixaTexto[]>([])
  const [renderizando, setRenderizando] = useState(false)
  useEffect(() => {
    if (!pdf || !folhaRef.current) return
    let vivo = true
    setRenderizando(true)
    ;(async () => {
      const page = await pdf.getPage(pagina)
      const canvas = document.createElement('canvas')
      await renderizar(page, canvas, largura, Math.min(window.devicePixelRatio || 1, 2))
      const cx = await caixasDeTexto(page, largura)
      if (!vivo || !folhaRef.current) return
      const antigo = folhaRef.current.querySelector('canvas')
      if (antigo) antigo.replaceWith(canvas)
      else folhaRef.current.prepend(canvas)
      setCaixas(cx)
    })()
      .catch((e: unknown) => vivo && setErroPdf(e instanceof Error ? e.message : String(e)))
      .finally(() => vivo && setRenderizando(false))
    return () => {
      vivo = false
    }
  }, [pdf, pagina, largura])

  const realces = useMemo(() => (termos.length ? caixas.filter((c) => casaAlgum(normalizar(c.texto), termos)) : []), [caixas, termos])

  // rola a primeira ocorrência para a vista
  useEffect(() => {
    const palco = palcoRef.current
    if (!realces.length || !palco || !folhaRef.current) return
    const topoFolha = folhaRef.current.getBoundingClientRect().top - palco.getBoundingClientRect().top + palco.scrollTop
    palco.scrollTo({ top: Math.max(0, topoFolha + realces[0].y - 120), behavior: 'smooth' })
  }, [realces])

  // ao trocar de página: volta ao topo da folha e mostra a miniatura atual na coluna
  const colunaRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    palcoRef.current?.scrollTo({ top: 0 })
    const coluna = colunaRef.current
    const atual = coluna?.querySelector<HTMLElement>('.atual')
    if (coluna && atual) {
      // rola só a coluna (scrollIntoView rolaria a janela inteira junto)
      const topo = atual.offsetTop - coluna.offsetTop
      if (topo < coluna.scrollTop || topo + atual.offsetHeight > coluna.scrollTop + coluna.clientHeight) {
        coluna.scrollTo({ top: topo - coluna.clientHeight / 2 + atual.offsetHeight / 2 })
      }
    }
  }, [pagina, total])

  // teclado: ← → PageUp PageDown
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement
      if (saida) return
      if (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.tagName === 'SELECT') return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') irPara(pagina + 1)
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') irPara(pagina - 1)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  })

  const paginasComHit = (acertos ?? []).map((a) => a.pagina)
  const anteriorHit = [...paginasComHit].reverse().find((p) => p < pagina)
  const proximoHit = paginasComHit.find((p) => p > pagina)

  // campo "página N": edita livre e só navega ao confirmar
  const [paginaDigitada, setPaginaDigitada] = useState(String(pagina))
  useEffect(() => setPaginaDigitada(String(pagina)), [pagina])
  const confirmarPagina = () => {
    const n = Number(paginaDigitada)
    if (n >= 1 && n <= total) irPara(n)
    else setPaginaDigitada(String(pagina))
  }

  const voltar = () => (window.history.length > 1 ? navegar(-1) : navegar(`/acervo?doc=${id}`))

  if (erroDoc) {
    return (
      <main className="pagina">
        <Alerta tipo="erro">{erroDoc}</Alerta>
        <p style={{ marginTop: 12 }}><button className="btn" onClick={() => navegar('/acervo')}>Ir para o acervo</button></p>
      </main>
    )
  }

  return (
    <main className="pagina cheia">
      <div className="visualizador">
        <div className="vis-barra">
          <button className="btn discreto peq" onClick={voltar}><Icone nome="esquerda" />Voltar</button>
          <div className="titulo">
            <h1 title={doc?.titulo}>{doc?.titulo ?? 'Carregando…'}</h1>
            {doc && <p>{[doc.entidade, `${doc.municipio}/${doc.uf}`, doc.tipo, competencia(doc.mes, doc.ano), doc.caixa].filter(Boolean).join(' · ')}</p>}
          </div>
          <div className="grupo-btn">
            <button className="btn peq icone" onClick={() => irPara(pagina - 1)} disabled={pagina <= 1} aria-label="Página anterior"><Icone nome="esquerda" /></button>
            <span className="rotulo-pag">
              <input
                id="ir-pagina" className="input peq num" style={{ width: 52, textAlign: 'center' }} aria-label="Número da página" inputMode="numeric"
                value={paginaDigitada}
                onChange={(e) => setPaginaDigitada(e.target.value.replace(/\D/g, '').slice(0, 5))}
                onKeyDown={(e) => e.key === 'Enter' && confirmarPagina()}
                onBlur={confirmarPagina}
                onFocus={(e) => e.target.select()}
              />
              {' '}de {total}
            </span>
            <button className="btn peq icone" onClick={() => irPara(pagina + 1)} disabled={pagina >= total} aria-label="Próxima página"><Icone nome="direita" /></button>
          </div>
          <div className="grupo-btn">
            <button className="btn peq icone" onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)])} disabled={zoom <= ZOOMS[0]} aria-label="Diminuir zoom"><Icone nome="zoomMenos" /></button>
            <button className="btn peq num" style={{ minWidth: 56 }} onClick={() => setZoom(1)} title="Ajustar à largura">{Math.round(zoom * 100)}%</button>
            <button className="btn peq icone" onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)])} disabled={zoom >= ZOOMS[ZOOMS.length - 1]} aria-label="Aumentar zoom"><Icone nome="zoomMais" /></button>
          </div>
          {doc && (
            <div className="grupo-btn">
              {podeBaixar(usuario) && <button className="btn peq" onClick={() => setSaida('baixar')}><Icone nome="baixar" />Baixar PDF</button>}
              {podeImprimir(usuario) && <button className="btn peq" onClick={() => setSaida('imprimir')}><Icone nome="imprimir" />Imprimir</button>}
            </div>
          )}
          {doc && saida && (
            <SaidaPaginas doc={doc} modo={saida} paginaAtual={pagina} termo={termoDeb} paginasTermo={paginasComHit} aoFechar={() => setSaida(null)} />
          )}
        </div>

        <div className="vis-miniaturas" ref={colunaRef} aria-label="Páginas">
          {Array.from({ length: total }, (_, i) => i + 1).map((p) => (
            <button key={p} className={p === pagina ? 'atual' : ''} onClick={() => irPara(p)} aria-current={p === pagina ? 'page' : undefined} aria-label={`Página ${p}`}>
              <Miniatura docId={id} pagina={p} />
              <span>{hitsPorPagina.get(p) ? <span className="tem-hit">{p} · {hitsPorPagina.get(p)}</span> : p}</span>
            </button>
          ))}
        </div>

        <div className="vis-palco" ref={palcoRef}>
          {erroPdf ? (
            <Alerta tipo="erro">{erroPdf}</Alerta>
          ) : (
            <div className="folha" ref={folhaRef} style={{ width: largura, minHeight: pdf ? undefined : largura * 1.414 }}>
              {(!pdf || renderizando) && caixas.length === 0 && <div style={{ padding: 24 }}><Carregando texto="Abrindo página…" /></div>}
              {realces.map((r, i) => (
                <span key={i} className="realce" style={{ left: r.x - 2, top: r.y - 1, width: r.w + 4, height: r.h + 2 }} />
              ))}
            </div>
          )}
        </div>

        <aside className="vis-lateral" aria-label="Buscar no documento">
          <div className="busca-interna">
            <label className="busca-campo">
              <span className="sr-only">Buscar neste documento</span>
              <Icone nome="busca" />
              <input id="busca-vis" className="input" placeholder="Buscar neste documento" value={termo} onChange={(e) => setTermo(e.target.value)} />
            </label>
            {termoDeb && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span className="small muted">
                  {acertos?.length ? `${plural(totalOcorrencias, 'ocorrência', 'ocorrências')} em ${plural(acertos.length, 'página', 'páginas')}` : acertos ? 'Nenhuma ocorrência.' : 'Buscando…'}
                </span>
                <span className="grupo-btn">
                  <button className="btn peq icone" disabled={!anteriorHit} onClick={() => anteriorHit && irPara(anteriorHit)} aria-label="Página anterior com ocorrência"><Icone nome="cima" /></button>
                  <button className="btn peq icone" disabled={!proximoHit} onClick={() => proximoHit && irPara(proximoHit)} aria-label="Próxima página com ocorrência"><Icone nome="baixo" /></button>
                </span>
              </div>
            )}
            {termoDeb && acertos?.some((a) => a.pagina === pagina) && realces.length === 0 && caixas.length > 0 && (
              <span className="small muted">O termo está nesta página, mas dividido entre linhas; o destaque pode não aparecer.</span>
            )}
          </div>
          <div className="resultados">
            {!termoDeb && <p className="small muted" style={{ padding: 12 }}>Digite uma palavra para ver em que páginas ela aparece. Use ← e → para trocar de página.</p>}
            {acertos?.map((a) => (
              <button key={a.pagina} className={`acerto${a.pagina === pagina ? ' atual' : ''}`} onClick={() => irPara(a.pagina)}>
                <Miniatura docId={id} pagina={a.pagina} />
                <div>
                  <div className="pg">Página {a.pagina} <span className="muted" style={{ fontWeight: 400 }}>· {a.ocorrencias}×</span></div>
                  {a.trechos.map((t, i) => <div key={i} className="tx"><TextoTrecho partes={t} /></div>)}
                </div>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </main>
  )
}

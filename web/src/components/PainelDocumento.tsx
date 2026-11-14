import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useConsulta, useDebounce } from '../lib/hooks'
import { competencia, formatarTamanho, plural } from '../lib/util'
import { podeBaixar, podeImprimir } from './acoesArquivo'
import { SaidaPaginas, type ModoSaida } from './SaidaPaginas'
import { Icone } from './Icone'
import { Miniatura } from './Miniatura'
import { Alerta, Carregando, TextoTrecho } from './ui'

export function PainelDocumento({ docId, termoInicial, aoFechar }: { docId: string; termoInicial: string; aoFechar: () => void }) {
  const navegar = useNavigate()
  const usuario = api.usuarioAtual()
  const [termo, setTermo] = useState(termoInicial)
  const [saida, setSaida] = useState<ModoSaida | null>(null)
  useEffect(() => setTermo(termoInicial), [docId, termoInicial])
  const termoDeb = useDebounce(termo.trim(), 200)

  const { data: doc, erro } = useConsulta(() => api.documento(docId), [docId])
  const { data: acertos, carregando: buscando } = useConsulta(
    () => (termoDeb ? api.buscarNoDocumento(docId, termoDeb) : Promise.resolve(null)),
    [docId, termoDeb],
  )

  const abrir = (pagina: number) => {
    const q = termoDeb ? `&q=${encodeURIComponent(termoDeb)}` : ''
    navegar(`/documento/${docId}?p=${pagina}${q}`)
  }

  const totalOcorrencias = acertos?.reduce((s, a) => s + a.ocorrencias, 0) ?? 0

  return (
    <aside className="painel painel-doc" aria-label="Documento selecionado">
      <div style={{ position: 'relative' }}>
        <button className="btn discreto peq icone fechar-painel" onClick={aoFechar} aria-label="Fechar painel"><Icone nome="x" /></button>
      </div>
      {erro && <div className="painel-corpo"><Alerta tipo="erro">{erro}</Alerta></div>}
      {!doc && !erro && <div className="painel-corpo"><Carregando /></div>}
      {doc && (
        <>
          <div className="topo-doc">
            <Miniatura docId={doc.id} pagina={0} />
            <div style={{ minWidth: 0, paddingRight: 24 }}>
              <h2>{doc.titulo}</h2>
              <dl>
                {doc.entidade && <><dt>Entidade</dt><dd>{doc.entidade}</dd></>}
                <dt>Município</dt><dd>{doc.municipio}/{doc.uf}</dd>
                <dt>Tipo</dt><dd>{doc.tipo}</dd>
                <dt>{doc.mes ? 'Competência' : 'Ano'}</dt><dd>{competencia(doc.mes, doc.ano)}</dd>
                <dt>Caixa</dt><dd>{doc.caixa ?? '—'}</dd>
                <dt>Páginas</dt><dd className="num">{doc.paginas} · {formatarTamanho(doc.tamanhoKb)}</dd>
              </dl>
            </div>
          </div>

          <div className="busca-interna">
            <label className="busca-campo">
              <span className="sr-only">Buscar neste documento</span>
              <Icone nome="busca" />
              <input id="busca-no-doc" className="input" placeholder="Buscar neste documento" value={termo} onChange={(e) => setTermo(e.target.value)} />
            </label>
            {termoDeb && (
              <span className="small muted">
                {buscando && !acertos ? 'Buscando…' : acertos?.length ? `${plural(totalOcorrencias, 'ocorrência', 'ocorrências')} em ${plural(acertos.length, 'página', 'páginas')}` : 'Nenhuma ocorrência neste documento.'}
              </span>
            )}
            {doc.erro && doc.status === 'pronto' && <Alerta tipo="aviso">{doc.erro}</Alerta>}
          </div>

          <div className="resultados">
            {termoDeb && acertos ? (
              acertos.map((a) => (
                <button key={a.pagina} className="acerto" onClick={() => abrir(a.pagina)}>
                  <Miniatura docId={doc.id} pagina={a.pagina} />
                  <div>
                    <div className="pg">Página {a.pagina} <span className="muted" style={{ fontWeight: 400 }}>· {plural(a.ocorrencias, 'ocorrência', 'ocorrências')}</span></div>
                    {a.trechos.map((t, i) => <div key={i} className="tx"><TextoTrecho partes={t} /></div>)}
                  </div>
                </button>
              ))
            ) : !termoDeb ? (
              <div className="paginas-grade">
                {Array.from({ length: doc.paginas }, (_, i) => (
                  <button key={i} onClick={() => abrir(i + 1)} title={`Abrir página ${i + 1}`}>
                    <Miniatura docId={doc.id} pagina={i + 1} rotulo={String(i + 1)} />
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="rodape-doc">
            <button className="btn primario peq" onClick={() => abrir(acertos?.[0]?.pagina ?? 1)}><Icone nome="abrir" />Abrir</button>
            {podeBaixar(usuario) && <button className="btn peq" onClick={() => setSaida('baixar')}><Icone nome="baixar" />Baixar PDF</button>}
            {podeImprimir(usuario) && <button className="btn peq" onClick={() => setSaida('imprimir')}><Icone nome="imprimir" />Imprimir</button>}
            {usuario?.papel === 'admin' && <Link className="btn peq discreto" to={`/admin/documentos?editar=${doc.id}`}><Icone nome="editar" />Editar</Link>}
          </div>
          {saida && (
            <SaidaPaginas doc={doc} modo={saida} termo={termoDeb} paginasTermo={acertos?.map((a) => a.pagina) ?? []} aoFechar={() => setSaida(null)} />
          )}
        </>
      )}
    </aside>
  )
}

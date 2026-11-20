import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, type DocResumo, type Faceta, type Filtros } from '../api'
import { Icone } from '../components/Icone'
import { Miniatura } from '../components/Miniatura'
import { PainelDocumento } from '../components/PainelDocumento'
import { Alerta, Carregando, TextoTrecho, Vazio } from '../components/ui'
import { useConsulta, useDebounce } from '../lib/hooks'
import { competencia, formatarNumero, plural } from '../lib/util'

const CHAVES = ['q', 'mun', 'ent', 'cx', 'tipo', 'de', 'ate'] as const
const POR_VEZ = 60

function numero(v: string | null): number | undefined {
  const n = Number(v)
  return v && Number.isFinite(n) ? n : undefined
}

export function Acervo() {
  const [sp, setSp] = useSearchParams()
  const usuario = api.usuarioAtual()
  const chaveFiltros = CHAVES.map((k) => sp.get(k) ?? '').join('|')
  const filtros: Filtros = useMemo(
    () => ({
      texto: sp.get('q') ?? '',
      municipioId: sp.get('mun') || undefined,
      entidadeId: sp.get('ent') || undefined,
      caixaId: sp.get('cx') || undefined,
      tipoId: sp.get('tipo') || undefined,
      anoDe: numero(sp.get('de')),
      anoAte: numero(sp.get('ate')),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chaveFiltros],
  )
  const docSel = sp.get('doc')
  const vista = sp.get('vista') === 'lista' ? 'lista' : 'grade'
  const [filtrosAbertos, setFiltrosAbertos] = useState(false)
  const [limite, setLimite] = useState(POR_VEZ)

  const mudar = (mudancas: Record<string, string | null | undefined>, substituir = false) => {
    const p = new URLSearchParams(sp)
    for (const [k, v] of Object.entries(mudancas)) {
      if (v) p.set(k, v)
      else p.delete(k)
    }
    setSp(p, { replace: substituir })
  }

  // texto digitado → URL (com pausa)
  const [texto, setTexto] = useState(filtros.texto ?? '')
  const textoDeb = useDebounce(texto, 300)
  const ultimoQ = useRef(sp.get('q') ?? '')
  useEffect(() => {
    const q = textoDeb.trim()
    if (q === ultimoQ.current) return
    ultimoQ.current = q
    mudar({ q: q || null }, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textoDeb])
  useEffect(() => {
    // mudança vinda de fora (chip removido, voltar do navegador)
    const q = sp.get('q') ?? ''
    if (q === ultimoQ.current) return
    ultimoQ.current = q
    setTexto(q)
  }, [sp])

  // registra a busca na auditoria quando a pessoa para de digitar
  const termoLog = useDebounce(filtros.texto ?? '', 1500)
  useEffect(() => {
    if (termoLog.trim().length >= 3) void api.registrarBusca(termoLog.trim())
  }, [termoLog])

  useEffect(() => setLimite(POR_VEZ), [chaveFiltros])

  const { data: cat } = useConsulta(() => api.catalogo(), [])
  const { data, erro, carregando } = useConsulta(() => api.buscar(filtros), [filtros])

  const nome = {
    mun: (id: string) => { const m = cat?.municipios.find((x) => x.id === id); return m ? `${m.nome}/${m.uf}` : 'Município' },
    ent: (id: string) => cat?.entidades.find((x) => x.id === id)?.sigla ?? 'Entidade',
    cx: (id: string) => cat?.caixas.find((x) => x.id === id)?.codigo ?? 'Caixa',
    tipo: (id: string) => cat?.tipos.find((x) => x.id === id)?.nome ?? 'Tipo',
  }

  const ativos: { chave: string; rotulo: string; limpar: Record<string, null> }[] = []
  if (filtros.texto) ativos.push({ chave: 'q', rotulo: `“${filtros.texto}”`, limpar: { q: null } })
  if (filtros.municipioId) ativos.push({ chave: 'mun', rotulo: nome.mun(filtros.municipioId), limpar: { mun: null, cx: null, ent: null } })
  if (filtros.entidadeId) ativos.push({ chave: 'ent', rotulo: nome.ent(filtros.entidadeId), limpar: { ent: null } })
  if (filtros.tipoId) ativos.push({ chave: 'tipo', rotulo: nome.tipo(filtros.tipoId), limpar: { tipo: null } })
  if (filtros.caixaId) ativos.push({ chave: 'cx', rotulo: nome.cx(filtros.caixaId), limpar: { cx: null } })
  if (filtros.anoDe || filtros.anoAte) {
    const r = filtros.anoDe && filtros.anoDe === filtros.anoAte ? `Ano ${filtros.anoDe}` : `Ano ${filtros.anoDe ?? '…'} a ${filtros.anoAte ?? '…'}`
    ativos.push({ chave: 'ano', rotulo: r, limpar: { de: null, ate: null } })
  }
  const limparTudo = () => mudar({ q: null, mun: null, ent: null, cx: null, tipo: null, de: null, ate: null })

  const selecionar = (id: string) => mudar({ doc: docSel === id ? null : id }, true)
  const anoUnico = filtros.anoDe && filtros.anoDe === filtros.anoAte ? filtros.anoDe : null

  const grupo = (titulo: string, chave: 'mun' | 'ent' | 'tipo' | 'cx', lista: Faceta[] | undefined, valor: string | undefined, extra?: Record<string, null>) => {
    if (!lista?.length && !valor) return null
    return (
      <div className="filtro-grupo">
        <h3>{titulo}{valor && <button className="btn discreto peq" onClick={() => mudar({ [chave]: null, ...extra })}>limpar</button>}</h3>
        <div className="opcoes">
          {lista?.map((f) => (
            <button key={f.id} className={`opcao${valor === f.id ? ' ativa' : ''}`} aria-pressed={valor === f.id} onClick={() => mudar({ [chave]: valor === f.id ? null : f.id, ...(valor === f.id ? extra : {}) })}>
              <span>{f.nome}</span><span className="qtd">{formatarNumero(f.qtd)}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  const docs = data?.documentos ?? []
  const semNada = data && data.total === 0 && ativos.length === 0

  return (
    <main className="pagina">
      <div className="cabecalho">
        <div>
          <h1>Acervo</h1>
          <p>Pesquise pelo texto das páginas ou filtre por município, entidade, tipo, caixa e ano. Clique num documento para ver as páginas e buscar dentro dele.</p>
        </div>
      </div>

      <div className={`acervo${docSel ? ' com-painel' : ''}`}>
        <aside className={`painel filtros${filtrosAbertos ? '' : ' recolhido'}`} aria-label="Filtros">
          <div className="filtro-grupo" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>Filtros</h3>
            <span style={{ display: 'flex', gap: 4 }}>
              {ativos.length > 0 && <button className="btn discreto peq" onClick={limparTudo}>Limpar tudo</button>}
              <button className="btn peq alternar-filtros" onClick={() => setFiltrosAbertos((v) => !v)} aria-expanded={filtrosAbertos}>
                <Icone nome="filtro" />{filtrosAbertos ? 'Ocultar' : 'Mostrar'}
              </button>
            </span>
          </div>
          {grupo('Município', 'mun', data?.facetas.municipios, filtros.municipioId, { cx: null, ent: null })}
          {grupo('Entidade', 'ent', data?.facetas.entidades, filtros.entidadeId)}
          {grupo('Tipo de documento', 'tipo', data?.facetas.tipos, filtros.tipoId)}
          {grupo('Caixa', 'cx', data?.facetas.caixas, filtros.caixaId)}
          <div className="filtro-grupo">
            <h3>Ano{(filtros.anoDe || filtros.anoAte) && <button className="btn discreto peq" onClick={() => mudar({ de: null, ate: null })}>limpar</button>}</h3>
            {data?.facetas.anos.length ? (
              <div className="anos">
                {data.facetas.anos.map((a) => (
                  <button key={a.ano} className={`ano${anoUnico === a.ano ? ' ativo' : ''}`} aria-pressed={anoUnico === a.ano} onClick={() => (anoUnico === a.ano ? mudar({ de: null, ate: null }) : mudar({ de: String(a.ano), ate: String(a.ano) }))}>
                    {a.ano}<small> · {formatarNumero(a.qtd)} {a.qtd === 1 ? 'doc' : 'docs'}</small>
                  </button>
                ))}
              </div>
            ) : <span className="small muted">Sem anos para mostrar.</span>}
            <div className="intervalo">
              <input id="ano-de" className="input peq num" inputMode="numeric" placeholder="De" aria-label="Ano inicial" value={sp.get('de') ?? ''} onChange={(e) => mudar({ de: e.target.value.replace(/\D/g, '').slice(0, 4) || null }, true)} />
              <span className="muted small">a</span>
              <input id="ano-ate" className="input peq num" inputMode="numeric" placeholder="Até" aria-label="Ano final" value={sp.get('ate') ?? ''} onChange={(e) => mudar({ ate: e.target.value.replace(/\D/g, '').slice(0, 4) || null }, true)} />
            </div>
          </div>
        </aside>

        <section style={{ minWidth: 0 }}>
          <div className="barra-busca">
            <label className="busca-campo grande">
              <span className="sr-only">Pesquisar no acervo</span>
              <Icone nome="busca" />
              <input id="busca-acervo" className="input" placeholder="Pesquisar palavras no texto dos documentos. Ex.: conciliação bancária" value={texto} onChange={(e) => setTexto(e.target.value)} autoFocus />
              {texto && <button className="btn discreto peq icone limpar" onClick={() => setTexto('')} aria-label="Limpar pesquisa"><Icone nome="x" /></button>}
            </label>
            <div className="grupo-btn" role="group" aria-label="Modo de exibição">
              <button className={`btn icone${vista === 'grade' ? ' primario' : ''}`} onClick={() => mudar({ vista: null }, true)} aria-pressed={vista === 'grade'} title="Miniaturas"><Icone nome="grade" /></button>
              <button className={`btn icone${vista === 'lista' ? ' primario' : ''}`} onClick={() => mudar({ vista: 'lista' }, true)} aria-pressed={vista === 'lista'} title="Lista"><Icone nome="lista" /></button>
            </div>
          </div>

          <div className="ativos">
            {ativos.map((a) => (
              <span key={a.chave} className="chip-filtro">
                {a.rotulo}
                <button onClick={() => mudar(a.limpar)} aria-label={`Remover filtro ${a.rotulo}`}><Icone nome="x" tam={13} /></button>
              </span>
            ))}
            <span className="contagem">
              {carregando && !data ? <Carregando texto="Buscando…" /> : data ? <>{plural(data.total, 'documento', 'documentos')}{filtros.texto ? ` · ${data.ms} ms` : ''}</> : null}
            </span>
          </div>

          {erro && <Alerta tipo="erro">{erro}</Alerta>}

          {semNada ? (
            <div className="painel">
              {usuario?.papel === 'admin' ? (
                <Vazio titulo="O acervo ainda está vazio" icone="pasta">
                  <p>Envie os PDFs digitalizados para começar. O sistema lê o texto de cada página e gera as miniaturas.</p>
                  <p style={{ marginTop: 12 }}><Link className="btn primario" to="/admin/enviar"><Icone nome="enviar" />Enviar PDFs</Link></p>
                </Vazio>
              ) : (
                <Vazio titulo="Nenhum documento liberado ainda" icone="escudo">
                  <p>Quando o administrador liberar documentos para a sua organização, eles aparecem aqui.</p>
                </Vazio>
              )}
            </div>
          ) : data && data.total === 0 ? (
            <div className="painel">
              <Vazio titulo="Nenhum documento encontrado" icone="busca">
                <p>Tente outras palavras ou remova algum filtro.</p>
                <p style={{ marginTop: 12 }}><button className="btn" onClick={limparTudo}>Limpar filtros</button></p>
              </Vazio>
            </div>
          ) : vista === 'grade' ? (
            <div className="grade-docs">
              {docs.slice(0, limite).map((d) => <CartaoDoc key={d.id} d={d} selecionado={docSel === d.id} aoClicar={() => selecionar(d.id)} />)}
            </div>
          ) : (
            <div className="painel lista-docs">
              <div className="tabela-wrap">
                <table className="tabela">
                  <thead>
                    <tr><th>Documento</th><th>Entidade</th><th>Tipo</th><th>Competência</th><th>Caixa</th><th className="dir">Págs.</th>{filtros.texto && <th className="dir">Págs. com o termo</th>}</tr>
                  </thead>
                  <tbody>
                    {docs.slice(0, limite).map((d) => (
                      <tr key={d.id} onClick={() => selecionar(d.id)} style={docSel === d.id ? { background: 'var(--primary-soft)' } : undefined}>
                        <td><div className="titulo-celula">{d.titulo}</div><div className="sub">{d.municipio}/{d.uf}</div></td>
                        <td>{d.entidade ?? '—'}</td>
                        <td>{d.tipo}</td>
                        <td className="num">{competencia(d.mes, d.ano)}</td>
                        <td className="mono">{d.caixa ?? '—'}</td>
                        <td className="dir num">{d.paginas}</td>
                        {filtros.texto && <td className="dir num">{d.paginasComAcerto ?? 0}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {docs.length > limite && (
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <button className="btn" onClick={() => setLimite((l) => l + POR_VEZ)}>Mostrar mais ({formatarNumero(docs.length - limite)} restantes)</button>
            </div>
          )}
        </section>

        {docSel && <PainelDocumento docId={docSel} termoInicial={filtros.texto ?? ''} aoFechar={() => mudar({ doc: null }, true)} />}
      </div>
    </main>
  )
}

function CartaoDoc({ d, selecionado, aoClicar }: { d: DocResumo; selecionado: boolean; aoClicar: () => void }) {
  return (
    <button className={`cartao-doc${selecionado ? ' selecionado' : ''}`} onClick={aoClicar} aria-pressed={selecionado}>
      <Miniatura docId={d.id} pagina={0} rotulo={`${d.paginas} p.`} />
      <div className="titulo">{d.titulo}</div>
      <div className="meta">
        {[d.entidade, `${d.municipio}/${d.uf}`].filter(Boolean).join(' · ')}
        {!d.titulo.includes(competencia(d.mes, d.ano)) && <><br />{d.tipo} · {competencia(d.mes, d.ano)}</>}
        {d.caixa && <><br />Caixa {d.caixa}</>}
      </div>
      {d.descricao && <div className="meta descricao" title={d.descricao}>{d.descricao}</div>}
      {d.paginasComAcerto === 0 && d.trecho ? (
        <div className="hits">Encontrado na descrição</div>
      ) : d.paginasComAcerto ? (
        <>
          <div className="hits">
            {d.ocorrencias ? `${plural(d.ocorrencias, 'ocorrência', 'ocorrências')} em ` : 'Em '}
            {plural(d.paginasComAcerto, 'página', 'páginas')}{d.trecho ? ` · 1ª na pág. ${d.trecho.pagina}` : ''}
          </div>
          {d.trecho && <div className="trecho"><TextoTrecho partes={d.trecho.partes} /></div>}
        </>
      ) : null}
    </button>
  )
}

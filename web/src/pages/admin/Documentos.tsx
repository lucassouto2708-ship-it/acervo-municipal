import { useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, type Catalogo, type DocResumo, type StatusDoc } from '../../api'
import { Icone } from '../../components/Icone'
import { Alerta, Carregando, Modal, StatusDocumento, useUI, Vazio } from '../../components/ui'
import { useAcao, useConsulta, useVersaoDados } from '../../lib/hooks'
import { capitalizar, competencia, formatarData, formatarTamanho, MESES, normalizar, plural } from '../../lib/util'

export function Documentos() {
  const [sp, setSp] = useSearchParams()
  const { avisar, confirmar } = useUI()
  useVersaoDados()
  const { data: docs, erro, carregando } = useConsulta(() => api.listarDocumentos(), [])
  const { data: cat } = useConsulta(() => api.catalogo(), [])
  const [busca, setBusca] = useState('')
  const [status, setStatus] = useState<'' | StatusDoc | 'aviso'>('')
  const [entidade, setEntidade] = useState('')
  const editarId = sp.get('editar')
  const editando = docs?.find((d) => d.id === editarId)

  const lista = useMemo(() => {
    const q = normalizar(busca.trim())
    return (docs ?? []).filter((d) =>
      (!q || normalizar(`${d.titulo} ${d.arquivoNome} ${d.caminho}`).includes(q)) &&
      (!status || (status === 'aviso' ? d.status === 'pronto' && !!d.erro : d.status === status)) &&
      (!entidade || d.entidadeId === entidade),
    )
  }, [docs, busca, status, entidade])

  const contagem = useMemo(() => {
    const c = { pronto: 0, processando: 0, na_fila: 0, erro: 0, aviso: 0, paginas: 0 }
    for (const d of docs ?? []) {
      c[d.status]++
      if (d.status === 'pronto' && d.erro) c.aviso++
      c.paginas += d.paginas
    }
    return c
  }, [docs])

  const remover = async (d: DocResumo) => {
    const ok = await confirmar({
      titulo: 'Remover documento',
      texto: <>Remover <b>{d.titulo}</b> do acervo? O PDF, o texto e as miniaturas são apagados e os clientes deixam de ver o documento. Não dá para desfazer.</>,
      confirmar: 'Remover',
      perigo: true,
    })
    if (!ok) return
    try {
      await api.removerDocumento(d.id)
      avisar('Documento removido.')
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), true)
    }
  }

  const reprocessar = async (d: DocResumo) => {
    try {
      await api.reprocessar(d.id)
      avisar(`${d.titulo} voltou para a fila.`)
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), true)
    }
  }

  const fecharEdicao = () => {
    const n = new URLSearchParams(sp)
    n.delete('editar')
    setSp(n, { replace: true })
  }

  return (
    <main className="pagina">
      <div className="cabecalho">
        <div>
          <h1>Documentos</h1>
          <p>Todos os PDFs do acervo, inclusive os que ainda estão em processamento. Edite metadados, reprocesse ou remova.</p>
        </div>
        <div className="acoes"><Link className="btn primario" to="/admin/enviar"><Icone nome="enviar" />Enviar PDFs</Link></div>
      </div>

      <div className="painel">
        <div className="painel-cab">
          <div className="resumo-org">
            <span><b>{docs?.length ?? 0}</b>documentos</span>
            <span><b>{contagem.paginas.toLocaleString('pt-BR')}</b>páginas</span>
            {contagem.processando + contagem.na_fila > 0 && <span><b>{contagem.processando + contagem.na_fila}</b>em processamento</span>}
            {contagem.erro > 0 && <span style={{ color: 'var(--erro)' }}><b style={{ color: 'inherit' }}>{contagem.erro}</b>com erro</span>}
          </div>
          <div className="linha-acoes">
            <label className="busca-campo" style={{ minWidth: 220 }}>
              <span className="sr-only">Filtrar por título ou arquivo</span>
              <Icone nome="busca" />
              <input id="docs-busca" className="input peq" placeholder="Título ou nome do arquivo" value={busca} onChange={(e) => setBusca(e.target.value)} />
            </label>
            <select id="docs-entidade" className="input peq" style={{ width: 'auto' }} aria-label="Entidade" value={entidade} onChange={(e) => setEntidade(e.target.value)}>
              <option value="">Todas as entidades</option>
              {cat?.entidades.map((en) => <option key={en.id} value={en.id}>{en.sigla}</option>)}
            </select>
            <select id="docs-status" className="input peq" style={{ width: 'auto' }} aria-label="Situação" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="">Todas as situações</option>
              <option value="pronto">Pronto</option>
              <option value="processando">Processando</option>
              <option value="na_fila">Na fila</option>
              <option value="erro">Erro</option>
              <option value="aviso">Sem texto</option>
            </select>
          </div>
        </div>
        {erro && <div className="painel-corpo"><Alerta tipo="erro">{erro}</Alerta></div>}
        {carregando && !docs && <div className="painel-corpo"><Carregando /></div>}
        {docs && docs.length === 0 && (
          <Vazio titulo="Nenhum documento enviado" icone="pasta">
            <p style={{ marginTop: 8 }}><Link className="btn primario" to="/admin/enviar"><Icone nome="enviar" />Enviar PDFs</Link></p>
          </Vazio>
        )}
        {docs && docs.length > 0 && lista.length === 0 && <Vazio titulo="Nenhum documento com esses filtros" icone="busca" />}
        {lista.length > 0 && (
          <div className="tabela-wrap">
            <table className="tabela">
              <thead>
                <tr><th>Documento</th><th>Entidade</th><th>Tipo</th><th>Competência</th><th>Caixa</th><th className="dir">Págs.</th><th className="dir">Tamanho</th><th>Situação</th><th>Enviado</th><th className="dir">Ações</th></tr>
              </thead>
              <tbody>
                {lista.map((d) => {
                  const p = api.progresso(d.id)
                  return (
                    <tr key={d.id}>
                      <td style={{ maxWidth: 320 }}>
                        <div className="titulo-celula">{d.titulo}</div>
                        <div className="sub" style={{ overflowWrap: 'anywhere' }}>{d.caminho}</div>
                        {d.erro && <div className="small" style={{ color: d.status === 'erro' ? 'var(--erro)' : 'var(--aviso)' }}>{d.erro}</div>}
                      </td>
                      <td>{d.entidade ?? '—'}<div className="sub">{d.municipio}/{d.uf}</div></td>
                      <td>{d.tipo}</td>
                      <td className="num">{competencia(d.mes, d.ano)}</td>
                      <td className="mono">{d.caixa ?? '—'}</td>
                      <td className="dir num">{d.status === 'processando' && p ? `${p.feitas}/${p.total}` : d.paginas || '—'}</td>
                      <td className="dir num">{formatarTamanho(d.tamanhoKb)}</td>
                      <td><StatusDocumento status={d.status} aviso={!!d.erro} /></td>
                      <td className="num">{formatarData(d.criadoEm)}</td>
                      <td className="acoes">
                        {d.status === 'pronto' && <Link className="btn discreto peq" to={`/documento/${d.id}`}>Abrir</Link>}
                        <button className="btn discreto peq icone" title="Editar metadados" aria-label={`Editar ${d.titulo}`} onClick={() => setSp({ editar: d.id }, { replace: true })}><Icone nome="editar" /></button>
                        {(d.status === 'erro' || d.erro) && <button className="btn discreto peq icone" title="Processar de novo" aria-label={`Reprocessar ${d.titulo}`} onClick={() => reprocessar(d)}><Icone nome="refazer" /></button>}
                        <button className="btn discreto peq icone" title="Remover" aria-label={`Remover ${d.titulo}`} style={{ color: 'var(--erro)' }} onClick={() => remover(d)}><Icone nome="lixo" /></button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {lista.length > 0 && <p className="painel-corpo small muted" style={{ borderTop: '1px solid var(--border)' }}>{plural(lista.length, 'documento listado', 'documentos listados')}</p>}
      </div>

      {editando && cat && <EditarDocumento doc={editando} cat={cat} aoFechar={fecharEdicao} />}
    </main>
  )
}

function EditarDocumento({ doc, cat, aoFechar }: { doc: DocResumo; cat: Catalogo; aoFechar: () => void }) {
  const { avisar } = useUI()
  const [f, setF] = useState({
    titulo: doc.titulo, numero: doc.numero, descricao: doc.descricao ?? '', municipioId: doc.municipioId, entidadeId: doc.entidadeId,
    caixaId: doc.caixaId, tipoId: doc.tipoId, ano: doc.ano, mes: doc.mes,
  })
  const { ocupado, erro, executar } = useAcao()
  const salvar = async (e: FormEvent) => {
    e.preventDefault()
    const ok = await executar(async () => {
      await api.atualizarDocumento(doc.id, f)
      return true
    })
    if (ok) {
      avisar('Documento atualizado.')
      aoFechar()
    }
  }
  return (
    <Modal
      titulo="Editar documento"
      largo
      aoFechar={aoFechar}
      rodape={<><button className="btn" onClick={aoFechar}>Cancelar</button><button className="btn primario" type="submit" form="form-doc" disabled={ocupado}>{ocupado ? 'Salvando…' : 'Salvar'}</button></>}
    >
      <p className="small muted">Arquivo: <span className="mono">{doc.caminho}</span> · {doc.paginas} páginas</p>
      <form id="form-doc" onSubmit={salvar} className="grade-form">
        <label className="campo" style={{ gridColumn: '1 / -1' }}><span>Título <em>*</em></span><input id="doc-titulo" className="input" value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} /></label>
        <label className="campo">
          <span>Município <em>*</em></span>
          <select id="doc-mun" className="input" value={f.municipioId} onChange={(e) => setF({ ...f, municipioId: e.target.value, entidadeId: null, caixaId: null })}>
            {cat.municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}/{m.uf}</option>)}
          </select>
        </label>
        <label className="campo">
          <span>Entidade</span>
          <select id="doc-ent" className="input" value={f.entidadeId ?? ''} onChange={(e) => setF({ ...f, entidadeId: e.target.value || null })}>
            <option value="">—</option>
            {cat.entidades.filter((x) => x.municipioId === f.municipioId).map((x) => <option key={x.id} value={x.id}>{x.sigla} · {x.nome}</option>)}
          </select>
        </label>
        <label className="campo">
          <span>Tipo <em>*</em></span>
          <select id="doc-tipo" className="input" value={f.tipoId} onChange={(e) => setF({ ...f, tipoId: e.target.value })}>
            {cat.tipos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
        </label>
        <label className="campo">
          <span>Caixa</span>
          <select id="doc-caixa" className="input" value={f.caixaId ?? ''} onChange={(e) => setF({ ...f, caixaId: e.target.value || null })}>
            <option value="">Sem caixa</option>
            {cat.caixas.filter((c) => c.municipioId === f.municipioId).map((c) => <option key={c.id} value={c.id}>{c.codigo}</option>)}
          </select>
        </label>
        <label className="campo">
          <span>Mês</span>
          <select id="doc-mes" className="input" value={f.mes ?? ''} onChange={(e) => setF({ ...f, mes: e.target.value ? Number(e.target.value) : null })}>
            <option value="">—</option>
            {MESES.map((m, i) => <option key={m} value={i + 1}>{capitalizar(m)}</option>)}
          </select>
        </label>
        <label className="campo"><span>Ano <em>*</em></span><input id="doc-ano" className="input num" inputMode="numeric" value={f.ano || ''} onChange={(e) => setF({ ...f, ano: Number(e.target.value.replace(/\D/g, '').slice(0, 4)) || 0 })} /></label>
        <label className="campo"><span>Número do ato</span><input id="doc-numero" className="input" placeholder="Ex.: 045/2016" value={f.numero} onChange={(e) => setF({ ...f, numero: e.target.value })} /></label>
        <label className="campo" style={{ gridColumn: '1 / -1' }}>
          <span>Descrição / palavras-chave</span>
          <textarea id="doc-descricao" className="input" rows={3} placeholder="Ex.: folha de pagamento, precatórios, prestação de contas TCE" value={f.descricao} onChange={(e) => setF({ ...f, descricao: e.target.value })} />
          <span className="ajuda">Entram na busca do acervo junto com o texto do PDF.</span>
        </label>
      </form>
      {erro && <Alerta tipo="erro">{erro}</Alerta>}
    </Modal>
  )
}

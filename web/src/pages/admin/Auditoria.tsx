import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type AcaoAuditoria } from '../../api'
import { Icone } from '../../components/Icone'
import { Alerta, Carregando, EtiquetaPapel, Vazio } from '../../components/ui'
import { useConsulta } from '../../lib/hooks'
import { formatarDataHora, normalizar, plural } from '../../lib/util'

const ACOES: Record<AcaoAuditoria, string> = {
  entrou: 'Entrou no sistema',
  viu: 'Abriu documento',
  baixou: 'Baixou PDF',
  imprimiu: 'Imprimiu',
  buscou: 'Pesquisou',
  enviou: 'Enviou PDF',
  editou: 'Editou documento',
  removeu: 'Removeu documento',
  concedeu: 'Concedeu acesso',
  revogou: 'Revogou acesso',
  criou_usuario: 'Criou usuário',
  alterou_usuario: 'Alterou usuário',
  criou_cliente: 'Criou cliente',
  alterou_cliente: 'Alterou cliente',
  cadastro: 'Incluiu cadastro',
}

const POR_VEZ = 200

export function Auditoria() {
  const { data: eventos, erro, carregando } = useConsulta(() => api.listarAuditoria(), [], ['dados', 'auditoria'])
  const [acao, setAcao] = useState('')
  const [usuario, setUsuario] = useState('')
  const [texto, setTexto] = useState('')
  const [limite, setLimite] = useState(POR_VEZ)

  const usuarios = useMemo(() => [...new Map((eventos ?? []).map((e) => [e.usuarioId, e.usuarioNome])).entries()], [eventos])
  const lista = useMemo(() => {
    const q = normalizar(texto.trim())
    return (eventos ?? []).filter((e) =>
      (!acao || e.acao === acao) && (!usuario || e.usuarioId === usuario) &&
      (!q || normalizar(`${e.detalhe} ${e.documentoTitulo ?? ''} ${e.usuarioNome} ${e.organizacao ?? ''}`).includes(q)),
    )
  }, [eventos, acao, usuario, texto])

  return (
    <main className="pagina">
      <div className="cabecalho">
        <div>
          <h1>Auditoria</h1>
          <p>Quem entrou, pesquisou, abriu, baixou ou imprimiu cada documento, e toda alteração feita no acervo e nos acessos.</p>
        </div>
      </div>
      <div className="painel">
        <div className="painel-cab">
          <span className="small muted">{eventos ? plural(lista.length, 'registro', 'registros') : ''}</span>
          <div className="linha-acoes">
            <label className="busca-campo" style={{ minWidth: 220 }}>
              <span className="sr-only">Filtrar registros</span>
              <Icone nome="busca" />
              <input id="aud-texto" className="input peq" placeholder="Documento, termo, pessoa…" value={texto} onChange={(e) => setTexto(e.target.value)} />
            </label>
            <select id="aud-acao" className="input peq" style={{ width: 'auto' }} aria-label="Ação" value={acao} onChange={(e) => setAcao(e.target.value)}>
              <option value="">Todas as ações</option>
              {Object.entries(ACOES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select id="aud-usuario" className="input peq" style={{ width: 'auto' }} aria-label="Pessoa" value={usuario} onChange={(e) => setUsuario(e.target.value)}>
              <option value="">Todas as pessoas</option>
              {usuarios.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
            </select>
          </div>
        </div>
        {erro && <div className="painel-corpo"><Alerta tipo="erro">{erro}</Alerta></div>}
        {carregando && !eventos && <div className="painel-corpo"><Carregando /></div>}
        {eventos && lista.length === 0 && <Vazio titulo="Nenhum registro" icone="historico" />}
        {lista.length > 0 && (
          <div className="tabela-wrap">
            <table className="tabela">
              <thead><tr><th>Quando</th><th>Pessoa</th><th>Ação</th><th>Detalhe</th></tr></thead>
              <tbody>
                {lista.slice(0, limite).map((e) => (
                  <tr key={e.id}>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>{formatarDataHora(e.em)}</td>
                    <td><div className="titulo-celula">{e.usuarioNome} <EtiquetaPapel papel={e.papel} /></div>{e.organizacao && <div className="sub">{e.organizacao}</div>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{ACOES[e.acao]}</td>
                    <td>
                      {e.documentoTitulo && e.documentoId ? <Link to={`/documento/${e.documentoId}`}>{e.documentoTitulo}</Link> : null}
                      {e.documentoTitulo && e.detalhe ? ' · ' : ''}
                      {e.acao === 'buscou' ? <>“{e.detalhe}”</> : e.detalhe}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {lista.length > limite && <div className="painel-corpo" style={{ textAlign: 'center' }}><button className="btn" onClick={() => setLimite((l) => l + POR_VEZ)}>Mostrar mais</button></div>}
      </div>
    </main>
  )
}

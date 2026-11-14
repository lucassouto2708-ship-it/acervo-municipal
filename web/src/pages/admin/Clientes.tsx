import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api, type EscopoAcesso } from '../../api'
import { GestaoUsuarios } from '../../components/GestaoUsuarios'
import { Icone } from '../../components/Icone'
import { Alerta, Carregando, Modal, SenhaGerada, useUI, Vazio } from '../../components/ui'
import { useAcao, useConsulta } from '../../lib/hooks'
import { formatarData, mascararCnpj } from '../../lib/util'

export function Clientes() {
  const navegar = useNavigate()
  const { data: orgs, erro, carregando } = useConsulta(() => api.listarOrganizacoes(), [])
  const [novo, setNovo] = useState(false)
  const [senha, setSenha] = useState<{ email: string; senha: string; orgId: string } | null>(null)

  return (
    <main className="pagina">
      <div className="cabecalho">
        <div>
          <h1>Clientes</h1>
          <p>Cada cliente é uma organização (prefeitura, instituto, escritório). Você libera partes do acervo para ela, e o cliente cadastra os próprios leitores.</p>
        </div>
        <div className="acoes"><button className="btn primario" onClick={() => setNovo(true)}><Icone nome="mais" />Novo cliente</button></div>
      </div>
      <div className="painel">
        {erro && <div className="painel-corpo"><Alerta tipo="erro">{erro}</Alerta></div>}
        {carregando && !orgs && <div className="painel-corpo"><Carregando /></div>}
        {orgs?.length === 0 && <Vazio titulo="Nenhum cliente cadastrado" icone="predio" />}
        {orgs && orgs.length > 0 && (
          <div className="tabela-wrap">
            <table className="tabela">
              <thead><tr><th>Cliente</th><th>CNPJ</th><th className="dir">Usuários</th><th className="dir">Regras de acesso</th><th className="dir">Documentos visíveis</th><th>Situação</th><th>Desde</th></tr></thead>
              <tbody>
                {orgs.map((o) => (
                  <tr key={o.id} onClick={() => navegar(`/admin/clientes/${o.id}`)} style={{ cursor: 'pointer' }} className={o.ativo ? '' : 'inativo'}>
                    <td><Link to={`/admin/clientes/${o.id}`} className="titulo-celula" style={{ textDecoration: 'none', color: 'inherit' }}>{o.nome}</Link></td>
                    <td className="mono">{o.cnpj || '—'}</td>
                    <td className="dir num">{o.usuarios}</td>
                    <td className="dir num">{o.acessos}</td>
                    <td className="dir num">{o.documentosVisiveis}</td>
                    <td>{o.ativo ? <span className="status pronto">Ativo</span> : <span className="status inativo">Suspenso</span>}</td>
                    <td className="num">{formatarData(o.criadoEm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {novo && <NovoCliente aoFechar={() => setNovo(false)} aoCriar={(s) => { setNovo(false); setSenha(s) }} />}
      {senha && (
        <Modal titulo="Cliente criado" aoFechar={() => navegar(`/admin/clientes/${senha.orgId}`)} rodape={<button className="btn primario" onClick={() => navegar(`/admin/clientes/${senha.orgId}`)}>Liberar documentos para o cliente</button>}>
          {senha.email ? <SenhaGerada email={senha.email} senha={senha.senha} /> : <p>Cliente criado sem usuário. Você pode cadastrar usuários na página do cliente.</p>}
        </Modal>
      )}
    </main>
  )
}

function NovoCliente({ aoFechar, aoCriar }: { aoFechar: () => void; aoCriar: (s: { email: string; senha: string; orgId: string }) => void }) {
  const [nome, setNome] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [usuNome, setUsuNome] = useState('')
  const [usuEmail, setUsuEmail] = useState('')
  const { ocupado, erro, executar } = useAcao()
  const salvar = async (e: FormEvent) => {
    e.preventDefault()
    const r = await executar(async () => {
      if ((usuNome && !usuEmail) || (!usuNome && usuEmail)) throw new Error('Para criar o primeiro usuário, preencha nome e e-mail.')
      const o = await api.criarOrganizacao(nome, cnpj)
      if (!usuNome) return { email: '', senha: '', orgId: o.id }
      const u = await api.criarUsuario({ nome: usuNome, email: usuEmail, papel: 'cliente', organizacaoId: o.id })
      return { email: u.usuario.email, senha: u.senha, orgId: o.id }
    })
    if (r) aoCriar(r)
  }
  return (
    <Modal titulo="Novo cliente" aoFechar={aoFechar} rodape={<><button className="btn" onClick={aoFechar}>Cancelar</button><button className="btn primario" type="submit" form="form-cliente" disabled={ocupado}>{ocupado ? 'Criando…' : 'Criar cliente'}</button></>}>
      <form id="form-cliente" onSubmit={salvar} style={{ display: 'grid', gap: 12 }}>
        <label className="campo"><span>Nome da organização <em>*</em></span><input id="org-nome" className="input" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Prefeitura Municipal de Alpercata" autoFocus /></label>
        <label className="campo"><span>CNPJ</span><input id="org-cnpj" className="input mono" value={cnpj} onChange={(e) => setCnpj(mascararCnpj(e.target.value))} placeholder="00.000.000/0000-00" /></label>
        <div className="rotulo" style={{ marginTop: 4 }}>Primeiro usuário (opcional)</div>
        <div className="grade-form">
          <label className="campo"><span>Nome</span><input id="org-usu-nome" className="input" value={usuNome} onChange={(e) => setUsuNome(e.target.value)} /></label>
          <label className="campo"><span>E-mail</span><input id="org-usu-email" className="input" type="email" value={usuEmail} onChange={(e) => setUsuEmail(e.target.value)} /></label>
        </div>
        {erro && <Alerta tipo="erro">{erro}</Alerta>}
      </form>
    </Modal>
  )
}

const ESCOPOS: { valor: EscopoAcesso; rotulo: string }[] = [
  { valor: 'entidade', rotulo: 'Entidade inteira' },
  { valor: 'municipio', rotulo: 'Município inteiro' },
  { valor: 'caixa', rotulo: 'Caixa' },
  { valor: 'documento', rotulo: 'Documento avulso' },
]

export function Cliente() {
  const { id = '' } = useParams()
  const { avisar, confirmar } = useUI()
  const { data: org, erro } = useConsulta(() => api.organizacao(id), [id])
  const { data: acessos } = useConsulta(() => api.listarAcessos(id), [id])
  const { data: cat } = useConsulta(() => api.catalogo(), [])
  const { data: docs } = useConsulta(() => api.listarDocumentos(), [])
  const [escopo, setEscopo] = useState<EscopoAcesso>('entidade')
  const [alvo, setAlvo] = useState('')
  const [tipo, setTipo] = useState('')
  const [editar, setEditar] = useState(false)
  const conceder = useAcao()

  const opcoes: { id: string; nome: string }[] =
    escopo === 'municipio' ? (cat?.municipios ?? []).map((m) => ({ id: m.id, nome: `${m.nome}/${m.uf}` }))
    : escopo === 'entidade' ? (cat?.entidades ?? []).map((e) => ({ id: e.id, nome: `${e.sigla} · ${e.nome}` }))
    : escopo === 'caixa' ? (cat?.caixas ?? []).map((c) => ({ id: c.id, nome: `${c.codigo} · ${cat?.municipios.find((m) => m.id === c.municipioId)?.nome ?? ''}` }))
    : (docs ?? []).filter((d) => d.status === 'pronto').map((d) => ({ id: d.id, nome: d.titulo }))

  const enviarConcessao = async (e: FormEvent) => {
    e.preventDefault()
    const ok = await conceder.executar(async () => {
      await api.conceder(id, escopo, alvo, tipo || null)
      return true
    })
    if (ok) {
      avisar('Acesso concedido.')
      setAlvo('')
    }
  }

  const revogar = async (aid: string, nome: string) => {
    const ok = await confirmar({ titulo: 'Revogar acesso', texto: <>O cliente deixa de ver os documentos de <b>{nome}</b> imediatamente.</>, confirmar: 'Revogar', perigo: true })
    if (!ok) return
    await api.revogar(aid)
    avisar('Acesso revogado.')
  }

  const alternarSuspensao = async () => {
    if (!org) return
    if (org.ativo) {
      const ok = await confirmar({ titulo: 'Suspender cliente', texto: 'Todos os usuários desta organização deixam de entrar até você reativar.', confirmar: 'Suspender', perigo: true })
      if (!ok) return
    }
    try {
      await api.atualizarOrganizacao(org.id, { nome: org.nome, cnpj: org.cnpj, ativo: !org.ativo })
      avisar(org.ativo ? 'Cliente suspenso.' : 'Cliente reativado.')
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), true)
    }
  }

  if (erro) return <main className="pagina"><Alerta tipo="erro">{erro}</Alerta></main>
  if (!org) return <main className="pagina"><Carregando /></main>

  return (
    <main className="pagina">
      <Link to="/admin/clientes" className="voltar"><Icone nome="esquerda" tam={14} />Clientes</Link>
      <div className="cabecalho">
        <div>
          <h1>{org.nome}</h1>
          <div className="resumo-org" style={{ marginTop: 6 }}>
            <span>{org.cnpj ? <span className="mono">{org.cnpj}</span> : 'CNPJ não informado'}</span>
            <span><b>{org.documentosVisiveis}</b>documentos visíveis</span>
            <span><b>{org.usuarios}</b>usuários</span>
            {org.ativo ? <span className="status pronto">Ativo</span> : <span className="status inativo">Suspenso</span>}
          </div>
        </div>
        <div className="acoes">
          <button className="btn" onClick={() => setEditar(true)}><Icone nome="editar" />Editar</button>
          <button className={`btn ${org.ativo ? 'perigo' : ''}`} onClick={alternarSuspensao}>{org.ativo ? 'Suspender' : 'Reativar'}</button>
        </div>
      </div>

      <div className="dois">
        <div className="painel">
          <div className="painel-cab">
            <div>
              <h2>O que este cliente vê</h2>
              <p>Documentos novos que caírem numa regra aparecem para o cliente automaticamente.</p>
            </div>
          </div>
          {acessos && acessos.length === 0 && <Vazio titulo="Nada liberado ainda" icone="escudo"><p>O cliente entra e não vê nenhum documento.</p></Vazio>}
          {acessos && acessos.length > 0 && (
            <ul className="lista-simples">
              {acessos.map((a) => (
                <li key={a.id}>
                  <div>
                    <div style={{ fontWeight: 500 }}>{a.alvoNome}</div>
                    <div className="small muted">{ESCOPOS.find((e) => e.valor === a.escopo)?.rotulo}{a.tipoNome ? ` · só ${a.tipoNome}` : ' · todos os tipos'} · desde {formatarData(a.em)}</div>
                  </div>
                  <button className="btn perigo peq" onClick={() => revogar(a.id, a.alvoNome)}>Revogar</button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={enviarConcessao} className="painel-corpo" style={{ borderTop: '1px solid var(--border)', display: 'grid', gap: 10 }}>
            <h3>Liberar mais</h3>
            <div className="grade-form">
              <label className="campo">
                <span>Liberar</span>
                <select id="ace-escopo" className="input" value={escopo} onChange={(e) => { setEscopo(e.target.value as EscopoAcesso); setAlvo('') }}>
                  {ESCOPOS.map((e) => <option key={e.valor} value={e.valor}>{e.rotulo}</option>)}
                </select>
              </label>
              <label className="campo">
                <span>Qual</span>
                <select id="ace-alvo" className="input" value={alvo} onChange={(e) => setAlvo(e.target.value)}>
                  <option value="">Escolher…</option>
                  {opcoes.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
                </select>
              </label>
              <label className="campo">
                <span>Tipos de documento</span>
                <select id="ace-tipo" className="input" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                  <option value="">Todos os tipos</option>
                  {cat?.tipos.map((t) => <option key={t.id} value={t.id}>Só {t.nome}</option>)}
                </select>
              </label>
            </div>
            {escopo !== 'documento' && opcoes.length === 0 && <span className="ajuda">Nenhum item cadastrado. Cadastre em Cadastros.</span>}
            {conceder.erro && <Alerta tipo="erro">{conceder.erro}</Alerta>}
            <div className="linha-acoes"><button className="btn primario" type="submit" disabled={!alvo || conceder.ocupado}><Icone nome="escudo" />Conceder acesso</button></div>
          </form>
        </div>

        <GestaoUsuarios orgId={org.id} papeisPermitidos={['cliente', 'leitor']} />
      </div>

      {editar && <EditarCliente id={org.id} nome={org.nome} cnpj={org.cnpj} ativo={org.ativo} aoFechar={() => setEditar(false)} />}
    </main>
  )
}

function EditarCliente({ id, nome: n0, cnpj: c0, ativo, aoFechar }: { id: string; nome: string; cnpj: string; ativo: boolean; aoFechar: () => void }) {
  const [nome, setNome] = useState(n0)
  const [cnpj, setCnpj] = useState(c0)
  const { ocupado, erro, executar } = useAcao()
  const salvar = async (e: FormEvent) => {
    e.preventDefault()
    const ok = await executar(async () => {
      await api.atualizarOrganizacao(id, { nome, cnpj, ativo })
      return true
    })
    if (ok) aoFechar()
  }
  return (
    <Modal titulo="Editar cliente" aoFechar={aoFechar} rodape={<><button className="btn" onClick={aoFechar}>Cancelar</button><button className="btn primario" form="form-edit-org" type="submit" disabled={ocupado}>Salvar</button></>}>
      <form id="form-edit-org" onSubmit={salvar} style={{ display: 'grid', gap: 12 }}>
        <label className="campo"><span>Nome <em>*</em></span><input id="edit-org-nome" className="input" value={nome} onChange={(e) => setNome(e.target.value)} /></label>
        <label className="campo"><span>CNPJ</span><input id="edit-org-cnpj" className="input mono" value={cnpj} onChange={(e) => setCnpj(mascararCnpj(e.target.value))} placeholder="00.000.000/0000-00" /></label>
        {erro && <Alerta tipo="erro">{erro}</Alerta>}
      </form>
    </Modal>
  )
}


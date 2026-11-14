import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { api, type Usuario } from '../api'
import { Icone, type NomeIcone } from './Icone'
import { useUI } from './ui'

const NAV: Record<Usuario['papel'], { para: string; rotulo: string; icone: NomeIcone }[]> = {
  admin: [
    { para: '/acervo', rotulo: 'Acervo', icone: 'busca' },
    { para: '/admin/documentos', rotulo: 'Documentos', icone: 'lista' },
    { para: '/admin/enviar', rotulo: 'Enviar', icone: 'enviar' },
    { para: '/admin/clientes', rotulo: 'Clientes', icone: 'predio' },
    { para: '/admin/cadastros', rotulo: 'Cadastros', icone: 'caixa' },
    { para: '/admin/auditoria', rotulo: 'Auditoria', icone: 'historico' },
    { para: '/admin/administradores', rotulo: 'Administradores', icone: 'escudo' },
  ],
  cliente: [
    { para: '/acervo', rotulo: 'Acervo', icone: 'busca' },
    { para: '/equipe', rotulo: 'Equipe', icone: 'usuarios' },
  ],
  leitor: [{ para: '/acervo', rotulo: 'Acervo', icone: 'busca' }],
}

const PAPEL = { admin: 'Administrador', cliente: 'Cliente', leitor: 'Leitor' }

export function Layout({ usuario }: { usuario: Usuario }) {
  const { avisar, confirmar } = useUI()
  const navegar = useNavigate()
  const org = api.organizacaoDoUsuario()

  const trocarConta = async (email: string) => {
    const conta = api.contasDemo().find((c) => c.email === email)
    if (!conta) return
    try {
      await api.entrar(conta.email, conta.senha)
      navegar('/acervo')
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), true)
    }
  }

  const resetar = async () => {
    const ok = await confirmar({
      titulo: 'Apagar dados de demonstração',
      texto: 'Remove do navegador todos os PDFs enviados, clientes, usuários criados e a auditoria, e volta ao estado inicial. Não dá para desfazer.',
      confirmar: 'Apagar tudo',
      perigo: true,
    })
    if (!ok) return
    await api.resetar()
    navegar('/acervo')
  }

  return (
    <div className="app">
      <header className="topo">
        <NavLink to="/acervo" className="marca">
          <span className="marca-icone"><Icone nome="caixa" tam={16} /></span>
          <span>Acervo Municipal<small>{org ? org.nome : 'Administração do acervo'}</small></span>
        </NavLink>
        <nav className="nav" aria-label="Principal">
          {NAV[usuario.papel].map((n) => (
            <NavLink key={n.para} to={n.para}>
              <Icone nome={n.icone} /><span>{n.rotulo}</span>
            </NavLink>
          ))}
        </nav>
        <div className="topo-dir">
          <div className="usuario-chip">
            <b>{usuario.nome}</b>
            <span>{PAPEL[usuario.papel]}</span>
          </div>
          <button className="btn-topo" onClick={() => api.sair()} title="Sair">
            <Icone nome="sair" /><span className="sr-only">Sair</span>
          </button>
        </div>
      </header>
      {api.modo === 'demonstracao' && <div className="faixa-demo">
        <b>Protótipo F0</b>
        <span>Os dados ficam só neste navegador, até o banco entrar na F1.</span>
        <label>
          Entrar como{' '}
          <select value={usuario.email} onChange={(e) => trocarConta(e.target.value)} aria-label="Trocar conta de demonstração">
            {!api.contasDemo().some((c) => c.email === usuario.email) && <option value={usuario.email}>{usuario.nome}</option>}
            {api.contasDemo().map((c) => (
              <option key={c.email} value={c.email}>{PAPEL[c.papel]} · {c.nome}</option>
            ))}
          </select>
        </label>
        {usuario.papel === 'admin' && (
          <button className="btn-topo" style={{ height: 24, fontSize: 12 }} onClick={resetar}>Apagar dados de demonstração</button>
        )}
      </div>}
      <Outlet />
    </div>
  )
}

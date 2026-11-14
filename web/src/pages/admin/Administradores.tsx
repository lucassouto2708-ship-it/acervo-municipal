import { GestaoUsuarios } from '../../components/GestaoUsuarios'

export function Administradores() {
  return (
    <main className="pagina">
      <div className="cabecalho">
        <div>
          <h1>Administradores</h1>
          <p>Quem tem acesso total ao acervo. Para usuários de clientes (cliente e leitor), use a página de cada cliente.</p>
        </div>
      </div>
      <GestaoUsuarios orgId={null} papeisPermitidos={['admin']} />
    </main>
  )
}

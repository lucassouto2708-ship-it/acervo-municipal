import { api } from '../api'
import { GestaoUsuarios } from '../components/GestaoUsuarios'
import { Alerta } from '../components/ui'

export function Equipe() {
  const usuario = api.usuarioAtual()
  const org = api.organizacaoDoUsuario()
  if (!usuario?.organizacaoId || !org) return <main className="pagina"><Alerta tipo="erro">Sua conta não está ligada a uma organização.</Alerta></main>
  return (
    <main className="pagina">
      <div className="cabecalho">
        <div>
          <h1>Equipe</h1>
          <p>Cadastre as pessoas de {org.nome} que precisam consultar o acervo. Elas enxergam os mesmos documentos que você.</p>
        </div>
      </div>
      <GestaoUsuarios orgId={usuario.organizacaoId} papeisPermitidos={['leitor']} />
    </main>
  )
}

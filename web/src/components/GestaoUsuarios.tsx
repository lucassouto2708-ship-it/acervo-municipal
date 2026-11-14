import { useState, type FormEvent } from 'react'
import { api, type Papel, type Usuario } from '../api'
import { useAcao, useConsulta } from '../lib/hooks'
import { formatarData } from '../lib/util'
import { Icone } from './Icone'
import { Alerta, Carregando, EtiquetaPapel, Modal, SenhaGerada, useUI, Vazio } from './ui'

/** Lista e cadastro de usuários de uma organização. Usado pelo admin (cliente) e pelo cliente (equipe). */
/** orgId = null → lista e cria administradores. */
export function GestaoUsuarios({ orgId, papeisPermitidos }: { orgId: string | null; papeisPermitidos: Papel[] }) {
  const eu = api.usuarioAtual()
  const { avisar, confirmar } = useUI()
  const { data: usuarios, erro, carregando } = useConsulta(() => (orgId ? api.listarUsuarios(orgId) : api.listarUsuarios().then((l) => l.filter((u) => u.papel === 'admin'))), [orgId])
  const [novo, setNovo] = useState(false)
  const [senha, setSenha] = useState<{ email: string; senha: string } | null>(null)

  const podeGerir = (u: Usuario) => u.id !== eu?.id && (eu?.papel === 'admin' || (eu?.papel === 'cliente' && u.papel === 'leitor'))

  const alternar = async (u: Usuario) => {
    if (u.ativo) {
      const ok = await confirmar({
        titulo: 'Desativar acesso',
        texto: <>Desativar <b>{u.nome}</b>? A pessoa deixa de entrar no sistema na hora. O histórico dela continua na auditoria e o acesso pode ser reativado depois.</>,
        confirmar: 'Desativar',
        perigo: true,
      })
      if (!ok) return
    }
    try {
      await api.definirUsuarioAtivo(u.id, !u.ativo)
      avisar(u.ativo ? `${u.nome} foi desativado.` : `${u.nome} foi reativado.`)
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), true)
    }
  }

  const novaSenha = async (u: Usuario) => {
    const ok = await confirmar({ titulo: 'Gerar nova senha', texto: <>A senha atual de <b>{u.nome}</b> deixa de funcionar. Continuar?</>, confirmar: 'Gerar senha' })
    if (!ok) return
    try {
      setSenha({ email: u.email, senha: await api.redefinirSenha(u.id) })
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), true)
    }
  }

  return (
    <div className="painel">
      <div className="painel-cab">
        <div>
          <h2>Usuários</h2>
          <p>{!orgId ? 'Administradores enviam documentos, liberam acesso e criam qualquer usuário.' : papeisPermitidos.length === 1 && papeisPermitidos[0] === 'leitor' ? 'Leitores só consultam o acervo; não criam usuários.' : 'Clientes podem cadastrar leitores. Leitores só consultam.'}</p>
        </div>
        <button className="btn primario peq" onClick={() => setNovo(true)}><Icone nome="mais" />Novo {papeisPermitidos.length === 1 ? ({ leitor: 'leitor', cliente: 'cliente', admin: 'administrador' } as const)[papeisPermitidos[0]] : 'usuário'}</button>
      </div>
      {erro && <div className="painel-corpo"><Alerta tipo="erro">{erro}</Alerta></div>}
      {carregando && !usuarios && <div className="painel-corpo"><Carregando /></div>}
      {usuarios && usuarios.length === 0 && <Vazio titulo="Nenhum usuário cadastrado" icone="usuarios" />}
      {usuarios && usuarios.length > 0 && (
        <div className="tabela-wrap">
          <table className="tabela">
            <thead><tr><th>Nome</th><th>Papel</th><th>Situação</th><th>Desde</th><th className="dir">Ações</th></tr></thead>
            <tbody>
              {usuarios.map((u) => (
                <tr key={u.id} className={u.ativo ? '' : 'inativo'}>
                  <td><div className="titulo-celula">{u.nome}{u.id === eu?.id ? ' (você)' : ''}</div><div className="sub mono">{u.email}</div></td>
                  <td><EtiquetaPapel papel={u.papel} /></td>
                  <td>{u.ativo ? <span className="status pronto">Ativo</span> : <span className="status inativo">Desativado</span>}</td>
                  <td className="num">{formatarData(u.criadoEm)}</td>
                  <td className="acoes">
                    {podeGerir(u) && (
                      <>
                        <button className="btn discreto peq" onClick={() => novaSenha(u)} disabled={!u.ativo} title="Gerar nova senha provisória"><Icone nome="chave" />Senha</button>
                        <button className={`btn peq ${u.ativo ? 'perigo' : ''}`} onClick={() => alternar(u)}>{u.ativo ? 'Desativar' : 'Reativar'}</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {novo && <NovoUsuario orgId={orgId} papeis={papeisPermitidos} aoFechar={() => setNovo(false)} aoCriar={(s) => { setNovo(false); setSenha(s) }} />}
      {senha && (
        <Modal titulo="Usuário pronto" aoFechar={() => setSenha(null)} rodape={<button className="btn primario" onClick={() => setSenha(null)}>Concluir</button>}>
          <SenhaGerada email={senha.email} senha={senha.senha} />
        </Modal>
      )}
    </div>
  )
}

function NovoUsuario({ orgId, papeis, aoFechar, aoCriar }: { orgId: string | null; papeis: Papel[]; aoFechar: () => void; aoCriar: (s: { email: string; senha: string }) => void }) {
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [papel, setPapel] = useState<Papel>(papeis[0])
  const { ocupado, erro, executar } = useAcao()
  const salvar = async (e: FormEvent) => {
    e.preventDefault()
    const r = await executar(() => api.criarUsuario({ nome, email, papel, organizacaoId: orgId }))
    if (r) aoCriar({ email: r.usuario.email, senha: r.senha })
  }
  return (
    <Modal
      titulo="Novo usuário"
      aoFechar={aoFechar}
      rodape={<><button className="btn" onClick={aoFechar}>Cancelar</button><button className="btn primario" form="form-usuario" type="submit" disabled={ocupado}>{ocupado ? 'Criando…' : 'Criar acesso'}</button></>}
    >
      <form id="form-usuario" onSubmit={salvar} style={{ display: 'grid', gap: 12 }}>
        <label className="campo"><span>Nome <em>*</em></span><input id="usr-nome" className="input" value={nome} onChange={(e) => setNome(e.target.value)} autoFocus /></label>
        <label className="campo"><span>E-mail <em>*</em></span><input id="usr-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        {papeis.length > 1 && (
          <label className="campo">
            <span>Papel</span>
            <select id="usr-papel" className="input" value={papel} onChange={(e) => setPapel(e.target.value as Papel)}>
              {papeis.map((p) => <option key={p} value={p}>{p === 'cliente' ? 'Cliente (pode cadastrar leitores)' : 'Leitor (só consulta)'}</option>)}
            </select>
          </label>
        )}
        <p className="ajuda">O sistema gera uma senha provisória para você repassar. Na F1 o convite vai por e-mail.</p>
        {erro && <Alerta tipo="erro">{erro}</Alerta>}
      </form>
    </Modal>
  )
}

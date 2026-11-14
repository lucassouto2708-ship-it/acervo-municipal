import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { Icone } from '../components/Icone'
import { Alerta } from '../components/ui'
import { useAcao } from '../lib/hooks'

const PAPEL = { admin: 'Administrador', cliente: 'Cliente', leitor: 'Leitor' }

export function Entrar() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const { ocupado, erro, executar } = useAcao()

  const enviar = (e: FormEvent) => {
    e.preventDefault()
    void executar(() => api.entrar(email, senha))
  }

  return (
    <div className="login">
      <section className="login-lado">
        <div className="marca" style={{ fontSize: 15 }}>
          <span className="marca-icone"><Icone nome="caixa" tam={16} /></span>
          Acervo Municipal
        </div>
        <div>
          <h1>Documentos públicos digitalizados, organizados e pesquisáveis.</h1>
          <p>Consulte o acervo por município, entidade, caixa, tipo e ano. Pesquise uma palavra dentro de cada PDF e veja em que página ela aparece, sem abrir o arquivo.</p>
          <ul className="login-lista">
            <li><Icone nome="busca" />Busca no texto de todas as páginas</li>
            <li><Icone nome="grade" />Miniatura de cada página</li>
            <li><Icone nome="escudo" />Cada cliente vê só o que foi liberado para ele</li>
          </ul>
        </div>
        <span className="small" style={{ color: 'var(--salvia)' }}>{api.modo === 'demonstracao' ? 'Modo demonstração · dados guardados neste navegador' : 'Acesso restrito a usuários cadastrados'}</span>
      </section>

      <section className="login-form">
        <div>
          <h1>Entrar</h1>
          <p className="muted" style={{ marginTop: 4 }}>Use o e-mail e a senha que você recebeu.</p>
        </div>
        <form onSubmit={enviar} noValidate>
          <label className="campo">
            <span>E-mail</span>
            <input id="login-email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label className="campo">
            <span>Senha</span>
            <input id="login-senha" className="input" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
          </label>
          {erro && <Alerta tipo="erro">{erro}</Alerta>}
          <button className="btn primario" type="submit" disabled={ocupado || !email || !senha}>
            {ocupado ? 'Entrando…' : 'Entrar'}
          </button>
        </form>

        {api.contasDemo().length > 0 && <div className="contas-demo">
          <span className="rotulo">Contas de demonstração</span>
          {api.contasDemo().map((c) => (
            <button key={c.email} type="button" className="conta-demo" onClick={() => void executar(() => api.entrar(c.email, c.senha))}>
              <div>
                <b>{PAPEL[c.papel]}</b>
                <span className="mono">{c.email}</span>
              </div>
              <Icone nome="direita" />
            </button>
          ))}
        </div>}
      </section>
    </div>
  )
}

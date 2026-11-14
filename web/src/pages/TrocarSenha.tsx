import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { Icone } from '../components/Icone'
import { Alerta } from '../components/ui'
import { useAcao } from '../lib/hooks'

/** Primeiro acesso com senha provisória: a pessoa escolhe a própria senha antes de entrar. */
export function TrocarSenha() {
  const usuario = api.usuarioAtual()
  const [senha, setSenha] = useState('')
  const [repetir, setRepetir] = useState('')
  const { ocupado, erro, setErro, executar } = useAcao()

  const salvar = (e: FormEvent) => {
    e.preventDefault()
    if (senha !== repetir) return setErro('As duas senhas não são iguais.')
    void executar(() => api.definirSenha(senha))
  }

  return (
    <div className="login">
      <section className="login-lado">
        <div className="marca" style={{ fontSize: 15 }}>
          <span className="marca-icone"><Icone nome="caixa" tam={16} /></span>
          Acervo Municipal
        </div>
        <div>
          <h1>Bem-vindo{usuario ? `, ${usuario.nome.split(' ')[0]}` : ''}.</h1>
          <p>Você entrou com uma senha provisória. Escolha agora a sua senha; a provisória deixa de valer.</p>
        </div>
        <span />
      </section>
      <section className="login-form">
        <div>
          <h1>Criar sua senha</h1>
          <p className="muted" style={{ marginTop: 4 }}>Pelo menos 8 caracteres.</p>
        </div>
        <form onSubmit={salvar} noValidate>
          <label className="campo">
            <span>Nova senha</span>
            <input id="nova-senha" className="input" type="password" autoComplete="new-password" value={senha} onChange={(e) => setSenha(e.target.value)} autoFocus />
          </label>
          <label className="campo">
            <span>Repita a senha</span>
            <input id="repetir-senha" className="input" type="password" autoComplete="new-password" value={repetir} onChange={(e) => setRepetir(e.target.value)} />
          </label>
          {erro && <Alerta tipo="erro">{erro}</Alerta>}
          <button className="btn primario" type="submit" disabled={ocupado || senha.length < 8 || !repetir}>
            {ocupado ? 'Salvando…' : 'Salvar e entrar'}
          </button>
          <button className="btn discreto" type="button" onClick={() => api.sair()}>Sair</button>
        </form>
      </section>
    </div>
  )
}

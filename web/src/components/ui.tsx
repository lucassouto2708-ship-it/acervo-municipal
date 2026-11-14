import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { ParteTrecho, StatusDoc } from '../api/types'
import { Icone } from './Icone'

// ---------- toasts e confirmação ----------
interface Toast {
  id: number
  texto: string
  erro?: boolean
}
interface PedidoConfirmacao {
  titulo: string
  texto: ReactNode
  confirmar: string
  perigo?: boolean
  resolver: (ok: boolean) => void
}
interface Ctx {
  avisar: (texto: string, erro?: boolean) => void
  confirmar: (p: Omit<PedidoConfirmacao, 'resolver'>) => Promise<boolean>
}
const Contexto = createContext<Ctx | null>(null)

export function ProvedorUI({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [pedido, setPedido] = useState<PedidoConfirmacao | null>(null)
  const seq = useRef(0)

  const avisar = useCallback((texto: string, erro = false) => {
    const id = ++seq.current
    setToasts((t) => [...t, { id, texto, erro }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), erro ? 6000 : 3500)
  }, [])

  const confirmar = useCallback(
    (p: Omit<PedidoConfirmacao, 'resolver'>) => new Promise<boolean>((resolver) => setPedido({ ...p, resolver })),
    [],
  )

  const fechar = (ok: boolean) => {
    pedido?.resolver(ok)
    setPedido(null)
  }

  return (
    <Contexto.Provider value={{ avisar, confirmar }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast${t.erro ? ' erro' : ''}`}>
            <Icone nome={t.erro ? 'alerta' : 'check'} />
            <span>{t.texto}</span>
          </div>
        ))}
      </div>
      {pedido && (
        <Modal
          titulo={pedido.titulo}
          aoFechar={() => fechar(false)}
          rodape={
            <>
              <button className="btn" onClick={() => fechar(false)}>Cancelar</button>
              <button className={`btn ${pedido.perigo ? 'perigo cheio' : 'primario'}`} onClick={() => fechar(true)} autoFocus>
                {pedido.confirmar}
              </button>
            </>
          }
        >
          <div>{pedido.texto}</div>
        </Modal>
      )}
    </Contexto.Provider>
  )
}

export function useUI(): Ctx {
  const c = useContext(Contexto)
  if (!c) throw new Error('ProvedorUI ausente')
  return c
}

// ---------- modal ----------
export function Modal({ titulo, children, rodape, aoFechar, largo }: { titulo: string; children: ReactNode; rodape?: ReactNode; aoFechar: () => void; largo?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && aoFechar()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [aoFechar])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}>
      <div className={`modal${largo ? ' largo' : ''}`} role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="modal-cab">
          <h2>{titulo}</h2>
          <button className="btn discreto peq icone" onClick={aoFechar} aria-label="Fechar"><Icone nome="x" /></button>
        </div>
        <div className="modal-corpo">{children}</div>
        {rodape && <div className="modal-rodape">{rodape}</div>}
      </div>
    </div>
  )
}

// ---------- pequenos componentes ----------
const ROTULO_STATUS: Record<StatusDoc, string> = { pronto: 'Pronto', processando: 'Processando', na_fila: 'Na fila', erro: 'Erro' }

export function StatusDocumento({ status, aviso }: { status: StatusDoc; aviso?: boolean }) {
  if (status === 'pronto' && aviso) return <span className="status aviso">Sem texto</span>
  return <span className={`status ${status}`}>{ROTULO_STATUS[status]}</span>
}

export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return (
    <span className="carregando"><span className="spinner" />{texto}</span>
  )
}

export function Vazio({ titulo, children, icone = 'arquivo' }: { titulo: string; children?: ReactNode; icone?: Parameters<typeof Icone>[0]['nome'] }) {
  return (
    <div className="vazio">
      <Icone nome={icone} tam={28} />
      <b>{titulo}</b>
      {children && <div>{children}</div>}
    </div>
  )
}

export function Alerta({ tipo, children }: { tipo: 'erro' | 'aviso' | 'ok' | 'info'; children: ReactNode }) {
  return (
    <div className={`alerta ${tipo}`} role={tipo === 'erro' ? 'alert' : undefined}>
      <Icone nome={tipo === 'ok' ? 'check' : 'alerta'} />
      <div>{children}</div>
    </div>
  )
}

export function TextoTrecho({ partes }: { partes: ParteTrecho[] }) {
  return <>{partes.map((p, i) => (p.hl ? <mark key={i}>{p.t}</mark> : <span key={i}>{p.t}</span>))}</>
}

export function EtiquetaPapel({ papel }: { papel: 'admin' | 'cliente' | 'leitor' }) {
  const rot = { admin: 'Administrador', cliente: 'Cliente', leitor: 'Leitor' }[papel]
  return <span className={`etiqueta ${papel}`}>{rot}</span>
}

export function SenhaGerada({ email, senha }: { email: string; senha: string }) {
  const { avisar } = useUI()
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(`Acesso ao Acervo Municipal\nE-mail: ${email}\nSenha provisória: ${senha}`)
      avisar('Dados de acesso copiados.')
    } catch {
      avisar('Não foi possível copiar. Selecione e copie manualmente.', true)
    }
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <p className="muted">Senha provisória de <b>{email}</b>. Ela aparece só agora; envie para a pessoa.</p>
      <div className="senha-box">
        <span>{senha}</span>
        <button className="btn peq" onClick={copiar}><Icone nome="copiar" />Copiar acesso</button>
      </div>
    </div>
  )
}

import { lazy, Suspense } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom'
import { api } from './api'
import { Layout } from './components/Layout'
import { Carregando, ProvedorUI, Vazio } from './components/ui'
import { useVersaoDados } from './lib/hooks'
import { Acervo } from './pages/Acervo'
import { Entrar } from './pages/Entrar'
import { TrocarSenha } from './pages/TrocarSenha'

// telas carregadas sob demanda: o leitor não baixa o código do admin, e o pdf.js só vem quando precisa
const Documento = lazy(() => import('./pages/Documento').then((m) => ({ default: m.Documento })))
const Equipe = lazy(() => import('./pages/Equipe').then((m) => ({ default: m.Equipe })))
const Auditoria = lazy(() => import('./pages/admin/Auditoria').then((m) => ({ default: m.Auditoria })))
const Cadastros = lazy(() => import('./pages/admin/Cadastros').then((m) => ({ default: m.Cadastros })))
const Clientes = lazy(() => import('./pages/admin/Clientes').then((m) => ({ default: m.Clientes })))
const Cliente = lazy(() => import('./pages/admin/Clientes').then((m) => ({ default: m.Cliente })))
const Documentos = lazy(() => import('./pages/admin/Documentos').then((m) => ({ default: m.Documentos })))
const Administradores = lazy(() => import('./pages/admin/Administradores').then((m) => ({ default: m.Administradores })))
const Enviar = lazy(() => import('./pages/admin/Enviar').then((m) => ({ default: m.Enviar })))

const carregandoTela = <main className="pagina"><Carregando /></main>

function NaoEncontrada() {
  return (
    <main className="pagina">
      <div className="painel">
        <Vazio titulo="Página não encontrada" icone="busca">
          <p>O endereço não existe ou você não tem acesso a ele.</p>
          <p style={{ marginTop: 12 }}><Link className="btn" to="/acervo">Ir para o acervo</Link></p>
        </Vazio>
      </div>
    </main>
  )
}

function Rotas() {
  useVersaoDados()
  if (!api.pronto()) return <main className="pagina"><Carregando texto="Conferindo sua sessão…" /></main>
  const usuario = api.usuarioAtual()
  if (!usuario) return <Entrar />
  if (usuario.trocarSenha) return <TrocarSenha />
  return (
    <Suspense fallback={carregandoTela}>
    <Routes>
      <Route element={<Layout usuario={usuario} />}>
        <Route index element={<Navigate to="/acervo" replace />} />
        <Route path="acervo" element={<Acervo />} />
        <Route path="documento/:id" element={<Documento />} />
        {usuario.papel === 'cliente' && <Route path="equipe" element={<Equipe />} />}
        {usuario.papel === 'admin' && (
          <>
            <Route path="admin/documentos" element={<Documentos />} />
            <Route path="admin/enviar" element={<Enviar />} />
            <Route path="admin/clientes" element={<Clientes />} />
            <Route path="admin/clientes/:id" element={<Cliente />} />
            <Route path="admin/cadastros" element={<Cadastros />} />
            <Route path="admin/auditoria" element={<Auditoria />} />
            <Route path="admin/administradores" element={<Administradores />} />
          </>
        )}
        <Route path="*" element={<NaoEncontrada />} />
      </Route>
    </Routes>
    </Suspense>
  )
}

export function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <ProvedorUI>
        <Rotas />
      </ProvedorUI>
    </BrowserRouter>
  )
}

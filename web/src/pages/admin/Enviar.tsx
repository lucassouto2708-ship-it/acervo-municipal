import { useMemo, useRef, useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, type Catalogo, type ItemEnvio } from '../../api'
import { Icone } from '../../components/Icone'
import { Alerta, Carregando, StatusDocumento, useUI } from '../../components/ui'
import { useAcao, useConsulta, useVersaoDados } from '../../lib/hooks'
import { sugerir } from '../../lib/inferir'
import { competencia, formatarTamanho, MESES, capitalizar, plural } from '../../lib/util'

interface Linha extends ItemEnvio {
  chave: string
}

async function lerEntrada(entrada: FileSystemEntry, prefixo: string, out: { arquivo: File; caminho: string }[]) {
  if (entrada.isFile) {
    const arquivo = await new Promise<File>((ok, falha) => (entrada as FileSystemFileEntry).file(ok, falha))
    out.push({ arquivo, caminho: prefixo + arquivo.name })
  } else if (entrada.isDirectory) {
    const leitor = (entrada as FileSystemDirectoryEntry).createReader()
    let lote: FileSystemEntry[]
    do {
      lote = await new Promise<FileSystemEntry[]>((ok, falha) => leitor.readEntries(ok, falha))
      for (const e of lote) await lerEntrada(e, `${prefixo}${entrada.name}/`, out)
    } while (lote.length)
  }
}

function faltando(l: Linha): string | null {
  if (!l.titulo.trim()) return 'título'
  if (!l.municipioId) return 'município'
  if (!l.tipoId) return 'tipo'
  if (!l.ano || l.ano < 1900 || l.ano > 2100) return 'ano'
  return null
}

export function Enviar() {
  const { avisar } = useUI()
  const { data: cat } = useConsulta(() => api.catalogo(), [])
  const { data: docs } = useConsulta(() => api.listarDocumentos(), [])
  useVersaoDados()
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [arrastando, setArrastando] = useState(false)
  const [ignorados, setIgnorados] = useState<string[]>([])
  const inputArquivos = useRef<HTMLInputElement>(null)
  const inputPasta = useRef<HTMLInputElement>(null)
  const { ocupado, erro, executar } = useAcao()

  const adicionar = (lista: { arquivo: File; caminho: string }[], c: Catalogo) => {
    const pdfs = lista.filter((x) => /\.pdf$/i.test(x.arquivo.name))
    setIgnorados(lista.filter((x) => !/\.pdf$/i.test(x.arquivo.name)).map((x) => x.caminho))
    setLinhas((atual) => {
      const ja = new Set(atual.map((l) => l.caminho))
      const novas = pdfs
        .filter((x) => !ja.has(x.caminho))
        .map((x) => ({ chave: `${x.caminho}|${x.arquivo.size}`, arquivo: x.arquivo, caminho: x.caminho, ...sugerir(x.caminho, c) }))
      return [...atual, ...novas].sort((a, b) => a.caminho.localeCompare(b.caminho, 'pt-BR', { numeric: true }))
    })
  }

  const aoSoltar = async (e: DragEvent) => {
    e.preventDefault()
    setArrastando(false)
    if (!cat) return
    const entradas = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry()).filter((x): x is FileSystemEntry => !!x)
    const out: { arquivo: File; caminho: string }[] = []
    for (const en of entradas) await lerEntrada(en, '', out)
    adicionar(out, cat)
  }

  const aoEscolher = (files: FileList | null) => {
    if (!files || !cat) return
    adicionar([...files].map((f) => ({ arquivo: f, caminho: f.webkitRelativePath || f.name })), cat)
  }

  const mudar = (chave: string, campo: Partial<Linha>) => setLinhas((ls) => ls.map((l) => (l.chave === chave ? { ...l, ...campo } : l)))
  const aplicarTodos = (campo: Partial<Linha>) => setLinhas((ls) => ls.map((l) => ({ ...l, ...campo })))

  const problemas = linhas.map(faltando).filter(Boolean).length
  const tamanhoTotal = linhas.reduce((s, l) => s + l.arquivo.size, 0)

  const enviar = async () => {
    const ids = await executar(() => api.enviar(linhas.map(({ chave: _c, ...it }) => it)))
    if (ids) {
      avisar(`${plural(ids.length, 'arquivo enviado', 'arquivos enviados')} para processamento.`)
      setLinhas([])
      setIgnorados([])
    }
  }

  const fila = useMemo(() => (docs ?? []).filter((d) => d.status !== 'pronto' || d.erro).slice(0, 50), [docs])
  const recentes = useMemo(() => (docs ?? []).filter((d) => d.status === 'pronto' && !d.erro).slice(0, 8), [docs])

  if (!cat) return <main className="pagina"><Carregando /></main>

  return (
    <main className="pagina">
      <div className="cabecalho">
        <div>
          <h1>Enviar documentos</h1>
          <p>Arraste PDFs ou pastas inteiras. O sistema sugere entidade, tipo, competência e caixa pelo caminho do arquivo; confira antes de enviar. Depois do envio, cada PDF é lido página por página para a busca.</p>
        </div>
      </div>

      <div
        className={`soltar${arrastando ? ' ativo' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setArrastando(true) }}
        onDragLeave={() => setArrastando(false)}
        onDrop={aoSoltar}
      >
        <Icone nome="enviar" tam={28} />
        <b>Solte aqui os PDFs ou as pastas</b>
        <span className="muted small">Padrão reconhecido: <span className="exemplo-caminho">ENTIDADE/CX-012/Movimento Contabil 012026.pdf</span></span>
        <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="btn" onClick={() => inputArquivos.current?.click()}><Icone nome="arquivo" />Escolher arquivos</button>
          <button className="btn" onClick={() => inputPasta.current?.click()}><Icone nome="pasta" />Escolher pasta</button>
        </div>
        <input ref={inputArquivos} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => { aoEscolher(e.target.files); e.target.value = '' }} />
        <input ref={inputPasta} type="file" multiple hidden onChange={(e) => { aoEscolher(e.target.files); e.target.value = '' }} {...{ webkitdirectory: '' }} />
      </div>

      {ignorados.length > 0 && <div style={{ marginTop: 12 }}><Alerta tipo="aviso">{plural(ignorados.length, 'arquivo ignorado', 'arquivos ignorados')} por não ser PDF: {ignorados.slice(0, 5).join(', ')}{ignorados.length > 5 ? '…' : ''}</Alerta></div>}

      {linhas.length > 0 && (
        <div className="painel" style={{ marginTop: 16 }}>
          <div className="painel-cab">
            <div>
              <h2>Conferir {plural(linhas.length, 'arquivo', 'arquivos')}</h2>
              <p>{formatarTamanho(Math.round(tamanhoTotal / 1024))} no total{problemas ? ` · ${plural(problemas, 'linha incompleta', 'linhas incompletas')}` : ''}</p>
            </div>
            <div className="linha-acoes">
              <label className="campo" style={{ minWidth: 160 }}>
                <span>Aplicar entidade a todos</span>
                <select id="todos-entidade" className="input peq" value="" onChange={(e) => { const en = cat.entidades.find((x) => x.id === e.target.value); if (en) aplicarTodos({ entidadeId: en.id, municipioId: en.municipioId }) }}>
                  <option value="">Escolher…</option>
                  {cat.entidades.map((en) => <option key={en.id} value={en.id}>{en.sigla}</option>)}
                </select>
              </label>
              <label className="campo" style={{ minWidth: 160 }}>
                <span>Aplicar tipo a todos</span>
                <select id="todos-tipo" className="input peq" value="" onChange={(e) => e.target.value && aplicarTodos({ tipoId: e.target.value })}>
                  <option value="">Escolher…</option>
                  {cat.tipos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
                </select>
              </label>
              <label className="campo" style={{ minWidth: 240 }}>
                <span>Descrição para todos</span>
                <input id="todos-descricao" className="input peq" placeholder="Digite e tecle Enter" onKeyDown={(e) => { if (e.key === 'Enter') { aplicarTodos({ descricao: e.currentTarget.value }); e.currentTarget.value = '' } }} />
              </label>
            </div>
          </div>
          <div className="tabela-wrap">
            <table className="tabela">
              <thead>
                <tr><th>Arquivo</th><th>Título</th><th>Descrição / palavras-chave</th><th>Município</th><th>Entidade</th><th>Tipo</th><th>Mês</th><th>Ano</th><th>Caixa</th><th /></tr>
              </thead>
              <tbody>
                {linhas.map((l) => {
                  const falta = faltando(l)
                  const caixas = cat.caixas.filter((c) => c.municipioId === l.municipioId)
                  return (
                    <tr key={l.chave}>
                      <td style={{ maxWidth: 220 }}>
                        <div className="titulo-celula" style={{ overflowWrap: 'anywhere' }}>{l.arquivo.name}</div>
                        <div className="sub">{formatarTamanho(Math.round(l.arquivo.size / 1024))}{l.caminho !== l.arquivo.name ? ` · ${l.caminho.split('/').slice(0, -1).join('/')}` : ''}</div>
                        {falta && <div className="small" style={{ color: 'var(--erro)' }}>Falta: {falta}</div>}
                      </td>
                      <td className="celula-titulo"><input className="input peq" aria-label="Título" value={l.titulo} aria-invalid={!l.titulo.trim()} onChange={(e) => mudar(l.chave, { titulo: e.target.value })} /></td>
                      <td style={{ minWidth: 220 }}><input className="input peq" aria-label="Descrição / palavras-chave" placeholder="Ex.: folha, precatórios" value={l.descricao} onChange={(e) => mudar(l.chave, { descricao: e.target.value })} /></td>
                      <td>
                        <select className="input peq" aria-label="Município" value={l.municipioId} aria-invalid={!l.municipioId} onChange={(e) => mudar(l.chave, { municipioId: e.target.value, entidadeId: null, caixaId: null })}>
                          <option value="">—</option>
                          {cat.municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}/{m.uf}</option>)}
                        </select>
                      </td>
                      <td>
                        <select className="input peq" aria-label="Entidade" value={l.entidadeId ?? ''} onChange={(e) => mudar(l.chave, { entidadeId: e.target.value || null })}>
                          <option value="">—</option>
                          {cat.entidades.filter((en) => en.municipioId === l.municipioId).map((en) => <option key={en.id} value={en.id}>{en.sigla}</option>)}
                        </select>
                      </td>
                      <td>
                        <select className="input peq" aria-label="Tipo" value={l.tipoId} aria-invalid={!l.tipoId} onChange={(e) => mudar(l.chave, { tipoId: e.target.value })}>
                          <option value="">—</option>
                          {cat.tipos.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
                        </select>
                      </td>
                      <td>
                        <select className="input peq" aria-label="Mês" value={l.mes ?? ''} onChange={(e) => mudar(l.chave, { mes: e.target.value ? Number(e.target.value) : null })}>
                          <option value="">—</option>
                          {MESES.map((m, i) => <option key={m} value={i + 1}>{capitalizar(m.slice(0, 3))}</option>)}
                        </select>
                      </td>
                      <td><input className="input peq num" style={{ width: 72, minWidth: 72 }} aria-label="Ano" inputMode="numeric" value={l.ano || ''} aria-invalid={!l.ano} onChange={(e) => mudar(l.chave, { ano: Number(e.target.value.replace(/\D/g, '').slice(0, 4)) || 0 })} /></td>
                      <td>
                        <select className="input peq" aria-label="Caixa" value={l.caixaId ?? ''} onChange={(e) => mudar(l.chave, { caixaId: e.target.value || null })}>
                          <option value="">Sem caixa</option>
                          {l.caixaId?.startsWith('nova:') && <option value={l.caixaId}>{l.caixaId.slice(5)} (nova)</option>}
                          {caixas.map((c) => <option key={c.id} value={c.id}>{c.codigo}</option>)}
                        </select>
                      </td>
                      <td className="acoes"><button className="btn discreto peq icone" aria-label={`Tirar ${l.arquivo.name} da lista`} onClick={() => setLinhas((ls) => ls.filter((x) => x.chave !== l.chave))}><Icone nome="x" /></button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="painel-corpo" style={{ borderTop: '1px solid var(--border)', display: 'grid', gap: 10 }}>
            {erro && <Alerta tipo="erro">{erro}</Alerta>}
            <div className="linha-acoes">
              <button className="btn" onClick={() => setLinhas([])} disabled={ocupado}>Limpar lista</button>
              <button className="btn primario" onClick={enviar} disabled={ocupado || problemas > 0}>
                <Icone nome="enviar" />{ocupado ? 'Enviando…' : `Enviar ${plural(linhas.length, 'arquivo', 'arquivos')}`}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="painel" style={{ marginTop: 16 }}>
        <div className="painel-cab">
          <div>
            <h2>Processamento</h2>
            <p>Leitura do texto e geração das miniaturas. Pode deixar esta tela; o processamento continua enquanto o sistema estiver aberto.</p>
          </div>
          <Link className="btn peq" to="/admin/documentos">Ver todos os documentos</Link>
        </div>
        {fila.length === 0 && recentes.length === 0 ? (
          <p className="painel-corpo muted">Nenhum envio ainda.</p>
        ) : (
          <div className="tabela-wrap">
            <table className="tabela">
              <thead><tr><th>Documento</th><th>Situação</th><th style={{ width: '30%' }}>Andamento</th></tr></thead>
              <tbody>
                {[...fila, ...recentes].map((d) => {
                  const p = api.progresso(d.id)
                  return (
                    <tr key={d.id}>
                      <td><div className="titulo-celula">{d.titulo}</div><div className="sub">{d.arquivoNome} · {competencia(d.mes, d.ano)}</div></td>
                      <td><StatusDocumento status={d.status} aviso={!!d.erro} /></td>
                      <td>
                        {d.status === 'processando' && p ? (
                          <div style={{ display: 'grid', gap: 4 }}>
                            <div className="barra"><i style={{ width: `${p.total ? (p.feitas / p.total) * 100 : 0}%` }} /></div>
                            <span className="small muted num">página {p.feitas} de {p.total}</span>
                          </div>
                        ) : d.erro ? <span className="small" style={{ color: d.status === 'erro' ? 'var(--erro)' : 'var(--aviso)' }}>{d.erro}</span>
                          : d.status === 'pronto' ? <span className="small muted num">{d.paginas} páginas indexadas</span>
                          : <span className="small muted">aguardando</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  )
}

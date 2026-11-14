import { useState, type FormEvent, type ReactNode } from 'react'
import { api } from '../../api'
import { Icone } from '../../components/Icone'
import { Alerta, Carregando, useUI } from '../../components/ui'
import { useAcao, useConsulta } from '../../lib/hooks'

export function Cadastros() {
  const { data: cat, erro } = useConsulta(() => api.catalogo(), [])
  const { avisar, confirmar } = useUI()

  const remover = async (tipo: 'municipio' | 'entidade' | 'caixa' | 'tipo', id: string, nome: string) => {
    const ok = await confirmar({ titulo: 'Remover cadastro', texto: <>Remover <b>{nome}</b>? Só é possível se nenhum documento ou acesso usar este cadastro.</>, confirmar: 'Remover', perigo: true })
    if (!ok) return
    try {
      await api.removerCadastro(tipo, id)
      avisar(`${nome} removido.`)
    } catch (e) {
      avisar(e instanceof Error ? e.message : String(e), true)
    }
  }

  if (erro) return <main className="pagina"><Alerta tipo="erro">{erro}</Alerta></main>
  if (!cat) return <main className="pagina"><Carregando /></main>
  const nomeMun = (id: string) => { const m = cat.municipios.find((x) => x.id === id); return m ? `${m.nome}/${m.uf}` : '—' }

  return (
    <main className="pagina">
      <div className="cabecalho">
        <div>
          <h1>Cadastros</h1>
          <p>Listas usadas para organizar e filtrar o acervo. Caixas novas também são criadas sozinhas no envio, quando o caminho do arquivo traz o código (ex.: CX-012).</p>
        </div>
      </div>
      <div className="cad-grid">
        <Bloco titulo="Municípios" itens={cat.municipios.map((m) => ({ id: m.id, nome: `${m.nome}/${m.uf}` }))} aoRemover={(id, n) => remover('municipio', id, n)}>
          <FormMunicipio />
        </Bloco>
        <Bloco titulo="Entidades" descricao="Órgãos dentro do município: prefeitura, câmara, instituto de previdência." itens={cat.entidades.map((e) => ({ id: e.id, nome: `${e.sigla} · ${e.nome}`, sub: nomeMun(e.municipioId) }))} aoRemover={(id, n) => remover('entidade', id, n)}>
          <FormEntidade municipios={cat.municipios} />
        </Bloco>
        <Bloco titulo="Caixas" descricao="Caixas físicas do arquivo, por município." itens={cat.caixas.map((c) => ({ id: c.id, nome: c.codigo, sub: `${nomeMun(c.municipioId)}${c.anoInicial ? ` · ${c.anoInicial}–${c.anoFinal ?? '…'}` : ''}${c.descricao ? ` · ${c.descricao}` : ''}` }))} aoRemover={(id, n) => remover('caixa', id, n)}>
          <FormCaixa municipios={cat.municipios} />
        </Bloco>
        <Bloco titulo="Tipos de documento" itens={cat.tipos.map((t) => ({ id: t.id, nome: t.nome }))} aoRemover={(id, n) => remover('tipo', id, n)}>
          <FormTipo />
        </Bloco>
      </div>
    </main>
  )
}

function Bloco({ titulo, descricao, itens, aoRemover, children }: { titulo: string; descricao?: string; itens: { id: string; nome: string; sub?: string }[]; aoRemover: (id: string, nome: string) => void; children: ReactNode }) {
  return (
    <section className="painel">
      <div className="painel-cab"><div><h2>{titulo}</h2>{descricao && <p>{descricao}</p>}</div><span className="small muted num">{itens.length}</span></div>
      {itens.length === 0 ? <p className="painel-corpo muted small">Nenhum cadastrado.</p> : (
        <ul className="lista-simples" style={{ maxHeight: 280, overflow: 'auto' }}>
          {itens.map((i) => (
            <li key={i.id}>
              <div><div>{i.nome}</div>{i.sub && <div className="small muted">{i.sub}</div>}</div>
              <button className="btn discreto peq icone" aria-label={`Remover ${i.nome}`} onClick={() => aoRemover(i.id, i.nome)}><Icone nome="lixo" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="painel-corpo" style={{ borderTop: '1px solid var(--border)' }}>{children}</div>
    </section>
  )
}

function useForm(acao: () => Promise<unknown>, limpar: () => void) {
  const { avisar } = useUI()
  const a = useAcao()
  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    const ok = await a.executar(async () => {
      await acao()
      return true
    })
    if (ok) {
      limpar()
      avisar('Cadastro incluído.')
    }
  }
  return { ...a, enviar }
}

function FormMunicipio() {
  const [nome, setNome] = useState('')
  const [uf, setUf] = useState('MG')
  const f = useForm(() => api.criarMunicipio(nome, uf), () => setNome(''))
  return (
    <form onSubmit={f.enviar} style={{ display: 'grid', gap: 8 }}>
      <div className="grade-form" style={{ gridTemplateColumns: 'minmax(0,1fr) 80px auto' }}>
        <label className="campo"><span>Nome</span><input id="mun-nome" className="input" value={nome} onChange={(e) => setNome(e.target.value)} /></label>
        <label className="campo"><span>UF</span><input id="mun-uf" className="input" maxLength={2} value={uf} onChange={(e) => setUf(e.target.value.toUpperCase())} /></label>
        <button className="btn" type="submit" disabled={f.ocupado || !nome}><Icone nome="mais" />Incluir</button>
      </div>
      {f.erro && <Alerta tipo="erro">{f.erro}</Alerta>}
    </form>
  )
}

function FormEntidade({ municipios }: { municipios: { id: string; nome: string; uf: string }[] }) {
  const [mun, setMun] = useState(municipios[0]?.id ?? '')
  const [nome, setNome] = useState('')
  const [sigla, setSigla] = useState('')
  const f = useForm(() => api.criarEntidade(mun, nome, sigla), () => { setNome(''); setSigla('') })
  return (
    <form onSubmit={f.enviar} style={{ display: 'grid', gap: 8 }}>
      <div className="grade-form">
        <label className="campo"><span>Município</span><select id="ent-mun" className="input" value={mun} onChange={(e) => setMun(e.target.value)}>{municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}/{m.uf}</option>)}</select></label>
        <label className="campo"><span>Sigla</span><input id="ent-sigla" className="input" placeholder="Ex.: Câmara" value={sigla} onChange={(e) => setSigla(e.target.value)} /></label>
        <label className="campo" style={{ gridColumn: '1 / -1' }}><span>Nome completo</span><input id="ent-nome" className="input" value={nome} onChange={(e) => setNome(e.target.value)} /></label>
      </div>
      {f.erro && <Alerta tipo="erro">{f.erro}</Alerta>}
      <div className="linha-acoes"><button className="btn" type="submit" disabled={f.ocupado || !nome || !sigla}><Icone nome="mais" />Incluir</button></div>
    </form>
  )
}

function FormCaixa({ municipios }: { municipios: { id: string; nome: string; uf: string }[] }) {
  const [mun, setMun] = useState(municipios[0]?.id ?? '')
  const [codigo, setCodigo] = useState('')
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [descricao, setDescricao] = useState('')
  const f = useForm(
    () => api.criarCaixa({ municipioId: mun, codigo, anoInicial: Number(de) || null, anoFinal: Number(ate) || null, descricao }),
    () => { setCodigo(''); setDe(''); setAte(''); setDescricao('') },
  )
  return (
    <form onSubmit={f.enviar} style={{ display: 'grid', gap: 8 }}>
      <div className="grade-form" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))' }}>
        <label className="campo"><span>Município</span><select id="cx-mun" className="input" value={mun} onChange={(e) => setMun(e.target.value)}>{municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}</select></label>
        <label className="campo"><span>Código</span><input id="cx-codigo" className="input mono" placeholder="CX-012" value={codigo} onChange={(e) => setCodigo(e.target.value)} /></label>
        <label className="campo"><span>Ano inicial</span><input id="cx-de" className="input num" inputMode="numeric" value={de} onChange={(e) => setDe(e.target.value.replace(/\D/g, '').slice(0, 4))} /></label>
        <label className="campo"><span>Ano final</span><input id="cx-ate" className="input num" inputMode="numeric" value={ate} onChange={(e) => setAte(e.target.value.replace(/\D/g, '').slice(0, 4))} /></label>
        <label className="campo" style={{ gridColumn: '1 / -1' }}><span>Descrição</span><input id="cx-desc" className="input" placeholder="Opcional" value={descricao} onChange={(e) => setDescricao(e.target.value)} /></label>
      </div>
      {f.erro && <Alerta tipo="erro">{f.erro}</Alerta>}
      <div className="linha-acoes"><button className="btn" type="submit" disabled={f.ocupado || !codigo || !mun}><Icone nome="mais" />Incluir</button></div>
    </form>
  )
}

function FormTipo() {
  const [nome, setNome] = useState('')
  const f = useForm(() => api.criarTipo(nome), () => setNome(''))
  return (
    <form onSubmit={f.enviar} style={{ display: 'grid', gap: 8 }}>
      <div className="grade-form" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}>
        <label className="campo"><span>Nome</span><input id="tipo-nome" className="input" placeholder="Ex.: Folha de pagamento" value={nome} onChange={(e) => setNome(e.target.value)} /></label>
        <button className="btn" type="submit" disabled={f.ocupado || !nome}><Icone nome="mais" />Incluir</button>
      </div>
      {f.erro && <Alerta tipo="erro">{f.erro}</Alerta>}
    </form>
  )
}

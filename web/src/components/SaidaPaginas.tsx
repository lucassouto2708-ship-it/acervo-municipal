import { useMemo, useState } from 'react'
import { api, type DocResumo } from '../api'
import { baixarArquivo, imprimirPdf, nomeRecorte, recortarPdf } from '../lib/arquivo'
import { escreverIntervalos, lerIntervalos } from '../lib/paginas'
import { formatarTamanho, plural } from '../lib/util'
import { Icone } from './Icone'
import { Miniatura } from './Miniatura'
import { Alerta, Modal, useUI } from './ui'

export type ModoSaida = 'baixar' | 'imprimir'
type Opcao = 'todas' | 'atual' | 'termo' | 'escolher'

interface Props {
  doc: DocResumo
  modo: ModoSaida
  paginaAtual?: number
  termo?: string
  paginasTermo?: number[]
  aoFechar: () => void
}

/** Escolha das páginas antes de baixar ou imprimir. Gera um PDF só com elas. */
export function SaidaPaginas({ doc, modo, paginaAtual, termo, paginasTermo = [], aoFechar }: Props) {
  const { avisar } = useUI()
  const total = doc.paginas
  const [opcao, setOpcao] = useState<Opcao>(paginaAtual ? 'atual' : paginasTermo.length ? 'termo' : 'todas')
  const [texto, setTexto] = useState(paginaAtual ? String(paginaAtual) : escreverIntervalos(paginasTermo))
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const escolha = useMemo(() => lerIntervalos(texto, total), [texto, total])
  const paginas: number[] =
    opcao === 'todas' ? Array.from({ length: total }, (_, i) => i + 1)
    : opcao === 'atual' && paginaAtual ? [paginaAtual]
    : opcao === 'termo' ? paginasTermo
    : escolha.paginas
  const marcadas = new Set(opcao === 'escolher' ? escolha.paginas : paginas)
  const invalido = opcao === 'escolher' && (!!escolha.erro || escolha.paginas.length === 0)

  const alternar = (p: number) => {
    const s = new Set(escolha.erro ? [] : escolha.paginas)
    if (s.has(p)) s.delete(p)
    else s.add(p)
    setOpcao('escolher')
    setTexto(escreverIntervalos([...s]))
  }

  const executar = async () => {
    setOcupado(true)
    setErro(null)
    try {
      const url = await api.urlDoArquivo(doc.id)
      const inteiro = paginas.length === total
      // sempre um arquivo local: o navegador só imprime e só dá nome ao download de arquivos do próprio site
      const blob = inteiro ? await (await fetch(url)).blob() : await recortarPdf(url, paginas)
      const alvo = URL.createObjectURL(blob)
      if (modo === 'baixar') baixarArquivo(alvo, nomeRecorte(doc.arquivoNome, paginas, total))
      else await imprimirPdf(alvo)
      setTimeout(() => URL.revokeObjectURL(alvo), 90_000)
      await api.registrarUso(modo === 'baixar' ? 'baixou' : 'imprimiu', doc.id, inteiro ? 'documento inteiro' : `${paginas.length === 1 ? 'página' : 'páginas'} ${escreverIntervalos(paginas)}`)
      if (modo === 'baixar') avisar(`PDF com ${plural(paginas.length, 'página', 'páginas')} baixado.`)
      aoFechar()
    } catch (e) {
      setErro(`Não foi possível preparar o PDF. ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setOcupado(false)
    }
  }

  const tamanhoEstimado = Math.round((doc.tamanhoKb * paginas.length) / Math.max(1, total))
  const verbo = modo === 'baixar' ? 'Baixar' : 'Imprimir'

  const opcaoRadio = (valor: Opcao, rotulo: string, detalhe?: string) => (
    <label className={`opcao-saida${opcao === valor ? ' ativa' : ''}`}>
      <input type="radio" name="opcao-saida" value={valor} checked={opcao === valor} onChange={() => setOpcao(valor)} />
      <span><b>{rotulo}</b>{detalhe && <small>{detalhe}</small>}</span>
    </label>
  )

  return (
    <Modal
      titulo={modo === 'baixar' ? 'Baixar PDF' : 'Imprimir'}
      largo
      aoFechar={aoFechar}
      rodape={
        <>
          <span className="small muted" style={{ marginRight: 'auto', alignSelf: 'center' }}>
            {invalido ? 'Escolha ao menos uma página' : `${plural(paginas.length, 'página', 'páginas')} · ≈ ${formatarTamanho(tamanhoEstimado)}`}
          </span>
          <button className="btn" onClick={aoFechar}>Cancelar</button>
          <button className="btn primario" onClick={executar} disabled={ocupado || invalido || paginas.length === 0}>
            <Icone nome={modo === 'baixar' ? 'baixar' : 'imprimir'} />
            {ocupado ? 'Preparando…' : `${verbo} ${plural(paginas.length, 'página', 'páginas')}`}
          </button>
        </>
      }
    >
      <p className="small muted">{doc.titulo} · {doc.arquivoNome}</p>
      <div className="opcoes-saida" role="radiogroup" aria-label="Páginas">
        {opcaoRadio('todas', 'Documento inteiro', plural(total, 'página', 'páginas'))}
        {paginaAtual ? opcaoRadio('atual', 'Página atual', `página ${paginaAtual}`) : null}
        {paginasTermo.length > 0 && opcaoRadio('termo', `Páginas com “${termo}”`, escreverIntervalos(paginasTermo))}
        {opcaoRadio('escolher', 'Escolher páginas', 'digite ou clique nas miniaturas')}
      </div>

      {opcao === 'escolher' && (
        <div style={{ display: 'grid', gap: 8 }}>
          <label className="campo">
            <span>Páginas</span>
            <input id="saida-paginas" className="input mono" placeholder="Ex.: 1-3, 7, 10-12" value={texto} aria-invalid={!!escolha.erro} onChange={(e) => setTexto(e.target.value)} autoFocus />
          </label>
          {escolha.erro && <span className="small" style={{ color: 'var(--erro)' }}>{escolha.erro}</span>}
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn peq" onClick={() => setTexto(`1-${total}`)}>Marcar todas</button>
            <button className="btn peq" onClick={() => setTexto('')}>Limpar</button>
            {paginasTermo.length > 0 && <button className="btn peq" onClick={() => setTexto(escreverIntervalos(paginasTermo))}>Só as com “{termo}”</button>}
          </div>
        </div>
      )}

      <div className="selecao-paginas" aria-label="Miniaturas das páginas">
        {Array.from({ length: total }, (_, i) => i + 1).map((p) => (
          <button key={p} className={marcadas.has(p) ? 'marcada' : ''} onClick={() => alternar(p)} aria-pressed={marcadas.has(p)} aria-label={`Página ${p}`}>
            <Miniatura docId={doc.id} pagina={p} rotulo={String(p)} />
            {marcadas.has(p) && <span className="marca-sel"><Icone nome="check" tam={12} /></span>}
          </button>
        ))}
      </div>
      {erro && <Alerta tipo="erro">{erro}</Alerta>}
    </Modal>
  )
}

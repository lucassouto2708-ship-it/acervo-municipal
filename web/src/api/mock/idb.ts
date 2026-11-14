// IndexedDB guarda o que é pesado na F0: o PDF, o texto de cada página e as miniaturas.
// Na F1 isso vai para o Storage e para a tabela `paginas` do Supabase.

const NOME = 'acervo-f0'
export type Loja = 'arquivos' | 'textos' | 'miniaturas'
const LOJAS: Loja[] = ['arquivos', 'textos', 'miniaturas']

let conexao: Promise<IDBDatabase> | null = null

function abrir(): Promise<IDBDatabase> {
  if (!conexao) {
    conexao = new Promise((ok, falha) => {
      const req = indexedDB.open(NOME, 1)
      req.onupgradeneeded = () => {
        for (const l of LOJAS) if (!req.result.objectStoreNames.contains(l)) req.result.createObjectStore(l)
      }
      req.onsuccess = () => ok(req.result)
      req.onerror = () => falha(req.error)
    })
  }
  return conexao
}

function pedido<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((ok, falha) => {
    r.onsuccess = () => ok(r.result)
    r.onerror = () => falha(r.error)
  })
}

export async function idbGet<T>(loja: Loja, chave: string): Promise<T | undefined> {
  const db = await abrir()
  return pedido(db.transaction(loja).objectStore(loja).get(chave)) as Promise<T | undefined>
}

export async function idbPut(loja: Loja, chave: string, valor: unknown): Promise<void> {
  const db = await abrir()
  await pedido(db.transaction(loja, 'readwrite').objectStore(loja).put(valor, chave))
}

export async function idbPutVarios(loja: Loja, itens: [string, unknown][]): Promise<void> {
  const db = await abrir()
  const tx = db.transaction(loja, 'readwrite')
  const st = tx.objectStore(loja)
  for (const [k, v] of itens) st.put(v, k)
  await new Promise<void>((ok, falha) => {
    tx.oncomplete = () => ok()
    tx.onerror = () => falha(tx.error)
  })
}

/** Apaga a chave exata e todas as que começam com `chave:`. */
export async function idbApagarDoc(loja: Loja, chave: string): Promise<void> {
  const db = await abrir()
  const st = db.transaction(loja, 'readwrite').objectStore(loja)
  await pedido(st.delete(chave))
  await pedido(st.delete(IDBKeyRange.bound(`${chave}:`, `${chave}:￿`)))
}

export async function idbLimparTudo(): Promise<void> {
  const db = await abrir()
  for (const l of LOJAS) await pedido(db.transaction(l, 'readwrite').objectStore(l).clear())
}

// Testa a migração do Acervo num Postgres local (PGlite) imitando o ambiente do Supabase.
import { PGlite } from '@electric-sql/pglite'
import { unaccent } from '@electric-sql/pglite/contrib/unaccent'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const raiz = fileURLToPath(new URL('../', import.meta.url))
const db = new PGlite({ extensions: { unaccent } })
let falhas = 0
const ok = (cond, msg) => { console.log(`${cond ? 'OK  ' : 'FALHOU'} ${msg}`); if (!cond) falhas++ }

// ---- ambiente estilo Supabase ----
await db.exec(`
  create schema extensions; create schema auth;
  create role anon nologin; create role authenticated nologin;
  grant usage on schema public, extensions, auth to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant execute on function auth.uid() to anon, authenticated;
`)
await db.exec(readFileSync(raiz + 'migrations/20261111000000_inicial.sql', 'utf8'))
await db.exec(readFileSync(raiz + 'migrations/20261120000000_descricao.sql', 'utf8'))
await db.exec(readFileSync(raiz + 'seed.sql', 'utf8'))
ok(true, 'migração e seed rodaram sem erro')

// ---- dados de teste (como superusuário) ----
const um = async (sql, p = []) => (await db.query(sql, p)).rows[0]
const ids = {}
for (const [k, email] of [['admin', 'a@x'], ['cliente', 'c@x'], ['leitor', 'l@x'], ['outro', 'o@x'], ['inativo', 'i@x']]) {
  ids[k] = (await um(`insert into auth.users (email) values ($1) returning id`, [email])).id
}
const iprema = (await um(`select id from organizacoes where nome like 'IPREMA%'`)).id
const outraOrg = (await um(`insert into organizacoes (nome) values ('Outra Prefeitura') returning id`)).id
await db.query(`insert into perfis (id, nome, email, papel, organizacao_id) values
  ($1,'Admin','a@x','admin',null), ($2,'Cli','c@x','cliente',$6), ($3,'Lei','l@x','leitor',$6),
  ($4,'Outro','o@x','cliente',$7), ($5,'Inativo','i@x','leitor',$6)`,
  [ids.admin, ids.cliente, ids.leitor, ids.outro, ids.inativo, iprema, outraOrg])
await db.query(`update perfis set ativo = false where id = $1`, [ids.inativo])

const mun = (await um(`select id from municipios`)).id
const entI = (await um(`select id from entidades where sigla = 'IPREMA'`)).id
const entP = (await um(`select id from entidades where sigla = 'Prefeitura'`)).id
const tipoMov = (await um(`select id from tipos_documento where nome = 'Movimento contábil'`)).id
const tipoLei = (await um(`select id from tipos_documento where nome = 'Lei'`)).id

// ---- age como um usuário ----
async function como(quem, fn) {
  await db.exec(`set role ${quem === 'anon' ? 'anon' : 'authenticated'}`)
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [quem === 'anon' ? '' : ids[quem]])
  try { return await fn() } finally { await db.exec('reset role') }
}
const tenta = async (fn) => { try { await fn(); return null } catch (e) { return e.message } }

// admin cadastra documentos pelo caminho normal (com RLS ligado)
const docs = await como('admin', async () => {
  const ins = async (titulo, ent, tipo, status = 'pronto') =>
    (await um(`insert into documentos (titulo, municipio_id, entidade_id, tipo_id, ano, mes, arquivo_nome, status)
               values ($1,$2,$3,$4,2026,1,$1||'.pdf',$5) returning id`, [titulo, mun, ent, tipo, status])).id
  const d = {
    jan: await ins('Movimento contábil · Janeiro/2026', entI, tipoMov),
    fev: await ins('Movimento contábil · Fevereiro/2026', entI, tipoMov),
    pref: await ins('Lei 45/2016 da Prefeitura', entP, tipoLei),
    fila: await ins('Ainda processando', entI, tipoMov, 'processando'),
  }
  await db.query(`insert into paginas (documento_id, numero, texto) values
    ($1, 1, 'CONCILIAÇÃO BANCÁRIA Saldo do extrato 399,39'),
    ($1, 2, 'INSTAR TECNOLOGIA EM INFORMATICA LTDA fatura emissão. Instar de novo.'),
    ($1, 3, 'Anulação de dotações orçamentárias'),
    ($2, 1, 'conciliacao bancaria de fevereiro'),
    ($3, 1, 'CONCILIAÇÃO bancária da prefeitura, segredo'),
    ($4, 1, 'conciliação em processamento')`, [d.jan, d.fev, d.pref, d.fila])
  await db.query(`select registrar('enviou', $1, 'jan.pdf')`, [d.jan])
  return d
})
ok(true, 'admin cadastrou documentos e páginas com RLS ativo')

// ---- visibilidade ----
const contarDocs = (q) => como(q, async () => (await um(`select count(*)::int n from documentos`)).n)
ok(await contarDocs('admin') === 4, 'admin vê os 4 documentos (inclusive em processamento)')
ok(await contarDocs('cliente') === 2, 'cliente IPREMA vê só os 2 prontos do IPREMA')
ok(await contarDocs('leitor') === 2, 'leitor IPREMA vê os mesmos 2')
ok(await contarDocs('outro') === 0, 'cliente de outra organização sem acesso não vê nada')
ok(await contarDocs('inativo') === 0, 'usuário desativado não vê nada')
ok(await tenta(() => contarDocs('anon')) !== null, 'visitante sem login é barrado')
ok(await como('leitor', async () => (await um(`select count(*)::int n from paginas`)).n) === 4, 'leitor lê só as páginas dos documentos visíveis (4)')

// ---- busca ----
const busca = (q, termo) => como(q, async () => (await db.query(`select * from buscar_texto($1)`, [termo])).rows)
let r = await busca('leitor', 'conciliacao bancaria')
ok(r.length === 2 && !r.some((x) => x.documento_id === docs.pref || x.documento_id === docs.fila), 'busca sem acento acha só os 2 visíveis (não a prefeitura nem o em processamento)')
ok(r.some((x) => x.trecho.includes('[[[CONCILIAÇÃO]]]')), `trecho vem destacado: ${r[0]?.trecho}`)
r = await busca('admin', 'conciliação')
ok(r.length === 3, 'admin acha 3 (prontos de todas as entidades)')
r = await busca('leitor', 'instar')
ok(r.length === 1 && r[0].primeira_pagina === 2, 'acha "instar" e aponta a página 2')
r = await busca('leitor', 'inst')
ok(r.length === 1, 'acha pelo começo da palavra ("inst")')
r = await busca('leitor', 'dotação')
ok(r.length === 1, 'singular "dotação" acha "dotações"')
r = await busca('leitor', 'de da do')
ok(r.length === 0, 'consulta só com palavras vazias não devolve tudo')
const dentro = await como('leitor', async () => (await db.query(`select * from buscar_no_documento($1, 'instar')`, [docs.jan])).rows)
ok(dentro.length === 1 && dentro[0].pagina === 2 && dentro[0].ocorrencias === 2, `busca dentro do documento: página 2, 2 ocorrências (${JSON.stringify(dentro[0])})`)
const vazado = await como('leitor', async () => (await db.query(`select * from buscar_no_documento($1, 'segredo')`, [docs.pref])).rows)
ok(vazado.length === 0, 'busca dentro de documento sem acesso não vaza texto')

// ---- escrita ----
ok(await como('leitor', () => tenta(() => db.query(`insert into documentos (titulo, municipio_id, tipo_id, ano, arquivo_nome) values ('x',$1,$2,2020,'x')`, [mun, tipoLei]))) !== null, 'leitor não cria documento')
ok(await como('cliente', async () => { await db.query(`update documentos set titulo = 'hack'`); return (await um(`select count(*)::int n from documentos where titulo = 'hack'`)).n }) === 0, 'update do cliente não teve efeito')
ok(await como('cliente', () => tenta(() => db.query(`insert into acessos (organizacao_id, escopo, alvo_id) values ($1,'entidade',$2)`, [iprema, entP]))) !== null, 'cliente não se concede acesso')
ok(await como('leitor', () => tenta(() => db.query(`insert into auditoria (acao) values ('viu')`))) !== null, 'ninguém grava auditoria direto')
ok(await como('leitor', () => tenta(() => db.query(`select registrar('viu', $1)`, [docs.pref]))) !== null, 'leitor não registra uso de documento que não vê')
ok(await como('leitor', () => tenta(() => db.query(`select registrar('enviou', null)`))) !== null, 'leitor não registra ação de admin')
ok(await como('leitor', () => tenta(() => db.query(`select registrar('viu', $1)`, [docs.jan]))) === null, 'leitor registra que abriu documento visível')
await como('leitor', () => db.query(`select registrar('viu', $1)`, [docs.jan]))
ok(await como('admin', async () => (await um(`select count(*)::int n from auditoria where acao = 'viu'`)).n) === 1, 'registro repetido em 5 s não duplica')
ok(await como('leitor', async () => (await um(`select count(*)::int n from auditoria`)).n) === 0, 'leitor não lê a auditoria')

// ---- perfis ----
ok(await como('cliente', async () => (await um(`select count(*)::int n from perfis`)).n) === 3, 'cliente vê os 3 perfis da própria organização')
ok(await como('leitor', async () => (await um(`select count(*)::int n from perfis`)).n) === 1, 'leitor vê só o próprio perfil')
ok(await como('admin', async () => (await um(`select papel from perfis where id = $1`, [ids.cliente])).papel) === 'cliente', 'cliente não se promove a admin')

// ---- regras finas ----
await db.query(`insert into acessos (organizacao_id, escopo, alvo_id, tipo_id) values ($1, 'entidade', $2, $3)`, [outraOrg, entI, tipoLei])
ok(await contarDocs('outro') === 0, 'acesso restrito ao tipo Lei não libera Movimento contábil')
await db.query(`insert into acessos (organizacao_id, escopo, alvo_id) values ($1, 'documento', $2)`, [outraOrg, docs.fev])
ok(await contarDocs('outro') === 1, 'acesso avulso a um documento libera só ele')
await como('admin', () => db.query(`update documentos set descricao = 'folha de pagamento e precatórios' where id = $1`, [docs.jan]))
r = await busca('leitor', 'precatorio')
ok(r.length === 1 && r[0].paginas_com_acerto === 0 && r[0].trecho.includes('[[['), `busca acha pela descrição (sem acento, singular): ${r[0]?.trecho}`)
r = await busca('leitor', 'instar precatorios')
ok(r.length === 0, 'palavras em lugares diferentes (uma no texto, outra na descrição) não se misturam')
await como('admin', () => db.query(`update documentos set descricao = 'segredo da prefeitura' where id = $1`, [docs.pref]))
ok((await busca('leitor', 'segredo')).length === 0, 'descrição de documento sem acesso não aparece para o leitor')
const resumo = await como('admin', async () => (await db.query(`select * from resumo_organizacoes()`)).rows)
ok(resumo.find((x) => x.organizacao_id === iprema)?.documentos_visiveis === 2, 'resumo de clientes conta 2 visíveis para o IPREMA')
ok(await como('leitor', () => tenta(() => db.query(`select * from resumo_organizacoes()`))) !== null, 'leitor não vê resumo de clientes')
await como('admin', () => db.query(`delete from documentos where id = $1`, [docs.fev]))
ok((await um(`select count(*)::int n from acessos where escopo = 'documento'`)).n === 0, 'remover documento remove o acesso avulso dele')
ok((await um(`select count(*)::int n from paginas where documento_id = $1`, [docs.fev])).n === 0, 'remover documento remove as páginas')
await db.query(`update organizacoes set ativo = false where id = $1`, [iprema])
ok(await contarDocs('cliente') === 0, 'cliente suspenso deixa de ver na hora')
ok(await tenta(() => db.query(`insert into perfis (id, nome, email, papel) values (gen_random_uuid(), 'x', 'z@x', 'leitor')`)) !== null, 'leitor sem organização é recusado')

console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTudo certo.')
process.exit(falhas ? 1 : 0)

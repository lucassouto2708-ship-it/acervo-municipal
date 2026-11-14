# Acervo Municipal

App de consulta a PDFs públicos digitalizados (município → entidade → caixa → documento),
com busca no texto de todas as páginas e busca dentro de cada PDF sem abrir o arquivo.

- `docs/arquitetura.html` — arquitetura v0 (papéis, dados, ingestão, busca, fases).
- `web/` — front (React + Vite + TypeScript). Rodar: `npm install` e `npm run dev` → http://localhost:5181

## F1: Supabase + Cloudflare R2 (pronta, falta ligar as contas)

- `supabase/migrations/` — tabelas, regras de acesso (RLS) e busca em português. `supabase/seed.sql` — cadastros iniciais.
- `supabase/functions/arquivos` — links temporários para o R2 (PDFs e miniaturas). `supabase/functions/usuarios` — criar contas e senhas provisórias.
- `web/src/api/supabase/` — mesma interface do modo demonstração. Com `web/.env` preenchido, o app usa o Supabase.
- `supabase/teste/` — testa as regras do banco localmente (`npm test`).
- Passo a passo das contas: **`supabase/CONFIGURAR.md`**.

## Modo demonstração (F0, sem `.env`)

Tudo roda no navegador; não há servidor ainda.

- `web/src/api/index.ts` é o único ponto de acesso a dados. Hoje aponta para `api/mock/`.
  Na F1 entra `api/supabase/` com as mesmas funções e as telas não mudam.
- `api/mock/`: metadados no localStorage; PDF, texto por página e miniaturas no IndexedDB.
  O processamento (hash, texto, miniaturas) usa pdf.js no navegador. É o mesmo trabalho
  que o worker Python fará na F2.
- Regra de acesso (`podeVer`) = a mesma que vai virar RLS no Postgres.

Contas de demonstração (aparecem na tela de login):
admin@acervo.local / admin123 · cliente@iprema.local / cliente123 · leitor@iprema.local / leitor123

## Baixar e imprimir

"Baixar PDF" e "Imprimir" abrem a escolha de páginas: documento inteiro, página atual,
páginas onde o termo pesquisado aparece, ou uma seleção livre ("1-3, 7", ou clicando nas miniaturas).
O PDF com só essas páginas é montado no navegador (`lib/arquivo.ts`, biblioteca pdf-lib) e mantém o texto pesquisável.

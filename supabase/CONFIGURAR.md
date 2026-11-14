# Ligar o Acervo ao Supabase + Cloudflare R2

São as duas contas grátis. Ordem: Supabase → R2 → ligar um ao outro → app.
Nenhuma chave **secreta** vai para o chat nem para o código: elas ficam só nos painéis.

---

## 1. Supabase (banco, login, regras)

1. Em **supabase.com** → *New project*. Nome: `acervo`. Região: **South America (São Paulo)**.
   Anote a senha do banco num lugar seguro.
2. **SQL Editor** → *New query* → cole todo o arquivo
   `migrations/20261111000000_inicial.sql` → **Run**. Depois, numa nova query, cole `seed.sql` → **Run**.
3. **Fechar cadastro público**: *Authentication → Sign In / Providers* → desligue
   **Allow new users to sign up**. (Contas só são criadas pelo app, pelo administrador.)
4. **Seu usuário de administrador**:
   - *Authentication → Users → Add user → Create new user*: seu e-mail e uma senha, marque **Auto Confirm User**.
   - No SQL Editor, troque o e-mail e rode:
     ```sql
     insert into public.perfis (id, nome, email, papel)
     select id, 'Lucas Souto', email, 'admin' from auth.users where email = 'SEU-EMAIL-AQUI';
     ```
5. *Project Settings → API*: copie **Project URL** e a chave **anon / publishable**.
   Essas duas são públicas (vão no app). A `service_role` / `secret` **não** copie para lugar nenhum.

## 2. Cloudflare R2 (PDFs e miniaturas)

1. Em **dash.cloudflare.com** → **R2 Object Storage** → ative (pode pedir um cartão; até 10 GB não cobra).
2. **Create bucket** → nome `acervo` → localização automática.
3. No bucket → **Settings → CORS Policy** → *Edit* → cole (troque/adicione o endereço do site quando publicar):
   ```json
   [
     {
       "AllowedOrigins": ["http://localhost:5181"],
       "AllowedMethods": ["GET", "PUT", "HEAD"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["Content-Length", "Content-Range", "Accept-Ranges", "ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
4. **R2 → Manage API Tokens → Create API token**: permissão **Object Read & Write**, só no bucket `acervo`.
   Guarde o **Access Key ID** e o **Secret Access Key** (o secret aparece uma vez só).
   O **Account ID** fica na página inicial do R2.

## 3. Ligar o Supabase ao R2

1. Supabase → **Edge Functions → Secrets** → adicione:

   | Nome | Valor |
   |---|---|
   | `R2_ACCOUNT_ID` | Account ID do Cloudflare |
   | `R2_ACCESS_KEY_ID` | Access Key ID do token |
   | `R2_SECRET_ACCESS_KEY` | Secret Access Key do token |
   | `R2_BUCKET` | `acervo` |

2. Publicar as duas funções (`functions/arquivos` e `functions/usuarios`). Escolha um jeito:
   - **Pelo painel**: *Edge Functions → Deploy a new function → Via Editor*, nome `arquivos`,
     cole o `index.ts` da pasta, *Deploy*. Repita para `usuarios`.
   - **Pelo terminal** (dentro da pasta `acervo`):
     ```bash
     npx supabase login
     ```
     ```bash
     npx supabase functions deploy arquivos usuarios --project-ref ID-DO-PROJETO
     ```

## 4. App

Em `acervo/web`, crie o arquivo `.env` (modelo em `.env.example`):

```
VITE_SUPABASE_URL=https://ID-DO-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=chave-anon-ou-publishable
```

Rode `npm run dev` e entre com o seu e-mail de administrador. Sem o `.env`, o app volta ao modo demonstração.

## 5. Conferir que está tudo certo

1. **Enviar**: mande 1 PDF. Ele deve passar por *Na fila → Processando → Pronto*.
   Erro "Armazenamento de arquivos ainda não configurado" = faltou segredo do R2.
   Erro "O armazenamento recusou o arquivo" = CORS ou token do R2.
2. **Acervo**: a capa aparece e a busca acha palavras do PDF.
3. **Clientes**: crie um leitor para o IPREMA, anote a senha provisória, entre com ela numa janela anônima:
   o app pede para criar a senha e depois mostra só os documentos do IPREMA.

## Limites do plano grátis

- O projeto do Supabase **pausa depois de 7 dias sem uso** (reativa com um clique no painel).
  Com clientes usando de verdade, passe para o Pro (US$ 25/mês). Não precisa refazer nada.
- Banco: 500 MB (≈ 80–100 mil páginas de texto). R2: 10 GB (≈ 20 mil páginas de PDF).

## Testar as regras do banco sem Supabase

```bash
cd teste && npm install && npm test
```
Roda a migração num Postgres local e confere 40 regras (quem vê o quê, busca, auditoria).

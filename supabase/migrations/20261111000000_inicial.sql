-- Acervo Municipal · esquema inicial (F1)
-- Rodar uma vez no SQL Editor do Supabase (ou `supabase db push`).
-- A regra de quem vê o quê fica AQUI, no banco (RLS). O app só pede; o banco decide.

create extension if not exists unaccent with schema extensions;

-- Busca em português, sem acento: "conciliação" = "conciliacao", "dotações" ≈ "dotação".
do $$
begin
  if not exists (select 1 from pg_ts_config where cfgname = 'pt' and cfgnamespace = 'public'::regnamespace) then
    create text search configuration public.pt (copy = pg_catalog.portuguese);
    alter text search configuration public.pt
      alter mapping for hword, hword_part, word with extensions.unaccent, pg_catalog.portuguese_stem;
  end if;
end $$;

-- =====================================================================
-- Tabelas
-- =====================================================================

create table public.organizacoes (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) > 0),
  cnpj text not null default '',
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table public.perfis (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null,
  email text not null unique,
  papel text not null check (papel in ('admin', 'cliente', 'leitor')),
  organizacao_id uuid references public.organizacoes (id) on delete restrict,
  criado_por uuid references public.perfis (id) on delete set null,
  ativo boolean not null default true,
  trocar_senha boolean not null default false,
  criado_em timestamptz not null default now(),
  -- admin não pertence a cliente; cliente e leitor sempre pertencem a um
  constraint perfis_org_coerente check ((papel = 'admin') = (organizacao_id is null))
);
create index perfis_org on public.perfis (organizacao_id);

create table public.municipios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  uf char(2) not null check (uf ~ '^[A-Z]{2}$'),
  unique (nome, uf)
);

-- órgão dentro do município: prefeitura, câmara, instituto de previdência…
create table public.entidades (
  id uuid primary key default gen_random_uuid(),
  municipio_id uuid not null references public.municipios (id) on delete restrict,
  nome text not null,
  sigla text not null
);
create index entidades_mun on public.entidades (municipio_id);

create table public.caixas (
  id uuid primary key default gen_random_uuid(),
  municipio_id uuid not null references public.municipios (id) on delete restrict,
  codigo text not null,
  ano_inicial int,
  ano_final int,
  descricao text not null default '',
  unique (municipio_id, codigo),
  check (ano_inicial is null or ano_final is null or ano_inicial <= ano_final)
);

create table public.tipos_documento (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique
);

create table public.documentos (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (length(trim(titulo)) > 0),
  numero text not null default '',
  municipio_id uuid not null references public.municipios (id) on delete restrict,
  entidade_id uuid references public.entidades (id) on delete restrict,
  caixa_id uuid references public.caixas (id) on delete restrict,
  tipo_id uuid not null references public.tipos_documento (id) on delete restrict,
  ano int not null check (ano between 1800 and 2100),
  mes int check (mes between 1 and 12),
  paginas int not null default 0,
  status text not null default 'na_fila' check (status in ('na_fila', 'processando', 'pronto', 'erro')),
  erro text,
  arquivo_nome text not null,
  caminho text not null default '',
  tamanho_kb int not null default 0,
  sha256 text unique,
  enviado_por uuid references public.perfis (id) on delete set null,
  criado_em timestamptz not null default now()
);
create index documentos_mun on public.documentos (municipio_id);
create index documentos_ent on public.documentos (entidade_id);
create index documentos_cx on public.documentos (caixa_id);
create index documentos_tipo on public.documentos (tipo_id);
create index documentos_ano on public.documentos (ano);

-- uma linha por página: o coração da busca
create table public.paginas (
  documento_id uuid not null references public.documentos (id) on delete cascade,
  numero int not null check (numero >= 1),
  texto text not null default '',
  tsv tsvector generated always as (to_tsvector('public.pt'::regconfig, texto)) stored,
  primary key (documento_id, numero)
);
create index paginas_tsv on public.paginas using gin (tsv);

-- o que cada cliente enxerga
create table public.acessos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references public.organizacoes (id) on delete cascade,
  escopo text not null check (escopo in ('municipio', 'entidade', 'caixa', 'documento')),
  alvo_id uuid not null,
  tipo_id uuid references public.tipos_documento (id) on delete restrict,
  concedido_por uuid references public.perfis (id) on delete set null,
  em timestamptz not null default now(),
  unique nulls not distinct (organizacao_id, escopo, alvo_id, tipo_id)
);
create index acessos_org on public.acessos (organizacao_id);
create index acessos_alvo on public.acessos (alvo_id);

create table public.auditoria (
  id bigint generated always as identity primary key,
  usuario_id uuid references public.perfis (id) on delete set null,
  acao text not null,
  documento_id uuid, -- sem FK: o registro fica mesmo se o documento for removido
  detalhe text not null default '',
  em timestamptz not null default now()
);
create index auditoria_em on public.auditoria (em desc);

-- remover um documento remove as liberações avulsas dele
create function public.limpar_acessos_documento() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.acessos where escopo = 'documento' and alvo_id = old.id;
  return old;
end $$;
create trigger documentos_limpar_acessos after delete on public.documentos
  for each row execute function public.limpar_acessos_documento();

-- =====================================================================
-- Quem sou eu (usadas pelas regras)
-- =====================================================================

-- papel do usuário logado; null se desativado ou se o cliente dele estiver suspenso
create function public.meu_papel() returns text
language sql stable security definer set search_path = '' as $$
  select p.papel
  from public.perfis p
  left join public.organizacoes o on o.id = p.organizacao_id
  where p.id = auth.uid() and p.ativo and (p.organizacao_id is null or o.ativo)
$$;

create function public.minha_org() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.organizacao_id
  from public.perfis p
  join public.organizacoes o on o.id = p.organizacao_id
  where p.id = auth.uid() and p.ativo and o.ativo
$$;

create function public.sou_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(public.meu_papel() = 'admin', false)
$$;

-- a mesma regra do protótipo (podeVer): o cliente vê documentos prontos cobertos por algum acesso
create function public.org_ve(p_org uuid, d public.documentos) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_org is not null and d.status = 'pronto' and exists (
    select 1 from public.acessos a
    where a.organizacao_id = p_org
      and (a.tipo_id is null or a.tipo_id = d.tipo_id)
      and (   (a.escopo = 'municipio' and a.alvo_id = d.municipio_id)
           or (a.escopo = 'entidade'  and a.alvo_id = d.entidade_id)
           or (a.escopo = 'caixa'     and a.alvo_id = d.caixa_id)
           or (a.escopo = 'documento' and a.alvo_id = d.id))
  )
$$;

create function public.pode_ver_documento(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.documentos d
    where d.id = p_id and (public.sou_admin() or public.org_ve(public.minha_org(), d))
  )
$$;

-- =====================================================================
-- Regras de acesso (RLS)
-- =====================================================================

alter table public.organizacoes enable row level security;
alter table public.perfis enable row level security;
alter table public.municipios enable row level security;
alter table public.entidades enable row level security;
alter table public.caixas enable row level security;
alter table public.tipos_documento enable row level security;
alter table public.documentos enable row level security;
alter table public.paginas enable row level security;
alter table public.acessos enable row level security;
alter table public.auditoria enable row level security;

-- (select …) faz o Postgres calcular uma vez por consulta, não uma vez por linha
create policy org_ler on public.organizacoes for select to authenticated
  using ((select public.sou_admin()) or id = (select public.minha_org()));
create policy org_admin on public.organizacoes for all to authenticated
  using ((select public.sou_admin())) with check ((select public.sou_admin()));

-- perfis só são criados/alterados pela função `usuarios` (chave de serviço)
create policy perfis_ler on public.perfis for select to authenticated
  using (
    (select public.sou_admin())
    or id = (select auth.uid())
    or ((select public.meu_papel()) = 'cliente' and organizacao_id = (select public.minha_org()))
  );

create policy mun_ler on public.municipios for select to authenticated using ((select public.meu_papel()) is not null);
create policy mun_admin on public.municipios for all to authenticated using ((select public.sou_admin())) with check ((select public.sou_admin()));
create policy ent_ler on public.entidades for select to authenticated using ((select public.meu_papel()) is not null);
create policy ent_admin on public.entidades for all to authenticated using ((select public.sou_admin())) with check ((select public.sou_admin()));
create policy cx_ler on public.caixas for select to authenticated using ((select public.meu_papel()) is not null);
create policy cx_admin on public.caixas for all to authenticated using ((select public.sou_admin())) with check ((select public.sou_admin()));
create policy tipo_ler on public.tipos_documento for select to authenticated using ((select public.meu_papel()) is not null);
create policy tipo_admin on public.tipos_documento for all to authenticated using ((select public.sou_admin())) with check ((select public.sou_admin()));

create policy doc_ler on public.documentos for select to authenticated
  using ((select public.sou_admin()) or public.org_ve((select public.minha_org()), documentos));
create policy doc_admin on public.documentos for all to authenticated
  using ((select public.sou_admin())) with check ((select public.sou_admin()));

create policy pag_ler on public.paginas for select to authenticated
  using ((select public.sou_admin()) or public.pode_ver_documento(documento_id));
create policy pag_admin on public.paginas for all to authenticated
  using ((select public.sou_admin())) with check ((select public.sou_admin()));

create policy ace_admin on public.acessos for all to authenticated
  using ((select public.sou_admin())) with check ((select public.sou_admin()));

-- auditoria: só o admin lê; ninguém grava direto (só pela função registrar)
create policy aud_ler on public.auditoria for select to authenticated using ((select public.sou_admin()));

-- visitante sem login não vê nada
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- =====================================================================
-- Funções chamadas pelo app (RPC)
-- =====================================================================

-- radical aproximado (dotações → dotac), igual ao do app (lib/termos.ts)
create function public.radical_pt(p text) returns text
language sql immutable as $$
  select case
    when length(p) >= 7 and p ~ '(oes|aes|eis)$' then left(p, length(p) - 3)
    when length(p) >= 6 and p ~ '(ao|as|os|es|is)$' then left(p, length(p) - 2)
    when length(p) >= 5 and p ~ '[saoe]$' then left(p, length(p) - 1)
    else p
  end
$$;

-- consulta digitada → tsquery: todas as palavras; cada uma vale como digitada ou pelo radical,
-- e também como começo de palavra ("inst" acha "instar")
create function public.consulta_pt(p_consulta text) returns tsquery
language plpgsql stable set search_path = '' as $$
declare
  q text;
begin
  select string_agg(
           '(' || quote_literal(w) || ':* | ' || quote_literal(public.radical_pt(w)) || ':*)', ' & ')
    into q
  from (
    select lower(w) as w
    from regexp_split_to_table(extensions.unaccent(coalesce(p_consulta, '')), '[^[:alnum:]]+') as w
    where length(w) >= 2
  ) palavras;
  if q is null then
    return null;
  end if;
  return to_tsquery('public.pt'::regconfig, q);
end $$;

-- marcadores dos trechos destacados: [[[termo]]] e fragmentos separados por |||
create function public.opcoes_trecho(p_fragmentos int) returns text
language sql immutable as $$
  select format('StartSel="[[[", StopSel="]]]", MaxFragments=%s, MaxWords=28, MinWords=12, FragmentDelimiter="|||"', p_fragmentos)
$$;

-- busca no acervo: documentos visíveis com o termo, quantas páginas casaram e o 1º trecho
create function public.buscar_texto(p_consulta text)
returns table (documento_id uuid, paginas_com_acerto int, primeira_pagina int, trecho text, relevancia real)
language plpgsql stable security invoker set search_path = '' as $$
declare
  q tsquery := public.consulta_pt(p_consulta);
begin
  if q is null or q::text = '' then
    return;
  end if;
  return query
  with hits as (
    select p.documento_id as doc, p.numero, ts_rank(p.tsv, q) as r
    from public.paginas p
    join public.documentos d on d.id = p.documento_id and d.status = 'pronto'
    where p.tsv @@ q
  ), agg as (
    select doc, count(*)::int as n, min(numero) as primeira, sum(r)::real as rel
    from hits group by doc
  )
  select a.doc, a.n, a.primeira,
         ts_headline('public.pt'::regconfig, p.texto, q, public.opcoes_trecho(1)),
         a.rel
  from agg a
  join public.paginas p on p.documento_id = a.doc and p.numero = a.primeira
  order by a.rel desc
  limit 1000;
end $$;

-- busca dentro de um documento: cada página com o termo, nº de ocorrências e até 2 trechos
create function public.buscar_no_documento(p_documento uuid, p_consulta text)
returns table (pagina int, ocorrencias int, trechos text)
language plpgsql stable security invoker set search_path = '' as $$
declare
  q tsquery := public.consulta_pt(p_consulta);
begin
  if q is null or q::text = '' then
    return;
  end if;
  return query
  select p.numero,
         ((length(t.tudo) - length(replace(t.tudo, '[[[', ''))) / 3)::int,
         ts_headline('public.pt'::regconfig, p.texto, q, public.opcoes_trecho(2))
  from public.paginas p
  cross join lateral (
    select ts_headline('public.pt'::regconfig, p.texto, q, 'HighlightAll=true, StartSel="[[[", StopSel="]]]"') as tudo
  ) t
  where p.documento_id = p_documento and p.tsv @@ q
  order by p.numero;
end $$;

-- registro de auditoria: o usuário é sempre quem está logado (não dá para forjar)
create function public.registrar(p_acao text, p_documento uuid default null, p_detalhe text default '')
returns void
language plpgsql security definer set search_path = '' as $$
declare
  ultimo public.auditoria;
begin
  if public.meu_papel() is null then
    raise exception 'Sua sessão terminou. Entre novamente.';
  end if;
  if p_acao not in ('entrou', 'viu', 'baixou', 'imprimiu', 'buscou') and not public.sou_admin() then
    raise exception 'Ação de auditoria não permitida.';
  end if;
  if p_acao not in ('entrou', 'viu', 'baixou', 'imprimiu', 'buscou', 'enviou', 'editou', 'removeu', 'concedeu',
                    'revogou', 'criou_usuario', 'alterou_usuario', 'criou_cliente', 'alterou_cliente', 'cadastro') then
    raise exception 'Ação desconhecida: %', p_acao;
  end if;
  if p_documento is not null and p_acao in ('viu', 'baixou', 'imprimiu') and not public.pode_ver_documento(p_documento) then
    raise exception 'Documento não encontrado ou sem permissão de acesso.';
  end if;
  -- evita registro dobrado (mesma ação repetida em menos de 5 s)
  select * into ultimo from public.auditoria a where a.usuario_id = auth.uid() order by a.em desc limit 1;
  if found and ultimo.acao = p_acao and ultimo.documento_id is not distinct from p_documento
     and ultimo.detalhe = coalesce(p_detalhe, '') and ultimo.em > now() - interval '5 seconds' then
    return;
  end if;
  insert into public.auditoria (usuario_id, acao, documento_id, detalhe)
  values (auth.uid(), p_acao, p_documento, left(coalesce(p_detalhe, ''), 500));
end $$;

-- contadores da tela de clientes (só admin)
create function public.resumo_organizacoes()
returns table (organizacao_id uuid, usuarios int, acessos int, documentos_visiveis int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.sou_admin() then
    raise exception 'Só o administrador pode fazer isso.';
  end if;
  return query
  select o.id,
         (select count(*)::int from public.perfis p where p.organizacao_id = o.id),
         (select count(*)::int from public.acessos a where a.organizacao_id = o.id),
         (select count(*)::int from public.documentos d where public.org_ve(o.id, d))
  from public.organizacoes o;
end $$;

-- depois que a pessoa troca a senha provisória
create function public.senha_trocada() returns void
language sql security definer set search_path = '' as $$
  update public.perfis set trocar_senha = false where id = auth.uid()
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.meu_papel(), public.minha_org(), public.sou_admin(), public.org_ve(uuid, public.documentos),
  public.pode_ver_documento(uuid), public.radical_pt(text), public.consulta_pt(text), public.opcoes_trecho(int),
  public.buscar_texto(text), public.buscar_no_documento(uuid, text),
  public.registrar(text, uuid, text), public.resumo_organizacoes(), public.senha_trocada()
to authenticated;

-- Acervo Municipal · descrição / palavras-chave do documento
-- Texto livre digitado no envio. A busca do acervo procura nele também (além do texto das páginas).

alter table public.documentos add column if not exists descricao text not null default '';

-- índice de busca de título + número + descrição (mesmas regras: português, sem acento)
alter table public.documentos add column if not exists busca_meta tsvector
  generated always as (to_tsvector('public.pt'::regconfig, coalesce(titulo, '') || ' ' || coalesce(numero, '') || ' ' || coalesce(descricao, ''))) stored;
create index if not exists documentos_busca_meta on public.documentos using gin (busca_meta);

-- busca no acervo: casa nas páginas OU na descrição/título. Quem casa nos dois sobe na ordem.
create or replace function public.buscar_texto(p_consulta text)
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
  ), meta as (
    select d.id as doc from public.documentos d
    where d.status = 'pronto' and d.busca_meta @@ q
  ), todos as (
    select coalesce(a.doc, m.doc) as doc, coalesce(a.n, 0) as n, a.primeira,
           (coalesce(a.rel, 0) + case when m.doc is not null then 1 else 0 end)::real as rel
    from agg a full join meta m on m.doc = a.doc
  )
  select t.doc, t.n, t.primeira,
         case when t.primeira is not null
              then ts_headline('public.pt'::regconfig, p.texto, q, public.opcoes_trecho(1))
              else ts_headline('public.pt'::regconfig, d.titulo || ' · ' || d.descricao, q, public.opcoes_trecho(1)) end,
         t.rel
  from todos t
  join public.documentos d on d.id = t.doc
  left join public.paginas p on p.documento_id = t.doc and p.numero = t.primeira
  order by t.rel desc
  limit 1000;
end $$;

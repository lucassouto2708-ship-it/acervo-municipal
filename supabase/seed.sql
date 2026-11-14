-- Acervo Municipal · dados iniciais (rodar depois da migração)
-- Cadastros de partida e o primeiro cliente. Documentos entram pelo app (tela Enviar).

insert into public.tipos_documento (nome) values
  ('Movimento contábil'), ('Minuta contábil'), ('Balancete'), ('Lei'), ('Decreto'), ('Portaria'), ('Contrato')
on conflict (nome) do nothing;

with m as (
  insert into public.municipios (nome, uf) values ('Alpercata', 'MG')
  on conflict (nome, uf) do update set nome = excluded.nome
  returning id
)
insert into public.entidades (municipio_id, nome, sigla)
select m.id, e.nome, e.sigla from m, (values
  ('Instituto de Previdência Municipal de Alpercata', 'IPREMA'),
  ('Prefeitura Municipal de Alpercata', 'Prefeitura'),
  ('Câmara Municipal de Alpercata', 'Câmara')
) as e (nome, sigla)
where not exists (select 1 from public.entidades x where x.municipio_id = m.id and x.sigla = e.sigla);

-- primeiro cliente: IPREMA enxerga tudo da entidade IPREMA
with o as (
  insert into public.organizacoes (nome)
  select 'IPREMA · Instituto de Previdência de Alpercata'
  where not exists (select 1 from public.organizacoes where nome = 'IPREMA · Instituto de Previdência de Alpercata')
  returning id
)
insert into public.acessos (organizacao_id, escopo, alvo_id)
select o.id, 'entidade', e.id from o, public.entidades e where e.sigla = 'IPREMA';

-- ---------------------------------------------------------------------
-- PRIMEIRO ADMINISTRADOR
-- 1. No painel do Supabase: Authentication → Users → Add user → Create new user
--    (e-mail e senha seus, marque "Auto Confirm User").
-- 2. Troque o e-mail abaixo pelo seu e rode só este bloco:
--
-- insert into public.perfis (id, nome, email, papel)
-- select id, 'Lucas Souto', email, 'admin' from auth.users where email = 'SEU-EMAIL-AQUI';
-- ---------------------------------------------------------------------

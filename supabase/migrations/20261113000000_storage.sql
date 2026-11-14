-- Acervo Municipal · arquivos no Supabase Storage (versão demonstração)
-- PDFs e miniaturas num bucket privado. Caminho: <documento_id>/original.pdf | capa.webp | p<N>.webp
-- A regra é a mesma do banco: só lê quem pode ver o documento; só o admin grava ou apaga.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('acervo', 'acervo', false, 52428800, array['application/pdf', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- primeiro pedaço do caminho → uuid do documento (null se não for um uuid)
create or replace function public.documento_do_caminho(p_nome text) returns uuid
language plpgsql immutable as $$
begin
  return split_part(p_nome, '/', 1)::uuid;
exception when others then
  return null;
end $$;
grant execute on function public.documento_do_caminho(text) to authenticated;

drop policy if exists acervo_ler on storage.objects;
drop policy if exists acervo_inserir on storage.objects;
drop policy if exists acervo_alterar on storage.objects;
drop policy if exists acervo_apagar on storage.objects;

create policy acervo_ler on storage.objects for select to authenticated
  using (bucket_id = 'acervo' and ((select public.sou_admin()) or public.pode_ver_documento(public.documento_do_caminho(name))));
create policy acervo_inserir on storage.objects for insert to authenticated
  with check (bucket_id = 'acervo' and (select public.sou_admin()));
create policy acervo_alterar on storage.objects for update to authenticated
  using (bucket_id = 'acervo' and (select public.sou_admin()))
  with check (bucket_id = 'acervo' and (select public.sou_admin()));
create policy acervo_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'acervo' and (select public.sou_admin()));

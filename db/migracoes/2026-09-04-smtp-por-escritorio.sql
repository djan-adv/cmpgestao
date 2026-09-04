-- (cópia versionada da migração aplicada: conta de envio por escritório)
-- Ver o comentário completo na tabela e nas funções no banco.
create table if not exists public.escritorio_smtp (
  escritorio_id uuid primary key references public.escritorios(id) on delete cascade,
  host text not null,
  porta integer not null default 465,
  usuario text not null,
  senha_cif bytea,
  remetente_nome text,
  testado_em timestamptz,
  testado_ok boolean,
  testado_erro text,
  atualizado_em timestamptz not null default now()
);
alter table public.escritorio_smtp enable row level security;

create or replace function public.smtp_set(p_esc uuid, p_host text, p_porta int, p_usuario text,
                                           p_senha text, p_nome text, p_key text)
returns void language sql security definer set search_path to 'public' as $$
  insert into escritorio_smtp(escritorio_id, host, porta, usuario, senha_cif, remetente_nome, atualizado_em)
  values (p_esc, p_host, coalesce(p_porta,465), p_usuario,
          case when p_senha is null or p_senha='' then null else extensions.pgp_sym_encrypt(p_senha, p_key) end,
          p_nome, now())
  on conflict (escritorio_id) do update set
    host = excluded.host, porta = excluded.porta, usuario = excluded.usuario,
    senha_cif = coalesce(excluded.senha_cif, escritorio_smtp.senha_cif),
    remetente_nome = excluded.remetente_nome, atualizado_em = now();
$$;

create or replace function public.smtp_get(p_esc uuid, p_key text)
returns table(host text, porta int, usuario text, senha text, remetente_nome text, testado_ok boolean)
language sql security definer set search_path to 'public' as $$
  select s.host, s.porta, s.usuario,
         case when s.senha_cif is null then null else extensions.pgp_sym_decrypt(s.senha_cif, p_key) end,
         s.remetente_nome, s.testado_ok
  from escritorio_smtp s where s.escritorio_id = p_esc;
$$;

revoke execute on function public.smtp_set(uuid,text,int,text,text,text,text) from public, anon, authenticated;
revoke execute on function public.smtp_get(uuid,text) from public, anon, authenticated;
grant execute on function public.smtp_set(uuid,text,int,text,text,text,text) to service_role;
grant execute on function public.smtp_get(uuid,text) to service_role;

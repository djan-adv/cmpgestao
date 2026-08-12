-- ============================================================================
--  Chat da Equipe — criação do banco de dados
--  Cole este arquivo INTEIRO no SQL Editor do Supabase e clique em "Run".
--  Pode rodar mais de uma vez sem estragar nada (os comandos são idempotentes).
-- ============================================================================

-- ---------- pessoas da equipe ----------
create table if not exists public.usuarios (
  id       uuid primary key references auth.users(id) on delete cascade,
  nome     text,
  email    text,
  cor_chat text
);

-- Quando um usuário é criado no painel do Supabase (Authentication → Add user),
-- esta função cria sozinha a linha correspondente em `usuarios`.
create or replace function public.novo_usuario()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.usuarios (id, email, nome)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nome', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end
$$;
drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.novo_usuario();

-- ---------- mensagens ----------
create table if not exists public.chat_mensagens (
  id              bigint generated always as identity primary key,
  autor_id        uuid not null default auth.uid() references public.usuarios(id),
  autor_nome      text,
  para_id         uuid references public.usuarios(id),  -- vazio = mensagem para "Todos"
  texto           text not null,
  respondendo_a   bigint,                               -- id da mensagem citada
  imagem_anexo_id uuid,                                 -- id em chat_anexos (imagem)
  criado_em       timestamptz not null default now()
);

-- ---------- inscrições de push (o "alarme" no celular) ----------
create table if not exists public.chat_push_subs (
  endpoint  text primary key,
  user_id   uuid not null references public.usuarios(id) on delete cascade,
  p256dh    text not null,
  auth_key  text not null,
  criado_em timestamptz not null default now()
);

-- ---------- imagens/anexos enviados no chat ----------
create table if not exists public.chat_anexos (
  id        uuid primary key default gen_random_uuid(),
  autor_id  uuid references public.usuarios(id),
  nome      text,
  tipo      text,
  tamanho   bigint,
  path      text not null,
  criado_em timestamptz not null default now()
);

-- ---------- segurança (RLS) ----------
alter table public.usuarios       enable row level security;
alter table public.chat_mensagens enable row level security;
alter table public.chat_push_subs enable row level security;
alter table public.chat_anexos    enable row level security;

-- todo mundo logado vê a lista de colegas; cada um só altera a própria cor
drop policy if exists "ver colegas" on public.usuarios;
create policy "ver colegas" on public.usuarios
  for select to authenticated using (true);
drop policy if exists "mudar minha cor" on public.usuarios;
create policy "mudar minha cor" on public.usuarios
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- mensagem do grupo: todos leem; privada: só quem enviou e quem recebeu
drop policy if exists "ler minhas conversas" on public.chat_mensagens;
create policy "ler minhas conversas" on public.chat_mensagens
  for select to authenticated
  using (para_id is null or autor_id = auth.uid() or para_id = auth.uid());
-- só dá para enviar mensagem em nome de si mesmo
drop policy if exists "enviar como eu" on public.chat_mensagens;
create policy "enviar como eu" on public.chat_mensagens
  for insert to authenticated with check (autor_id = auth.uid());

-- chat_push_subs e chat_anexos: só o servidor (service role) mexe.
-- RLS ligado sem nenhuma policy = navegador sem acesso direto. É proposital.

-- ---------- tempo real (mensagem nova aparece sem recarregar) ----------
do $$
begin
  alter publication supabase_realtime add table public.chat_mensagens;
exception when duplicate_object then
  null;  -- já estava adicionada
end
$$;

-- ---------- pasta (bucket) privada para as imagens ----------
insert into storage.buckets (id, name, public)
values ('chat-anexos', 'chat-anexos', false)
on conflict (id) do nothing;

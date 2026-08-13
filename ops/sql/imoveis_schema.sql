-- Schema do site do corretor (djan.net.br) — isolado do escritório (CMP).
--
-- Mesmo raciocínio já adotado para a Inove (ver ops/PROJETO-INOVE.md, seção 4) e
-- para o assinador (ops/MIGRACAO-ASSINADOR.md): banco separado não reduz risco aqui,
-- aumenta (duas fontes de verdade). A isolação real é por schema + role dedicado,
-- sem privilégio nenhum no `public` (dados jurídicos da CMP) — não por disciplina de
-- quem escreve o código, e sim porque o Postgres recusa.
--
-- Rodar este arquivo inteiro no SQL Editor do Supabase do projeto cmpgestao.
-- Depois, definir a senha do role (nunca fica neste arquivo nem no repositório):
--   alter role imoveis_app with password 'escolha-uma-senha-forte-aqui';
-- E colar a connection string resultante em IMOVEIS_DB_URL (.env.local na VPS).

create schema if not exists imoveis;

-- ---------- perfil (linha única, editável pelo painel) ----------
create table if not exists imoveis.perfil (
  id            int primary key default 1 check (id = 1),
  nome          text not null default 'Djan',
  titulo        text not null default 'Corretor e Avaliador de Imóveis',
  creci         text not null default '5401',
  cnai          text not null default '8514',
  bio           text not null default '',
  telefone      text,
  whatsapp      text,
  email         text default 'djan@creci.org.br',
  instagram     text,
  foto_url      text,
  atualizado_em timestamptz not null default now()
);
insert into imoveis.perfil (id) values (1) on conflict (id) do nothing;

-- ---------- imóveis (próprios e de parceria) ----------
create table if not exists imoveis.imoveis (
  id            uuid primary key default gen_random_uuid(),
  tipo          text not null check (tipo in ('proprio','parceria')),
  titulo        text not null,
  descricao     text,
  finalidade    text not null check (finalidade in ('venda','aluguel')),
  categoria     text, -- apartamento, casa, terreno, comercial, rural...
  preco         numeric(14,2),
  endereco      text,
  bairro        text,
  cidade        text,
  uf            text,
  quartos       int,
  banheiros     int,
  vagas         int,
  area_util     numeric(10,2),
  area_total    numeric(10,2),
  fotos         jsonb not null default '[]'::jsonb, -- array de URLs
  destaque      boolean not null default false,
  status        text not null default 'ativo' check (status in ('ativo','inativo','vendido','alugado')),
  parceiro_nome    text, -- preenchido quando tipo = 'parceria'
  parceiro_contato text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists imoveis_imoveis_status_idx on imoveis.imoveis (status, tipo);

-- ---------- anúncios de terceiros (vitrine paga/parceira) ----------
create table if not exists imoveis.anuncios (
  id                 uuid primary key default gen_random_uuid(),
  titulo             text not null,
  descricao          text,
  link_externo       text,
  imagem_url         text,
  anunciante_nome    text,
  anunciante_contato text,
  ativo              boolean not null default true,
  criado_em          timestamptz not null default now()
);

-- ---------- leads (avaliação, interesse em imóvel, parceria, contato geral) ----------
create table if not exists imoveis.leads (
  id              uuid primary key default gen_random_uuid(),
  tipo            text not null check (tipo in ('avaliacao','imovel','parceria','contato')),
  nome            text not null,
  telefone        text,
  email           text,
  imovel_id       uuid references imoveis.imoveis(id) on delete set null,
  endereco_imovel text, -- imóvel a avaliar, quando tipo = 'avaliacao'
  mensagem        text,
  status          text not null default 'novo' check (status in ('novo','em_andamento','concluido')),
  ip              text,
  criado_em       timestamptz not null default now()
);
create index if not exists imoveis_leads_status_idx on imoveis.leads (status, criado_em desc);

-- ---------- sessão do admin (login único, ver app/api/imoveis/lib.js) ----------
create table if not exists imoveis.sessoes (
  token      text primary key,
  criado_em  timestamptz not null default now(),
  expira_em  timestamptz not null,
  ip         text
);

-- ---------- role da aplicação: tudo no schema imoveis, nada no public ----------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'imoveis_app') then
    create role imoveis_app login;
  end if;
end
$$;

grant usage on schema imoveis to imoveis_app;
grant all on all tables in schema imoveis to imoveis_app;
grant all on all sequences in schema imoveis to imoveis_app;
alter default privileges in schema imoveis grant all on tables to imoveis_app;
alter default privileges in schema imoveis grant all on sequences to imoveis_app;
-- de propósito: nenhum grant em `public` — sem isso, imoveis_app não enxerga
-- nem lê nada dos dados jurídicos da CMP.

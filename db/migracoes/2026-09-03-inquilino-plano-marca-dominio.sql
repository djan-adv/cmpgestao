-- Fundação multi-inquilino, passo 2: o escritório vira um CADASTRO de verdade
-- (plano, limites, marca, domínio) e o acesso ganha níveis.
--
-- Antes: escritorios tinha nome, subdominio, plano e raiz — e "plano" era texto
-- solto ('ativo', 'trial'), sem limite nenhum. Vender por assentos e por volume
-- de processos exige que o limite seja DADO, não código: aumentar preço ou
-- mudar oferta não pode virar deploy, e quem contratou antes tem de manter o
-- que contratou sem gambiarra.

begin;

-- ------------------------------------------------------------- ESCRITÓRIOS
alter table public.escritorios
  -- Endereços que levam a este escritório. É uma LISTA porque o mesmo
  -- inquilino costuma ter dois: o subdomínio de fábrica (jose.djan.app.br) e,
  -- depois, o domínio próprio (joseadvocacia.com.br). Os dois convivem.
  add column if not exists hosts text[] not null default '{}',
  add column if not exists ativo boolean not null default true,
  -- Limites do plano, gravados no ato da contratação. Nulo = sem limite.
  add column if not exists limite_acessos integer,
  add column if not exists limite_processos integer,
  -- Espaço em disco. Os documentos NÃO ficam no Supabase: ficam no disco do
  -- VPS (/opt/cmpdocs), que é finito e é o gargalo real do produto. Cobrar por
  -- GB só faz sentido se o sistema souber medir e travar — senão um cliente
  -- pesado consome o disco de todos.
  add column if not exists limite_gb numeric,
  -- Módulos ligados. Nulo = tudo ligado (é o caso dos primeiros clientes, que
  -- recebem o sistema inteiro). Depois, restringir é gravar uma chave aqui.
  add column if not exists modulos jsonb,
  -- Marca: nome que aparece no lugar de "CMPGestão", cor e logo.
  add column if not exists marca jsonb,
  add column if not exists criado_em_por uuid;

comment on column public.escritorios.hosts is
  'Endereços que apontam para este escritório (subdominio de fabrica e dominio proprio).';
comment on column public.escritorios.modulos is
  'Nulo = todos os modulos liberados. Objeto = liga/desliga por chave.';

-- Busca por endereço tem de ser exata e rápida: é feita a cada carregamento de
-- página, antes mesmo do login.
create index if not exists escritorios_hosts_idx on public.escritorios using gin (hosts);

-- Os dois escritórios que já existem passam a ter endereço declarado.
-- (a CMP responde pelo endereço atual; o de demonstração fica como está)
update public.escritorios
   set hosts = array['djan.app.br','www.djan.app.br']
 where raiz and cardinality(hosts) = 0;

-- ---------------------------------------------------------------- USUÁRIOS
alter table public.usuarios
  -- Níveis de acesso. Os valores antigos continuam valendo: 'socio' é o dono
  -- na CMP, 'adv'/'est' já existiam, 'membro' é da Inove. O nível novo é
  -- 'contratante': quem assinou o contrato e manda no PRÓPRIO escritório —
  -- é ele quem cadastra a equipe, no lugar do e-mail do dono do sistema
  -- chumbado no código (ACESSOS_ALLOW).
  add column if not exists trocar_senha boolean not null default false,
  add column if not exists ativo boolean not null default true,
  add column if not exists criado_por uuid;

comment on column public.usuarios.trocar_senha is
  'Senha provisoria: obriga a trocar no primeiro login. Quem gerou a senha nao fica sabendo dela depois.';

-- O contratante de cada escritório. Um por escritório — é quem responde pelo
-- contrato e quem paga; os demais são equipe dele.
create unique index if not exists usuarios_um_contratante_por_escritorio
  on public.usuarios (escritorio_id) where papel = 'contratante';

-- Quem é o contratante do MEU escritório? Usada pelas políticas e pela API de
-- acessos, no lugar da lista de e-mails fixa que existia no código.
create or replace function public.sou_contratante()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists(
    select 1 from public.usuarios u
    where u.id = auth.uid() and u.papel in ('contratante','socio')
  )
$$;
revoke execute on function public.sou_contratante() from public;
grant execute on function public.sou_contratante() to authenticated, service_role;

commit;

-- ============================================================================
-- Parte 3 — o cadastro do escritório é SÓ DE LEITURA para o navegador.
--
-- A política que existia era `for all` (id = meu_escritorio()): o usuário lia e
-- TAMBÉM escrevia a própria linha. Num sistema de um escritório só isso não
-- fazia diferença. Vendendo, faz toda: o contratante abriria o console do
-- navegador e daria a si mesmo assentos ilimitados, ou ligaria o canal de
-- e-mail — que usa a caixa do fornecedor — e passaria a mandar mensagem em
-- nome de outra pessoa. Plano e limites passam a mudar só pela chave de
-- serviço, em /api/escritorios.
-- ============================================================================

drop policy if exists esc_self on public.escritorios;

create policy esc_self_leitura
  on public.escritorios for select to authenticated
  using (id = public.meu_escritorio());

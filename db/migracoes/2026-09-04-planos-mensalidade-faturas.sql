-- Planos, mensalidade e faturas.
--
-- Até aqui "plano" era texto livre ('ativo', 'trial', 'pago') e não havia onde
-- guardar quanto o escritório paga. Vender exige as duas coisas: o degrau
-- contratado (que define os limites) e o valor combinado — com desconto e
-- pausa, que existem na vida real e, sem lugar próprio, acabam virando
-- combinação de boca que ninguém lembra depois.
--
-- Os limites ficam gravados no escritório, não no código do plano: quem
-- contratou o Full de hoje mantém o Full de hoje quando o plano mudar de
-- conteúdo. O código do plano serve para saber em que degrau a pessoa entrou.

begin;

alter table public.escritorios
  add column if not exists plano_codigo text,          -- full | intermediario | starter
  add column if not exists mensalidade numeric,        -- valor combinado, em reais
  add column if not exists desconto numeric,           -- abatimento fixo mensal
  add column if not exists pausa_ate date,             -- cobrança suspensa até esta data
  add column if not exists suspenso_em timestamptz,    -- quando o acesso foi suspenso
  add column if not exists suspenso_motivo text,
  add column if not exists observacoes text,
  -- Dados do escritório que aparecem nas peças e nos e-mails dele. Ficam num
  -- objeto só porque são cadastro, não estrutura: acrescentar um campo não
  -- pode virar migração.
  add column if not exists dados jsonb;

comment on column public.escritorios.plano_codigo is
  'Degrau contratado. Os limites valem os gravados no proprio escritorio: mudar o conteudo de um plano nao mexe em quem ja assinou.';
comment on column public.escritorios.pausa_ate is
  'Cobranca pausada ate esta data. O acesso continua; o que para e a fatura.';
comment on column public.escritorios.dados is
  'Cadastro do escritorio (endereco, telefone, e-mail, CNPJ, OAB) usado nas pecas e nos e-mails dele.';

-- ----------------------------------------------------------------- FATURAS
create table if not exists public.faturas (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references public.escritorios(id) on delete cascade,
  competencia text not null,                 -- '2026-09'
  valor numeric not null,
  vencimento date not null,
  status text not null default 'aberta',     -- aberta | paga | cancelada | isenta
  pago_em timestamptz,
  cora_id text,                              -- id da cobranca no Cora
  link text,                                 -- boleto/pix
  observacao text,
  criado_em timestamptz not null default now(),
  unique (escritorio_id, competencia)
);

comment on table public.faturas is
  'Mensalidades do sistema. So a raiz le e escreve (o inquilino ve as dele por rota do servidor).';

-- A fatura é assunto entre o dono do sistema e o cliente: não pode ficar
-- exposta ao navegador de ninguém. Sem política — quem lê é o servidor, com a
-- chave de serviço, que decide o que cada lado enxerga.
alter table public.faturas enable row level security;

create index if not exists faturas_escritorio_idx on public.faturas (escritorio_id, competencia desc);

commit;

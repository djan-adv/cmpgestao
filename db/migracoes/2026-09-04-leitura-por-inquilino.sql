-- Leitura por inquilino: e-mail que chega, diário e status dos robôs.
--
-- O envio já era do escritório (escritorio_smtp). A LEITURA continuava sendo de
-- uma casa só: a caixa lida por IMAP era a do dono do sistema, o estado do IMAP
-- morava numa linha única (id = 1) e o resultado de cada robô ficava em
-- cron_exec, também sem dono. Num sistema vendido isso significa três coisas
-- ruins de uma vez: o escritório cliente não recebe as respostas das varas
-- dele, o painel de robôs mostraria a rodada do fornecedor como se fosse dele,
-- e um e-mail da caixa do fornecedor podia cair na ficha de um cliente.

-- 1. Conta de leitura. O servidor de IMAP quase sempre é o mesmo host do SMTP
--    com "smtp." trocado por "imap.", e é isso que o sistema assume quando o
--    campo fica em branco — mas provedor que foge da regra precisa poder dizer.
alter table public.escritorio_smtp add column if not exists imap_host text;
alter table public.escritorio_smtp add column if not exists imap_porta integer;

-- 2. Até onde já lemos a caixa DE CADA escritório. Sem isto, dois escritórios
--    dividiriam o mesmo "último UID lido" e um faria o outro pular mensagens.
create table if not exists public.email_imap_estado_esc (
  escritorio_id uuid primary key references public.escritorios(id) on delete cascade,
  uidvalidity bigint,
  ultima_uid bigint not null default 0,
  ultima_checagem timestamptz,
  ultimo_resultado text
);
alter table public.email_imap_estado_esc enable row level security;

-- A raiz já vinha lendo a caixa dela: herda o ponto onde parou, senão a próxima
-- rodada reimportaria os últimos dias inteiros.
insert into public.email_imap_estado_esc (escritorio_id, uidvalidity, ultima_uid, ultima_checagem, ultimo_resultado)
select e.id, s.uidvalidity, s.ultima_uid, s.ultima_checagem, s.ultimo_resultado
  from public.escritorios e cross join public.email_imap_estado s
 where e.raiz = true and s.id = 1
on conflict (escritorio_id) do nothing;

-- 3. Resultado dos robôs que rodam UMA VEZ POR ESCRITÓRIO. cron_exec continua
--    guardando a rodada inteira (a visão do fornecedor); aqui fica a linha de
--    cada escritório, que é o que o escritório tem direito de ver.
create table if not exists public.robo_exec_esc (
  escritorio_id uuid not null references public.escritorios(id) on delete cascade,
  nome text not null,
  ultima_exec timestamptz,
  ultimo_ok boolean,
  ultimo_resultado text,
  atualizado_em timestamptz not null default now(),
  primary key (escritorio_id, nome)
);
alter table public.robo_exec_esc enable row level security;

drop policy if exists robo_exec_esc_sel on public.robo_exec_esc;
create policy robo_exec_esc_sel on public.robo_exec_esc
  for select using (escritorio_id = public.meu_escritorio() or public.sou_raiz());

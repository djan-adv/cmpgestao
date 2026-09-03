-- Robôs por inquilino, parte 1: o que cada escritório procura no diário.
--
-- O robô do DJEN buscava publicações por uma lista de OAB ESCRITA NO CÓDIGO —
-- as inscrições do dono do sistema (5219/SE, 5219/PB, 46268/CE, 73003/BA,
-- 59426/PE). Num sistema de um escritório só isso era natural. Vendendo, é o
-- robô do cliente procurando as publicações do fornecedor: o cliente não
-- recebe nada e ainda paga pela varredura alheia.
--
-- A OAB passa a ser cadastro do escritório. A lista da CMP entra aqui como
-- dado (é o mesmo conteúdo que estava no código, não há nada inventado).

begin;

alter table public.escritorios
  add column if not exists oabs jsonb not null default '[]'::jsonb;

comment on column public.escritorios.oabs is
  'Inscricoes da OAB usadas na varredura do DJEN: [{"numero":"5219","uf":"PB"}]. Vazio = escritorio nao e varrido por OAB.';

update public.escritorios
   set oabs = '[{"numero":"5219","uf":"SE"},{"numero":"5219","uf":"PB"},{"numero":"46268","uf":"CE"},{"numero":"73003","uf":"BA"},{"numero":"59426","uf":"PE"}]'::jsonb
 where raiz and oabs = '[]'::jsonb;

commit;

-- ============================================================================
-- Parte 2 — gravar andamento DENTRO de um escritório.
--
-- robot_add_andamento e robot_add_andamento_fonte procuravam o processo assim:
--     select id from processos where numero_digitos = p_num limit 1
-- Sem escritório e com limit 1. Número de processo se repete entre tribunais,
-- então com dois inquilinos a publicação de um cairia na ficha do outro. Pelo
-- navegador era pior: um usuário logado gravava movimento em processo de outro
-- escritório mandando o número dele.
--
-- Agora existe robot_add_andamento_esc(p_esc, ...), exclusiva do servidor, e a
-- versão chamada pelo navegador virou um invólucro que força meu_escritorio().
-- ============================================================================

create or replace function public.robot_add_andamento_esc(
  p_esc uuid, p_num text, p_data date, p_texto text,
  p_fonte text default 'djen', p_tipo text default 'publicacao')
returns text language plpgsql security definer set search_path to 'public' as $$
declare v_pid uuid;
begin
  if p_esc is null then return 'sem_escritorio'; end if;
  select id into v_pid from processos
   where numero_digitos = p_num and escritorio_id = p_esc limit 1;
  if v_pid is null then return 'sem_processo'; end if;
  if exists (
    select 1 from andamentos
     where processo_id = v_pid and texto = p_texto and data is not distinct from p_data
  ) then return 'existe'; end if;
  insert into andamentos(processo_id, data, texto, tipo, fonte)
  values (v_pid, p_data, p_texto, coalesce(nullif(p_tipo,''),'publicacao'), coalesce(nullif(p_fonte,''),'djen'));
  update processos set ultima_movimentacao = p_data
   where id = v_pid and (ultima_movimentacao is null or ultima_movimentacao < p_data);
  return 'inserido';
end $$;

revoke execute on function public.robot_add_andamento_esc(uuid,text,date,text,text,text) from public, anon;
grant  execute on function public.robot_add_andamento_esc(uuid,text,date,text,text,text) to service_role;

create or replace function public.robot_add_andamento_fonte(
  p_num text, p_data date, p_texto text, p_fonte text)
returns text language plpgsql security definer set search_path to 'public' as $$
begin
  return public.robot_add_andamento_esc(
    public.meu_escritorio(), p_num, p_data, p_texto,
    coalesce(nullif(p_fonte,''),'jusbr'), 'movimento');
end $$;

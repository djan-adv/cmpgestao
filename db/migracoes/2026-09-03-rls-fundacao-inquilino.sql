-- Fundação multi-inquilino, passo 1: fechar o banco antes de existir um segundo
-- escritório dentro dele.
--
-- Motivo: 6 tabelas estavam com Row Level Security DESLIGADA — com a chave anon
-- (que é pública, vai no navegador) qualquer pessoa lia e escrevia nelas. Outras
-- 5 tinham escritorio_id mas nenhuma política, o que dá no mesmo assim que a RLS
-- for ligada de verdade. Entre elas, jusbr_sessao: onde ficam os tokens do jus.br.
--
-- Critério usado em cada tabela:
--   - o navegador escreve nela?  -> política por inquilino (escritorio_id = meu_escritorio())
--   - só o servidor toca nela?   -> RLS ligada e NENHUMA política (a chave de
--                                   serviço ignora RLS; anon e authenticated ficam de fora)
-- Conferido arquivo por arquivo antes de escrever isto: das 11, só
-- agenda_google_lixeira é gravada pelo navegador (public/sistema.html).

begin;

-- ---------------------------------------------------------------- 1) RLS ligada
alter table public.notificacoes_jader          enable row level security;
alter table public.avisos_app_fila             enable row level security;
alter table public.portal_processos_coletivos  enable row level security;
alter table public.robo_avisos_cliente         enable row level security;
alter table public.agenda_google_lixeira       enable row level security;
alter table public.portal_convites             enable row level security;

-- --------------------------------------------- 2) a única que o navegador grava
-- Fila de exclusão do Google Calendar: quem apaga o evento é o navegador, que não
-- tem o token do Google; o robô google-sync executa depois. Cada escritório só
-- enxerga e alimenta a própria fila.
drop policy if exists inquilino_agenda_google_lixeira on public.agenda_google_lixeira;
create policy inquilino_agenda_google_lixeira
  on public.agenda_google_lixeira for all to authenticated
  using      (escritorio_id = public.meu_escritorio())
  with check (escritorio_id = public.meu_escritorio());

-- ------------------------------------------- 3) só servidor: sem política mesmo
-- Ficam acessíveis apenas pela chave de serviço, que roda no servidor. Guardam
-- token do jus.br, token de convite e token de redefinição de senha do portal —
-- nada disso pode ser lido pelo navegador nem pelo dono do próprio escritório.
comment on table public.jusbr_sessao is
  'Somente servidor (chave de serviço). RLS ligada sem política: guarda token/refresh do jus.br cifrados.';
comment on table public.convites is
  'Somente servidor (chave de serviço). RLS ligada sem política: token de convite vale como credencial.';
comment on table public.portal_reset is
  'Somente servidor (chave de serviço). RLS ligada sem política: token de redefinição de senha do portal.';

-- (jusbr_sessao, convites, portal_reset, portal_varredura_avisos e salas_reuniao
--  já estavam com RLS ligada e sem política — ficam como estão, agora por decisão
--  registrada e não por esquecimento.)

-- ------------------------------------- 4) endurecer as funções de segurança
-- SECURITY DEFINER sem search_path fixo é porta de entrada clássica: quem puder
-- criar um schema no caminho de busca troca o significado de "usuarios" dentro da
-- função. Mesmo corpo de antes, só com o caminho travado.
create or replace function public.meu_escritorio()
returns uuid language sql stable security definer set search_path to 'public' as $$
  select escritorio_id from public.usuarios where id = auth.uid()
$$;

create or replace function public.sou_inove()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists(
    select 1 from public.inove_membros m
    where lower(m.email) = lower(coalesce(auth.jwt()->>'email',''))
  )
$$;

commit;

-- ============================================================================
-- Parte 2 — funções que estavam abertas pela API pública (/rest/v1/rpc/...)
--
-- O linter do Supabase apontou 14 funções SECURITY DEFINER chamáveis com a chave
-- anon, que é pública. Duas eram graves de verdade:
--   jusbr_get_sessao / jusbr_set_sessao / jusbr_apos_refresh -> mexem no token do jus.br
--   robot_add_andamento -> qualquer um inseria andamento em qualquer processo
--
-- Conferido antes de revogar: o navegador só chama TRÊS funções
-- (chat_marcar_lido, chat_ocultar_para_mim, robot_add_andamento_fonte). Essas
-- continuam liberadas para quem está logado e são fechadas só para o anônimo.
-- As demais viram exclusivas do servidor (chave de serviço).
--
-- Ficam de fora de propósito: meu_escritorio(), sou_raiz(), sou_inove() e
-- chat_so_privado() são usadas DENTRO das políticas de RLS — revogar o EXECUTE
-- delas derruba as consultas de quem está logado, não protege nada.
-- ============================================================================

do $$
declare f record;
begin
  -- só servidor: ninguém no navegador chama
  for f in
    select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'jusbr_get_sessao','jusbr_set_sessao','jusbr_apos_refresh','jusbr_limpar_expirados',
      'jusbr_get_token','jusbr_set_token','robot_add_andamento','wa_incr_nao_lidas',
      'ia_gasto_mes','portal_processos','portal_processos_ids','portal_acessos_do_processo',
      'portal_contato_por_nome','portal_previa_por_nome','portal_ultima_mov','portal_norm')
  loop
    -- REVOKE de anon/authenticated sozinho NAO adianta: o EXECUTE vem de um
    -- privilegio dado ao PUBLIC, que continua valendo. Tira do PUBLIC e devolve
    -- so para quem precisa.
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant  execute on function %s to service_role', f.sig);
  end loop;

  -- usadas pelo navegador de quem está logado: fecha só para o anônimo
  for f in
    select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'robot_add_andamento_fonte','chat_marcar_lido','chat_ocultar_para_mim')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant  execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;

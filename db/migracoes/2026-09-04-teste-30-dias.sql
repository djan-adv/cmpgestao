-- Teste de 30 dias, com teto que o sistema sabe fazer valer.
--
-- A oferta é: o escritório entra e usa o sistema INTEIRO por 30 dias. Não se
-- escolhe plano para testar — escolhe-se na hora de contratar. Nada é apagado
-- no fim: o acesso para, o acervo fica, e quando o boleto é pago tudo reaparece
-- como estava.
--
-- O que o teste limita é tamanho, não função: 10 acessos, 200 processos, 1 GB.
-- Esses números existem para que um teste não consuma o disco e o banco de
-- todos os outros — e por isso PRECISAM ser aplicados de verdade. Até aqui
-- `limite_processos` só era conferido nas rotas do servidor, e `limite_gb` não
-- era conferido em lugar nenhum: o cadastro avulso, que vai do navegador
-- direto ao banco pela RLS, passava por cima do teto sem que ninguém visse.
-- Teto que o cliente atravessa sem perceber não é teto: é promessa.

begin;

-- ------------------------------------------------------------- ESCRITÓRIOS
alter table public.escritorios
  -- Fim do período de teste. Nulo = não está em teste (contratado, ou a raiz).
  add column if not exists teste_ate date,
  -- Até quando os robôs continuam COLETANDO depois de o acesso ser bloqueado.
  -- É a carência que existe para não transformar fim de teste em prazo
  -- perdido: o escritório não entra, mas o diário continua sendo varrido e
  -- guardado. Quando ele paga, o histórico do período está lá, inteiro.
  add column if not exists coleta_ate date,
  -- Teto de gasto com IA no mês, em reais, POR ESCRITÓRIO. Nulo = sem teto
  -- próprio (é o caso da raiz e de quem contratou com IA inclusa). O teto
  -- global de `ia_config` continua valendo por cima: este aqui existe para que
  -- um escritório não consuma sozinho o orçamento de IA de todos os outros.
  add column if not exists ia_teto_brl numeric;

comment on column public.escritorios.teste_ate is
  'Fim do periodo de teste. Nulo = nao esta em teste.';
comment on column public.escritorios.coleta_ate is
  'Carencia: ate quando os robos coletam mesmo com o acesso bloqueado. Evita que fim de teste vire prazo perdido.';
comment on column public.escritorios.ia_teto_brl is
  'Teto mensal de IA deste escritorio, em reais. Nulo = sem teto proprio.';

-- --------------------------------------------------- TETO DE PROCESSOS (BD)
-- O teto tem de morar no banco porque nem todo cadastro passa pelo servidor:
-- a tela grava processo direto pela RLS. Conferir só nas rotas deixaria o
-- caminho mais usado sem porteiro.
create or replace function public.processos_teto()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  lim integer;
  em_teste boolean;
  usados integer;
begin
  select limite_processos, teste_ate is not null
    into lim, em_teste
    from public.escritorios where id = new.escritorio_id;
  -- Nulo = sem teto. É o caso da raiz e o de quem contratou sem limite.
  if lim is null then return new; end if;

  select count(*) into usados from public.processos where escritorio_id = new.escritorio_id;
  if usados >= lim then
    -- A mensagem aparece INTEIRA na tela de quem tentou cadastrar, então é
    -- escrita para ser lida por advogado, não por programador: diz o que houve,
    -- garante que nada se perdeu e propõe o passo seguinte. Quem bateu no teto
    -- está usando o sistema — é o melhor momento que existe para propor o plano,
    -- e o pior possível para um "não" seco.
    raise exception '%',
      case when em_teste
        then 'O teste chegou ao limite de processos (' || lim || '). Nada foi apagado: tudo o que já está cadastrado continua onde está. Para continuar de onde parou, é só contratar um plano — os limites sobem na hora, sem nenhuma migração.'
        else 'O plano chegou ao limite de processos (' || lim || '). Nada foi apagado: tudo o que já está cadastrado continua onde está. Para ampliar, fale com quem cuida do contrato: o plano maior vale a partir do mesmo dia.'
      end
      using errcode = 'check_violation';
  end if;
  return new;
end
$$;

comment on function public.processos_teto() is
  'Faz valer escritorios.limite_processos tambem no cadastro feito pela tela (RLS), nao so nas rotas do servidor.';

drop trigger if exists processos_teto_tg on public.processos;
create trigger processos_teto_tg
  before insert on public.processos
  for each row execute function public.processos_teto();

-- A contagem do teto roda a cada inserção: sem índice por escritório ela vira
-- varredura da tabela inteira no cadastro em lote.
create index if not exists processos_escritorio_idx on public.processos (escritorio_id);

-- ------------------------------------------------------- GASTO DE IA POR ESC
-- Já existe `ia_gasto_mes()` para o teto global. Este é o mesmo cálculo,
-- recortado por escritório — é o que permite dizer "o teste gastou R$ 12 dos
-- R$ 30" em vez de descobrir no extrato do cartão.
create or replace function public.ia_gasto_mes_esc(p_esc uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(custo_usd), 0)::numeric
    from public.ia_uso
   where escritorio_id = p_esc
     and criado_em >= date_trunc('month', (now() at time zone 'America/Sao_Paulo'))
$$;

comment on function public.ia_gasto_mes_esc(uuid) is
  'Gasto de IA do escritorio no mes corrente (USD), mesmo fuso e mesmo recorte de ia_gasto_mes().';

-- ------------------------------------------- A SUSPENSÃO PASSA A VALER MESMO
-- Descoberta ao construir o fim do teste: `escritorios.ativo` não era
-- conferido em lugar nenhum da RLS. O botão "Suspender" do painel-mãe existia
-- desde o começo, mudava a coluna — e o escritório suspenso continuava lendo e
-- gravando tudo pelo navegador, porque `meu_escritorio()` só olhava o vínculo
-- do usuário. Bloqueio que não bloqueia é pior do que bloqueio nenhum: dá
-- confiança falsa a quem apertou o botão.
--
-- Aqui a suspensão passa a valer no lugar onde não se contorna. De quebra, o
-- usuário DESATIVADO também deixa de ter acesso ao banco — até aqui, tirar o
-- acesso de alguém na tela de Acessos não tirava a chave dele do banco.
--
-- Os robôs não são afetados: eles usam a chave de serviço, que não passa por
-- RLS. É isso que permite a carência de coleta continuar funcionando com o
-- escritório bloqueado.
create or replace function public.meu_escritorio()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select u.escritorio_id
    from public.usuarios u
    join public.escritorios e on e.id = u.escritorio_id
   where u.id = auth.uid()
     and coalesce(u.ativo, true)
     and coalesce(e.ativo, true)
$function$;

comment on function public.meu_escritorio() is
  'Escritorio do usuario logado, base de toda a RLS. Devolve NULL quando o escritorio esta suspenso ou o usuario desativado: e o que faz a suspensao valer no banco, e nao so na tela.';

commit;

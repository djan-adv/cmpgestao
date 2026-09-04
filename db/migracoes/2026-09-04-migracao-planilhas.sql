-- Área de migração: registro de cada importação de planilha.
--
-- Existe por um motivo só: para a migração ser reversível. O escritório que sai
-- de outro sistema traz mil processos numa planilha que ele nunca conferiu
-- coluna por coluna; se o resultado sair torto, "conserte na mão" não é
-- resposta. Guardando quais fichas ESTA importação criou, dá para desfazer
-- exatamente ela — sem tocar no que já existia antes e sem apagar nada que a
-- equipe tenha mexido depois.
--
-- Também é o histórico: quem importou, quando, com qual mapa de colunas e o que
-- ficou de fora (e por quê).
create table if not exists public.migracoes (
  id uuid primary key default gen_random_uuid(),
  escritorio_id uuid not null references public.escritorios(id) on delete cascade,
  criado_por uuid,
  criado_por_nome text,
  criado_em timestamptz not null default now(),
  arquivo text,
  mapa jsonb,                                  -- coluna da planilha -> campo do sistema
  lote_id uuid,                                -- lote criado para separar o acervo migrado
  linhas int not null default 0,
  criados int not null default 0,
  atualizados int not null default 0,
  ignorados int not null default 0,
  recusadas jsonb not null default '[]'::jsonb, -- linha + motivo, para o advogado conferir
  processos_ids uuid[] not null default '{}',   -- só o que ESTA importação criou
  desfeita_em timestamptz,
  desfeitos int
);
create index if not exists migracoes_esc_idx on public.migracoes(escritorio_id, criado_em desc);

alter table public.migracoes enable row level security;

-- Leitura: só o próprio escritório vê as próprias migrações. A escrita é toda
-- pela rota (service_role), que já confere papel e limite do plano — deixar o
-- navegador gravar aqui seria deixar o contador de "o que esta importação
-- criou" à mercê de quem quisesse reescrevê-lo.
drop policy if exists migracoes_sel on public.migracoes;
create policy migracoes_sel on public.migracoes
  for select using (escritorio_id = public.meu_escritorio() or public.sou_raiz());

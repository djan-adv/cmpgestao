-- BANCO DO ASSINADOR (projeto separado: fjboytucivmdykkfpdhs)
--
-- Os documentos não tinham dono — o assinador nasceu para um escritório só. A
-- tela de assinaturas listava TODOS os documentos de TODOS os escritórios:
-- procuração e contrato de cliente de uma banca visíveis para outra.
--
-- O escritório vem do banco do sistema (outro projeto), então aqui é só um uuid
-- guardado; não há chave estrangeira possível. Quem garante o isolamento é o
-- servidor, em /api/assinatura, único caminho até estas tabelas.

alter table public.documentos
  add column if not exists escritorio_id uuid;

comment on column public.documentos.escritorio_id is
  'Escritorio dono do documento (uuid vindo do banco do sistema). Filtro obrigatorio em /api/assinatura.';

create index if not exists documentos_escritorio_idx on public.documentos (escritorio_id, criado_em desc);

-- os documentos que já existiam são todos do escritório que criou o sistema
update public.documentos
   set escritorio_id = '908f77fc-19f5-4d86-9576-f5590af09e0a'
 where escritorio_id is null;

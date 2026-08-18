# Projeto Inove — portal do perito com acesso aos documentos do jus.br

**Status:** especificado, nada executado. Levantamento e decisões de 04/08/2026.

A Inove Consultoria Atuarial atua como **perito/atuário**. Tem 2 processos próprios
(Italo e Impa) e cerca de 40 de terceiros que administra nessa qualidade. Todos os
processos cadastrados no nosso sistema são tratados como **processos do escritório** —
a Inove é **um único cliente**, não um escritório à parte.

---

## 1. O que existe hoje

| Peça | Estado |
|---|---|
| `public/inove.html` | Portal do Perito no ar: login por Supabase Auth, processos, kanban, cadastros nos TJs, solicitações, documento-padrão, plano |
| `processos` com `inove = true` | **42 registros** |
| Portal do Cliente (`public/portal.html` + `app/api/portal/`) | Login e-mail/senha próprio, sessão pelo servidor, chat por processo com histórico, entrega de PDF do jus.br, push |
| `jusbr_arquivos` | 2.678 documentos indexados; arquivos em `/opt/cmpdocs` na VPS |
| `etiquetas` / `processo_etiquetas` | Tabelas existem e estão **vazias**. No `sistema.html` a etiqueta só vive em memória (`LABELS = []`, `initEtiquetas()` é vazia) — **não persiste** |
| `hon_per_fixado`, `hon_per_recebido`, `hon_per_areceber` | Colunas de honorário pericial já existem em `processos` |
| `inove_quesitos`, `inove_config`, `inove_membros`, `inove_tarefas`, `inove_solicitacoes`, `inove_tribunais`, `inove_upgrades` | Tabelas já criadas |
| `pdf-lib` | Já é dependência (`app/api/jusbr/lib.js`, `integra/core.js`) — serve para a tarja |

## 2. Decisões já tomadas

1. **Só os 42 processos.** A planilha deles tem 233 (PB 108, PE 51, BA 46, MG 12,
   RN 11, outros 5), mas só os 42 do nosso sistema estão ativos. O resto **não entra
   e não baixa nada**. A planilha serve como referência de campo e vocabulário.
2. **Podem cadastrar mais 20.** Teto de 62. No 63º: bloqueio com aviso para eles e
   alerta para o escritório.
3. **Etiquetas no lugar de fase.** O campo Fase some da tela deles.
4. **Aba "Plano" bloqueada** — sai da navegação e da rota. Não pode parecer cobrança.
5. **5→10 acessos**, autogeridos por eles — mas não por qualquer um: só o
   **controlador** cria, edita ou desativa. **Adicionado em 05/08/2026, tarde:**
   `inove.acessos.controlador`, boolean. O primeiro acesso não-oculto que Djan
   cadastra vira controlador sozinho, na hora do insert. Quem cria um acesso não
   digita senha — o servidor gera (`gerarSenha()`) e manda por e-mail
   (`enviarAcessoInove`, mesmo motor do Portal do Cliente), no espírito de
   "esqueci senha": a pessoa já recebe pronta pra entrar. Uma trava impede zerar
   o número de controladores (sempre sobra um, além do oculto), pra não travar a
   Inove sem ninguém que possa administrar. O acesso do desenvolvedor fica
   **oculto** da lista.
6. **Inove = um cliente só.**
7. **Chat na barra lateral esquerda.** **Revisto em 05/08/2026: o chat é conversa
   interna da Inove — NÃO é espelhado no `sistema.html` do escritório.** A redação
   anterior (falar com o sistema como cliente, qualquer pessoa logada no Gestão
   responde) está cancelada; não reimplementar sem confirmar.

## 3. Modelo de login — decidido

**Portal-style:** e-mail e senha em `inove.acessos`, sessão validada no servidor
(`inove.sessoes`), navegador nunca fala com o Supabase. Mesmo desenho de
`app/api/portal/`.

É o que sustenta a tarja e o log: todo documento passa por rota nossa. Com Supabase
Auth no navegador, quem tivesse a chave publishable pegaria o arquivo por fora da
rota que carimba, e a tarja viraria decorativa.

Custo aceito: migrar o login que hoje está no `inove.html`.

## 4. Isolamento — schema `inove`

Mesmo raciocínio adotado para o assinador (`ops/MIGRACAO-ASSINADOR.md`), e pelo mesmo
motivo: banco separado **não** reduz bug aqui, aumenta. Os 42 processos e os 2.678
documentos vivem no banco do Gestão e são alimentados pelos crons de lá. Banco à parte
significaria espelhar os 42 — duas fontes de verdade — ou consultar pela rede e manter
o mesmo acoplamento pagando US$ 10/mês.

```
banco cmpgestao (ndeqlyrydcijbgjiviuw)
├── public/       ← o Gestão
├── inove/        ← esta obra
└── assinatura/   ← obra separada
```

**Role dedicado `inove_app`** — criado, com privilégio total no schema `inove` e
**nenhum** no `public`. Verificado no banco:

```
has_table_privilege('inove_app','public.processos','select')      false
has_table_privilege('inove_app','public.processos','update')      false
has_table_privilege('inove_app','public.jusbr_arquivos','select') false
has_table_privilege('inove_app','public.portal_acessos','select') false
has_table_privilege('inove_app','inove.acessos','insert')         true
```

Um `delete` errado no código da Inove é recusado pelo Postgres, não evitado pela
disciplina de quem escreveu.

### A pegadinha: service_role passa por cima disso

**A rota `/api/inove` NÃO pode usar `SUPABASE_SERVICE_ROLE_KEY.`** A service role
ignora RLS e tem privilégio sobre tudo — usá-la anula a barreira inteira e o
argumento de não separar o banco cai junto.

Por isso a rota conecta **direto no Postgres** como `inove_app`, via `pg`
(dependência adicionada ao `package.json`) e a variável `INOVE_DB_URL`.

O role nasceu **sem senha**, de propósito: ela não passa por arquivo do repositório
nem por conversa. Para definir, no SQL Editor do Supabase:

```sql
alter role inove_app with password 'a-senha-que-voce-escolher';
```

E na VPS, em **`/opt/cmpgestao/.env.local`** (nunca commitado):

```
INOVE_DB_URL=postgresql://inove_app.ndeqlyrydcijbgjiviuw:<senha>@aws-1-sa-east-1.pooler.supabase.com:5432/postgres
```

Quatro detalhes que custaram uma hora na primeira vez. Confira todos antes de
concluir que a senha está errada — os quatro se disfarçam de erro de senha:

- **Porta 5432, não 6543.** A 5432 do pooler é o *session mode*, que a documentação
  indica para "persistent backend on IPv4-only networks" — que é o nosso caso, um
  Next.js rodando como processo permanente com pool de conexões. A 6543 é
  *transaction mode*, para serverless. Com a 6543 a autenticação falhava mesmo com a
  senha certa.
- **É `aws-1`, não `aws-0`.** Os dois hosts existem e respondem; o `aws-0` devolve
  `tenant/user not found`, que parece erro de senha e não é. Projeto criado em julho
  de 2026 fica no `aws-1`.
- **O usuário leva o ref no nome:** `inove_app.ndeqlyrydcijbgjiviuw`. Só na conexão
  direta (`db.<ref>.supabase.co:5432`) é que o usuário é `inove_app` puro — e aquele
  host resolve só em IPv6 e recusa conexão na 5432.
- **Senha com `#`, `@`, `/` ou `:` precisa ser codificada** (`%23`, `%40`, `%2F`,
  `%3A`), senão a URL quebra em silêncio, com "Invalid URL" antes de qualquer rede.

Cuidado também com **linha duplicada** no `.env.local`: sobrou uma de tentativa
anterior e o arquivo passou a ter dois `INOVE_DB_URL`. O `dotenv` do Next.js usa a
última; o script agora faz igual e avisa quando encontra repetição.

**Validado de ponta a ponta em 05/08/2026.** `node scripts/inove-acesso.mjs criar
"Djan (dev)" djan.adv@gmail.com --oculto` gravou em `inove.acessos` a partir da VPS.
A cadeia VPS → `pg` → `inove_app` → schema `inove` funciona.

### RLS nas tabelas do schema

RLS ligada nas 8 tabelas, com uma política `inove_app_total` por tabela, restrita ao
role `inove_app`. Assim `anon` e `authenticated` continuam trancados do lado de fora,
que é o motivo de ter ligado a RLS.

Não foi usado `BYPASSRLS` no role: é atributo global e valeria para qualquer tabela
que alguém venha a conceder a ele no futuro.

**Backup:** `ops/backup-supabase.sh` já faz `pg_dump` completo. Acrescentar um dump
diário de `--schema=inove`, restaurável sozinho — é o único ponto em que projeto
separado ganharia, e sai resolvido assim.

## 5. Tabelas novas (schema `inove`)

| Tabela | Para quê |
|---|---|
| `inove.acessos` | os 5 logins, com hash de senha; flag `oculto` para o acesso do desenvolvedor |
| `inove.sessoes` | token, expiração, último uso |
| `inove.etiquetas` | as duas dimensões: `situacao` e `quesitos` |
| `inove.processo_etiquetas` | vínculo processo ↔ etiqueta |
| `inove.financeiro` | ver seção 7 |
| `inove.log_documentos` | quem abriu, qual peça, quando, de qual IP — é o que fecha o ciclo com a tarja |
| `inove.aceites_lgpd` | registro do aviso aceito |

Os processos permitidos saem de `portal_acesso_processos` (grants), como no Portal do
Cliente. Não mexer em `processos.cliente_nome` — os 42 têm o nome da parte periciada,
não "Inove".

## 6. Etiquetas — as duas dimensões

Vieram da aba **Dados** da planilha deles.

**Situação (57 valores).** Da planilha: `Aguardando Despacho`, `Aguardando Intimação
para falar sobre Impugnação da proposta`, `Aguardando Intimação para falar sobre
Impugnação do Laudo`, `Aguardando Intimação para Iniciar os Trabalhos`, `Aguardando o
Pagamento`, `Aguardando o Pagamento - Alvará Emitido`, `Aguardando o Pagamento -
Processo com recurso no Tribunal`, `Arquivado Definitivamente`, `Arquivado
Provisoriamente`, `Assinar a Resposta`, `Assinar Petição`, `Assinar Proposta`,
`Atualizar Processo`, `Concluído`, `Conclusos para Despacho`, `Desistência da Produção
de Prova`, `Destituído`, `Elaborar Petição`, `Emitir Nota Fiscal`, `Enviar Petição de
Alvará`, `Enviar Petição de dados`, `Enviar Petição de Prazo de 15 dias`, `Enviar
Petição de Prazo de 30 dias`, `Enviar Proposta`, `Enviar Resposta`, `Honorários
Depositados`, `Honorários Impugnados`, `Intimado - Aceitar Hónorarios
arbitrado/Indicar dia,local,horário`, `Intimado - Complementar Laudo`, `Intimado -
Elaborar Laudo`, `Intimado - Elaborar Proposta`, `Intimado - Elaborar Resposta a
Impugnação`, `Intimado - Falar sobre impugnação do Laudo`, `Intimado - Justificar
valor dos Hónorarios`, `Julgado sem necessidade de Pericia`, `Laudo Complementar
Entregue`, `Laudo Entregue`, `Laudo Entregue - Aguardando Intimação para falar sobre
Impugnação`, `Laudo Finalizado - Entregar/Enviar`, `Nomeado outro Perito`, `Pago`,
`Petição de Alvará de Honorários Enviada`, `Petição de dados Enviada - Aguardar`,
`Petição Protocolada: Aguardar a resposta da Petição de Prazo/Entregar Laudo`,
`Petição Protocolada: Aguardar a resposta/Aguardar envio dos dados`, `Processo
Extinto`, `Processo Suspenso`, `Proposta Enviada - Aguardar`, `Proposta Protocolada:
Aguardar a resposta/Impugnação dos Honorários`, `Resposta a impugnação enviada:
Aguardar Protocolo`, `Resposta a impugnação protocolada: Aguardar a
resposta/Impugnação dos Honorários/Laudo`, `Resposta com pedido de destituição
enviada: Aguardar Protocolo`, `Resposta com pedido de destituição protocolada:
Aguardar Resposta/Destituição`, `Tirar Cópias`, `URGENTE!!!!!!!`, `Ver Despacho`,
`Ver Processo`.

> Manter a grafia original, inclusive os erros (`Hónorarios`, `Pericia`). É o
> vocabulário deles e eles reconhecem de imediato. Corrigir depois, se pedirem.

**Quesitos (9 valores):** `Selecione`, `Sem quesitos`, `Autor`, `Autor; Juizo`,
`Autor; Juizo; Réu`, `Autor; Réu`, `Juizo`, `Juizo; Réu`, `Réu`.

São **duas dimensões independentes** — um processo tem uma situação e um quesito ao
mesmo tempo. Não misturar numa lista só.

**De quebra:** aproveitar para fazer as etiquetas do `sistema.html` persistirem de
verdade. Hoje somem ao recarregar a página.

## 7. Financeiro

Campos, espelhando as abas *Financeiro* e *Justiça Geral* da planilha: número do
processo, valor da proposta, honorário fixado, valor depositado, valor recebido,
despesas, retenções, valor a receber, data, situação do pagamento
(`Pago`, `Pago Parcialmente`, em aberto), réu, vara, foro, UF.

Referência do volume atual: 63 linhas, **R$ 348.446,97** recebidos em 56 processos
(média R$ 6.222), mais R$ 79.660,33 a receber em 14 processos.

Onde couber, ler de `processos.hon_per_fixado / hon_per_recebido / hon_per_areceber`
em vez de duplicar.

## 7b. Duas descobertas ao criar as views — decidir antes do passo 5

### a) Só 7 dos 42 processos têm documento baixado

```
processos da Inove                                42
com algum documento em jusbr_arquivos              7
com documento que passa no filtro de peça oficial  2
```

Contra 2.693 documentos no acervo total — quase todos são de processos do escritório,
não da Inove. Abrir o portal hoje mostraria prateleira vazia.

**Consequência:** antes de liberar o acesso, rodar a carga do jus.br
(`app/api/jusbr/puxar-docs/`) para os 35 processos que faltam. É trabalho de máquina,
mas depende da sessão do jus.br ativa — ver `ops/JUSBR-RENOVACAO-AUTOMATICA.md`.

### c) Quem aperta o botão "Atualizar" — resolvido

O botão fica **no portal da Inove**, mas quem puxa é a sessão do jus.br do escritório.

`/api/jusbr/puxar-docs` usa `getFreshToken()`, que lê o token guardado por escritório
em `jusbr_sessao` — sincronizado pelo userscript do Djan. O próprio arquivo registra:
*"não precisa de ninguém logado na hora"*. A Inove nunca encosta no certificado nem no
token; só dispara o pedido.

**Ponto de atenção:** o token dura ~8h. Se estiver vencido no clique, a busca falha.
O botão então enfileira, avisa "vai atualizar assim que a sessão estiver ativa" e
manda alerta ao escritório — em vez de devolver erro seco.

### b) O filtro de peça oficial não serve para perito

`RE_OFICIAL` foi escrito para o **cliente** ver o andamento do próprio processo:
sentença, despacho, decisão, acórdão, acordo, homologação, ata de audiência, alvará.
Corta de 321 para 63 nos processos da Inove.

Só que perito não acompanha — ele **produz o laudo**. Precisa de quesitos, petições
das partes, impugnação de honorários, proposta, documentos técnicos juntados. Nada
disso passa naquele filtro.

O pedido original foi explícito: *"não podemos deixar de ter acesso a documentos do
jus.br, cadastre como se fossem meus se for o caso"*.

**Decidido em 04/08/2026: liberar tudo dos 42 processos.** A view perdeu o filtro e
passou de 63 para **321** documentos (migration `inove_docs_abertos`).

O controle não sai de cena — muda o tamanho da prateleira, não o rastreamento. A tarja
com o e-mail de quem abriu e o `inove.log_documentos` valem para todos os 321.

Os bytes saem por `inove.doc_conteudo(uuid)`, `security definer`: `conteudo_b64` e
`caminho_disco` moram em `public.jusbr_arquivos`, onde o `inove_app` não tem nem deve
ter privilégio. A função é a única fresta e confere sozinha se o documento é de
processo da Inove — quem chama não escolhe o filtro.

## 8. Documentos do jus.br

Servidos por rota própria (`/api/inove?doc=…`), **nunca** direto do Supabase — mesmo
desenho de `app/api/portal/route.js`, que já filtra por peça oficial (`RE_OFICIAL`) e
resolve `hrefBinario`/`hrefTexto`.

### Tarja diagonal

Carimbo com **e-mail de quem abriu + data/hora**, a 45°, opacidade baixa, **atrás** do
conteúdo.

- **PDF:** `pdf-lib` desenha em cada página no momento da entrega. O arquivo original
  em `/opt/cmpdocs` **não é alterado**.
- **HTML/texto:** camada CSS com `pointer-events: none`, para **leitura e copiar-colar
  continuarem funcionando** — foi requisito explícito.

Sendo honesto sobre o alcance: a tarja **não impede** print de tela nem foto. Ela
rastreia e dissuade. O que de fato responsabiliza é o `inove.log_documentos`.

### LGPD

Aviso de proibição de divulgação no primeiro acesso do dia e faixa fixa em toda tela
de documento, com aceite gravado em `inove.aceites_lgpd`.

## 9. Chat

Reaproveitar `portal_chat` e o desenho de `app/api/portal/route.js`
(`acao: 'chat'` / `'chat_enviar'`). Botão na **barra lateral esquerda**. Do lado do
escritório aparece junto com os outros chats de cliente, e qualquer pessoa logada no
Gestão responde.

## 10. Ordem de execução

- [x] **0.** Decidir o modelo de login — portal-style (seção 3).
- [x] **1.** Criar schema `inove`, o role `inove_app` e as tabelas da seção 5.
      Migrations `inove_schema_inicial`, `inove_role_app`, `inove_policies_app`.
- [x] **2.** Semear as 57 situações e os 9 quesitos, extraídos da planilha por script.
- [ ] **2b.** Definir a senha do `inove_app` e a `INOVE_DB_URL` na VPS (seção 4).
- [x] **3.** Pontes de leitura `inove.v_processos` (42) e `inove.v_documentos`, mais a
      tabela `inove.chat`. Migration `inove_views_e_chat`.
      Grant de processos por acesso **não é necessário**: a Inove é um cliente só, e o
      conjunto visível é `processos where inove = true`. Contato no CRM também não —
      fica para quando houver necessidade comercial.
- [ ] **3b.** Decidir o filtro de documentos e rodar a carga do jus.br (seção 7b).
- [x] **4.** Rota `/api/inove` — sessão, processos, etiquetas, financeiro, chat,
      cadastro de processo, gestão dos acessos. Ver seção 13.
- [x] **5.** Entrega de documento com tarja e log (`GET /api/inove?doc=…`).
- [x] **6.** Aviso de LGPD por dia e registro de aceite.
- [ ] **7.** Reescrever `public/inove.html`: fase → etiquetas, aba Financeiro, chat na
      sidebar, "Plano" fora, tela de gestão dos 5 acessos com o do desenvolvedor
      oculto.
- [ ] **8.** Teto de 62 processos com alerta dos dois lados.
- [ ] **9.** Dump diário do schema `inove` no `ops/backup-supabase.sh`.

## 13. A rota — o que já está escrito

```
app/api/inove/lib.js   conexão (pg + role inove_app), senha scrypt, sessão,
                       tarja, leitura de documento, log, alerta
app/api/inove/route.js as ações
scripts/inove-acesso.mjs  criar/trocar senha/ativar acesso pela linha de comando
```

### Ações

| Ação | O que faz |
|---|---|
| `login` / `sair` | sessão de 30 dias, trava de 10 tentativas por 10 min |
| `meus` | os 42 processos, com Situação, Quesitos e contagem de peças |
| `processo` | ficha + movimentações oficiais + documentos + etiquetas |
| `etiquetas` / `etiquetar` | as duas dimensões; trocar substitui, nunca acumula |
| `cadastrar_processo` | via função do banco, com o teto de 62 aplicado lá dentro |
| `atualizar` | dispara `puxar-docs` do jus.br com a sessão do escritório |
| `financeiro` / `financeiro_salvar` | lista com totais e gravação |
| `chat` / `chat_enviar` | por processo ou conversa geral |
| `acessos` / `acesso_criar` / `acesso_editar` / `acesso_desativar` | limite de 5; o acesso `oculto` não aparece nem conta |
| `lgpd_aceitar` | grava o aceite do dia |
| `GET ?doc=&t=` | entrega o arquivo já carimbado, gravando quem abriu |

### Duas decisões dentro do código que valem registro

**PDF que o `pdf-lib` não consegue reabrir não é entregue.** Cifrado ou malformado,
a rota devolve erro em vez de servir sem tarja — uma cópia anônima circulando é pior
que um documento que não abriu. O log registra a tentativa.

**O primeiro acesso nasce pelo script, não pela tela.** A tela de acessos exige estar
logado, e não haveria quem criasse o primeiro. Depois do primeiro, a Inove administra
os cinco sozinha.

```bash
cd /opt/cmpgestao
node scripts/inove-acesso.mjs criar "Nome da Pessoa" pessoa@inove.com.br
node scripts/inove-acesso.mjs criar "Djan (dev)" djan.adv@gmail.com --oculto
node scripts/inove-acesso.mjs listar
```

A senha é gerada e mostrada uma vez; no banco fica só o hash scrypt.

## 14. A página — reescrita

`public/inove.html` foi refeito contra `/api/inove`. **Não carrega mais o SDK do
Supabase nem a chave publishable** — sem isso não existe caminho para baixar peça por
fora da rota que carimba, que é o que faz a tarja valer.

Barra lateral: Painel · Processos · Financeiro · **Chat com o escritório** · Cadastros
(Tribunais) · Solicitar funcionalidades · Acessos. **"Plano" saiu**, como pedido —
nada ali sugere cobrança.

O que mudou de comportamento:

- **Fase deu lugar a duas listas** na ficha do processo: Situação e Quesitos. Trocar
  substitui o valor daquela dimensão; o banco impede duas situações no mesmo processo.
- **Aviso de LGPD** em dois lugares: modal no primeiro acesso do dia, com aceite
  gravado, e faixa fixa acima da lista de peças, nomeando o e-mail que vai no carimbo.
- **Chat em dois níveis:** o geral na barra lateral e um por processo, dentro da
  ficha. O contador da barra pisca em dourado quando há resposta não lida.
- **Botão "Buscar peças novas no jus.br"** na ficha. Roda com a sessão do escritório;
  se o token estiver vencido, avisa sem erro seco e manda alerta.
- **Acessos:** eles criam, editam e desativam os 5. Ninguém desativa o próprio acesso.
  O acesso `oculto` do desenvolvedor não aparece na lista nem conta na cota.
- **Cadastros e Solicitações** foram preservados — trocar o login não podia custar
  função que eles já tinham.

Conferido: compila, o JavaScript da página passa no `node --check`, todo
`getElementById` tem elemento correspondente, e as 20 ações chamadas pelo front
existem na rota.

## 15. O que falta

- [x] `INOVE_DB_URL` no `.env.local` da VPS e `npm install` com o `pg`.
- [x] **Conexão como `inove_app` validada da VPS** em 05/08/2026.
- [x] Primeiro acesso criado (`Djan (dev)`, oculto).
- [x] **Publicado em 05/08/2026.** `npm install`, `npm run build`,
      `pm2 restart cmpgestao`. Conferido no ar: `inove.html` sem SDK do Supabase e
      `/api/inove` respondendo pelo role `inove_app`.
- [ ] Criar os acessos das pessoas da Inove (pelo script ou pela tela, já logado).
- [x] **Carga do jus.br feita em 05/08/2026.** De 7 para **41 dos 42** processos com
      documento; 313 peças baixadas, acervo da Inove em **634**. Sobra
      `00038151020158250001` (TJSE, 2º grau), que o PDPJ devolve com `docs:0` em duas
      consultas separadas — não tem peça, não é falha.
- [ ] **Completar a carga.** A rota tem teto de `porproc=10` e vários processos têm
      mais de 100 peças (o maior, 229). Cada passada com `?numero=` traz as 10
      seguintes ainda não guardadas, então o acervo inteiro exige repetir por
      processo. **Ir devagar:** na primeira tentativa, 2s entre processos derrubou o
      PDPJ em `HTTP 429` a partir do 26º; com 20–30s passou limpo.
- [x] Chat: **decidido que fica só do lado da Inove** — ver a decisão 7 revista.
- [ ] Passo 9: dump diário do schema `inove` no `ops/backup-supabase.sh`.
      **Bloqueado:** o backup diário nunca foi instalado nesta VPS — o estado real
      apurado está no fim de `ops/COMO-CONFIGURAR-BACKUP.md`.

## 13b. Correções de 05/08/2026 à tarde — testado com documento real

Djan testou o portal no ar e trouxe 4 pontos, mais uma virada de decisão sobre o
chat. Nesta ordem:

**a) Botão de atualizar do jus.br — vira exclusivo do acesso oculto.** Existe agora
`atualizar_todos`: varre os processos sem nenhum documento e dispara a busca em
lote, em segundo plano (não bloqueia a resposta HTTP — 35 chamadas sequenciais ao
jus.br não cabem numa única requisição sem arriscar timeout do proxy da VPS). Só
aparece na tela para `acesso.oculto`, e o servidor confere de novo — a tela
escondida não é a segurança, é só a UI.

**b) A tarja atrapalhava copiar/colar.** Era esperado: a tarja era texto comum
desenhado por cima, então qualquer seleção que passasse perto arrastava o carimbo
junto. Corrigido marcando o carimbo como **Artifact** (ISO 32000-1 §14.8.2.2 — a
mesma classificação de marca d'água/cabeçalho/rodapé), envolvendo o desenho com os
operadores `BDC`/`EMC` do PDF via `pag.pushOperators(...)`. Testado gerando um PDF e
inflando o content stream salvo: o bloco aparece como
`/Artifact <</Type /Pagination /Subtype /Watermark>> BDC ... EMC` — a sintaxe exata
do padrão. Visores compatíveis (Adobe, e o pdf.js por trás do Chrome/Edge) excluem
conteúdo marcado como Artifact da extração de texto.
**Não testado num navegador real** — só a estrutura do PDF foi verificada aqui.
Confirmar depois de publicar: selecionar um parágrafo perto da tarja e colar no
Word deve trazer só o texto do documento.

**c) O "marcar o que baixar" do sistema.html** (checkboxes + zip/PDF único/soltos)
não foi replicado como zip — geraria uma dependência nova (`archiver`/`jszip`) e
mais um ciclo de `npm install` na VPS, logo depois da hora que já foi gasta com
host/porta/`.env` duplicado. Em vez disso: checkbox por peça, "marcar todas" e
"Baixar selecionadas" disparando downloads individuais em sequência (a cada
400ms) pelo mesmo `/api/inove?doc=...&dl=1` que já existe. Resolve "escolher o que
baixar"; não resolve "um arquivo só". Se valer a pena o zip de verdade, é obra à
parte — avisar antes de instalar dependência nova.

**d) A causa real do "html lê tudo errado" — achada e corrigida na raiz, não só
escondendo o botão Abrir.** O documento era `Petição.html` (id `d4d925cb…`),
conferido direto no banco: `doc_tipo` declarado pelo jus.br é `text/plain`
(errado) e o conteúdo é um **fragmento HTML solto** — só `<p class="paragraph"
...>`, sem `<html>`/`<body>` ao redor. `tipoRealDoArquivo()` em `app/api/jusbr/lib.js`
só reconhecia HTML com `<!doctype html>`, `<html` ou `<body` — um fragmento não bate
nenhum desses, cai no ramo de texto puro, e o navegador mostra a tag literalmente.
Ampliado para reconhecer `<p`, `<div`, `<span`, `<table` soltos também. Esse bug
existia desde antes da Inove — o Portal do Cliente nunca expôs porque o filtro de
peça oficial exclui petição; abrir tudo para a Inove foi o que revelou.
Como HTML nunca passava pela tarja, foi acrescentada `carimbarHtml()`: camada
`position:fixed; pointer-events:none; user-select:none` — mais simples que o
truque do PDF, porque em HTML o problema do item (b) nem existe. **"Abrir" volta a
funcionar** para esses arquivos; não foi preciso removê-lo.

## 13c. Chat — vira interno da Inove, não fala com o escritório

Decisão revista: **as conversas são só entre as pessoas da Inove**, não chegam ao
`sistema.html`. Ao testar, "a mensagem não chegou no gestão" — o comportamento
estava certo desde o início pela intenção original (chat com "meu sistema"), mas
depois de pensar Djan decidiu que não quer esse canal com o escritório.

**Boa notícia: isso é MENOS trabalho, não mais.** A tabela `inove.chat` e as ações
`chat`/`chat_enviar` já suportam múltiplas pessoas da Inove postando na mesma sala
(geral ou por processo) e se vendo entre si — não há bug aí, só faltava mais de uma
pessoa logada para testar. **Cancelado**: construir leitura do `inove.chat` no
`sistema.html` (item que constava como pendência acima e tinha sido passado como
tarefa 3 para a sessão da VPS antes desta correção — avisar lá se ela já começou).

**Assentos: 5 → 10.** Alterado direto no banco (`inove.config.limite_acessos = 10`).

**"Todas as funcionalidades que temos do chat"** — comparado com `chat_mensagens`
(chat interno da equipe CMP): eles têm push notification (web-push/VAPID), anexo
com imagem, responder a uma mensagem (thread), arquivar. O `inove.chat` já nasceu
com as colunas de anexo prontas; **faltam** push, resposta a mensagem e arquivar —
não construído ainda, é obra própria (push exige chave VAPID + service worker no
`inove.html`, anexo exige endpoint de upload).

**Sessões simultâneas por pessoa — pergunta em aberto, minha recomendação: 3.**
Hoje `inove.sessoes` **não tem limite nenhum** — cada login insere uma sessão nova
sem apagar as anteriores, então já é possível logar em quantos aparelhos quiser,
sem controle. Isso não é o que foi pedido nem é seguro (não dá pra saber quantos
aparelhos usam um acesso). Recomendo copiar o modelo que o próprio Gestão já usa
para a equipe (`sessao_dispositivos`, commit "até 3 aparelhos por pessoa, sessão
que sobrevive à aba congelada") — mesmo número, mesma lógica, já validada em
produção. Precisa de `dispositivo_id` gerado no navegador (hoje `inove.sessoes.
dispositivo` é só rótulo livre, não identifica o aparelho) e contagem de
distintos no login, bloqueando ou derrubando o mais antigo no 4º.
**Não implementado ainda** — depende da confirmação do número.

## 14b. Pedido maior, ainda não escopado — RBAC por pessoa, documentos, kanban

Chegou em bloco, precisa de planejamento antes de codar (é redesenho de escopo, não
ajuste pontual):

1. **Acesso por pessoa, não só por conta.** Hoje todo acesso ativo enxerga os
   mesmos 42 processos (`inove.v_processos`, sem filtro por pessoa). Passa a ser:
   maioria das pessoas só vê **o(s) processo(s) que é dela**; 2–3 "diretores" veem
   todos. Precisa de uma tabela de vínculo pessoa↔processo (nos moldes de
   `portal_acesso_processos`, que já existe para o cliente) e um flag de diretor em
   `inove.acessos`, e toda consulta que hoje lê `v_processos` sem filtro passa a
   filtrar por esse vínculo (exceto diretor).
2. **Aba "Documentos do processo"** — diferente da lista de peças do jus.br que já
   existe: é upload de arquivo PRÓPRIO da Inove (minuta antes de protocolar,
   rascunho de laudo), não documento do tribunal. Precisa de tabela + bucket de
   storage + endpoint de upload — não existe nada disso hoje no schema `inove`.
3. **Tarefa do processo / Agenda de prazos / Kanban.** A tabela `inove_tarefas` já
   existe no `public`, criada mas vazia e sem UI. Decidir: reaproveitar essa tabela
   do `public` (aí precisa de uma view + função no molde do resto) ou criar
   `inove.tarefas` própria, mais consistente com o isolamento que já existe.
4. **Quadro de recados**, abaixo de Documentos do processo — mural por processo ou
   geral? Não especificado; perguntar antes de desenhar a tabela.

Nenhum dos 4 foi iniciado. São suficientes para uma rodada de planejamento própria
— o RBAC por pessoa em especial muda o contrato de várias views e merece ser
fechado antes de mexer no código, para não reescrever duas vezes.

## 11. Ideias levantadas, ainda não aprovadas

1. Alerta de prazo disparado por etiqueta (`Intimado - Elaborar Laudo` há X dias).
2. Movimento de alvará/depósito vindo do jus.br marcando o financeiro sozinho.
3. Painel por responsável — a planilha tem Lorena 44, Wallace 22, Mairlley 16,
   Italo 16, Gerlany 10, e ninguém vê isso consolidado.
4. Cofre de credenciais dos TJs, criptografado.
5. Gerador de petição de alvará por tribunal.
6. Auditoria de acesso a documento, exportável.
7. Ranking de réus (CASSI, GEAP, UNIMED, SUL AMERICA) com valor médio e prazo de
   pagamento.
8. Aviso automático no chat em `Destituído` / `Nomeado outro Perito`.

## 12. Alerta de segurança encontrado no levantamento

A aba **Cadastro** da planilha deles guarda **senhas em texto puro** dos portais de
TJCE (`Pericia100#`), TJBA (`inove2021`), TJAP (`@inove2022#`) e TJMT (`Pericia100`).

Não importar como texto legível. Se virar funcionalidade, é a ideia 4 — cofre
criptografado.

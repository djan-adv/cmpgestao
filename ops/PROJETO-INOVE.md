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
5. **5 acessos**, autogeridos por eles (criar, editar, desativar). O acesso do
   desenvolvedor fica **oculto** da lista.
6. **Inove = um cliente só.**
7. **Chat na barra lateral esquerda**, falando com o sistema como cliente. Qualquer
   pessoa logada no Gestão responde. Histórico igual aos chats de cliente.

## 3. Decisão em aberto — resolver antes de codar

### Modelo de login

| Opção | Como é | Consequência |
|---|---|---|
| **A. Portal-style (recomendado)** | E-mail e senha em tabela própria, sessão validada no servidor, navegador nunca fala com o Supabase | É o que sustenta a tarja e o log de acesso: todo documento passa por uma rota nossa. Exige migrar o login atual do `inove.html` |
| **B. Supabase Auth atual** | Mantém o que já está no `inove.html` | Mais rápido, mas o navegador fala direto com o banco e o controle sobre documento fica frágil |

Sem a opção A, a tarja é contornável: quem tiver a chave publishable pega o arquivo
por fora da rota que carimba.

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

**Role dedicado `inove_app`:**

- `USAGE` + `ALL` no schema `inove`;
- `SELECT` em exatamente duas views: os 42 processos e os documentos liberados;
- **nenhum** privilégio de escrita em `public`;
- `REVOKE ALL ON SCHEMA public FROM inove_app`.

Um `delete` errado no código da Inove é barrado pelo Postgres, não pela disciplina de
quem escreveu.

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

- [ ] **0.** Decidir o modelo de login (seção 3).
- [ ] **1.** Criar schema `inove`, o role `inove_app` e as tabelas da seção 5.
- [ ] **2.** Semear as 57 situações e os 9 quesitos.
- [ ] **3.** Criar o contato "INOVE CONSULTORIA ATUARIAL LTDA - EPP" e vincular os 42
      processos por grant.
- [ ] **4.** Rota `/api/inove` — sessão, processos, etiquetas, financeiro, chat.
- [ ] **5.** Entrega de documento com tarja e log.
- [ ] **6.** Avisos de LGPD e registro de aceite.
- [ ] **7.** Reescrever `public/inove.html`: fase → etiquetas, aba Financeiro, chat na
      sidebar, "Plano" fora, tela de gestão dos 5 acessos com o do desenvolvedor
      oculto.
- [ ] **8.** Teto de 62 processos com alerta dos dois lados.
- [ ] **9.** Dump diário do schema `inove` no `ops/backup-supabase.sh`.

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

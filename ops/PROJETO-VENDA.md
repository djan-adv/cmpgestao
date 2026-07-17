# Projeto — Linha de VENDA (djan.app.br) · plano comercial e técnico

> Status: **planejamento — nada será construído antes de o projeto inteiro estar
> fechado** (decisão do Djan). Este documento registra as propostas do Djan, a
> análise de viabilidade e o desenho de cada peça. Complementa o
> `PROJETO-MULTIEMPRESA.md` (arquitetura) e o `COMO-CRIAR-AMBIENTE-VENDA.md`
> (instalação do ambiente de teste).
>
> Regra de ouro: **nada muda no sistema da CMP.** Toda personalização vira
> configuração por escritório (engrenagem), nunca fork, nunca alteração do que
> a CMP já usa.

---

## 1. Log das propostas do Djan (17/07/2026)

1. Jaline com vários processos + processos particulares do Djan no ambiente de
   demonstração (~70 processos ao final) — sem apagar nada, sem mexer na CMP.
2. Modelos de venda considerados:
   a) acesso total grátis por X processos ou por tempo;
   b) **grátis até 20 processos por 3 meses** (preferida — puxa tíquete maior);
   c) 7 dias até 1000 processos.
   Preço justo mínimo: **R$ 8.000/ano**. Referência Astrea: 1000 processos +
   10 usuários por ~R$ 700/mês, e no pacote simples nem agendamento dão.
3. **Importador de Excel** (a maioria entrega planilha bagunçada) — como foi
   feito no início da CMP.
4. **DJEN**: botão para receber intimações por OAB **ou** só dos processos
   cadastrados — configurável.
5. **Engrenagem única** (um botão com vários botões dentro): tudo que foi
   personalizado para a CMP (botões James, músicas, processo-mãe etc.) vira
   opção ligável por escritório. Layout atual permanece para todos.
6. Capacidade e custo: quanto vai crescer o gasto com GitHub/Supabase/VPS; e o
   **problema seríssimo dos backups** (sumir processo é confusão sem fim).
7. **Tarefas com permissões** (a dor de quem compra: controlar empregados,
   advogados associados e estagiários):
   - quem cria a tarefa é dono; outro não altera — só o sócio/coordenador;
   - estagiário não edita tarefa, não move data nem prazo; só **comenta**
     (como no Astrea);
   - controle rígido de cumprimento (em boa parte já existe).
8. **Pontuação/premiação**: percentual de conclusão relativo ao que cada um
   recebeu (27/30 = 18/20 = 90%), bônus por antecipar, e **nível de dificuldade
   de 1 a 5** definido por quem transfere a tarefa.
9. **Venda modulada**: vender partes do sistema (como Astrea e todos fazem),
   só para arrecadar mais.
10. **Cora**: cobrança dos clientes pelo Cora (já sabemos fazer) + botão
    "Abrir conta no Cora" com o nosso link de indicação (ganhamos pontos).
11. **Cofre de documentos da contratação**: a planilha/documentos que o cliente
    enviou ficam guardados, acessíveis ao coordenador por login — para nunca
    dizerem que um processo "estava na lista" e não foi cadastrado.
12. **E-mail institucional** dos clientes: usar remetente do sistema
    (ex.: contato@djan.app.br), ou o Gmail logado do cliente, ou **vender
    domínio + e-mail pela Hostinger** (pacote completo: domínio + site +
    sistema, tudo no painel Hostinger do Djan). Reforçar segurança da conta
    Hostinger com 2FA.

## 2. Veredito geral

**Tudo é viável**, com duas ressalvas técnicas:

- **Envio "pelo Gmail logado"**: abrir o Gmail com o e-mail pronto (como a CMP
  já faz) é trivial. Mas **enviar automaticamente** em nome do Gmail do cliente
  exige OAuth verificado pelo Google (processo burocrático). Caminho: lançar
  com remetente do sistema + "abrir no Gmail", e domínio próprio como upsell.
- **Trial 7 dias / 1000 processos**: importar 1000 processos custa caro (nosso
  trabalho) para um lead que em 7 dias nem aprendeu a usar. Descartar.

## 3. Modelo comercial recomendado

- **Trial**: grátis **20 processos / 3 meses** (opção b do Djan). 3 meses cria
  hábito e custo de troca; 20 processos limita o risco. A importação assistida
  ("me manda sua planilha bagunçada que amanhã está no ar") é a arma de venda
  do onboarding — cobrar taxa de implantação fora do trial.
- **Preço-âncora**: Astrea cobra ~R$ 8.400/ano (700×12) sem agendamento
  automático no plano simples. Nosso mínimo de **R$ 8.000/ano** entrega mais
  (DJEN automático, agendamento, Kanban, portal, assinatura). Tabela sugerida:
  - Essencial — até 100 processos / 3 acessos;
  - Profissional — até 500 processos / 5 acessos;
  - Escritório — até 1000 processos / 10 acessos (R$ 8.000+/ano);
  - anual antecipado com desconto (caixa na frente + retenção).
- **Módulos** (venda modulada, princípio Astrea): DJEN automático, portal do
  cliente, assinatura eletrônica, WhatsApp/avisos, gestão financeira —
  ligáveis por plano na engrenagem. Mesma infraestrutura de toggles serve
  para personalização e para monetização.
- **Cora**: cobrança recorrente via boleto/Pix Cora (rotas já existem na CMP) e
  botão "Abrir conta no Cora" com link de indicação.

## 4. Engrenagem (⚙ um botão, tudo dentro) — o coração do produto

Guarda-chuva de configuração **por escritório** (tabela de config por
`escritorio_id`, JSON), em abas:

1. **Aparência**: nome, logo, cores (white-label).
2. **Módulos**: liga/desliga conforme plano (e personalizações tipo botões
   James, músicas, processo-mãe — viram recursos genéricos: "atalhos
   personalizados", "pastas especiais", "processos vinculados/mãe").
3. **Publicações/DJEN**: por OAB do escritório ou só processos cadastrados;
   horário; quem recebe aviso.
4. **Tarefas e permissões** (seção 5).
5. **Pontuação/premiação** (seção 6).
6. **E-mail**: remetente institucional, assinatura.
7. **Cofre da contratação**: documentos enviados no onboarding (seção 7).

A CMP continua exatamente como está — o escritório-raiz simplesmente tem tudo
ligado do jeito atual.

## 5. Tarefas: papéis e permissões (dor nº 1 de quem compra)

Papéis já existem (sócio/advogado/funcionário/estagiário). Regras (aplicadas
no servidor/banco, não só na tela):

| Ação | Sócio/Coord. | Advogado | Funcionário | Estagiário |
|---|---|---|---|---|
| Criar tarefa | ✔ | ✔ | ✔ | — |
| Editar/mover a própria tarefa criada | ✔ | ✔ | ✔ | — |
| Editar tarefa dos outros | ✔ | — | — | — |
| Mover data/prazo | ✔ | só das próprias | — | — |
| Concluir tarefa atribuída a si | ✔ | ✔ | ✔ | ✔ |
| Comentar (estilo Astrea) | ✔ | ✔ | ✔ | ✔ |

Cada regra é um toggle na engrenagem (nem todo escritório quer o regime duro).
Precisa de: campo `criado_por` nas tarefas, tabela de comentários, e histórico
de alterações (auditoria — quem mexeu no quê; casa com "dar pressão").

## 6. Pontuação e premiação

- Tarefa ganha **dificuldade 1–5** (definida por quem cria/transfere) e datas
  de atribuição/prazo/conclusão.
- Índice por pessoa no período: `feitas ÷ recebidas` (27/30 = 18/20 = 90%),
  ponderado pela dificuldade; bônus por antecipação (concluir antes do prazo).
- Painel de ranking mensal para o coordenador + meta/premiação configurável.
- Tudo calculável com o Kanban atual + os campos novos. Viável e barato.

## 7. Importador de Excel + cofre da contratação

- **Importador**: upload da planilha → mapeamento de colunas assistido →
  prévia → importa para o escritório. Aceitar bagunça: IA (Claude API, já
  usada no projeto) normaliza colunas tortas, nomes misturados, datas em
  formatos variados. Registro de importação: quantos entraram, quais linhas
  falharam e por quê.
- **Cofre**: todo arquivo enviado (planilhas, contratos do onboarding) fica
  guardado em bucket por escritório (RLS), visível ao coordenador — prova
  permanente do que foi entregue. Resolve o "esse processo estava na lista".

## 8. DJEN para inquilinos

O robô diário já existe (CMP). Para a venda: configuração por escritório
(OAB(s) monitoradas **ou** apenas processos cadastrados), rodando no mesmo
cron com fila por escritório (horários escalonados para respeitar o serviço
do DJEN). É argumento central de venda — concorrente cobra caro por isso.

## 9. Capacidade, custos e onde cresce o gasto

| Peça | Hoje | Quando começar a vender | Custo |
|---|---|---|---|
| GitHub | grátis | grátis (repo privado) | R$ 0 |
| VPS Hostinger | roda CMP + instância venda | dezenas de escritórios na MESMA instância venda (multi-tenant — não é 1 servidor por cliente) | R$ 0 extra; upgrade de RAM se precisar (~R$ 30–60/mês) |
| Supabase | Free (500 MB banco, 1 GB storage) | **Pro US$ 25/mês** no 1º cliente pago | ~R$ 140/mês |
| Backup externo (R2/Drive) | — | obrigatório | ~R$ 5–15/mês |

- Régua de consumo: CMP = 625 processos ≈ 92 mil andamentos. Um cliente de
  1000 processos ≈ 150 mil linhas de andamentos. O plano Pro (8 GB) comporta
  **dezenas de clientes grandes**; um único cliente de R$ 8.000/ano paga ~4×
  o custo total de infraestrutura do ano.
- Limite técnico real: a tela carrega até ~3.000 processos por escritório de
  uma vez — confortável para o público-alvo; acima disso, paginar (trabalho
  futuro, não bloqueia o lançamento).

## 10. Backups (o "problema seríssimo") — plano 3-2-1

1. **Supabase Pro**: backup diário automático, 7 dias de retenção (motivo nº 1
   de assinar o Pro no primeiro cliente; PITR opcional depois).
2. **Backup próprio**: `pg_dump` diário no VPS (o `backup-supabase.sh` já
   existe) + cópia para fora do VPS (Cloudflare R2 ou Drive) com retenção de
   30 dias. Storage (arquivos) sincronizado por rclone.
3. **Teste de restauração** agendado (1×/mês) — backup que nunca foi restaurado
   não é backup. Registrar o procedimento em `ops/`.
4. Extra de confiança para o cliente: exportação mensal automática em
   Excel/PDF da lista de processos dele, guardada no cofre — o cliente "vê" o
   backup existir.

## 11. E-mail dos clientes — decisão em camadas

1. **Lançamento**: remetente único do sistema (ex.: `notifica@djan.app.br`),
   SPF/DKIM configurados uma vez, Reply-To do escritório. Zero cadastro por
   usuário (modelo Astrea). + botão "abrir no Gmail" (sem OAuth, sem risco).
2. **Upsell**: domínio + e-mail do cliente via revenda Hostinger (pacote
   domínio + site + sistema) — decisão nº 10 do PROJETO-MULTIEMPRESA.
3. **Não fazer**: IMAP/senha de cada usuário (trabalho sem fim) e envio
   automático pela conta Google do cliente (exige verificação OAuth — só se
   um dia valer a pena).
4. **Hostinger**: ligar 2FA na conta, senha única forte, e nunca guardar a
   senha no código/repos. API tokens só se automatizarmos a revenda.

### Domínio do cliente em nome do Djan (cessão de uso / "comodato")

Decisão (17/07/2026): **viável e aprovado como modelo do pacote.** O Djan
registra o domínio do cliente no próprio CPF/CNPJ (~R$ 40/ano no Registro.br)
e cede o uso enquanto durar a assinatura — retenção forte (site + e-mail do
cliente dependem do pacote). Amarrações contratuais:

1. Juridicamente, formatar como **cláusula de cessão de uso gratuita do
   domínio, acessória ao contrato de serviço** (domínio é direito de uso, não
   coisa — mais limpo que comodato em instrumento apartado).
2. Cláusula expressa de que **o cliente autorizou/solicitou** o registro em
   nome do fornecedor — desmonta alegação de má-fé numa eventual disputa
   SACI-Adm (titular de marca INPI pode disputar domínio registrado de má-fé).
3. **Opção de transferência ao cliente no encerramento, por valor fixo** —
   evita fama de "sequestro de domínio" (fatal vendendo para advogados) e
   ainda gera receita na saída; a fricção de migrar site/e-mail já retém.
4. Usar **`.com.br`** para domínios cedidos; `.adv.br` é categoria restrita —
   só quando o titular for o próprio advogado cliente.
5. Item de tabela comercial: "domínio incluso" (do Djan, cedido) vs. "domínio
   próprio do cliente" (transferência paga).

## 12. Riscos e lições (para não esquecer)

- **LGPD/contrato**: dados processuais são sensíveis. Ter contrato de
  prestação com cláusula de dados, e política de acesso/auditoria. (Clientes
  advogados VÃO perguntar.)
- **Restauração testada** antes do primeiro cliente pago.
- **Nunca** personalizar por código para um cliente (balde do
  PROJETO-MULTIEMPRESA: configuração → recurso geral → add-on pago).
- Trial só com importação assistida agendada — trial vazio não converte.

## 13. Ideias adicionais (Claude)

- **Migração do Astrea em 1 clique**: importar o export do Astrea direto
  (formato conhecido) — ataque frontal ao concorrente.
- **Auditoria completa** (quem criou/alterou/excluiu o quê e quando): casa com
  o controle de equipe e vira argumento de venda para o sócio.
- **Avisos de prazo por WhatsApp** (infra `wa_*` já existe) como módulo
  premium.
- **Indicação entre advogados**: mês grátis para quem indicar escritório que
  assinar.
- **Taxa de implantação** (setup) cobrando a importação assistida — receita já
  no dia 1, mesmo no trial.
- **Página de status/monitoramento** simples (uptime) — confiança barata.
- **Exportação total dos dados** pelo próprio cliente (1 botão) — reduz medo
  de aprisionamento e é exigência comum em licitação de software.

## 14. Fases de construção (quando o projeto for aprovado)

1. **Fundação comercial**: engrenagem (config por escritório) + limites de
   plano/trial + tela de módulos.
2. **Onboarding**: importador de Excel com IA + cofre da contratação.
3. **Equipe**: permissões de tarefas + comentários + auditoria.
4. **Pontuação**: dificuldade, índice, ranking, premiação.
5. **Operação**: DJEN por escritório, e-mail institucional, backups 3-2-1
   com teste de restauração, Supabase Pro.
6. **Cobrança**: Cora (boletos/Pix + link de indicação), contrato/LGPD.

Cada fase entrega algo vendável; a ordem prioriza o que destrava a primeira
venda (1–2) antes do que retém (3–5) e do que escala (6).

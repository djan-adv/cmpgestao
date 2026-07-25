# Estagiário Virtual — o robô que lê a intimação e prepara a petição

O robô faz sozinho a parte chata: lê as publicações novas do DJEN, separa as que
exigem peça, lança o prazo no Kanban e monta um **dossiê** — um zip só, com as
instruções da petição e os documentos dos autos — na pasta **"Estagiário Virtual"**
do processo.

Você baixa esse arquivo, manda redigir no **Claude do escritório** (plano mensal,
sem custo de API) e sobe a minuta revisada. O robô nunca protocola nada.

---

## Como funciona, na ordem

1. **DJEN** (`/api/cron/djen`, 5h) traz as publicações novas para `andamentos`.
2. **Triagem** (`/api/robo/minutas?fase=triagem`, a cada 30 min) lê cada publicação
   nova e decide: exige peça? qual? qual o prazo? quais documentos o redator precisa?
   - Grava uma linha em `robo_minutas` (uma por publicação — `andamento_id` é único,
     então a mesma publicação nunca é triada nem cobrada duas vezes).
   - **Se exige peça, cria a tarefa de prazo no Kanban na hora.** O prazo não
     depende do dossiê, nem do orçamento, nem de nada dar certo depois.
3. **Dossiê** (`/api/robo/minutas?fase=dossie`, a cada 15 min) pega a pendência de
   prazo mais curto e monta o zip. Sem IA nenhuma nesta fase — só junta o que já temos.

## O que vem dentro do zip

```
2026-07-25_contestacao.zip
├── PEDIDO.md                    ← leia primeiro
└── documentos/
    ├── Contestação - Réu.pdf
    ├── Laudo pericial.pdf
    └── ...                       (até 8 peças, 60 MB no total)
```

O `PEDIDO.md` traz: a peça a redigir, o que ela deve fazer (com o eixo da tese),
o prazo, os dados do processo, **o teor completo da intimação**, o histórico
recente e a lista de documentos anexos — além das regras do escritório
(`[A PREENCHER]`, `[CONFIRMAR]`, `[JURISPRUDÊNCIA A CONFIRMAR]`, Relatório de teses).

Os documentos saem, nesta ordem: os da pasta do processo em `/opt/cmpdocs`
(curados pelo escritório) e depois os que o robô do jus.br já baixou
(`jusbr_arquivos`). Os que a triagem apontou como necessários entram na frente.

> Se nenhum documento estiver guardado, o zip sai só com o `PEDIDO.md` e um aviso.
> Abra o processo no jus.br e use "baixar peças" antes de mandar redigir.

## Íntegra dos autos na pasta do processo

Junto com o dossiê, o robô também guarda **a íntegra dos autos em um PDF só**, em
**ordem crescente** (do documento mais antigo ao mais novo, como os autos), como
**primeiro arquivo** da pasta do processo:

```
/opt/cmpdocs/08116164820268152001/
├── 000 - ÍNTEGRA DOS AUTOS (25-07-2026).pdf   ← o robô põe e mantém atualizada
├── Estagiário Virtual/
│   └── 2026-07-25_contestacao.zip
├── Contestação - Réu.pdf
└── ...
```

Assim você escolhe: ler só as peças que o robô selecionou (o zip do dossiê) ou ler
os autos inteiros. O prefixo `000 - ` é o que faz o arquivo ficar em primeiro na
listagem, que é alfabética.

**Custo de IA: zero.** A íntegra vem do jus.br, não da Anthropic — nenhuma chamada
paga acontece nesta fase.

### O que isso custa de verdade: disco

Uma íntegra costuma ter dezenas de MB (o teto por pacote é 180 MB). Para o disco do
VPS não crescer sem fim, valem duas regras:

- **Uma íntegra por processo.** Ao gravar a nova, o robô apaga a anterior.
- **Íntegra com menos de 7 dias não é refeita** (`INTEGRA_VALIDADE_DIAS`), mesmo que
  chegue outra intimação.

Na prática, o piso é ~1 PDF por processo com prazo ativo. Se o disco apertar, dá para
apagar as íntegras antigas sem perder nada — o robô refaz quando precisar:

```bash
# quanto as íntegras estão ocupando
du -ch /opt/cmpdocs/*/000\ -\ ÍNTEGRA* 2>/dev/null | tail -1

# apagar as que não são tocadas há mais de 60 dias
find /opt/cmpdocs -name '000 - ÍNTEGRA*' -mtime +60 -delete
```

### Esta fase depende do jus.br

Diferente do dossiê, a íntegra **precisa da sessão do PDPJ ativa** — ela baixa peça
por peça na hora. Com a sessão caída, o robô não marca a pendência como resolvida:
tenta de novo no ciclo seguinte, sozinho, quando a sessão voltar. O dossiê e o prazo
seguem normalmente enquanto isso.

Se algumas peças não couberem no limite, a íntegra sai **parcial** e o lançamento no
histórico diz quantas ficaram de fora.

## Onde ver

- **Sistema → Robôs → 🎓 Estagiário Virtual**: a fila, o prazo de cada uma, os botões
  de baixar o dossiê e a íntegra, e o gasto de IA do mês.
- **Documentos do processo → pasta "Estagiário Virtual"**: os zips daquele processo.
- **Histórico do processo**: cada dossiê deixa um lançamento `[ESTAGIÁRIO VIRTUAL]`.
- **Kanban**: o prazo, criado na triagem.

## Custo

Só a triagem usa a API paga (Claude Sonnet 5, com o manual de triagem em cache).
São cerca de **R$ 15 a R$ 25 por mês** no volume atual (~500 publicações/mês).
A redação da peça acontece fora, no plano mensal — custo marginal zero.

O teto está em `ia_config` (padrão **R$ 100/mês**). Todo gasto é registrado em
`ia_uso`, chamada por chamada. Se o teto estourar, o robô **para de gastar** — mas
continua triando o que já foi pago e lançando prazos.

```sql
-- ver o gasto do mês
select rotina, count(*) chamadas, round(sum(custo_usd)::numeric, 4) usd
from ia_uso
where criado_em >= date_trunc('month', now() at time zone 'America/Sao_Paulo')
group by rotina;

-- mudar o teto / desligar o robô
update ia_config set teto_mensal_brl = 150 where id = 1;
update ia_config set robo_minutas_ativo = false where id = 1;
```

## Modo alternativo: o robô redige sozinho

Se um dia quiser que o próprio robô escreva a peça pela API (Word pronto no
histórico, como o botão "Peticionar com Claude"):

```sql
update ia_config set modo = 'api' where id = 1;
```

Aí a fase 2 passa a redigir em vez de montar o dossiê, e respeita o teto mensal —
custa cerca de **R$ 0,90 por peça** (uns R$ 90/mês no volume atual). Para voltar:
`update ia_config set modo = 'dossie' where id = 1;`

## Quando algo falha

O painel mostra o erro no card. Uma pendência marcada como **falhou** não é
retentada automaticamente (de propósito: erro permanente ficaria em loop a cada
15 min). Resolva a causa e use **▶ rodar agora** no robô "Minutas — dossiê do
Estagiário Virtual", ou volte a linha para a fila:

```sql
update robo_minutas set status = 'triado', erro = null where id = '<uuid>';
```

## Limites conhecidos

- **A contagem do prazo não considera feriados** — só pula sábado e domingo. A data
  é sugestão; confira antes de confiar. A tarefa nasce para revisão justamente por isso.
- A triagem erra para mais, não para menos: na dúvida, marca que exige peça. É melhor
  um dossiê a mais do que um prazo perdido.
- Só processos ativos do escritório entram (arquivado e suspenso ficam de fora).
- Publicações com mais de 5 dias o robô não pega — é para não ressuscitar fila antiga
  numa primeira execução.

---

## Conta da API (botão 💳 no painel)

Em **Robôs → 🎓 Estagiário Virtual → 💳 conta da API** aparece:

- **Gasto do mês** pelo nosso registro (`ia_uso`), em tempo real, quebrado por rotina.
  É o número que segura o teto.
- **Conferência com a fatura**: o custo oficial da Anthropic (`/v1/organizations/cost_report`),
  se houver uma Admin API key configurada.
- **Botão "Ver saldo e pagar"**, que abre o Console da Anthropic.

### Saldo de crédito não dá para mostrar aqui

A Anthropic **não expõe saldo de crédito em nenhum endpoint** — nem no Admin API.
Só no Console. Por isso o botão leva para lá em vez de mostrar o número.

### Para ligar a conferência oficial

1. Console → Settings → API keys → crie uma **Admin API key** (`sk-ant-admin01-…`).
   É diferente da chave normal.
2. Ponha no servidor: `ANTHROPIC_ADMIN_KEY=sk-ant-admin01-…` e reinicie.

> ⚠️ **Exige conta de organização.** O Admin API não funciona em conta individual —
> nesse caso o painel mostra só o nosso número, que é suficiente para o teto.

O número oficial é diário e atualiza uns 5 minutos depois da chamada, então ele
vai ficar sempre um pouco atrás do nosso. Divergência grande entre os dois quer
dizer que alguém está usando a mesma chave fora do CMPGestão.

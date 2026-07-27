# Horário de envio de e-mail às varas e cartórios

E-mail que chega às 14h afunda no meio da caixa do servidor. Chegando na abertura
do expediente, fica no topo. Por isso todo e-mail à vara/cartório sai em hora marcada:

| Justiça | Dígito do CNJ | Horário |
|---|---|---|
| Estadual (comum) | `8` | **08:00** |
| Trabalho | `5` | **08:00** |
| **Federal** | `4` | **10:00** |
| Eleitoral, militar, tribunais superiores | 6, 7, 9, 1, 2, 3 | 08:00 (padrão) |

O dígito é o **J** do número CNJ (`NNNNNNN-DD.AAAA.J.TR.OOOO`) — o sistema lê sozinho.

## Como funciona na prática

Você escreve o e-mail normalmente e clica em **Enviar agora (contato@)**.

- **Dentro do horário** (a hora cheia do slot — ex.: 08:00–08:59 na estadual):
  sai na hora, sem perguntar.
- **Fora do horário**: abre a janela ⏰ *Horário de envio à vara* com três saídas:
  - **Agendar para ⟨dia⟩ às ⟨hora⟩** — entra na fila e sai sozinho;
  - **Enviar agora mesmo assim** — ignora o horário;
  - **Cancelar**.

O próximo horário é **hoje**, se ainda não passou, ou o **próximo dia útil**.
Sábado e domingo nunca — cartório fechado.

> ⚠️ **Feriado não é considerado.** O e-mail sai mesmo assim. Se a data cair em
> feriado, cancele na fila e reagende.

## A fila

Botão **📮 Fila de e-mails**, na janela do e-mail à vara e no alerta de
"Diligências a cobrar". Mostra o que ainda vai sair, e para cada item:

- **▶ enviar já** — adianta a hora marcada e dispara na mesma hora;
- **✕ cancelar** — tira da fila.

Itens já enviados ficam listados por 7 dias, para conferência.

O robô **`email_fila`** (`/api/cron/email-fila`) roda de 5 em 5 minutos pelo
maestro (`/api/cron/tick`) e envia o que venceu — no máximo 8 por rodada.

- A linha sai de `agendado` **antes** do envio, então duas rodadas simultâneas
  nunca pegam o mesmo item.
- Falha de infra volta para a fila, até **3 tentativas**; depois fica `falhou`
  e aparece com o motivo no painel.
- Item preso em `enviando` por mais de 10 minutos (queda do servidor no meio do
  envio) volta sozinho para a fila.
- A trava anti-repetição do mesmo dia continua valendo — se o mesmo conteúdo já
  saiu para aquele destinatário e processo, o item é marcado `falhou` sem
  reenviar.

## O que fica no histórico do processo

Agendar já registra o lançamento, dizendo que é agendamento:

```
[E-mail à vara/cartório — Solicitação de andamento, AGENDADO via painel em 27/07/2026 para sair amanhã (28/07) às 08:00]
```

A diligência só tem a `ultima_cobranca` atualizada **quando o e-mail sai de fato** —
agendar não conta como cobrança feita.

## Onde isso vale

Os dois caminhos de e-mail para vara/cartório:

1. **Ficha do processo → E-mail para a vara/cartório** (janela do balcão virtual).
2. **Painel → Diligências a cobrar → Cobrar por e-mail**.

E-mail para **cliente** não passa por aqui — sai na hora, como sempre.

## Tabela e ajustes

```sql
-- o que está na fila
select enviar_em, para, assunto, status, erro from emails_agendados
where status in ('agendado','enviando') order by enviar_em;

-- adiar/adiantar um item
update emails_agendados set enviar_em = '2026-07-29 08:00-03' where id = '<uuid>';

-- tirar da fila
update emails_agendados set status = 'cancelado' where id = '<uuid>';
```

Para mudar os horários, é uma linha em `public/sistema.html`:

```js
var HORA_VARA_PADRAO=8, HORA_VARA_FEDERAL=10;
```

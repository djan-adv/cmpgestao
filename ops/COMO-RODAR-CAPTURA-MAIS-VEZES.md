# Rodar a captura de intimações (DJEN) mais vezes por dia — pelo VPS

O robô que busca as intimações no DJEN é o endereço `/api/cron/djen` do próprio
sistema. Ele **não exige senha** e pode ser chamado por `curl`. Como o VPS é pago
(custo fixo), rodar a captura várias vezes ao dia **não tem custo nenhum** — ao
contrário da Vercel (grátis), que só permite 2 disparos diários.

## Por que fazer isso

A maioria dos tribunais publica à noite, mas parte das intimações só fica
disponível depois das 7h da manhã. Rodando a captura de 2 em 2 horas durante o
dia, nenhuma intimação fica esperando até o dia seguinte.

## Como ativar (uma vez só, no servidor)

Acesse o VPS por SSH (o mesmo servidor onde roda o `pm2 cmpgestao`) e rode:

```bash
# abre o agendador do usuário
crontab -e
```

Cole **uma** das linhas abaixo no final do arquivo, salve e feche:

```cron
# captura a cada 2 horas (12x/dia) — leve e cobre o dia todo
0 */2 * * * curl -s https://gestao.cmpadvogados.com.br/api/cron/djen >/dev/null 2>&1
```

ou, se preferir só no horário comercial (a cada 2h das 5h às 19h, horário de Brasília):

```cron
# ATENÇÃO: ajuste as horas se o servidor estiver em UTC (Brasília = UTC-3).
# Ex.: em UTC, 5h-19h BRT = 8,10,12,14,16,18,20,22 UTC
0 8,10,12,14,16,18,20,22 * * * curl -s https://gestao.cmpadvogados.com.br/api/cron/djen >/dev/null 2>&1
```

Para conferir o fuso do servidor: `date` (mostra a hora e o fuso atual).

## Como saber se está funcionando

No próprio sistema, veja se aparecem intimações novas ao longo do dia (aba
Publicações). No banco, os andamentos de fonte `djen` passam a ter horários de
gravação espalhados pelo dia, não só às 5h.

## Observações

- A captura é **idempotente**: rodar várias vezes não duplica intimações (cada
  publicação entra uma vez só).
- A API do CNJ (DJEN) é pública e gratuita — as chamadas extras não têm custo.
- O disparo da Vercel às 5h continua funcionando como reforço; pode manter os dois.

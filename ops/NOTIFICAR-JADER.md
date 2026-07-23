# Notificações para Jader — novos leads e reuniões (NÃO REMOVER)

O escritório avisa o Jader por e-mail (jadergabrielpinheiro.adv@gmail.com e
jaderpinheiroadv@gmail.com) sobre:

- **Novos leads**: aviso imediato ao chegar e, depois, a cada 30 min **até** que
  o card seja aberto, movido ou editado no funil Comercial.
- **Reuniões agendadas**: de manhã, novamente ~1h antes e ~30 min antes.

## Como funciona

- A rota `/api/notificar-jader` faz uma varredura idempotente: envia só o que
  estiver devido. A trava `notificacoes_jader` impede repetir a mesma janela de
  reunião no mesmo dia; os leads respeitam a cadência de 30 min pelo campo
  `crm_leads.notif_ultimo`, e param quando `notif_ack=true`.
- O **aviso imediato** de lead novo é disparado na hora (pela captura e ao criar
  o lead à mão). A varredura periódica cobre os lembretes de 30 min e as janelas
  das reuniões.

## Ativar no VPS (uma vez)

No mesmo servidor onde roda o `pm2 cmpgestao`, abra o agendador:

```bash
crontab -e
```

E cole a linha (roda a cada 15 min — cobre bem as janelas de 30 min):

```cron
*/15 * * * * curl -s http://127.0.0.1:3000/api/notificar-jader >/dev/null 2>&1
```

Sem custo (SMTP próprio do escritório; endpoint local).

## Testar

- `curl "http://127.0.0.1:3000/api/notificar-jader?debug=1"` mostra o que seria
  enviado (leads devidos e janelas de reunião) sem enviar nada.
- `curl "http://127.0.0.1:3000/api/notificar-jader"` executa e envia o que estiver
  devido, devolvendo um resumo (leads_avisados, reunioes_avisadas).

## Observações

- Reunião = evento da agenda cujo tipo/título/descrição contém "reuni". As
  audiências têm aviso próprio ao cliente e não entram aqui.
- Horário considerado: Brasília (UTC-3).

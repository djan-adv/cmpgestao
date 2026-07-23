# Baixa automática de pagamentos (sem depender de clique) — VPS

Para o sistema reconhecer os pagamentos **sozinho, 24/7** (inclusive contratações
do portal de Monitoramento fora do horário comercial) e disparar o extrato por
e-mail, ative o robô de conciliação no crontab do VPS.

## Ativar (uma vez)

No servidor onde roda o `pm2 cmpgestao`:

```bash
crontab -e
```

Adicione a linha (a cada 10 min):

```cron
*/10 * * * * curl -s http://127.0.0.1:3000/api/cora/conciliar-auto >/dev/null 2>&1
```

## O que ela faz

- Consulta no Cora as cobranças ainda em aberto e marca as **pagas** (baixa).
- Em seguida entrega os **extratos de Monitoramento** dos pedidos que ficaram
  pagos (e-mail ao cliente com aviso LGPD).
- É idempotente e sem custo (endpoint local + API do Cora).

## Testar

```bash
curl "http://127.0.0.1:3000/api/cora/conciliar-auto"
```

Retorna, por exemplo, `{"ok":true,"conferidas":3,"baixadas":1,"entregas":1}`.
Depois disso, o boleto pago aparece como **pago** no Financeiro e o cliente
recebe o extrato — tudo sem clique.

> Observação: o webhook do Cora ("Ativar baixa automática" no Financeiro) faz a
> baixa instantânea quando disponível; este robô é a rede de segurança que
> garante a baixa mesmo se o webhook não chegar.

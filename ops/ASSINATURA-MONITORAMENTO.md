# Assinatura mensal de monitoramento — robôs (VPS)

O cliente assina no portal (`/monitoramento.html` → "Assinar mensal") por
R$ 19,90/mês. O sistema faz varreduras **segunda e sexta** buscando processos
novos no nome dele e avisa por e-mail. Boleto mensal automático; 30 dias sem
pagar → suspende a emissão até nova contratação.

## Ativar no crontab (uma vez)

```bash
crontab -e
```

Adicione as duas linhas:

```cron
# cobrança mensal + baixa + suspensão (diário, 6h)
0 6 * * * curl -s "http://127.0.0.1:3000/api/monitoramento/robo?tarefa=cobrar" >/dev/null 2>&1
# varredura de novos processos — SEGUNDA (1) e SEXTA (5), às 8h
0 8 * * 1,5 curl -s "http://127.0.0.1:3000/api/monitoramento/robo?tarefa=varrer" >/dev/null 2>&1
```

Ou, sem abrir editor:

```bash
(crontab -l 2>/dev/null; \
 echo '0 6 * * * curl -s "http://127.0.0.1:3000/api/monitoramento/robo?tarefa=cobrar" >/dev/null 2>&1'; \
 echo '0 8 * * 1,5 curl -s "http://127.0.0.1:3000/api/monitoramento/robo?tarefa=varrer" >/dev/null 2>&1') | crontab -
```

## Testar

- `curl "http://127.0.0.1:3000/api/monitoramento/robo?tarefa=cobrar"` → `{ok:true,pagos,emitidos,suspensos}`
- `curl "http://127.0.0.1:3000/api/monitoramento/robo?tarefa=varrer"` → `{ok:true,varridos,avisos}`

## Observações

- A baixa dos pagamentos já é feita pelo `conciliar-auto`; o `cobrar` sincroniza
  a assinatura (marca pago, agenda o próximo boleto ou suspende).
- A varredura só roda para assinantes **ativos e em dia** (pagaram nos últimos
  ~35 dias). Só avisa processos que ainda não constavam.
- Preço configurável em `produtividade_config` chave `monit_assinatura_centavos`.

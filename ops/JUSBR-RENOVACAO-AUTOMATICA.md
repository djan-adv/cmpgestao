# jus.br (PDPJ) — renovação automática do token

**Problema:** o token do PDPJ dura ~8h e o userscript antigo só reenviava
enquanto você clicava no jus.br. Parou/fechou a aba → expirava e "saía da
sincronização", obrigando a relogar várias vezes ao dia.

**Solução:** capturar também o **refresh_token** (o gov.br/Keycloak entrega junto
com o access token). Com ele, o servidor **renova o acesso sozinho**, em segundo
plano, sem depender de aba aberta. Você loga **uma vez** e o sistema se mantém.

## O que muda

- **Userscript v2** (`/jusbr-token-sync.user.js`): além do Bearer, lê a resposta
  do endpoint de login/refresh do gov.br e captura `refresh_token`, `client_id` e
  a URL do token. Reinstale (copie por cima do antigo no Tampermonkey) e troque o
  `RELAY_SECRET`.
- **Servidor** guarda o refresh cifrado (mesma criptografia do token).
- **Renovação**: sob demanda (quando alguma consulta precisa do token e ele está
  perto de expirar) **e** por um cron a cada 20 min.

## Ativar no crontab (uma vez, no VPS)

```bash
(crontab -l 2>/dev/null; \
 echo '*/20 * * * * curl -s "http://127.0.0.1:3000/api/jusbr/refresh" >/dev/null 2>&1') | crontab -
```

## Testar / diagnosticar

- Status da sessão (mostra se a auto-renovação está armada):
  `curl "http://127.0.0.1:3000/api/jusbr/token"` (precisa de login) — campo
  `auto_renova:true` quando há refresh guardado.
- Forçar uma renovação agora e ver o resultado:
  `curl "http://127.0.0.1:3000/api/jusbr/refresh?forcar=1&debug=1"`
  → `{ ok:true, expira:... }` se renovou; se `ok:false`, o campo `detalhe`
  mostra a resposta do gov.br (ex.: refresh expirado, client_id divergente).

## Se a renovação falhar (ajuste fino)

O userscript captura `client_id` e `token_url` da própria sessão, então o padrão
deve bater. Se `?forcar=1&debug=1` acusar `client_id`/endpoint errado, me mande o
`detalhe` — os valores capturados ficam em `jusbr_sessao.oidc` e ajusto os
padrões em `app/api/jusbr/lib.js` (`TOKEN_URL_PADRAO`, `CLIENT_ID_PADRAO`).

## Limite honesto

A renovação vale enquanto a **sessão do gov.br** permitir (o refresh também tem
validade — normalmente cobre o dia de trabalho, bem mais que as 8h do access).
Quando o gov.br encerrar a sessão de vez, aí sim é preciso relogar — mas 1x, não
o dia todo.

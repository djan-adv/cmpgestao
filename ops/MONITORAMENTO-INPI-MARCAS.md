# Monitoramento de marcas no INPI (RPI de Marcas)

Acompanha processos de **marca** no INPI pela **Revista da Propriedade
Industrial (RPI)**, publicada semanalmente às **terças-feiras** em XML.
Cada despacho novo entra no **histórico da pasta** (andamentos, fonte `inpi`)
e sai um e-mail de aviso. Quando cai um despacho de **encerramento**
(arquivamento definitivo, extinção, registro concedido), o robô **suspende
sozinho** aquela marca — é só reativar pelo painel se quiser continuar.

## Como cadastrar uma marca

Painel **🛰 Monitoramento** → seção **🏛 Marcas no INPI (RPI)** → **➕ Marca INPI**.
Informe o número do processo (9 dígitos), a descrição e o CNPJ/nome do titular
para vincular à pasta (assessoria). Sem pasta vinculada, os despachos vão só
por e-mail.

## Ativar no crontab (uma vez, no VPS)

```bash
crontab -e
```

Adicione (terça 9h, depois que a RPI já saiu):

```cron
# varredura semanal da RPI de Marcas (terça, 9h)
0 9 * * 2 curl -s "http://127.0.0.1:3000/api/inpi/robo?tarefa=varrer" >/dev/null 2>&1
```

Sem abrir editor:

```bash
(crontab -l 2>/dev/null; \
 echo '0 9 * * 2 curl -s "http://127.0.0.1:3000/api/inpi/robo?tarefa=varrer" >/dev/null 2>&1') | crontab -
```

## Testar

- Uma marca só, mostrando o que foi extraído (sem gravar):
  `curl "http://127.0.0.1:3000/api/inpi/robo?tarefa=varrer&numero=944556140&debug=1&dry=1"`
- Rodar de verdade (grava histórico + e-mail):
  `curl "http://127.0.0.1:3000/api/inpi/robo?tarefa=varrer"`

Retorno: `{ ok, edicoes:[...], lancados, avisos, suspensos }`.

## Observações honestas

- Fonte: `revistas.inpi.gov.br` — listagem `/rpi/busca/data?...tipoRevista.id=5`
  e download do XML em `/xml/<nomeArquivoEscritorio>` (ZIP). O unzip é feito no
  próprio robô (zlib), sem dependência nova.
- A RPI só traz **despachos publicados** — enquanto o processo não anda, não há
  novidade (normal).
- O número do processo de marca tem **9 dígitos**; é ele que se cadastra.
- A extração dos despachos é tolerante ao layout. Na primeira rodada real no
  VPS, rode com `&debug=1&dry=1` e confira o campo `detalhe` — se o layout do
  XML exigir ajuste fino, é rápido.
- E-mail vai para `EMAIL_COPIA` (padrão `djan.adv@gmail.com`).
- Encerramento → auto-suspende. Reative no painel (▶ reativar) se necessário.

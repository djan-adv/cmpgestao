## Integração com a API da Anthropic — prompt caching (OBRIGATÓRIO)

Toda chamada à API da Anthropic neste projeto DEVE usar prompt caching nas partes fixas.

Regras:

- Ordem do prompt: tools → system → messages.
- Colocar `cache_control: {"type": "ephemeral"}` no ÚLTIMO bloco fixo (fim do system / documentação-base / definições de ferramentas).
- Conteúdo variável (nº de processo, dados do cliente, petição de entrada, timestamps) SEMPRE depois do breakpoint, nunca dentro do trecho cacheado.
- O texto do prefixo fixo tem que ser byte a byte idêntico entre chamadas.
- Nunca colocar o breakpoint num bloco que muda a cada requisição.
- Centralizar a montagem da requisição numa única função/wrapper — não espalhar `cache_control` chamada por chamada.
- Após implementar, logar `usage.cache_read_input_tokens` e `usage.cache_creation_input_tokens` para confirmar que o cache está pegando.

## Testes já DESCARTADOS — ALERTAR antes de reimplementar (OBRIGATÓRIO)

Se o usuário pedir para incluir, modificar ou "voltar a tentar" QUALQUER item da
lista abaixo, PARE e **alerte no chat** que isso já foi testado e descartado (com o
motivo), e peça confirmação explícita antes de mexer. Não reimplementar em silêncio.

Itens descartados (motivo entre parênteses):

1. Busca de processos/partes por **CPF/CNPJ** na base do CNJ (DJEN/Comunica) — a API pública só aceita **nome da parte**, não CPF/CNPJ. Adotado: busca por nome.
2. Renovação **100% automática** do acesso ao **jus.br/PDPJ** com tudo fechado — o gov.br guarda o refresh_token em **cookie HttpOnly** que o navegador não deixa o JS ler. Adotado: manter sessão do PDPJ ativa (certificado) + userscript.
3. **Login por senha** no gov.br para o PDPJ — deu falhas/instabilidade. Adotado: **certificado digital**.
4. Baixar a **íntegra dos autos pelo endpoint nativo** do PDPJ (como o "baixar autos" do PJe) — essa API do PDPJ **não expõe** esse link. Adotado: montar zip das peças (`/api/jusbr/integra`).
5. **PIX avulso "copia e cola"** no Monitoramento — PIX do Cora é dinâmico (valor na URL). Adotado: página de boleto/PIX.
6. **Cartão de crédito pela API do Cora** — conta não habilitada para cartão via integração (recusa 400). Adotado: boleto + PIX.
7. Monitorar **marcas do INPI pelo DJEN** — marcas saem na **RPI**, não no Diário da Justiça. Adotado: monitor próprio da RPI.
8. Abrir/baixar documentos do jus.br pelo **idOrigem / URL sem `/api/v2`** — devolvia a casca do visor. Correto: `hrefBinario`/`hrefTexto` (uuid do idCodex) com prefixo `/api/v2`.

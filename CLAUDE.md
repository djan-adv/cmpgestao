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

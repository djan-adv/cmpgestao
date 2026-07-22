# Como alternar o Claude Code para o modo API (quando a assinatura estourar)

Objetivo: continuar editando os sistemas mesmo quando o **limite da assinatura
Claude** for atingido. A saída é passar o Claude Code a cobrar na **API key**
(pré-pago por token), que é uma carteira **separada** da assinatura.

> A chave **nunca** vai pro repositório. Fica só na sua máquina, em
> `~/.claude/cmp-api-key`.

## 1. Pegar a API key (uma vez)

No Console da Anthropic (console.anthropic.com) → **API Keys** → crie uma chave
`sk-ant-...`. Precisa ter crédito/billing configurado na conta da API.

## 2. Guardar a chave na máquina (uma vez)

```bash
mkdir -p ~/.claude
printf 'sk-ant-SUA-CHAVE-AQUI' > ~/.claude/cmp-api-key
chmod 600 ~/.claude/cmp-api-key
```

## 3. Quando a assinatura estourar → ligar o modo API

No terminal, dentro do projeto:

```bash
source ops/claude-modo-api.sh on
claude
```

Na **primeira vez**, o Claude Code mostra um prompt pedindo pra aprovar o uso da
API key — aprove. A partir daí, aquela sessão cobra na API.

## 4. Conferir que está no modo certo

Dentro do Claude Code:

- `/status` → aparece uma linha **API key** quando a API está ativa.
- `/cost` → mostra o custo estimado por token da sessão (só existe no modo API).

## 5. Voltar pra assinatura (quando o limite resetar)

```bash
source ops/claude-modo-api.sh off
```

Isso remove a `ANTHROPIC_API_KEY` da sessão; o Claude Code volta a usar o login
da assinatura (`/login`).

---

## Notas importantes

- **Precedência de autenticação:** com a `ANTHROPIC_API_KEY` setada, ela tem
  prioridade sobre o login da assinatura (após a aprovação única). Fonte:
  https://code.claude.com/docs/en/authentication.md#authentication-precedence
- **Custo:** API é medida por token. Em sistema grande sem cache fica caro — por
  isso o `CLAUDE.md` deste projeto **exige prompt caching** em toda chamada à
  API da Anthropic. Continua valendo no modo API.
- **Você não precisa "copiar sessões".** O que você edita são os arquivos do
  repositório; basta abrir a mesma pasta. O histórico da conversa não é o que
  importa preservar.
- **Isto é pra máquina local.** Rodar "quando você estiver inativo" (notebook
  fechado) só na nuvem: Routines (`/schedule` ou claude.ai/code/routines).
- **Nunca** faça commit da chave nem de `~/.claude/.credentials.json`.
- **Alternativa persistente:** dá pra colocar a chave em
  `.claude/settings.local.json` (que fica fora do git) no campo `env`, assim não
  precisa dar `source` toda vez:
  ```json
  { "env": { "ANTHROPIC_API_KEY": "sk-ant-..." } }
  ```
  O toggle por `source` é mais seguro por não deixar a chave em arquivo do
  projeto.

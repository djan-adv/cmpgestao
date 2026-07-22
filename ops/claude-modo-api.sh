#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# claude-modo-api.sh
#
# Alterna o Claude Code entre a ASSINATURA (login /login) e o modo API
# (cobrança por token na sua ANTHROPIC_API_KEY). Serve pra continuar
# editando os sistemas quando a assinatura estourar o limite.
#
# A chave NUNCA fica no repositório. Ela é lida de um arquivo fora do git:
#   ~/.claude/cmp-api-key      (uma linha, só a chave sk-ant-...)
#
# USO (precisa dar `source`, pra alterar o shell atual):
#   source ops/claude-modo-api.sh on     # liga modo API
#   source ops/claude-modo-api.sh off    # volta pra assinatura
#   source ops/claude-modo-api.sh status # mostra o modo atual
#
# Depois, é só rodar `claude` normalmente. Na 1ª vez o Claude Code pede
# pra aprovar o uso da API key (prompt único); aprovando, passa a cobrar
# na API. Precedência de auth: ANTHROPIC_API_KEY > OAuth da assinatura.
# ---------------------------------------------------------------------------

CMP_API_KEY_FILE="${CMP_API_KEY_FILE:-$HOME/.claude/cmp-api-key}"

_cmp_api_status() {
  if [ -n "$ANTHROPIC_API_KEY" ]; then
    echo "Modo atual: API (ANTHROPIC_API_KEY setada). Cobrança por token."
    echo "Confirme no Claude Code com: /status  e  /cost"
  else
    echo "Modo atual: ASSINATURA (sem ANTHROPIC_API_KEY). Usa o login /login."
  fi
}

case "${1:-status}" in
  on|api)
    if [ ! -f "$CMP_API_KEY_FILE" ]; then
      echo "ERRO: não achei a chave em $CMP_API_KEY_FILE"
      echo "Crie o arquivo com a sua API key (Console da Anthropic):"
      echo "  mkdir -p ~/.claude && printf 'sk-ant-SUA-CHAVE' > $CMP_API_KEY_FILE && chmod 600 $CMP_API_KEY_FILE"
      return 1 2>/dev/null || exit 1
    fi
    ANTHROPIC_API_KEY="$(tr -d ' \t\r\n' < "$CMP_API_KEY_FILE")"
    export ANTHROPIC_API_KEY
    echo "OK: modo API ligado nesta sessão de terminal."
    echo "Rode 'claude' e aprove a API key no prompt inicial (1ª vez)."
    ;;
  off|assinatura|subscription)
    unset ANTHROPIC_API_KEY
    echo "OK: voltou pra ASSINATURA nesta sessão de terminal."
    ;;
  status)
    _cmp_api_status
    ;;
  *)
    echo "Uso: source ops/claude-modo-api.sh [on|off|status]"
    return 1 2>/dev/null || exit 1
    ;;
esac

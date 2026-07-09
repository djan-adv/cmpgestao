#!/usr/bin/env bash
# ============================================================================
#  backup-supabase.sh  —  Backup diário do banco do CMP Gestão (Supabase)
# ----------------------------------------------------------------------------
#  - Gera um dump DATADO por execução (cada arquivo = um ponto de restauração)
#  - Formato "custom" do PostgreSQL (compactado e restaurável com pg_restore)
#  - Mantém os últimos RETENCAO_DIAS dias (limpa os mais antigos)
#  - Envia uma cópia para o OneDrive usando rclone (opcional, se configurado)
# ============================================================================
set -euo pipefail

# ---------------------------- Configuração ---------------------------------
CONF_DIR="${HOME}/.config/cmp-backup"
ENV_FILE="${CONF_DIR}/db.env"          # deve conter: SUPABASE_DB_URL=postgres://...
BACKUP_DIR="${HOME}/cmp-backups"        # onde os dumps ficam guardados no VPS
RETENCAO_DIAS=30                        # quantos pontos de restauração manter
RCLONE_REMOTE="onedrive"               # nome do remote configurado no rclone
RCLONE_DEST="Sistema/backups"          # pasta de destino dentro do OneDrive
# ---------------------------------------------------------------------------

if [ ! -f "$ENV_FILE" ]; then
  echo "ERRO: falta o arquivo $ENV_FILE com a linha SUPABASE_DB_URL=..." >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"
: "${SUPABASE_DB_URL:?defina SUPABASE_DB_URL dentro de $ENV_FILE}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y-%m-%d_%H%M)"
OUT="${BACKUP_DIR}/cmpgestao_${STAMP}.dump"

echo "[$(date '+%F %T')] Gerando dump -> $OUT"
pg_dump "$SUPABASE_DB_URL" \
  --format=custom \
  --no-owner --no-privileges \
  --file "$OUT"

# valida que o dump não ficou vazio antes de confiar nele
if [ ! -s "$OUT" ]; then
  echo "ERRO: dump vazio — abortando e removendo arquivo." >&2
  rm -f "$OUT"
  exit 2
fi
echo "[$(date '+%F %T')] Dump OK ($(du -h "$OUT" | cut -f1))"

# --- Retenção local: apaga dumps mais antigos que RETENCAO_DIAS dias ---
find "$BACKUP_DIR" -name 'cmpgestao_*.dump' -type f -mtime +"${RETENCAO_DIAS}" -delete

# --- Cópia para o OneDrive (só se o rclone estiver configurado) ---
if command -v rclone >/dev/null 2>&1 && rclone listremotes | grep -q "^${RCLONE_REMOTE}:"; then
  echo "[$(date '+%F %T')] Enviando ao OneDrive ${RCLONE_REMOTE}:${RCLONE_DEST}"
  rclone copy "$OUT" "${RCLONE_REMOTE}:${RCLONE_DEST}"
  # espelha a retenção no OneDrive também
  rclone delete "${RCLONE_REMOTE}:${RCLONE_DEST}" --min-age "${RETENCAO_DIAS}d" --include 'cmpgestao_*.dump' || true
  echo "[$(date '+%F %T')] Cópia no OneDrive concluída."
else
  echo "AVISO: rclone não configurado — backup ficou SÓ no VPS ($BACKUP_DIR)." >&2
fi

echo "[$(date '+%F %T')] Backup concluído com sucesso."

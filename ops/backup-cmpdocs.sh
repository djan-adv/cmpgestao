#!/usr/bin/env bash
# ============================================================================
#  backup-cmpdocs.sh  —  Backup dos ARQUIVOS do CMP Gestão (/opt/cmpdocs)
# ----------------------------------------------------------------------------
#  Cobre a lacuna do backup-supabase.sh: aquele só salva o BANCO (tabelas).
#  Os documentos em si (petições, autos do jus.br, procurações etc.) vivem só
#  no disco do VPS, em /opt/cmpdocs — sem isto, um problema no disco do VPS
#  perde os arquivos sem cópia em lugar nenhum (ver ops/INCIDENTE-2026-08-02).
#
#  - Usa o MESMO remote rclone já configurado para o backup do banco.
#  - `rclone copy` (nunca `sync`): só envia o que é novo/mudou, nunca apaga
#    nada no OneDrive por conta própria — mais lento na 1ª vez, seguro depois.
#  - Sem custo adicional: usa o armazenamento do Google Drive que a conta já
#    tem, e o rclone não cobra nada para transferir.
# ============================================================================
set -euo pipefail

# ---------------------------- Configuração ---------------------------------
ORIGEM="/opt/cmpdocs"                   # pasta com os documentos no VPS
RCLONE_REMOTE="gdrive"                  # remote do Google Drive (rclone config)
RCLONE_DEST="Sistema/backups/cmpdocs"   # pasta de destino dentro do Drive
LOG_DIR="${HOME}/cmp-backups"
# ---------------------------------------------------------------------------

if [ ! -d "$ORIGEM" ]; then
  echo "ERRO: pasta $ORIGEM não existe neste servidor — nada para copiar." >&2
  exit 1
fi

if ! command -v rclone >/dev/null 2>&1; then
  echo "ERRO: rclone não instalado (ver ops/COMO-CONFIGURAR-BACKUP.md, Passo 1)." >&2
  exit 1
fi

if ! rclone listremotes | grep -q "^${RCLONE_REMOTE}:"; then
  echo "ERRO: remote '${RCLONE_REMOTE}' não configurado no rclone (ver Passo 4)." >&2
  exit 1
fi

mkdir -p "$LOG_DIR"
echo "[$(date '+%F %T')] Copiando ${ORIGEM} -> ${RCLONE_REMOTE}:${RCLONE_DEST}"
rclone copy "$ORIGEM" "${RCLONE_REMOTE}:${RCLONE_DEST}" \
  --create-empty-src-dirs \
  --stats-one-line --stats 30s

echo "[$(date '+%F %T')] Cópia dos documentos concluída."

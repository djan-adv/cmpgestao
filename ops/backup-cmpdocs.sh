#!/usr/bin/env bash
# ============================================================================
#  backup-cmpdocs.sh  —  Backup dos ARQUIVOS do CMP Gestão (/opt/cmpdocs)
# ----------------------------------------------------------------------------
#  Cobre a lacuna do backup-supabase.sh: aquele só salva o BANCO (tabelas).
#  Os documentos em si (petições, autos do jus.br, procurações etc.) vivem só
#  no disco do VPS, em /opt/cmpdocs — sem isto, um problema no disco do VPS
#  perde os arquivos sem cópia em lugar nenhum (ver ops/INCIDENTE-2026-08-02).
#
#  DUAS ÁRVORES desde 04/09/2026: os documentos do escritório da instalação
#  continuam em /opt/cmpdocs, e cada escritório CLIENTE tem a sua própria em
#  /opt/cmpdocs-inq/<id-do-escritorio> (número de processo se repete entre
#  tribunais — com uma árvore só, dois escritórios gravariam na mesma pasta).
#  Este script copia as duas: fazer backup de uma delas é perder a outra sem
#  ninguém perceber, que é exatamente como se perde arquivo.
#
#  - Usa o MESMO remote rclone já configurado para o backup do banco.
#  - `rclone copy` (nunca `sync`): só envia o que é novo/mudou, nunca apaga
#    nada no OneDrive por conta própria — mais lento na 1ª vez, seguro depois.
#  - Sem custo adicional: usa o armazenamento do Google Drive que a conta já
#    tem, e o rclone não cobra nada para transferir.
# ============================================================================
set -euo pipefail

# ---------------------------- Configuração ---------------------------------
ORIGEM="/opt/cmpdocs"                   # documentos do escritório da instalação
ORIGEM_INQ="/opt/cmpdocs-inq"           # documentos dos escritórios clientes
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

# Escritórios clientes: a pasta só existe depois que o primeiro deles guarda
# documento, então a ausência dela é normal — não é erro.
if [ -d "$ORIGEM_INQ" ]; then
  echo "[$(date '+%F %T')] Copiando ${ORIGEM_INQ} -> ${RCLONE_REMOTE}:${RCLONE_DEST}-inq"
  rclone copy "$ORIGEM_INQ" "${RCLONE_REMOTE}:${RCLONE_DEST}-inq" \
    --create-empty-src-dirs \
    --stats-one-line --stats 30s
else
  echo "[$(date '+%F %T')] Sem ${ORIGEM_INQ} (nenhum escritório cliente guardou documento ainda)."
fi

echo "[$(date '+%F %T')] Cópia dos documentos concluída."

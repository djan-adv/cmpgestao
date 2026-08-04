#!/usr/bin/env bash
# ============================================================================
#  backup-assinador.sh  —  Backup COMPLETO do projeto Supabase do assinador
#                          (fjboytucivmdykkfpdhs) ANTES de apagá-lo
# ----------------------------------------------------------------------------
#  Este NÃO é um backup recorrente como o backup-supabase.sh. É um retrato
#  ÚNICO, tirado antes da migração para o schema `assinatura` do banco do
#  Gestão. O passo 11 do plano (ops/MIGRACAO-ASSINADOR.md) APAGA o projeto
#  antigo, e projeto apagado não volta — nem no plano Pro. Este arquivo é a
#  única rede de segurança.
#
#  O que ele guarda:
#    1. dump.custom   — banco inteiro, restaurável com pg_restore
#    2. schema.sql    — o mesmo banco em SQL legível (fonte dos passos 3 e 4)
#    3. storage/      — os 43 objetos dos 3 buckets, na estrutura bucket/nome
#    4. buckets.tsv   — configuração dos buckets (quem é público)
#    5. MANIFEST.txt  — sha256 de tudo + contagens, para conferir depois
#
#  NÃO envia nada para a nuvem. É de propósito: o dump tem nome, e-mail, CPF
#  e telefone de cliente, e os arquivos são procurações assinadas de processos
#  de terceiros. Fica só no VPS. Se quiser uma segunda cópia, tire você mesmo
#  para um disco seu — não para o Drive do escritório.
# ============================================================================
set -euo pipefail

# ---------------------------- Configuração ---------------------------------
CONF_DIR="${HOME}/.config/cmp-backup"
ENV_FILE="${CONF_DIR}/assinador.env"
BACKUP_RAIZ="${HOME}/cmp-backups/assinador"
OBJETOS_ESPERADOS=43        # conferido em 04/08/2026: 19 documentos + 21 assinaturas + 3 app
# ---------------------------------------------------------------------------

if [ ! -f "$ENV_FILE" ]; then
  cat >&2 <<FIM
ERRO: falta o arquivo $ENV_FILE

Crie assim (no VPS):

  mkdir -p $CONF_DIR
  nano $ENV_FILE

Com estas três linhas (valores reais do projeto DO ASSINADOR):

  SIGN_DB_URL=postgresql://postgres:SENHA@db.fjboytucivmdykkfpdhs.supabase.co:5432/postgres
  SIGN_SERVICE_ROLE_KEY=eyJ...
  SIGN_PROJECT_REF=fjboytucivmdykkfpdhs

E proteja:  chmod 600 $ENV_FILE
FIM
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"
: "${SIGN_DB_URL:?defina SIGN_DB_URL dentro de $ENV_FILE}"
: "${SIGN_SERVICE_ROLE_KEY:?defina SIGN_SERVICE_ROLE_KEY dentro de $ENV_FILE}"
SIGN_PROJECT_REF="${SIGN_PROJECT_REF:-fjboytucivmdykkfpdhs}"
API="https://${SIGN_PROJECT_REF}.supabase.co"

for bin in pg_dump psql curl sha256sum; do
  command -v "$bin" >/dev/null 2>&1 || { echo "ERRO: falta o comando '$bin'." >&2; exit 1; }
done

# O servidor é PostgreSQL 17.6 — client 16 ou anterior recusa o dump.
VER_CLIENT="$(pg_dump --version | grep -oE '[0-9]+' | head -1)"
if [ "$VER_CLIENT" -lt 17 ]; then
  echo "ERRO: pg_dump é $VER_CLIENT.x e o servidor é 17.x. Instale postgresql-client-17." >&2
  echo "      (ver ops/COMO-CONFIGURAR-BACKUP.md, Passo 1)" >&2
  exit 1
fi

STAMP="$(date +%Y-%m-%d_%H%M)"
DEST="${BACKUP_RAIZ}/${STAMP}"
mkdir -p "${DEST}/storage"

log() { echo "[$(date '+%F %T')] $*"; }

# ------------------------- 1. Banco: dump restaurável -----------------------
log "Dump do banco (formato custom) ..."
pg_dump "$SIGN_DB_URL" \
  --format=custom --no-owner --no-privileges \
  --file "${DEST}/dump.custom"
[ -s "${DEST}/dump.custom" ] || { echo "ERRO: dump.custom vazio — abortando." >&2; exit 2; }
log "  dump.custom OK ($(du -h "${DEST}/dump.custom" | cut -f1))"

# ------------------------- 2. Banco: SQL legível ----------------------------
# Serve de FONTE para os passos 3 e 4 (recriar tabelas e funções no schema
# `assinatura`). Ler daqui, não reconstruir de memória.
log "Dump do banco (SQL legível, schema public) ..."
pg_dump "$SIGN_DB_URL" \
  --format=plain --no-owner --no-privileges --schema=public \
  --file "${DEST}/schema.sql"
[ -s "${DEST}/schema.sql" ] || { echo "ERRO: schema.sql vazio — abortando." >&2; exit 2; }
log "  schema.sql OK ($(du -h "${DEST}/schema.sql" | cut -f1))"

# ------------------------- 3. Configuração dos buckets ----------------------
log "Configuração dos buckets ..."
psql "$SIGN_DB_URL" -At -F $'\t' \
  -c "select id, public, coalesce(file_size_limit::text,'-'), coalesce(allowed_mime_types::text,'-') from storage.buckets order by id" \
  > "${DEST}/buckets.tsv"
cat "${DEST}/buckets.tsv"

# ------------------------- 4. Storage: os objetos ---------------------------
# Lista pelo banco (não pela API) para garantir que a contagem casa com o dump.
psql "$SIGN_DB_URL" -At -F $'\t' \
  -c "select bucket_id, name from storage.objects order by bucket_id, name" \
  > "${DEST}/storage-lista.tsv"

TOTAL="$(wc -l < "${DEST}/storage-lista.tsv" | tr -d ' ')"
log "Baixando ${TOTAL} objetos de storage ..."

# codifica o caminho para a URL (nomes podem ter espaço ou acento)
urlencode() {
  if command -v python3 >/dev/null 2>&1; then
    python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$1"
  else
    printf '%s' "$1" | jq -sRr @uri
  fi
}

BAIXADOS=0
FALHAS=0
while IFS=$'\t' read -r bucket nome; do
  [ -n "${bucket:-}" ] || continue
  alvo="${DEST}/storage/${bucket}/${nome}"
  mkdir -p "$(dirname "$alvo")"
  if curl -sS -f --retry 3 --retry-delay 2 \
       -H "Authorization: Bearer ${SIGN_SERVICE_ROLE_KEY}" \
       -o "$alvo" \
       "${API}/storage/v1/object/${bucket}/$(urlencode "$nome")"
  then
    BAIXADOS=$((BAIXADOS + 1))
  else
    echo "  FALHOU: ${bucket}/${nome}" >&2
    FALHAS=$((FALHAS + 1))
  fi
done < "${DEST}/storage-lista.tsv"

log "  baixados ${BAIXADOS}, falhas ${FALHAS}"

# ------------------------- 5. Manifesto e conferência -----------------------
log "Gerando MANIFEST.txt ..."
{
  echo "Backup do projeto Supabase do assinador"
  echo "projeto:            ${SIGN_PROJECT_REF}"
  echo "gerado em:          $(date '+%F %T %Z')"
  echo "servidor postgres:  $(psql "$SIGN_DB_URL" -Atc 'show server_version' 2>/dev/null || echo '?')"
  echo "objetos esperados:  ${OBJETOS_ESPERADOS}"
  echo "objetos baixados:   ${BAIXADOS}"
  echo "falhas:             ${FALHAS}"
  echo
  echo "linhas por tabela:"
  psql "$SIGN_DB_URL" -At -F $'\t' -c "
    select 'documentos', count(*) from public.documentos
    union all select 'signatarios', count(*) from public.signatarios
    union all select 'eventos_auditoria', count(*) from public.eventos_auditoria
    union all select 'otp_codigos', count(*) from public.otp_codigos
    order by 1" | sed 's/^/  /'
  echo
  echo "sha256:"
  ( cd "$DEST" && find . -type f ! -name MANIFEST.txt -print0 | sort -z | xargs -0 sha256sum )
} > "${DEST}/MANIFEST.txt"

chmod -R go-rwx "$DEST"

echo
log "Backup em: $DEST"
du -sh "$DEST"

if [ "$FALHAS" -ne 0 ]; then
  echo >&2
  echo "ATENÇÃO: ${FALHAS} objeto(s) não baixaram. NÃO siga para o passo 11 assim." >&2
  exit 3
fi
if [ "$BAIXADOS" -ne "$OBJETOS_ESPERADOS" ]; then
  echo >&2
  echo "ATENÇÃO: baixados ${BAIXADOS}, esperados ${OBJETOS_ESPERADOS}." >&2
  echo "         Se documentos novos foram criados desde 04/08/2026, isso é normal —" >&2
  echo "         confira a lista em storage-lista.tsv e ajuste OBJETOS_ESPERADOS." >&2
  exit 4
fi

log "Backup completo e conferido. Pode seguir para o passo 2 da migração."

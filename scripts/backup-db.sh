#!/usr/bin/env bash
# Backup do PostgreSQL em arquivo .dump (formato custom). Uso: DATABASE_URL=... ./scripts/backup-db.sh [pasta]
# Guarde a cópia FORA do servidor (Spaces, S3, outro computador). Mantém os últimos 14 arquivos da pasta.
set -euo pipefail
: "${DATABASE_URL:?Defina DATABASE_URL (a mesma do app)}"
dir="${1:-./backups}"
mkdir -p "$dir"
file="$dir/placanamao-$(date +%Y%m%d-%H%M%S).dump"
pg_dump --format=custom --no-owner --no-privileges --file="$file" "$DATABASE_URL"
pg_restore --list "$file" > /dev/null   # confere que o arquivo abre
ls -1t "$dir"/placanamao-*.dump | tail -n +15 | xargs -r rm -f
echo "Backup ok: $file ($(du -h "$file" | cut -f1))"

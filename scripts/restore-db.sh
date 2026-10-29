#!/usr/bin/env bash
# Restaura um backup .dump em um banco VAZIO (use para ensaiar a restauração, nunca direto na produção).
# Uso: TARGET_DATABASE_URL=postgresql://.../banco_teste ./scripts/restore-db.sh arquivo.dump
set -euo pipefail
: "${TARGET_DATABASE_URL:?Defina TARGET_DATABASE_URL (banco de destino vazio)}"
file="${1:?Informe o arquivo .dump}"
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$TARGET_DATABASE_URL" "$file"
psql "$TARGET_DATABASE_URL" -Atc "select 'migracoes: '||count(*) from schema_migrations; select 'usuarios: '||count(*) from users;"
echo "Restauração concluída. Compare os números acima com a produção."

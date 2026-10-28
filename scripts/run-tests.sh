#!/usr/bin/env bash
# AMBER — test runner (Ch. 9): fresh test DB, push schema, run bun test.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -f db/test.db
DATABASE_URL="file:$(pwd)/db/test.db" bunx prisma db push --schema prisma/schema.prisma --skip-generate >/dev/null 2>&1
echo "test db ready"
exec bun test tests/ "$@"

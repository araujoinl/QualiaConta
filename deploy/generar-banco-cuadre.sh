#!/usr/bin/env bash
# Regenera el esperado del banco de cuadre (F4, prec. 9) desde cuadre.py y
# corre el banco en Deno. Si cuadre.py cambia, esto es UN comando.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 empresas/blackbox/hermes/memoria/scripts/dump-cuadre-esperado.py \
  > supabase/functions/_shared/cuadre-esperado.json
deno test --allow-read supabase/functions/_shared/cuadre.test.ts

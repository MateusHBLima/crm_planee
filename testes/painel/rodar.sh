#!/usr/bin/env bash
# Roda os testes do login e do quadro de atendimento contra um Postgres LOCAL e descartável.
# Uso (na raiz do repositório):
#   DATABASE_URL=postgres://postgres@localhost:5432/painel_teste testes/painel/rodar.sh
# O banco é apagado e recriado. Por isso o script recusa qualquer endereço que não seja localhost.
set -euo pipefail
cd "$(dirname "$0")/../.."
RAIZ=$(pwd); T="$RAIZ/testes/painel"
: "${DATABASE_URL:?Defina DATABASE_URL de um Postgres local descartável}"
case "$DATABASE_URL" in *@localhost*|*@127.0.0.1*) ;; *) echo "Recusado: DATABASE_URL precisa ser local."; exit 1;; esac
PORTA_APP=${PORTA_APP:-3100}; PORTA_AUTH=${PORTA_AUTH:-54321}
export BASE_URL="http://localhost:$PORTA_APP"

echo "1/5 Banco: recria o schema e aplica as migrações 001, 002, 003 e a semente fictícia"
psql -q "$DATABASE_URL" -c "drop schema public cascade; create schema public;"
for f in supabase/migrations/001_crm_api.sql supabase/migrations/002_semente_ficticia.sql supabase/migrations/003_painel_login.sql "$T/semente.sql"; do
  psql -q -v ON_ERROR_STOP=1 "$DATABASE_URL" -f "$f" >/dev/null
done

echo "2/5 Dependências dos testes"
(cd "$T" && npm install --no-audit --no-fund --silent)
[ -n "${CHROMIUM_PATH:-}" ] || (cd "$T" && npx playwright install chromium >/dev/null)

sobe_auth() { TTL=$1 PORTA=$PORTA_AUTH node "$T/auth-falso.js" > /dev/null 2>&1 & AUTH_PID=$!; sleep 1; }
para() { for p in ${APP_PID:-} ${AUTH_PID:-}; do pkill -P "$p" 2>/dev/null || true; kill "$p" 2>/dev/null || true; done; }
trap para EXIT

echo "3/5 App: build e start com o Auth falso"
sobe_auth 3600
export SUPABASE_URL="http://localhost:$PORTA_AUTH" SUPABASE_ANON_KEY=anon-teste PAINEL_CLIENTE_NOME="Clínica de teste"
if curl -s -o /dev/null "$BASE_URL"; then echo "Porta $PORTA_APP ocupada: pare o app que está nela."; exit 1; fi
npm run build >/dev/null
node node_modules/next/dist/bin/next start -p "$PORTA_APP" > /dev/null 2>&1 & APP_PID=$!
for i in $(seq 1 30); do curl -sf "$BASE_URL/entrar" >/dev/null && break; sleep 1; done

echo "4/5 Testes de ponta a ponta"
node "$T/e2e.js"

echo "5/5 Renovação do token (Auth com token de 30 s)"
kill $AUTH_PID; sobe_auth 30
node "$T/renovacao.js"

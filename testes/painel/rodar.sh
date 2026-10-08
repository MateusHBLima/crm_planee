#!/usr/bin/env bash
# Roda os testes do login, do quadro de atendimento e da inbox contra um Postgres LOCAL e descartável.
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

echo "1/12 Banco: recria o schema, aplica as migrações 001 a 017 e a semente fictícia; cria o banco da 2ª empresa"
psql -q "$DATABASE_URL" -c "drop schema public cascade; create schema public;"
for f in supabase/migrations/001_crm_api.sql supabase/migrations/002_semente_ficticia.sql supabase/migrations/003_painel_login.sql "$T/semente.sql" \
         supabase/migrations/004_central_empresas.sql supabase/migrations/005_dados_auditoria_sem_fk.sql \
         supabase/migrations/006_convite_primeiro_acesso.sql supabase/migrations/007_whatsapp_central.sql \
         supabase/migrations/008_whatsapp_dados.sql supabase/migrations/009_whatsapp_dono.sql supabase/migrations/013_servicos_pagamentos.sql supabase/migrations/014_comprovante_campos.sql \
         supabase/migrations/015_avisos_central.sql supabase/migrations/016_avisos_dados.sql supabase/migrations/017_automaticas.sql; do
  psql -q -v ON_ERROR_STOP=1 "$DATABASE_URL" -f "$f" >/dev/null
done
# Banco de dados próprio de uma segunda empresa (decisão 26): mesmo modelo, dados diferentes.
export OUTRA_DATABASE_URL="${DATABASE_URL%/*}/painel_teste_outra"
psql -q "${DATABASE_URL%/*}/postgres" -c "drop database if exists painel_teste_outra" -c "create database painel_teste_outra" >/dev/null
for f in supabase/migrations/001_crm_api.sql supabase/migrations/002_semente_ficticia.sql supabase/migrations/003_painel_login.sql supabase/migrations/005_dados_auditoria_sem_fk.sql supabase/migrations/008_whatsapp_dados.sql supabase/migrations/009_whatsapp_dono.sql supabase/migrations/013_servicos_pagamentos.sql supabase/migrations/014_comprovante_campos.sql supabase/migrations/016_avisos_dados.sql supabase/migrations/017_automaticas.sql; do
  psql -q -v ON_ERROR_STOP=1 "$OUTRA_DATABASE_URL" -f "$f" >/dev/null
done
psql -q "$OUTRA_DATABASE_URL" -c "delete from notas; delete from atendimentos; insert into atendimentos (contato_id, topico_id, resumo, aberto_por) values ('00000000-0000-4000-8000-000000000001','receita','Cartão só da Clínica Outra','IA')" >/dev/null

echo "2/12 Dependências dos testes"
(cd "$T" && npm install --no-audit --no-fund --silent)
[ -n "${CHROMIUM_PATH:-}" ] || (cd "$T" && npx playwright install chromium >/dev/null)

sobe_auth() { TTL=$1 PORTA=$PORTA_AUTH node "$T/auth-falso.js" > /dev/null 2>&1 & AUTH_PID=$!; sleep 1; }
para() { for p in ${APP_PID:-} ${AUTH_PID:-}; do pkill -P "$p" 2>/dev/null || true; kill "$p" 2>/dev/null || true; done; }
trap para EXIT

echo "3/12 App: build e start com o Auth falso"
sobe_auth 3600
export SUPABASE_URL="http://localhost:$PORTA_AUTH" SUPABASE_ANON_KEY=anon-teste PAINEL_CHAVE_CIFRA="chave-de-teste-local-com-mais-de-32-caracteres"
# Webhook "painel_enviar" do n8n: um falso que o inbox.js sobe nesta porta (resposta pelo painel, fase 2.3).
export PORTA_N8N=${PORTA_N8N:-3999}
export N8N_WEBHOOK_PAINEL_ENVIAR="http://127.0.0.1:$PORTA_N8N/painel-enviar" N8N_WEBHOOK_SEGREDO="segredo-n8n-de-teste"
export N8N_WEBHOOK_PAINEL_RETOMAR="http://127.0.0.1:$PORTA_N8N/painel-retomar"
if curl -s -o /dev/null "$BASE_URL"; then echo "Porta $PORTA_APP ocupada: pare o app que está nela."; exit 1; fi
npm run build >/dev/null
node node_modules/next/dist/bin/next start -p "$PORTA_APP" > /dev/null 2>&1 & APP_PID=$!
for i in $(seq 1 30); do curl -sf "$BASE_URL/entrar" >/dev/null && break; sleep 1; done

echo "4/12 Testes de ponta a ponta"
node "$T/e2e.js"

echo "5/12 CRM completo: criar e editar pela tela, Configurações, avisos, ficha e funil da IA"
node "$T/crm-completo.js"

echo "6/12 Empresas, domínios, níveis e permissões (banco central)"
node "$T/central.js"

echo "7/12 Inbox: lista, conversa, não lidas, CPF e auditoria do master, isolamento, permissão, resposta pelo painel"
node "$T/inbox.js"

echo "8/12 Avisos para a Planee: menu da mensagem, fila do Interno, resposta, novidades, integrações, vigia e saúde"
node "$T/avisos.js"

echo "9/12 Mensagens automáticas da IA: recusa, registro de envios, ficha, histórico, selo e filtro de follow-up"
node "$T/automaticas.js"

echo "10/12 Velocidade: leitura comprimida, resumo cortado, clique na hora, conversa antecipada, memória da aba"
node "$T/velocidade.js"

echo "11/12 Segurança: cabeçalhos, Traefik, redirecionamento, CPF na API, sombra, conflito, limite de tentativas"
node "$T/seguranca.js"

echo "12/12 Renovação do token (Auth com token de 30 s)"
kill $AUTH_PID; sobe_auth 30
node "$T/renovacao.js"

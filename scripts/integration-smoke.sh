#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:4000}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

fail() { echo "FALHA: $1" >&2; exit 1; }
json_field() { sed -n "s/.*\"$1\":\"\([^\"]*\)\".*/\1/p"; }
assert_contains() { grep -Fq "$2" "$1" || fail "esperado encontrar '$2' em $1"; }

curl -fsS "$BASE_URL/health" >"$TMP_DIR/health.json"
assert_contains "$TMP_DIR/health.json" '"ok":true'
assert_contains "$TMP_DIR/health.json" '"database":"ok"'

echo '✓ healthcheck com banco'

curl -fsS -X POST "$BASE_URL/api/auth/login" \
  -H 'Content-Type: application/json' \
  --data '{"email":"cliente@demo.local","password":"Demo@123456"}' >"$TMP_DIR/login.json"
TOKEN="$(cat "$TMP_DIR/login.json" | json_field token)"
[ -n "$TOKEN" ] || fail 'token de login não retornado'
AUTH=(-H "Authorization: Bearer $TOKEN")
echo '✓ login sandbox'

curl -fsS "$BASE_URL/api/me" "${AUTH[@]}" >"$TMP_DIR/me-before.json"
assert_contains "$TMP_DIR/me-before.json" '"balanceCents":10000'
echo '✓ saldo inicial de R$ 100,00'

IDEMPOTENCY_KEY='integration-query-0001'
curl -fsS -X POST "$BASE_URL/api/queries" "${AUTH[@]}" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  --data '{"plate":"TST0A00","productId":"COMPLETE"}' >"$TMP_DIR/query.json"
QUERY_ID="$(cat "$TMP_DIR/query.json" | json_field id)"
[ -n "$QUERY_ID" ] || fail 'id de consulta não retornado'
assert_contains "$TMP_DIR/query.json" '"status":"SUCCESS"'
assert_contains "$TMP_DIR/query.json" '"plate":"TST0A00"'
echo '✓ consulta mock concluída'

IDEMPOTENT_STATUS="$(curl -sS -o "$TMP_DIR/idempotent.json" -w '%{http_code}' -X POST "$BASE_URL/api/queries" "${AUTH[@]}" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  --data '{"plate":"TST0A00","productId":"COMPLETE"}')"
[ "$IDEMPOTENT_STATUS" = '200' ] || fail "idempotência retornou HTTP $IDEMPOTENT_STATUS"
assert_contains "$TMP_DIR/idempotent.json" '"idempotent":true'
echo '✓ idempotência sem cobrança duplicada'

curl -fsS "$BASE_URL/api/me" "${AUTH[@]}" >"$TMP_DIR/me-after-query.json"
assert_contains "$TMP_DIR/me-after-query.json" '"balanceCents":8800'
echo '✓ débito monetário correto'

curl -fsS "$BASE_URL/api/queries/$QUERY_ID" "${AUTH[@]}" >"$TMP_DIR/saved.json"
assert_contains "$TMP_DIR/saved.json" '"status":"SUCCESS"'
curl -fsS "$BASE_URL/api/me" "${AUTH[@]}" >"$TMP_DIR/me-after-open.json"
assert_contains "$TMP_DIR/me-after-open.json" '"balanceCents":8800'
echo '✓ consulta salva aberta sem nova cobrança'

TIMEOUT_STATUS="$(curl -sS -o "$TMP_DIR/timeout.json" -w '%{http_code}' -X POST "$BASE_URL/api/queries" "${AUTH[@]}" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: integration-timeout-0001' \
  --data '{"plate":"TIM0E00","productId":"COMPLETE"}')"
[ "$TIMEOUT_STATUS" = '502' ] || fail "timeout retornou HTTP $TIMEOUT_STATUS"
assert_contains "$TMP_DIR/timeout.json" '"error":"QUERY_RETRY_AVAILABLE"'
assert_contains "$TMP_DIR/timeout.json" 'saldo será estornado'
curl -fsS "$BASE_URL/api/me" "${AUTH[@]}" >"$TMP_DIR/me-after-timeout.json"
assert_contains "$TMP_DIR/me-after-timeout.json" '"balanceCents":8800'
echo '✓ falha do provedor estorna saldo'

curl -fsS "$BASE_URL/api/queries?plate=TST" "${AUTH[@]}" >"$TMP_DIR/history.json"
assert_contains "$TMP_DIR/history.json" '"plate":"TST0A00"'
echo '✓ histórico filtrável disponível'

curl -fsS -X POST "$BASE_URL/api/auth/login" -H 'Content-Type: application/json' \
  --data '{"email":"admin@demo.local","password":"Admin@123456"}' >"$TMP_DIR/admin-login.json"
ADMIN_TOKEN="$(cat "$TMP_DIR/admin-login.json" | json_field token)"
[ -n "$ADMIN_TOKEN" ] || fail 'token de administrador não retornado'
curl -fsS "$BASE_URL/api/admin/overview" -H "Authorization: Bearer $ADMIN_TOKEN" >"$TMP_DIR/admin.json"
assert_contains "$TMP_DIR/admin.json" '"queries_today"'
echo '✓ rota administrativa protegida por permissão'

REGISTER_EMAIL="novo.usuario.$(date +%s)@example.test"
curl -fsS -X POST "$BASE_URL/api/auth/register" \
  -H 'Content-Type: application/json' \
  --data "{\"name\":\"Novo Usuario\",\"email\":\"$REGISTER_EMAIL\",\"password\":\"SenhaSegura@2026\",\"acceptTerms\":true,\"acceptPrivacy\":true,\"marketingOptIn\":false}" >"$TMP_DIR/register.json"
REGISTER_TOKEN="$(cat "$TMP_DIR/register.json" | json_field token)"
[ -n "$REGISTER_TOKEN" ] || fail 'token de cadastro não retornado'
REGISTER_AUTH=(-H "Authorization: Bearer $REGISTER_TOKEN")
curl -fsS "$BASE_URL/api/me" "${REGISTER_AUTH[@]}" >"$TMP_DIR/registered-me.json"
assert_contains "$TMP_DIR/registered-me.json" '"balanceCents":0'
LOGOUT_STATUS="$(curl -sS -o "$TMP_DIR/logout.json" -w '%{http_code}' -X POST "$BASE_URL/api/auth/logout" "${REGISTER_AUTH[@]}")"
[ "$LOGOUT_STATUS" = '204' ] || fail "logout retornou HTTP $LOGOUT_STATUS"
REVOKED_STATUS="$(curl -sS -o "$TMP_DIR/revoked.json" -w '%{http_code}' "$BASE_URL/api/me" "${REGISTER_AUTH[@]}")"
[ "$REVOKED_STATUS" = '401' ] || fail "sessão revogada retornou HTTP $REVOKED_STATUS"
echo '✓ cadastro com consentimentos e sessão revogável'

curl -fsS "$BASE_URL/api/auth/providers" >"$TMP_DIR/providers.json"
assert_contains "$TMP_DIR/providers.json" '"google"'
assert_contains "$TMP_DIR/providers.json" '"enabled":false'
echo '✓ provedores sociais expostos com ativação controlada por runtime'

curl -fsS "$BASE_URL/api/credit-packages" "${AUTH[@]}" >"$TMP_DIR/packages.json"
assert_contains "$TMP_DIR/packages.json" '"slug":"essencial"'
assert_contains "$TMP_DIR/packages.json" '"credits":10'
echo '✓ migrations de pacotes de crédito aplicadas'

CHECKOUT_STATUS="$(curl -sS -o "$TMP_DIR/checkout.json" -w '%{http_code}' -X POST "$BASE_URL/api/payments/checkout" "${AUTH[@]}" \
  -H 'Content-Type: application/json' --data '{"packageSlug":"essencial"}')"
[ "$CHECKOUT_STATUS" = '503' ] || fail "checkout não configurado retornou HTTP $CHECKOUT_STATUS"
assert_contains "$TMP_DIR/checkout.json" 'PAYMENT_PROVIDER_NOT_CONFIGURED'
echo '✓ checkout bloqueado com segurança enquanto faltam credenciais externas'

echo 'VALIDAÇÃO INTEGRADA: APROVADA'

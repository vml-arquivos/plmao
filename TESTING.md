# Testes e validação

## Suíte automatizada

Usa o runner nativo do Node contra PostgreSQL real (um banco descartável por execução de teste):

```bash
docker run -d --name pnm-pg -e POSTGRES_PASSWORD=test -p 54329:5432 postgres:16-alpine
export TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:54329/plmao_test
npm test        # build + node --test --test-concurrency=1 apps/api/test/*.test.mjs
```

Cobertura por área: motor de preço e trava de margem, liquidação idempotente e comissões/repasses/estornos, relatório v2 e máscara LGPD, estorno de consultas, 2FA/TOTP e separação cliente×equipe, API pública, migrations, validação de configuração de produção, Asaas/Mercado Pago, SEO e funil, controles de segurança de código-fonte.

## Smoke integrado

Sobe contra um servidor real com `DATA_PROVIDER=mock`, `PAYMENT_PROVIDER=sandbox`, `SANDBOX_SEED_ENABLED=true` e **banco recém-criado** (o script verifica saldo inicial):

```bash
BASE_URL=http://127.0.0.1:4000 npm run test:integration
```

Valida login, débito em centavos, idempotência, estorno por falha do provedor, histórico, separação do painel (2FA exigido, token de cliente recusado), cadastro/consentimentos, sessão revogável, checkout bloqueado sem credenciais, catálogo, `robots.txt`, `sitemap.xml` e título por rota.

## Release

`npm run release:verify` executa build, todos os testes, `npm audit --omit=dev --audit-level=high` e a checagem de fontes (`scripts/release-verify.mjs`).

## Imagem Docker

```bash
docker build -t placanamao .
docker run --rm -p 4000:4000 --env-file <seu-env> placanamao   # /health deve responder ok:true
```

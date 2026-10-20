# Deploy no Coolify

## Configuração da aplicação

Crie a aplicação usando **Dockerfile**, com base `/`, localização `/Dockerfile`, porta interna `4000` e healthcheck em `/health`. A API serve o build React e as rotas de API no mesmo processo; configure um único domínio, por exemplo `https://carpivara.casadf.com.br`.

O Dockerfile é multi-stage, executa o build dos dois workspaces e roda como usuário não-root. Nenhum segredo é copiado para a imagem durante o build.

## Banco PostgreSQL

Crie um PostgreSQL separado no mesmo projeto/servidor e informe a connection string interna em `DATABASE_URL`. O startup executa o bootstrap compatível e migrations versionadas antes de abrir a aplicação.

## Variáveis obrigatórias de produção

Cadastre as variáveis no painel do Coolify. Não use arquivo `.env` versionado e não reutilize nenhum segredo local.

```dotenv
NODE_ENV=production
PORT=4000
APP_NAME=Carpivara
APP_URL=https://carpivara.casadf.com.br
WEB_ORIGIN=https://carpivara.casadf.com.br
TRUST_PROXY=1

# Recuperação de senha por e-mail — configure somente no runtime do Coolify.
EMAIL_PROVIDER=smtp
SMTP_HOST=SEU_HOST_SMTP
SMTP_PORT=587
SMTP_USER=SEU_USUARIO_SMTP
SMTP_PASSWORD=SEU_SEGREDO_SMTP
SMTP_SECURE=false
EMAIL_FROM=no-reply@carpivara.casadf.com.br
PASSWORD_RESET_TTL_MINUTES=30
DATABASE_URL=postgresql://USUARIO:SENHA@HOST_INTERNO:5432/NOME_BANCO
DATABASE_SSL=false
MIGRATION_LOCK_TIMEOUT_MS=60000
JWT_SECRET=GERAR_UM_SEGREDO_ALEATORIO_COM_64_OU_MAIS_CARACTERES
JWT_EXPIRES_IN=2h
TEAM_TOTP_REQUIRED=false

DATA_PROVIDER=real
VEHICLE_API_BASE_URL=https://ENDPOINT_OFICIAL_DO_FORNECEDOR
VEHICLE_API_QUERY_PATH=/CAMINHO_DOCUMENTADO
VEHICLE_API_QUERY_METHOD=post
VEHICLE_API_AUTH_SCHEME=bearer
VEHICLE_API_TOKEN=SEGREDO_RUNTIME_DO_FORNECEDOR
QUERY_REQUEST_TIMEOUT_MS=20000
# Use disabled até haver contrato e credenciais completas do gateway.
PAYMENT_PROVIDER=disabled
PAYMENT_API_BASE_URL=
PAYMENT_API_KEY=
PAYMENT_WEBHOOK_SECRET=
SANDBOX_SEED_ENABLED=false
SANDBOX_CREDIT_PURCHASE_ENABLED=false

RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=120
LOGIN_RATE_LIMIT_MAX=10
LOG_LEVEL=info
LOG_SENSITIVE_DATA=false
AUDIT_LOG_ENABLED=true
STORE_RAW_PROVIDER_RESPONSE=false
```

O processo falha antes de abrir a porta se faltar banco, segredo forte, URL HTTPS ou credencial de um provider habilitado. Com `PAYMENT_PROVIDER=disabled`, checkout e webhook permanecem indisponíveis de forma explícita e nenhum saldo é liberado. Os valores acima são nomes ilustrativos; nunca copie segredos reais para este arquivo.

## Homologação sandbox

Em ambiente separado e não público, use `NODE_ENV=development` ou `test`, `DATA_PROVIDER=mock`, `SANDBOX_SEED_ENABLED=true` e `SANDBOX_CREDIT_PURCHASE_ENABLED=true` para executar `scripts/integration-smoke.sh`. Nunca reutilize esse conjunto em produção.

## Provider e pagamentos reais

Ative `DATA_PROVIDER=real` e somente o gateway contratado após confirmar contrato, endpoint, token, webhook assinado e matriz de homologação. Crédito e entitlement dependem do webhook validado, não do retorno do navegador.

## Diagnóstico de deploy

| Sintoma | Verificação |
| --- | --- |
| Healthcheck falha | Confirme `DATABASE_URL`, acesso de rede ao PostgreSQL e logs de migration. |
| Login falha | Confirme `DATABASE_URL`, usuários provisionados, `TEAM_TOTP_REQUIRED` e limite de login. |
| Recuperação não envia e-mail | Confirme `EMAIL_PROVIDER=smtp`, host, porta, usuário, senha, remetente autorizado e os logs de entrega do provedor. |
| Frontend abre sem API | Confirme o domínio único e proxy para a porta `4000`. |
| Consulta falha em sandbox | Confirme `DATA_PROVIDER=mock` e `SANDBOX_SEED_ENABLED=true` somente em ambiente de demonstração. |

> Credenciais de banco, JWT, provider e pagamentos devem existir somente como variáveis de runtime do Coolify. Nunca as coloque no Git, Dockerfile, logs ou argumentos de build.

# Deploy no Coolify

Este produto é **independente**: crie um projeto, um PostgreSQL, segredos e domínios novos. Nada é herdado de outro sistema; copie apenas os *nomes* das variáveis, nunca os valores antigos.

## Aplicação

- Build pack **Dockerfile** em `/Dockerfile`, porta interna `4000`, healthcheck `GET /health` (`{"ok":true,"database":"ok"}`).
- A API serve o front React e a API no mesmo processo. Cadastre **dois domínios** apontando para a mesma aplicação:
  - site: `https://placanamao.com.br` (provisório)
  - painel: `https://admin.placanamao.com.br` (provisório; informe-o em `ADMIN_HOSTS`)
- O Dockerfile é multi-stage e roda como usuário não-root; nenhum segredo entra na imagem.

## Banco

PostgreSQL 16+ dedicado ao produto (banco e usuário novos). As migrations rodam no startup com advisory lock; para rollout com várias réplicas rode antes, como job único: `node apps/api/dist/cli.js migrate`.

## Variáveis (runtime — não use `.env` versionado)

Os nomes estão em `.env.example`. Mínimo para produção:

```dotenv
NODE_ENV=production
PORT=4000
APP_NAME=Placa na Mão
APP_URL=https://placanamao.com.br
WEB_ORIGIN=https://placanamao.com.br
ADMIN_HOSTS=admin.placanamao.com.br
TRUST_PROXY=1

DATABASE_URL=postgresql://USUARIO:SENHA@HOST_INTERNO:5432/placanamao
DATABASE_SSL=false

# Gere valores NOVOS (ex.: openssl rand -hex 48). Devem ser diferentes entre si.
JWT_SECRET=<≥64 caracteres>
ADMIN_JWT_SECRET=<≥64 caracteres, diferente do JWT_SECRET>
DATA_ENCRYPTION_KEY=<≥32 caracteres; guarde em cofre>
TEAM_TOTP_REQUIRED=true
PII_REVEAL_ENABLED=true

DATA_PROVIDER=real
VEHICLE_API_BASE_URL=<url do provedor contratado>
VEHICLE_API_QUERY_PATH=<caminho da consulta>
VEHICLE_API_AUTH_SCHEME=bearer
VEHICLE_API_TOKEN=<token do provedor>

PAYMENT_PROVIDER=asaas            # ou mercadopago | disabled
PAYMENT_API_BASE_URL=https://api.asaas.com
PAYMENT_API_KEY=<chave>
PAYMENT_WEBHOOK_SECRET=<segredo do webhook>

EMAIL_PROVIDER=smtp
SMTP_HOST=<host>
SMTP_USER=<usuário>
SMTP_PASSWORD=<senha>
EMAIL_FROM=no-reply@placanamao.com.br

SANDBOX_SEED_ENABLED=false
SANDBOX_CREDIT_PURCHASE_ENABLED=false
```

Se algo estiver inseguro, o container **não sobe** e o log informa `PRODUCTION_CONFIGURATION_INVALID:<códigos>`.

## Subir sem provedor nem gateway (ativação em duas etapas)

Para colocar o sistema no ar antes de contratar as APIs, use `DATA_PROVIDER=disabled` e `PAYMENT_PROVIDER=disabled`: o site, o app e o painel funcionam, consultas pagas aparecem como "em breve", não há cobrança nem compra de saldo. Depois, troque para `DATA_PROVIDER=real` (+ `VEHICLE_API_*`) e `PAYMENT_PROVIDER=asaas|mercadopago` e faça redeploy.

## Primeiro acesso

**Opção A — por variáveis (sem terminal):** defina `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD` (12+ caracteres) e `ADMIN_BOOTSTRAP_NAME`, faça o redeploy e entre no painel. O administrador só é criado se ainda não existir nenhum SUPER_ADMIN ativo (nunca sobrescreve). Depois do primeiro acesso, **remova `ADMIN_BOOTSTRAP_PASSWORD`** do ambiente.

**Não consegue entrar ("e-mail ou senha inválidos")?** Veja nos logs da aplicação, logo após a subida, uma destas linhas: `admin_bootstrap_created` (administrador criado; confira `passwordLength` com o tamanho da sua senha — se for menor, o Coolify cortou algum caractere como `$`), `admin_bootstrap_skipped` (já existia outro SUPER_ADMIN, por isso a senha das variáveis **não** foi aplicada) ou nenhuma das duas (as variáveis não chegaram ao container em tempo de execução, ou o deploy falhou e o container antigo continua no ar). Para recuperar o acesso sem terminal, defina também `ADMIN_BOOTSTRAP_FORCE_RESET=true`, faça redeploy, entre e cadastre o 2FA de novo; depois **remova `ADMIN_BOOTSTRAP_FORCE_RESET` e `ADMIN_BOOTSTRAP_PASSWORD`**. Cinco tentativas erradas bloqueiam a conta por 15 minutos (o reset também desbloqueia). Prefira senhas sem `$`, aspas e espaços nas extremidades.

**Opção B — pelo terminal:**

1. Abra o terminal da aplicação no Coolify e rode `node apps/api/dist/cli.js admin:create voce@empresa.com.br "Seu Nome"`. A senha provisória aparece **uma única vez**.
2. Acesse `https://admin.placanamao.com.br`, entre com a senha e cadastre o 2FA (guarde os códigos de recuperação).
3. Em **Preços**, informe o custo do provedor e os preços de referência de mercado; confira os preços de venda provisórios.
4. Em **Pagamentos**, confirme Pix e crédito à vista e preencha as alíquotas **validadas pelo seu contador** (o painel exibe aviso fiscal).
5. Cadastre os webhooks no gateway: `${APP_URL}/api/payments/asaas/webhook` (ou `/mercadopago/webhook`).
6. Valide com uma consulta real de baixo valor antes de divulgar.

## Mudando de domínio

Altere `APP_URL`, `WEB_ORIGIN`, `ADMIN_HOSTS`/`ADMIN_URL`, `EMAIL_FROM` e as URIs de retorno de OAuth. O SEO (canonical, sitemap, Open Graph) segue `APP_URL`.

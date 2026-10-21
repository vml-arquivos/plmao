# Placa na Mão

Plataforma brasileira de consulta veicular por placa: o cliente digita a placa, paga só pelo que consulta e recebe um relatório claro, com veredito, alertas explicados e versão para impressão/PDF. A equipe opera tudo (preços, margens, pagamentos, comissões, repasses, LGPD) em um painel separado, protegido por 2FA.

> Domínios previstos (provisórios, configuráveis por variável): site `placanamao.com.br` e painel `admin.placanamao.com.br`.

## O que existe

| Superfície | Onde | Para quê |
| --- | --- | --- |
| Site público | `/`, `/consultar`, `/planos`, `/blog`, **`/veiculos` (guia), `/veiculos/:slug`, `/comparar`, `/simulador` (financiamento CDC e leasing)**, `/perguntas-frequentes`, `/fipe`, páginas de SEO por intenção, `/validar-relatorio/:código` | Aquisição, SEO, consultas como produtos, comparativo inteligente, pacotes, blog, FAQ, FIPE grátis, validação de relatório |
| App do cliente (PWA) | `/app/*` | Nova consulta, histórico, relatório, carteira, parceiro, conta; instalável como aplicativo (PWA) |
| Relatório | `/app/consulta/:id` | Veredito, módulos, alertas, impressão e PDF |
| Painel da equipe | `ADMIN_HOSTS` (ou `/painel` em desenvolvimento) | Dashboard, consultas, **clientes (particular/autônomo/empresa), empresas, equipe e níveis de acesso, cobranças e parcelas, notas fiscais (controle)**, suporte, financeiro, preços/margens, **catálogo (produtos, comparativo, pacotes), FAQ, artigos, guia de veículos (modelos, versões/ficha técnica, opiniões, dicas, importação CSV), simulador de financiamento (taxas, tarifas, IOF, bancos e taxas por banco, PDFs gerados)**, pagamentos, cupons, parceiros/repasses, auditoria, sistema, conta/2FA |

## Princípios do produto

- **Só mostra o que o provedor entrega.** Um módulo sem retorno aparece como "em breve"/"não fornecido", nunca como "nada consta". Um produto só fica ativo se existir regra de fonte ativa (`query_source_rules`); o provedor real só funciona com credenciais no ambiente.
- **Dinheiro em centavos inteiros** (percentuais em bps). Piso de preço calculado pelo pior meio de pagamento (trava de margem).
- **LGPD por padrão:** CPF/CNPJ/nomes mascarados; JSON bruto do provedor cifrado (AES‑256‑GCM); revelação de dado pessoal exige motivo (≥ 10 caracteres), é auditada e nunca guarda o valor revelado.
- **Independência total:** banco, segredos JWT/TOTP, chaves de pagamento, domínio e nomes de container são próprios deste produto.

## Stack

Node 20+, Express 4, PostgreSQL 16/17 (SQL direto, `pg`), zod, TypeScript; front React 18 + Vite 6 + react-router 6 com CSS próprio (tokens, claro/escuro/sistema, fontes auto-hospedadas). Monorepo npm workspaces: `apps/api` e `apps/web`.

## Começando (desenvolvimento)

```bash
cp .env.example .env            # ajuste DATABASE_URL e, para dev, DATA_PROVIDER=mock, SANDBOX_SEED_ENABLED=true
docker compose up -d postgres   # PostgreSQL local
npm ci
npm run db:migrate              # aplica migrations
npm run dev                     # API :4000 + Vite :5173
```

Com `SANDBOX_SEED_ENABLED=true` (somente fora de produção) são criadas contas e placas fictícias de demonstração (cliente `cliente@demo.local`, equipe `admin@demo.local`). Em produção o seed é proibido e o primeiro administrador é criado pelo CLI:

```bash
npm run admin:create -- voce@empresa.com.br "Seu Nome"   # senha provisória exibida uma única vez; 2FA é cadastrado no primeiro acesso
npm run admin:reset-2fa -- voce@empresa.com.br           # recuperação do 2FA (auditada)
```

## Comandos

| Comando | Função |
| --- | --- |
| `npm run build` | Compila API e front |
| `npm test` | Build + suíte de testes (exige `TEST_DATABASE_URL`) |
| `npm run test:integration` | Smoke ponta a ponta contra um servidor rodando (`BASE_URL`) |
| `npm run db:migrate` / `db:verify` | Migrar / conferir migrations |
| `npm run release:verify` | Build, testes, `npm audit` e checagem de fontes |

## Documentação

[ARCHITECTURE](ARCHITECTURE.md) · [PRODUCT](PRODUCT.md) · [DATABASE](DATABASE.md) · [SECURITY](SECURITY.md) · [TESTING](TESTING.md) · [DEPLOY-COOLIFY](DEPLOY-COOLIFY.md) · [OAUTH-SETUP](OAUTH-SETUP.md) · [CHANGELOG](CHANGELOG.md)

## Antes de vender (responsabilidade do dono)

1. **Provedor:** informar o custo real por consulta e credenciais no ambiente (`DATA_PROVIDER=real`).
2. **Preços:** os valores iniciais (Básica R$ 5,00 · Completa R$ 12,00 · Premium R$ 18,00) são **provisórios**; ajuste em *Preços* e preencha os preços de referência de mercado (manual, uso interno).
3. **Impostos:** as alíquotas são configuráveis e exibem aviso fiscal; **valide com o contador** antes de usar os números como verdade fiscal.
4. **Pagamentos:** habilite Pix e crédito à vista (padrão). Boleto vem desligado porque eleva o piso de preço.
5. **Confirmação:** para decisões de compra/venda, o relatório orienta o cliente a confirmar as informações junto aos órgãos competentes.

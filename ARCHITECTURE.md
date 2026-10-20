# Placa na Mão — arquitetura

```text
Navegador → TLS / reverse proxy → Placa na Mão (Express: API + front estático) → PostgreSQL
                                          │
                                          ├─ provedor veicular (adapter) → normalizador → relatório v2
                                          ├─ gateway de pagamento (Asaas | Mercado Pago) + webhooks idempotentes
                                          └─ e-mail (SMTP) · OAuth (Google/Microsoft/Apple)
```

Um único processo serve o site, o app do cliente, o painel da equipe e a API. O front React é compilado em `apps/web/dist`; o servidor entrega `index.html` com SEO por rota (`seo.ts`: título, descrição, canonical, `robots`, `sitemap.xml`) e o shell do painel apenas em `ADMIN_HOSTS`/`ADMIN_URL`.

## Módulos da API (`apps/api/src`)

| Módulo | Responsabilidade |
| --- | --- |
| `server.ts` | Rotas públicas/cliente, middlewares, estáticos, SEO |
| `routes/adminAuth.ts` | Login da equipe: senha → desafio TOTP → sessão `admin` |
| `routes/adminQueries.ts` | Consulta vista pela equipe, revelação LGPD auditada |
| `routes/finance.ts`, `routes/partners.ts` | Financeiro, ajustes de pagamento, parceiros, comissões, repasses |
| `routes/apiKeys.ts` | Chaves da API pública (`pnm_live_…`) |
| `pricing/` | Motor de preço (centavos/bps), trava de margem, preço de referência, histórico |
| `payments/` | Asaas, Mercado Pago, liquidação idempotente, comissões (carência/hold), estorno/chargeback |
| `providers/` | `mock` (somente dev), `ContractedVehicleProvider` (real), FIPE |
| `report/` | Normalização v2, catálogo de módulos, máscara LGPD, HTML de impressão e PDF |
| `lib/` | HTTP/erros/auditoria, dinheiro, estorno de consulta, cifra do bruto, TOTP |
| `permissions.ts` | Papéis e permissões da equipe |
| `schema.ts`, `migrations*.ts` | Bootstrap e migrations versionadas (advisory lock) |

## Fluxo de uma consulta

1. O cliente informa a placa e escolhe o produto; o preço vem do motor de preço (centavos).
2. O saldo é debitado de forma transacional, com `Idempotency-Key`.
3. O provedor é consultado (cache opcional `QUERY_CACHE_*`). Falha/timeout ⇒ estorno automático; consultas presas em `PROCESSING` além de `QUERY_STUCK_MINUTES` também são estornadas.
4. A resposta é normalizada para o **relatório v2**: cada módulo é `CLEAR`, `ALERT` ou `NOT_PROVIDED` (nunca "nada consta" sem retorno). O bruto é cifrado (`raw_enc`).
5. `viewReport` filtra por público (cliente/equipe/API) e nível do produto; dados pessoais saem mascarados.

## Pagamentos e repasses

Recarga de saldo via Pix ou crédito à vista (boleto opcional). O webhook confirma o pagamento de forma idempotente, credita a carteira e gera comissões do parceiro com carência; repasses são lotes auditados, e estornos/chargebacks revertem a comissão (clawback). Configuração em *Pagamentos* e *Preços* do painel; chaves e segredos ficam só no ambiente.

## Separação cliente × equipe

Dois segredos e duas *audiences* de JWT (`client`/`admin`). O painel exige TOTP, passa pelo `adminEdgeGuard` (host dedicado e, opcionalmente, `ADMIN_ALLOWED_IPS`) e um token de cliente nunca abre rotas `/api/admin/*`.

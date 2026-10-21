# Integrações

## Provedor de dados veiculares

| `DATA_PROVIDER` | Comportamento |
| --- | --- |
| `mock` | Dados fictícios (`sandbox_vehicles`). **Proibido em produção.** |
| `disabled` | Sem fonte de dados: consultas pagas ficam "em breve", nada é cobrado. Permitido em produção |
| `real` | Provedor contratado via `ContractedVehicleProvider`; exige `VEHICLE_API_BASE_URL`, `VEHICLE_API_QUERY_PATH` e credenciais conforme `VEHICLE_API_AUTH_SCHEME` (`bearer` ou `basic`) |

Fronteira: `Interface → API → serviço de consulta → adapter → normalizador → PostgreSQL → relatório v2`. O front nunca vê nomes técnicos do fornecedor. Campos que o provedor não devolve viram `NOT_PROVIDED` ("não fornecido"/"em breve"), nunca "nada consta". O formato de referência da resposta do provedor está em `apps/api/test/fixtures`.

Variáveis: `VEHICLE_API_*`, `APIBRASIL_*` (alternativa de token), `VEHICLE_API_TIMEOUT_MS`, `QUERY_CACHE_ENABLED`/`QUERY_CACHE_TTL_SECONDS`, `QUERY_REQUEST_TIMEOUT_MS`, `QUERY_STUCK_MINUTES`, `STORE_RAW_PROVIDER_RESPONSE` (bruto sempre cifrado).

Custo por consulta e preços de referência de mercado são informados pelo dono em **Preços** no painel; o sistema não coleta preços de terceiros automaticamente.

## FIPE

`FEATURE_FREE_FIPE=true` habilita a cotação FIPE e o relatório de cotação; fontes configuráveis em `FIPE_PRIMARY_*`/`FIPE_SECONDARY_*`. A FIPE **por placa** consome o provedor e por isso tem limites diários.

## Pagamentos

| `PAYMENT_PROVIDER` | Webhook |
| --- | --- |
| `disabled` | Checkout e webhook indisponíveis (503) |
| `sandbox` | Somente desenvolvimento |
| `asaas` | `${APP_URL}/api/payments/asaas/webhook` (header `asaas-access-token` = `PAYMENT_WEBHOOK_SECRET`) |
| `mercadopago` | `${APP_URL}/api/payments/mercadopago/webhook` |

O saldo só é creditado por webhook autenticado e idempotente. Meios, taxas, impostos e recebedor são configurados em **Pagamentos** (alterações de recebedor exigem `ADMIN_SYSTEM`).

## API pública v1 (integradores)

Desligada por padrão (`PUBLIC_API_ENABLED=false` ⇒ 404). Chaves `pnm_live_…` são geradas pelo cliente em `/app/api`; autenticação `Authorization: Bearer <chave>`; limite `PUBLIC_API_RATE_LIMIT_MAX`/min.

| Rota | Função |
| --- | --- |
| `GET /api/v1/balance` | Saldo em centavos |
| `GET /api/v1/products` | Produtos ativos e preços |
| `POST /api/v1/vehicles` | `{ "plate": "ABC1D23", "product": "COMPLETE" }` → relatório (debita o saldo) |
| `GET /api/v1/vehicles/:id` | Consulta uma consulta já feita (sem nova cobrança) |

Documentação voltada ao cliente em `/desenvolvedores`.

## Integrações preparadas na 1.10.0 (desligadas por padrão)

| Integração | Chave | Estado |
|---|---|---|
| Consulta veicular Credify | `VEHICLE_API_PROVIDER=credify`, `CREDIFY_*` | Adaptador pronto; falta o corpo da requisição (`CREDIFY_QUERY_BODY_TEMPLATE`), credenciais, homologação e contrato. |
| CNPJ | `CNPJ_PROVIDER=brasilapi` | Pronto; ativar após conferir os termos de uso da fonte. |
| E-mail | `EMAIL_PROVIDER=smtp`, `EMAIL_WEBHOOK_SECRET` | Fila pronta; falta SMTP e mapear o webhook de entrega do provedor. |
| Assinatura | `ESIGN_PROVIDER=internal` | Aceite eletrônico simples com trilha. Assinatura avançada/qualificada exige provedor e validação jurídica. |
| Fiscal | `FISCAL_PROVIDER=manual` | Fila para emissão externa e registro do resultado. Não há adaptador de NFS-e. |
| Mercado Pago | `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` | Checkout, webhook, estorno total e conciliação prontos; testar em sandbox. |

Endpoints novos: `/api/support/*` (cliente), `/api/admin/support/*`, `/api/testimonials` (público), `/api/testimonials/mine`, `/api/admin/testimonials*`, `/api/admin/contracts*`, `/api/contracts/*` (link seguro), `/api/admin/fiscal/*`, `/api/fiscal/documents/:token`, `/api/admin/email/*`, `/api/webhooks/email`, `/api/admin/payment-orders/:id/reconcile|refund`, `/api/admin/cnpj/*`, `/api/account/cnpj/*`, `GET /ready`.

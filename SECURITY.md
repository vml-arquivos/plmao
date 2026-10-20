# Segurança e privacidade

Segredos existem **somente no ambiente de execução** (Coolify): nunca no repositório, no front, no Dockerfile ou em argumentos de build. O startup valida a configuração e, com `NODE_ENV=production`, recusa subir se algo estiver inseguro (`PRODUCTION_CONFIGURATION_INVALID:<códigos>`): segredos fracos/de exemplo, URLs sem HTTPS, `mock`/`sandbox`/seed ligados, provedor habilitado sem credenciais, 2FA desligado ou painel sem host dedicado.

## Controles

| Controle | Aplicação |
| --- | --- |
| Senhas | bcrypt custo 12; bloqueio de 15 min após 5 falhas; rate limit de login |
| Sessões | JWT com *audience* `client` ou `admin`, segredos distintos (`JWT_SECRET` ≠ `ADMIN_JWT_SECRET`), sessões revogáveis, expiração curta no painel (`ADMIN_JWT_EXPIRES_IN`) |
| Painel da equipe | Host dedicado (`ADMIN_HOSTS`/`ADMIN_URL`), allowlist opcional de IP (`ADMIN_ALLOWED_IPS`), **2FA TOTP obrigatório** (não pode ser desligado em produção), códigos de recuperação de uso único |
| Autorização | Papéis e permissões granulares (ex.: `REVEAL_PII`, `VIEW_AUDIT`); ações financeiras sensíveis exigem `ADMIN_SYSTEM` |
| Dinheiro | Centavos inteiros, transações com `FOR UPDATE`, saldo ≥ 0, ledger, estorno automático, webhooks idempotentes, trava de margem |
| API | Helmet, limite de payload, rate limit, zod, SQL parametrizado, `Cache-Control: no-store` em dados sensíveis |
| API pública | Chaves `pnm_live_…` armazenadas com hash, limite por chave, desligada por padrão |
| Rastreamento | Request ID, trilha de auditoria, logs sem dados sensíveis (`LOG_SENSITIVE_DATA=false`) |

## LGPD

- **Minimização:** CPF/CNPJ, nomes, chassi, RENAVAM e motor saem mascarados por padrão no cliente, na equipe, na impressão e no PDF.
- **Bruto cifrado:** o JSON do provedor é guardado com AES‑256‑GCM (`DATA_ENCRYPTION_KEY`, mínimo 32 caracteres; perder a chave torna o bruto ilegível). Não existe endpoint que o devolva.
- **Revelação auditada:** só com `PII_REVEAL_ENABLED=true`, permissão `REVEAL_PII` e motivo ≥ 10 caracteres; fica registrada em `pii_reveals` e em auditoria **sem** gravar o valor revelado.
- **Analytics:** eventos de funil não registram placa, e-mail, documento, senha ou token.

A operação precisa formalizar finalidade, base legal, retenção e exclusão, e validar o contrato com o fornecedor de dados com assessoria jurídica; o código não declara conformidade automática.

## Checklist de produção

1. Gere `JWT_SECRET` e `ADMIN_JWT_SECRET` (≥ 64 caracteres, diferentes entre si) e `DATA_ENCRYPTION_KEY` (≥ 32). **Não reaproveite valores de outro sistema.**
2. `DATA_PROVIDER=real` com credenciais do provedor; `PAYMENT_PROVIDER=asaas|mercadopago` com chave e segredo de webhook (ou `disabled`).
3. `SANDBOX_SEED_ENABLED=false`, `SANDBOX_CREDIT_PURCHASE_ENABLED=false`.
4. Defina `ADMIN_HOSTS` e, se possível, `ADMIN_ALLOWED_IPS`.
5. Crie o primeiro admin com `npm run admin:create` (ou `ADMIN_BOOTSTRAP_EMAIL`/`ADMIN_BOOTSTRAP_PASSWORD`, removendo a senha do ambiente depois) e cadastre o 2FA imediatamente.
6. Rode `npm audit --omit=dev --audit-level=high` antes de cada release.

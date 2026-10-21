# Segurança e privacidade

Segredos existem **somente no ambiente de execução** (Coolify): nunca no repositório, no front, no Dockerfile ou em argumentos de build. O startup valida a configuração e, com `NODE_ENV=production`, recusa subir se algo estiver inseguro (`PRODUCTION_CONFIGURATION_INVALID:<códigos>`): segredos fracos/de exemplo, URLs sem HTTPS, `mock`/`sandbox`/seed ligados, provedor habilitado sem credenciais, painel sem host dedicado.

## Controles

| Controle | Aplicação |
| --- | --- |
| Senhas | bcrypt custo 12; bloqueio de 15 min após 5 falhas; rate limit de login |
| Sessões | JWT com *audience* `client` ou `admin`, segredos distintos (`JWT_SECRET` ≠ `ADMIN_JWT_SECRET`), sessões revogáveis, expiração curta no painel (`ADMIN_JWT_EXPIRES_IN`) |
| Painel da equipe | Host dedicado (`ADMIN_HOSTS`/`ADMIN_URL`), allowlist opcional de IP (`ADMIN_ALLOWED_IPS`), **2FA por aplicativo (TOTP) opcional**: cada pessoa liga e desliga em "Minha conta" (desligar exige senha e código); com `TEAM_TOTP_REQUIRED=true` passa a ser obrigatório para todos. Códigos de recuperação de uso único. Sem 2FA, a proteção do painel é senha, bloqueio de 15 min após 5 erros, host dedicado e allowlist de IP |
| Autorização | Papéis (Super admin, Admin, Financeiro, Operador, Suporte, Conteúdo) e permissões granulares (ex.: `REVEAL_PII`, `VIEW_AUDIT`, `MANAGE_TEAM`, `MANAGE_FISCAL`); o papel é lido do banco a cada requisição; só o Super admin concede Admin/Super admin; ninguém edita o próprio acesso; o último Super admin é protegido; CPF/CNPJ aparecem mascarados para quem não gerencia clientes ou fiscal; ações financeiras sensíveis exigem `ADMIN_SYSTEM` |
| Equipe | Senha temporária gerada pelo sistema e exibida uma única vez; troca em "Minha conta"; senha mínima de 8 caracteres (equipe e clientes); reset de senha/2FA derruba as sessões abertas; remoção é lógica e preserva a auditoria |
| Dinheiro | Centavos inteiros, transações com `FOR UPDATE`, saldo ≥ 0, ledger, estorno automático, webhooks idempotentes, trava de margem |
| API | Helmet, limite de payload, rate limit, zod, SQL parametrizado, `Cache-Control: no-store` em dados sensíveis |
| Conteúdo editável | Artigos em markdown restrito (sem HTML cru), links só http(s)/mailto/relativos, capa só https; permissão `MANAGE_CONTENT` |
| Rastreamento | Request ID, trilha de auditoria, logs sem dados sensíveis (`LOG_SENSITIVE_DATA=false`) |

- **Simulador de financiamento**: o cálculo público não grava nada e tem limite de 120 pedidos/min por IP; o PDF exige conta, tem limite de 30/h e só pode ser reimpresso pelo próprio dono (código `SIM-…`). A busca nas séries do Banco Central só acontece no servidor (timeout de 10 s, sem dados do cliente) e uma falha nunca derruba o simulador. Taxas, tarifas e IOF só mudam pela permissão `MANAGE_BILLING`, com auditoria. A importação de consumo oficial (`/admin/vehicles/consumption`, permissão de conteúdo) só aceita fonte https, valida unidade e faixa de valores e grava tudo como "a conferir": nada vai ao site sem conferência humana, e a conferência é auditada. O cadastro de bancos (`/admin/simulator/banks`) segue a mesma permissão e registra `FINANCING_BANK_CREATED/UPDATED/DELETED`; a leitura por instituição no Banco Central (Olinda) também só ocorre no servidor, sem dados do cliente.
- **Catálogo de frota e interesse por veículo**: a busca (`/vehicles/catalog/search`, 90/min por IP) usa consulta parametrizada com curingas escapados, no máximo 6 palavras e 20 resultados. O registro de interesse (`/vehicles/interest`, 120/min por IP) aceita só tipos fixos, valida o id do catálogo e o slug, guarda apenas o hash da visita (sem IP, sem conta) e descarta termos com cara de placa, e-mail ou número longo. A importação de snapshot (`/admin/vehicles/catalog/import`, permissão de conteúdo) tem parser próprio com limite de 12 MB, rejeita linhas inválidas sem corrigir nada e é auditada (`VEHICLE_CATALOG_IMPORTED`, `VEHICLE_CATALOG_REMATCHED`). Fotos de terceiros só entram com crédito e licença registrados. A lista e a exportação do catálogo no painel (`/admin/vehicles/catalog/list`, `/catalog/export`) exigem a permissão de conteúdo; a exportação é auditada (`VEHICLE_CATALOG_EXPORTED`).
- **Seletor FIPE**: `/fipe/search` e `/fipe/price` (90/min por IP) validam o tipo e os códigos (`[A-Za-z0-9._-]{1,24}`), não gravam dado pessoal, não criam relatório e não consomem a cota da consulta gratuita; só leem preço do mês (cache em `fipe_cache`). Listas de marca/modelo/ano ficam em cache de memória por 6 h.
- **Guia de veículos**: opiniões passam por moderação, rejeitam links/e-mails, têm limite de 20 envios/hora e aparecem com nome abreviado; o e-mail do autor só aparece no painel. Busca por placa no guia tem cota diária por conta. Foto de capa só aceita https e o painel avisa para usar apenas imagens com direito de uso. Gestão restrita à permissão `MANAGE_CONTENT` e registrada na auditoria (`VEHICLE_*`).

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
5. Crie o primeiro admin com `npm run admin:create` (ou `ADMIN_BOOTSTRAP_EMAIL`/`ADMIN_BOOTSTRAP_PASSWORD`, removendo a senha do ambiente depois) e, se quiser, ative o 2FA em "Minha conta".
6. Rode `npm audit --omit=dev --audit-level=high` antes de cada release.

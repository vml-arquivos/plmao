# Banco de dados

A Placa na Mão utiliza PostgreSQL. A criação inicial permite bootstrap seguro em banco vazio e o histórico de evolução é controlado pela tabela `schema_migrations`. As migrations aplicadas são transacionais e protegidas por advisory lock com `MIGRATION_LOCK_TIMEOUT_MS` e retry controlado, evitando que réplicas concorrentes executem a mesma alteração.

## Comandos operacionais

`npm run db:migrate` prepara o schema base e aplica todas as migrations pendentes. `npm run db:verify` confirma que todas as migrations presentes no código estão registradas e verifica tabelas centrais. O servidor mantém a inicialização compatível, mas o rollout recomendado executa o primeiro comando como job único antes de liberar novas réplicas.

## Tabelas centrais

| Grupo | Tabelas | Finalidade |
| --- | --- | --- |
| Identidade | `users`, `user_profiles`, `user_identities`, `user_sessions`, `user_consents`, `oauth_authorization_states`, `oauth_login_tickets`, `roles`, `permissions`, `role_permissions` | Usuários, perfis, autenticação por senha e social, sessões revogáveis, consentimentos, proteção de transações OAuth e autorização extensível. |
| Organização | `organizations`, `organization_members` | Preparação para empresas, membros e subcontas. |
| Carteira | `wallets`, `wallet_transactions`, `payments` | Saldo, ledger e pagamentos/sandbox. |
| Consulta | `query_products`, `vehicle_queries`, `vehicle_query_results`, `sandbox_vehicles` | Produtos configuráveis, requisições, relatório normalizado e massa de testes. |
| Financeiro | `payment_settings`, `payment_orders`, `payment_webhook_events`, `affiliates`, `affiliate_commissions`, `payouts`, `price_references`, `product_price_history` | Configuração de pagamento, parceiros, comissões, repasses e histórico de preços. |
| Equipe e LGPD | `team_totp`, `team_totp_recovery_codes`, `pii_reveals`, `api_keys`, `query_source_rules` | 2FA da equipe, revelações auditadas, (`api_keys` sem uso desde a remoção da API pública) e regras de fonte por produto. |
| Operação | `data_providers`, `saved_vehicles`, `query_exports`, `audit_logs`, `schema_migrations` | Controle de provider, favoritos, exportação, auditoria e versão de schema. |

## Integridade das consultas e créditos

A consulta cria `vehicle_queries` com status `PROCESSING` e registra um lançamento `QUERY` na mesma transação que reduz o saldo. O saldo da carteira é bloqueado com `FOR UPDATE` e possui `CHECK (balance >= 0)`.

Se o provider falhar, a mesma consulta é bloqueada novamente. Enquanto estiver em processamento, uma transação `REFUND` devolve o valor, a consulta passa a `REFUNDED` e o histórico preserva a evidência técnica sem repassar detalhes internos ao cliente.

A combinação de `user_id` com `idempotency_key` é única quando a chave está presente. Isso evita dupla cobrança causada por clique duplo, retry de rede ou reenvio do mesmo pedido.

## Identidade, sessões e consentimentos

A migration `003_identity_and_social_auth` prepara o banco para cadastro e autenticação por Google, Microsoft e Sign in with Apple. `user_identities` vincula uma conta a um identificador imutável do provedor, sem usar o e-mail como chave de vínculo. `user_sessions` permite que um JWT com `sid` seja revogado no logout ou após eventos de segurança. `oauth_authorization_states` contém somente estado de uso único, nonce e verificador PKCE até o retorno do provedor; `oauth_login_tickets` conclui o retorno ao frontend com ticket curto, de uso único e armazenado apenas como hash.

`user_consents` registra os aceites de Termos de Uso, Política de Privacidade e comunicação de marketing por versão da política. O cadastro por senha só é aceito após o cliente enviar os aceites obrigatórios, e o perfil do usuário armazena a preferência de marketing de forma separada.

## Dados sensíveis e retenção

`vehicle_query_results.normalized` é o contrato estável do produto. `raw_response` é reservado à auditoria e deve ser tratado como dado de acesso restrito; em produção, a política de retenção e a necessidade de criptografia devem ser definidas antes de utilizar provider que devolva dados pessoais.

`wallet_transactions` e `audit_logs` são registros de rastreabilidade e não devem ser apagados por rotinas comuns. Qualquer eliminação deve seguir a política de retenção e os requisitos legais aplicáveis.

## Evolução futura

Migrations futuras podem introduzir rotação de sessões, eventos de pagamento com webhook, API keys B2B, custos de provider, retenção automatizada, cupons e assinaturas. Cada alteração deve ser adicionada como migration nova e validada em cópia do banco antes de deploy.

## Migrations do produto

`010_payment_settings`, `011_partners_commissions_payouts`, `012_reference_prices_and_price_history`, `013_public_api_pii_and_session_audience`, `014_refunds_chargebacks_and_net_amounts` e `015_placanamao_catalog` (catálogo e regras de fonte `contracted`) e `016_catalog_cms` (catálogo editável: `catalog_features`, `product_catalog_features`, `faqs`, `articles`, novas colunas em produtos e pacotes, seções do relatório por produto, permissão `MANAGE_CONTENT`). Valores monetários são sempre `*_cents` (inteiros) e percentuais em bps.

Também `017_admin_people_billing_fiscal`: novos níveis `FINANCEIRO`, `SUPORTE` e `CONTEUDO` em `users.role`; `user_profiles` com tipo de cliente, segmento, dados fiscais, endereço, observações e `archived_at`; `organizations` com dados cadastrais completos; `archived_at` em FAQ, artigos e produtos; tabelas `fiscal_settings`, `charges`, `charge_installments` (parcelas PENDING/PAID/CANCELLED) e `fiscal_documents` (NFS-e/NF-e PENDING/ISSUED/CANCELLED, com cópia dos dados do cliente no momento da emissão). Clientes removidos são anonimizados no e-mail e mantêm o histórico.

Também `018_vehicle_guide`: `vehicle_models` (marca, modelo, tipo, carroceria, anos, resumo, review, pontos fortes/atenção, dicas de compra, foto https, status DRAFT/PUBLISHED, `archived_at`), `vehicle_versions` (versão, ano-modelo, combustível, código FIPE, `specs` jsonb validado contra o catálogo de campos), `vehicle_opinions` (única por usuário e modelo, nota 1–5, quesitos jsonb, PENDING/APPROVED/REJECTED com motivo) e `vehicle_tips` (categoria, modelo opcional, status). Apagar modelo só é permitido sem opiniões; arquivar preserva tudo.

Também `019_financing_simulator`: `financing_settings` (linha única: taxas médias CDC PF/PJ e leasing PJ/PF, mês de referência, fonte, atualização automática e último erro, tarifas de referência em centavos e parâmetros do IOF) e `financing_simulations` (código `SIM-XXXXXXXX`, usuário, modalidade, tipo de veículo, valores, taxa, parcela, total, CET, `input` e `output` jsonb para reimprimir o PDF exatamente como foi gerado).

Também `022_vehicle_consumption_obs`: `vehicle_consumption_obs` (consumo por versão como observação: rótulo literal da fonte, combustível, km/l cidade e estrada, ciclo, tipo e URL da fonte, datas, `status` CONFERIDO ou A_CONFERIR, nota e vínculo opcional com modelo e versão). Só `CONFERIDO` aparece no site. A migration também cria a versão Altis Hybrid do Corolla e o modelo Civic, e corrige o consumo do Corolla XEi apenas se a ficha ainda tem o valor da carga inicial.

A migration `025_financing_faqs` insere em `faqs` (categoria "Financiamento") as perguntas e respostas sobre CDC x leasing, atraso e inadimplência; só insere a pergunta se ela ainda não existir. Sem alteração de tabelas.

Também `023_vehicle_catalog`: `vehicle_catalog` (um registro por nome do Senatran: `raw_name` exato, `search_text` normalizado, `fleet_total`, `year_min/year_max`, `years` jsonb por ano de fabricação com `0` = sem ano informado, `snapshot` AAAA-MM e `model_id` opcional ligando ao guia), `vehicle_catalog_snapshots` (origem, licença e totais de cada carga), `vehicle_interest_events` (tipo SIMULATOR_PICK/SEARCH_PICK/MODEL_VIEW/SEARCH_NO_RESULT, catálogo ou modelo, termo anônimo e hash da visita) e novas colunas em `vehicle_models` (`catalog_brands/names/exclude`, `featured`, `featured_order`, `image_credit`, `image_license`, `image_source_url`). A carga inicial vem de `apps/api/assets/senatran/frota-2026-09.json.gz`. `024_vehicle_photos_free_license` preenche foto e crédito dos 6 modelos de partida só onde ainda não há foto.

Também `021_financing_banks`: `financing_banks` (nome, trecho do nome no Banco Central, taxas manuais CDC PF/PJ e leasing PJ, tarifas próprias em centavos, observação, ativo e ordem) e `financing_bank_rates` (média por instituição vinda do Banco Central: segmento, modalidade, instituição, taxa a.m./a.a., posição e período), mais `banks_refreshed_at` e `banks_refresh_error` em `financing_settings`. Os 12 bancos de partida entram sem taxa.

Também `020_vehicle_seed`: coluna `vehicle_models.spec_source` (fonte e data da conferência da ficha técnica, mostrada no site) e carga inicial de 20 modelos publicados com suas versões. Usa `ON CONFLICT DO NOTHING`: pode rodar de novo sem duplicar e não altera modelos já editados pela equipe.

# Banco de dados

A CARPIVARA utiliza PostgreSQL. A criação inicial permite bootstrap seguro em banco vazio e o histórico de evolução é controlado pela tabela `schema_migrations`. As migrations aplicadas são transacionais e protegidas por advisory lock com `MIGRATION_LOCK_TIMEOUT_MS` e retry controlado, evitando que réplicas concorrentes executem a mesma alteração.

## Comandos operacionais

`npm run db:migrate` prepara o schema base e aplica todas as migrations pendentes. `npm run db:verify` confirma que todas as migrations presentes no código estão registradas e verifica tabelas centrais. O servidor mantém a inicialização compatível, mas o rollout recomendado executa o primeiro comando como job único antes de liberar novas réplicas.

## Tabelas centrais

| Grupo | Tabelas | Finalidade |
| --- | --- | --- |
| Identidade | `users`, `user_profiles`, `user_identities`, `user_sessions`, `user_consents`, `oauth_authorization_states`, `oauth_login_tickets`, `roles`, `permissions`, `role_permissions` | Usuários, perfis, autenticação por senha e social, sessões revogáveis, consentimentos, proteção de transações OAuth e autorização extensível. |
| Organização | `organizations`, `organization_members` | Preparação para empresas, membros e subcontas. |
| Carteira | `wallets`, `wallet_transactions`, `payments` | Saldo, ledger e pagamentos/sandbox. |
| Consulta | `query_products`, `vehicle_queries`, `vehicle_query_results`, `sandbox_vehicles` | Produtos configuráveis, requisições, relatório normalizado e massa de testes. |
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

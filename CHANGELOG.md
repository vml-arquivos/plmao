# Changelog

## 0.5.0 — Funil de aquisição e SEO responsável

### Adicionado

- Doze páginas públicas por intenção com conteúdo útil, CTA progressivo e navegação para FIPE, conta ou produtos conforme o contexto.
- Metadata por rota no HTML entregue pelo servidor e no cliente: título, descrição, canonical, Open Graph, Twitter Card e JSON-LD `WebPage`.
- `robots.txt`, `sitemap.xml` e renderização SSR de metadata para as páginas indexáveis.
- Eventos de funil com lista fechada, atribuição UTM limitada, identificador de sessão com hash e endpoint `202` fail-open.
- Indicadores agregados de 30 dias no painel administrativo para visitantes, SEO, CTAs, cadastros e início de checkout.
- Tracking integrado à home, FIPE, autenticação, landing pages e checkout sem registrar placa, e-mail, documento, senha ou token em analytics.

### Segurança e responsabilidade

- Interesse comercial permanece validado no endpoint próprio, mas o e-mail não é misturado ao armazenamento de analytics.
- Conteúdo de gravame, sinistro, leilão, débitos, multas e recall informa a dependência de fonte e produto ativos, sem prometer cobertura não validada.
- Os hardenings de autenticação, sessão persistente/revogável, respostas `no-store`, carregamento administrativo resiliente e alteração de senha permanecem preservados.

## 0.4.0 — Hardening e experiência premium

### Corrigido

- Corrigida a compilação TypeScript adicionando as declarações tipadas compatíveis com `bcryptjs`.
- Corrigida a ausência de controle de concorrência funcional com idempotência por usuário e chave de requisição.
- Corrigido o risco de perda de créditos em timeout ou falha de provider com estorno transacional auditado.
- Corrigida a ausência de mensagem humana para falhas de consulta e autenticação.

### Adicionado

- Mecanismo de migrations versionadas, com controle de aplicação em banco e índices de integridade.
- Campos de bloqueio de login, log de acesso e metadados para operações críticas.
- Camada extensível de permissões e rotas administrativas protegidas.
- Cenários sandbox adicionais: IPVA, gravame, recall, furto/roubo, resposta incompleta, multas e timeout.
- Consulta salva por ID, filtro de histórico, exportação JSON autenticada e compra sandbox auditada.
- Landing comercial, autenticação, dashboard responsivo, relatório reorganizado, carteira, preferências e painel administrativo condicional.
- Modo claro, escuro e sistema com persistência local.
- Metadados SEO aprimorados e JSON-LD inicial.
- Testes unitários, roteiro de validação integrada e documentação de provider real.

### Segurança

- Logs estruturados com remoção de chaves sensíveis.
- Rate limit global e específico de login configuráveis por ambiente.
- Senhas protegidas por hash bcrypt; tokens expiram e não carregam dados sensíveis adicionais.
- Respostas brutas do provider permanecem no backend e o armazenamento pode ser desativado por ambiente.
- Seed e compra de créditos sandbox deixam de ser habilitados por padrão no código; devem ser ativados explicitamente por variável.

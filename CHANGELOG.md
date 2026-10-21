# Changelog

## 1.2.0 — Guia de veículos e comparador

### Adicionado

- **Guia de veículos** (`/veiculos`): busca por modelo (marca, tipo, carroceria, ordenação) e por placa, página do modelo com ficha técnica por versão (~30 campos em 5 grupos), pontos fortes/atenção, review, "o que olhar antes de comprar", dicas do modelo e **opinões de quem tem o carro** (nota geral + 6 quesitos: conforto, desempenho, consumo, confiabilidade, custo de manutenção, acabamento).
- **Comparador** (`/comparar`): 2 a 3 versões lado a lado, melhor de cada quesito destacado, "só o que é diferente", link da comparação compartilhável.
- **Dicas e cuidados** (cuidados, manutenção, compra, economia, segurança), gerais ou por modelo.
- Acesso: visitante vê resumo, nota, 2 pontos e prévia do review; ficha completa, opiniões e comparador exigem conta gratuita.
- Opiniões **moderadas** (nada aparece antes de aprovado), 1 por pessoa por modelo, sem links/e-mails, autor exibido como "Nome S.".
- Busca por placa no guia usa o provedor de dados (cota de 5 por dia por conta); sem provedor ativo, orienta a buscar pelo modelo.
- Painel: **Guia de veículos** (permissão de Conteúdo): modelos e versões, moderação de opiniões, dicas e **importação de planilha CSV** (modelo para baixar, conferência antes de gravar, até 2.000 linhas).
- Migration `018_vehicle_guide`. O guia começa **vazio**: nenhum dado técnico é inventado.

## 1.1.0 — Painel profissional: pessoas, cobranças e fiscal

### Adicionado

- **Clientes, Empresas e Equipe separados** no painel. Cliente tem tipo (particular, autônomo/vendedor/despachante, empresa/agência), segmento, dados fiscais e endereço; empresa agrupa vários usuários; equipe usa níveis de acesso.
- **Níveis de acesso da equipe**: Super admin, Admin, Financeiro, Operador, Suporte e Conteúdo. Só o Super admin cria/altera Admin e Super admin; ninguém edita a si mesmo; o último Super admin é protegido. Criação de membro gera senha temporária exibida uma vez; no primeiro acesso a pessoa cadastra o 2FA e troca a senha.
- **Cobranças e parcelas**: plano de pagamento (à vista ou N parcelas, frequência), baixa manual com forma de pagamento, reabertura, troca de vencimento, atrasos e saldo ("falta pagar").
- **Notas fiscais (controle)**: dados do emissor, fila "A emitir", registro de emissão (número, chave, links de PDF/XML), cancelamento, sincronização com pagamentos pagos e exportação CSV para o contador. A emissão automática na prefeitura/SEFAZ **não** está ligada (exige certificado digital e emissor contratado).
- Filtro por tipo de cliente em consultas, pagamentos e cobranças; exportação CSV de clientes.
- Criar, editar, arquivar, restaurar e apagar (quando não há vínculos) produtos da vitrine, FAQ e artigos; clientes e empresas podem ser arquivados ou removidos com proteção contra perda de histórico.
- Cadastro público pergunta "Como você vai usar?" (particular, autônomo, empresa).
- Migration `017_admin_people_billing_fiscal`.

### Alterado

- Menu do painel reorganizado em grupos; cada nível de acesso só vê o que pode usar. A antiga tela "Usuários" foi substituída por Clientes.
- Janelas (modais) com rolagem interna e rodapé sempre visível.

## 1.0.0 — Placa na Mão

Produto independente derivado do Carpivara, reconstruído como plataforma de consulta veicular por placa.

### Adicionado

- Novo front (site, app PWA do cliente, relatório) com identidade visual própria, tema claro/escuro/sistema e SEO por rota.
- Relatório v2 com veredito explicável, módulos `CLEAR`/`ALERT`/`NOT_PROVIDED`, impressão e PDF, validação pública por código.
- Painel da equipe separado (host dedicado, 2FA obrigatório, sessões `admin`): dashboard, consultas com revelação LGPD auditada, usuários, suporte, financeiro, preços e margens, pagamentos, cupons, parceiros e repasses, auditoria, sistema e conta.
- Motor de preço em centavos/bps com trava de margem, preços de referência e histórico; comissões com carência, repasses e clawback; estorno e chargeback.
- CLI `admin:create` e `admin:reset-2fa`; administrador inicial opcional por `ADMIN_BOOTSTRAP_*`.
- Catálogo editável no painel: cada consulta com descrição, o que inclui (matriz de características), preço, preço "de", desconto, selo, ordem e visibilidade na home; pacotes com selo e destaques; FAQ; blog/artigos com SEO (sitemap, JSON-LD). Seções do relatório limitadas por produto.
- Site público redesenhado: fonte Nunito, tema claro/escuro, capa noturna, cards de consulta, tabela comparativa, comparativo inteligente (combinação mais barata), pacotes, blog e perguntas frequentes; PWA com convite de instalação e aviso offline.
- Nova identidade visual (logo carro + lupa, azul sobre marinho) e ícones PWA regenerados.

### Removido

- A API pública v1 e as chaves de API: o produto não oferece API para integração em sistemas de terceiros. A tabela `api_keys` (migration 013) permanece sem uso.
- Dados brutos do provedor cifrados (AES‑256‑GCM); máscara de CPF/CNPJ/nomes por padrão.

### Corrigido

- Consulta de TOTP herdada usava `FOR UPDATE OF c` indevido.
- Compra sandbox gravava saldo no formato legado; agora usa centavos e o ledger novo.
- Padrão de meios de pagamento sem boleto (que elevava o piso de preço).

### Segurança

- Produção recusa subir com mock/sandbox/seed, segredos fracos, painel sem host dedicado ou 2FA desligado.

## Histórico anterior (Carpivara, base do projeto)

Versões 0.1–0.5: consulta com carteira e estorno, autenticação social, FIPE gratuita, funil de aquisição e SEO.

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

# Changelog

## 1.3.1 — Comparação de taxas e tarifas por banco

### Adicionado

- **Comparação entre bancos no simulador**: abaixo do resultado, a tabela "Compare os bancos" mostra, para cada banco ativo, a taxa ao mês, a parcela, o total pago e o **CET anual** daquela mesma simulação, ordenada pelo menor CET e com o melhor marcado. Cada linha informa a origem da taxa ("Média no Banco Central" com o nome da instituição, ou "Condição informada pela equipe") e se o banco usa tarifas próprias. Vale para CDC e leasing e para os dois modos de pessoa.
- **Taxas por instituição do Banco Central**: além das séries gerais, o servidor lê a base "Taxas de juros por instituição financeira" (Olinda/BCB, aquisição de veículos e arrendamento), guarda a média mais recente de cada banco e atualiza junto da rotina de 24 horas (`FINANCING_AUTO_REFRESH`). Uma falha só registra o erro e mantém as últimas taxas.
- **Painel › Simulador › Bancos e taxas por banco**: cadastrar, editar, ativar/desativar e remover bancos. Para cada um: nome mostrado ao cliente, "nome no Banco Central" (para achar a taxa média sozinho), taxa manual de CDC pessoa física, CDC empresa e leasing empresa, **tarifas próprias** (cadastro, avaliação, registro) e observação interna. Taxa informada à mão vale mais que a média do Banco Central; tarifa em branco usa a de referência. Alterações auditadas (`FINANCING_BANK_CREATED`, `FINANCING_BANK_UPDATED`, `FINANCING_BANK_DELETED`).
- **PDF**: nova página "Comparação entre bancos", salva junto da simulação (reimpressão idêntica).
- Migration `021_financing_banks` (tabelas `financing_banks` e `financing_bank_rates`, colunas de atualização em `financing_settings`) com 12 bancos de partida **sem taxa**.

### Atenção

- A taxa do Banco Central por banco é uma **média do período**, não uma oferta: a taxa real depende da análise de crédito. A tela e o PDF dizem isso.
- Bancos sem nenhuma taxa (nem manual nem do Banco Central) não aparecem para o cliente.
- As **tarifas por banco** não têm fonte pública consolidada: só aparecem se a equipe cadastrar.

## 1.3.0 — Simulador de financiamento e carga inicial do guia

### Adicionado

- **Simulador de financiamento** (`/simulador`, `/simulador/carro|moto|caminhao|utilitario`): CDC e leasing, pessoa física ou empresa, veículo novo ou usado, qualquer valor (R$ 5 mil a R$ 20 milhões), entrada, prazo (CDC 6–84 meses, leasing 24–60 com valor residual), taxa de mercado do Banco Central ou a taxa da proposta do cliente. O resultado traz parcela, total pago, juros, **IOF** (por parcela, financiado, com teto de 365 dias), tarifas (cadastro, avaliação do bem em usados, registro/gravame no CDC), **CET** mensal e anual, custo sobre o valor do veículo, carência opcional e a tabela completa de parcelas. Modo "Comparar os dois" mostra CDC × leasing lado a lado. A simulação fica na URL, então sobrevive a login e cadastro.
- **Taxas reais**: séries do Banco Central (SGS 25471, 25447, 25450 e 25474), atualizadas sozinhas a cada 24 horas (ou pelo botão no painel). Se o Banco Central estiver fora do ar, o simulador segue com a última taxa. Leasing de pessoa física quase não existe (o BC registra 0%): usa a média de leasing de empresa e avisa o cliente.
- **PDF da simulação** (para quem tem conta gratuita): capa com dados do cliente, comparação CDC × leasing, composição do custo, tabela de todas as parcelas, "como calculamos" e avisos, com links clicáveis. Cada PDF fica salvo (`SIM-XXXXXXXX`) e pode ser reimpresso na íntegra, com a data e as taxas da época.
- **Página inicial**: seção "Guia de veículos" (busca, diferenciais e modelos em destaque) e seção "Simulador" com a calculadora resumida. Botão "Simular financiamento" em cada modelo do guia. Menu e rodapé com o Simulador.
- **Painel › Simulador de financiamento** (permissão Financeiro): taxas, tarifas de referência, IOF, atualização automática, "Atualizar pelo Banco Central", indicadores e lista de PDFs gerados. Alterações auditadas (`FINANCING_SETTINGS_UPDATED`).
- **Guia de veículos com dados**: migration `020_vehicle_seed` publica 20 modelos muito vendidos (21 versões 2025) com ficha técnica de referência e **fonte registrada** em cada modelo, exibida no site. Só entram valores que a fonte informava; nenhuma opinião, nota ou review é criada. Campos novos de consumo a diesel. A carga é idempotente e nunca sobrescreve o que a equipe editou. O restante do catálogo entra pela importação CSV do painel.
- SEO: títulos e descrições próprios do simulador (por tipo de veículo) e entrada no sitemap.
- Migrations `019_financing_simulator` e `020_vehicle_seed`.

### Atenção

- As **tarifas** (cadastro R$ 500, avaliação R$ 300, registro R$ 200) são valores de referência editáveis: variam por banco e por estado. O cliente pode ajustá-las na tela.
- A simulação é **informativa**; não é proposta nem oferta de crédito.

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

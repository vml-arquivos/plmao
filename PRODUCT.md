# Produtos e catálogo

Preços iniciais **provisórios** (ajustáveis no painel, sempre em centavos; o motor impede vender abaixo do piso de margem).

| Produto | Preço inicial | Conteúdo (seções do relatório) |
| --- | --- | --- |
| FIPE por placa (grátis) | R$ 0 | Valor FIPE e dados básicos; consome o provedor, por isso tem limite diário (`FIPE_GUEST_DAILY_LIMIT`, `FIPE_AUTH_DAILY_LIMIT`) |
| Completa | R$ 61,60 | Identificação, débitos e multas, restrições, financiamento/gravame, recall e inspeção |
| Básica | R$ 43,60 | Identificação, débitos e multas, restrições |
| Leilão | R$ 33,10 | Histórico de leilão ("em breve" até existir fonte) |
| Gravame | R$ 14,10 | Identificação e financiamento/gravame |
| Cadastral | R$ 13,20 | Identificação, características e registro |

Pacotes de saldo: Inicial (R$ 60 por R$ 60), Plus (R$ 130 por R$ 120) e Pro (R$ 350 por R$ 300). Tudo isso é **ponto de partida**: preço, preço "de", desconto, selo, descrição, o que cada consulta inclui, ordem e presença na home são editados em *Painel → Catálogo* (migration 016 grava os valores uma única vez; reinícios nunca sobrescrevem edições). Os preços de referência de mercado são manuais, internos e jamais aparecem no site.

## Conteúdo editável

- **Catálogo:** produtos (descrição curta/longa, cobertura, selo, desconto, seções do relatório), matriz de características (incluso / não incluso / em breve) e pacotes (selo, destaques).
- **Perguntas frequentes:** categorias, ordem e publicação (`/perguntas-frequentes`, trecho na home e nas páginas de SEO).
- **Artigos/blog:** rascunho e publicação, capa (https), SEO próprio, tempo de leitura, relacionados, sitemap e JSON-LD. Permissão `MANAGE_CONTENT`.
- **Comparativo inteligente:** o visitante marca o que quer checar (ou escolhe uma situação, como "vou comprar um usado") e o site calcula a combinação de consultas ativas mais barata que cobre tudo, comparando com a melhor consulta única.
- O produto **não oferece API** para integração em sistemas de terceiros.

## Regras de honestidade

- Um produto só está **ativo** quando há regra de fonte ativa em `query_source_rules` (migration 015 cria regras da fonte contratada). Sem credenciais do provedor, nada é vendido como disponível.
- Cada módulo do relatório é `CLEAR`, `ALERT` ou `NOT_PROVIDED`. "Não fornecido" nunca é exibido como "nada consta".
- Veredito explicável: mostra quais fatos produziram a classificação (Sem alertas relevantes / Atenção / Risco elevado).
- Comunicação: "fonte contratada" e "bases atualizadas"; sem nomes de concorrentes nem comparativos percentuais; preços de mercado de referência são manuais e de uso interno.
- O relatório orienta o cliente a confirmar as informações junto aos órgãos competentes antes de decidir uma compra.

## Relatório

Tela responsiva, impressão (`/api/queries/:id/report/print`) e PDF (`/report/pdf`), com código de validação pública em `/validar-relatorio`.

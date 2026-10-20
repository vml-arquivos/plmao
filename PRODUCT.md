# Produtos e catálogo

Preços iniciais **provisórios** (ajustáveis no painel, sempre em centavos; o motor impede vender abaixo do piso de margem).

| Produto | Preço inicial | Conteúdo |
| --- | --- | --- |
| FIPE por placa (grátis) | R$ 0 | Valor FIPE e dados básicos; consome o provedor, por isso tem limite diário (`FIPE_GUEST_DAILY_LIMIT`, `FIPE_AUTH_DAILY_LIMIT`) |
| Básica | R$ 5,00 | Identificação, marca/modelo, ano, cor, combustível, município/UF, situação |
| Completa | R$ 12,00 | Básica + débitos, restrições, dados técnicos e situação documental |
| Premium | R$ 18,00 | Módulos adicionais efetivamente contratados (ex.: leilão, sinistro, histórico) |

Os produtos legados (Débitos, Cadastral, Restrições) ficam inativos com selo "em breve".

## Regras de honestidade

- Um produto só está **ativo** quando há regra de fonte ativa em `query_source_rules` (migration 015 cria regras da fonte contratada). Sem credenciais do provedor, nada é vendido como disponível.
- Cada módulo do relatório é `CLEAR`, `ALERT` ou `NOT_PROVIDED`. "Não fornecido" nunca é exibido como "nada consta".
- Veredito explicável: mostra quais fatos produziram a classificação (Sem alertas relevantes / Atenção / Risco elevado).
- Comunicação: "fonte contratada" e "bases atualizadas"; sem nomes de concorrentes nem comparativos percentuais; preços de mercado de referência são manuais e de uso interno.
- O relatório orienta o cliente a confirmar as informações junto aos órgãos competentes antes de decidir uma compra.

## Relatório

Tela responsiva, impressão (`/api/queries/:id/report/print`) e PDF (`/report/pdf`), com código de validação pública em `/validar-relatorio`.

# SEO da Placa na Mão (sem plugin)

Tudo é gerado no servidor e já vai pronto no HTML inicial de cada página: título, descrição, endereço canônico, Open Graph, dados estruturados (organização, site com busca, aplicativo, trilha de navegação, perguntas frequentes) e o texto que o Google lê. Nada depende de JavaScript para ser indexado.

## Onde editar

Painel > Site e conteúdo > **SEO e Google**. Para cada página: título, descrição, palavra-chave principal, textos, perguntas frequentes e a chave "Liberar para o Google". Há prévia de como aparece na busca e uma lista de verificação (tamanho do título e da descrição, palavra-chave no título, na descrição e no texto, 3 ou mais perguntas). "Restaurar texto padrão" devolve o texto de fábrica. Mudanças valem em até 1 minuto. Artigos do blog têm o SEO próprio em "Artigos e blog"; páginas de veículos e de lojas são geradas a partir do cadastro.

## Mapa de buscas por página

| Busca principal | Página |
|---|---|
| tabela fipe, preço fipe, valor do carro | /fipe |
| simulador de financiamento (veículo) | /simulador |
| financiamento de carro / moto / caminhão / utilitário | /simulador/carro, /moto, /caminhao, /utilitario |
| etanol ou gasolina | /combustivel |
| comparar carros | /comparar |
| consulta de placa, consulta veicular | /consulta-placa, /consulta-veicular |
| consultar gravame, débitos, multas, sinistro, leilão, recall | /consultar-gravame, /consultar-debitos-veiculo, /consultar-multas-veiculo, /consultar-sinistro-veiculo, /consultar-leilao-veiculo, /consultar-recall |
| histórico veicular | /historico-veicular |
| preço da consulta | /planos |
| ficha técnica e opinião de donos | /veiculos e cada modelo |

## Depois de publicar

1. `SITE_MODE=public` (em `prelaunch` o site sai com noindex).
2. Search Console: propriedade do domínio verificada (DNS) e sitemap `https://placanamao.com.br/sitemap.xml` enviado. O sitemap traz data de atualização de cada página e exclui as que você marcar como fora do Google.
3. Inspeção de URL: pedir indexação de /, /fipe, /simulador, /simulador/carro, /consulta-placa, /consultar-gravame e /planos.
4. Acompanhar em Desempenho: consultas, cliques e posição. Ajustar título e descrição das páginas com muitas impressões e poucos cliques.
5. Dados estruturados: Search Console > Melhorias mostra FAQ e trilha de navegação. O Google decide quando exibe o resultado enriquecido; não há como forçar.

## Regras de conteúdo

Só afirmar o que o produto entrega. Taxas, prazos e regras de banco ou de estado aparecem como "varia". Não prometer posição no Google nem resultado de consulta.

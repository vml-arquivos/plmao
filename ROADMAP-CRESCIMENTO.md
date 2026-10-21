# Roteiro de crescimento e inteligência do Placa na Mão

Base: a estratégia `estrategia_crescimento_placa_na_mao.md` (21/10/2026) cruzada com o que o sistema já faz na versão 1.5.0. Projeções de conversão e receita são **hipóteses para testar**, não resultados. Nada aqui promete cobertura de fonte que o contrato ainda não confirmou.

## 1. O que a estratégia diz e o que já mudou no código

| Ponto da estratégia | Situação na 1.5.0 |
|---|---|
| "O guia só tem 20 modelos" | Guia com cerca de 22 fichas **e** catálogo da frota com 40.571 nomes (Senatran, set/2026). A busca acha qualquer veículo; só 6 destaques aparecem na home. |
| "Conectar guia e simulador" | Primeiro elo feito: o simulador tem busca de veículo (lista do Senatran) e os botões do guia abrem o simulador com o nome preenchido. Na 1.6.0 o simulador também mostra o valor FIPE do mês depois de escolher marca, modelo e ano (seletor FIPE); falta ligar a versão do guia ao código FIPE. |
| "Medir o que a pessoa procura" | Passa a ser gravado, sem conta e sem dado pessoal: escolha no simulador, escolha na busca, visita à ficha e busca sem resultado. Relatório na aba **Frota e interesse** do painel. |
| Comparativo de bancos pelo CET | Já existe (1.3.1). |
| Compra sem surpresa, Minha garagem, seguro, peças, B2B | Ainda não feitos. Ordem e MVP abaixo. |

## 2. O que a base nova destrava (dado real, já no banco)

- **Frota por nome e ano de fabricação** (136,4 milhões de veículos): permite dizer, com fonte, "este é um dos nomes mais comuns do Brasil", "a frota deste modelo é antiga ou nova", "quantos são de 2018 a 2021".
- **Interesse por veículo** (`vehicle_interest_events`): quais nomes as pessoas escolhem para simular, quais fichas abrem, o que digitam e não existe.
- **Ligação nome do Senatran e ficha do guia** (regras editáveis por modelo): base para somar a frota por modelo e, no futuro, abrir a ficha certa a partir de uma placa.

Limites que continuam valendo: o nome do Senatran não separa marca, modelo e versão; o ano é de **fabricação**, não ano-modelo; não há tipo de veículo no arquivo; nada disso substitui a consulta pela placa nem a FIPE.

## 3. Funções "inteligentes" propostas, em ordem

"Inteligência" aqui é **explicar com evidência**, não opinar: cada função mostra fonte, data e limite, e diz "sem evidência" quando falta dado.

### A. Fila de fichas a criar (rápido, usa o que já coletamos)
Ranking no painel: `frota do nome × interesse (escolhas + buscas sem resultado)`, mostrando quais veículos sem ficha as pessoas mais pedem. O guia cresce onde há demanda, não por palpite. **Esforço baixo.** Medir: fichas criadas por semana e visitas nas fichas novas.

### B. Jornada "Decida": guia, comparador, simulador, relatório
Um veículo escolhido leva nome, versão e (após confirmação de versão e mês) o valor FIPE para o simulador; o resumo final pode ser compartilhado. Quando versão, ano ou metodologia não coincidem, mostrar "sem evidência comparável" em vez de apontar vencedor. **Esforço médio.** Medir: guia, simulação, PDF, cadastro, consulta paga.

### C. "Compra sem surpresa" (prioridade nº 1 da estratégia)
Prévia antes do pagamento: veículo identificado, fonte, data, o que o produto cobre e o que pode não vir. No PDF, separar `CLEAR`, `ALERT` e `NOT_PROVIDED` ("não localizado" não é "nada consta"). MVP em uma UF com uma fonte contratada. **Depende de confirmar contrato e cobertura por UF.**

### D. Páginas de dados da frota (SEO com informação própria)
Páginas como "carros mais comuns do Brasil", "frota por ano de fabricação" e "quantos [modelo] existem", calculadas do Senatran, com fonte e data, cada uma terminando numa ferramenta (simular, consultar placa, FIPE). Conteúdo que concorrente não tem e que outros sites podem citar. **Esforço médio.** Medir: visita orgânica, uso da ferramenta, cadastro.

### E. Explicador do relatório (IA com trilho)
Assistente que **só reescreve em linguagem simples o que está nos campos do relatório** (com os mesmos avisos de fonte e limite), responde "o que isso significa para a minha compra?" e sugere o que perguntar ao vendedor. Regras: não inventa campo, não dá nota única de "carro bom ou ruim", cita a seção de origem, registra o que foi mostrado. Entra depois da C. **Esforço médio; custo por uso a medir.**

### F. Minha garagem
Salvar veículo, relatórios, simulações e lembretes manuais (data ou km), com exportar e apagar. Alertas automáticos só se a fonte permitir atualização recorrente e a pessoa autorizar. Testar retorno voluntário antes de cobrar assinatura.

### G. Encaminhamentos com consentimento (seguro, crédito, peças)
Botão opcional depois do relatório ou da simulação, com parceiro habilitado, nome do corretor ou financiador à vista, consentimento separado, mínimo de dados e grupo de controle. Peças: poucos itens com compatibilidade verificada e link rastreável, sem loja própria. **Validar o papel jurídico (SUSEP, Banco Central) antes de usar as palavras "cotação" ou "aprovação".**

### H. Distribuição B2B medida
Links e QR por parceiro (lojas, despachantes, vistoriadoras) e painel simples: cliques, consultas, pagamentos, estornos, comissão. Poucos parceiros no início; comissão divulgada.

## 4. O que não fazer agora
Lançar seguro, loja de peças, assinatura de alertas e carteira própria ao mesmo tempo; criar nota única de "carro bom ou ruim"; copiar comentários de concorrentes; escrever "mais buscados" ou "mais confiáveis" sem dado. A home só mostra esses rótulos quando existe volume mínimo: 20 visitas por modelo em 3 modelos, ou 3 opiniões aprovadas em 3 modelos.

## 5. Próximos 30 dias sugeridos
1. Semana 1: publicar a 1.5.0, conferir fotos e créditos, deixar o painel de interesse coletando.
2. Semana 2: função A (fila de fichas) e as primeiras fichas novas pelos nomes de maior frota que ainda não têm ficha (confirmar no próprio arquivo quais são).
3. Semanas 3 e 4: função B (valor FIPE confirmado no simulador) e a prévia da C com a fonte contratada.
4. Medir o funil completo antes de abrir D, E, F ou G.

## 6. Critérios para avançar de uma etapa
Conversão paga e margem líquida positivas por origem; entrega confiável; poucos estornos e correções; consentimento compreendido; retorno voluntário; parceiro com atendimento adequado. Os valores-alvo saem da linha de base do próprio tráfego, que ainda não existe.

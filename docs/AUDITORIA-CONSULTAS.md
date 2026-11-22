# Auditoria das consultas (sem custo)

Gerado por `scripts/auditoria-consultas.mjs`. Usa o caminho real do sistema com respostas de exemplo no formato publicado pela Credify. **Nenhuma chamada real, nenhum custo.** Prova que o sistema chama as APIs certas e lê e mostra bem o formato documentado. Não prova o conteúdo real da Credify para uma placa real: isso só uma consulta real mostra.

## Resultado

- ✅ Nenhum problema encontrado: contrato de APIs respeitado, sem chamada repetida, sem consulta falha, sem texto de fonte/custo no relatório nem no PDF.

## APIs chamadas por consulta

| Consulta | placa limpa | alienação sem detalhe no cadastro | placa com ocorrências |
|---|---|---|---|
| Consulta FIPE Grátis | /precificadorfipe (454) | /precificadorfipe (454) | /precificadorfipe (454) |
| Consulta Cadastral | /debitosrestricoesproprietarios (487) | /debitosrestricoesproprietarios (487) | /debitosrestricoesproprietarios (487) |
| Consulta Gravame | /debitosrestricoesproprietarios (487)<br>/gravame (533) | /debitosrestricoesproprietarios (487)<br>/gravame (533) | /debitosrestricoesproprietarios (487)<br>/gravame (533) |
| Leilão e Dados do Veículo | /debitosrestricoesproprietarios (487)<br>/veicularbnacionalonline (369)<br>/leilaoconjugado (448) | /debitosrestricoesproprietarios (487)<br>/veicularbnacionalonline (369)<br>/leilaoconjugado (448) | /debitosrestricoesproprietarios (487)<br>/veicularbnacionalonline (369)<br>/leilaoconjugado (448) |
| Consulta Avançada | /debitosrestricoesproprietarios (487)<br>/indiciosinistro (450)<br>/veicularbnacionalonline (369)<br>/precificadorfipe (454)<br>/renainf (536)<br>/veiculoproprietarioplaca (514)<br>/leilaoconjugado (448) | /debitosrestricoesproprietarios (487)<br>/indiciosinistro (450)<br>/veicularbnacionalonline (369)<br>/precificadorfipe (454)<br>/renainf (536)<br>/veiculoproprietarioplaca (514)<br>/leilaoconjugado (448)<br>/gravame (533) | /debitosrestricoesproprietarios (487)<br>/indiciosinistro (450)<br>/veicularbnacionalonline (369)<br>/recall (452)<br>/historicoroubofurto (456)<br>/precificadorfipe (454)<br>/renainf (536)<br>/veiculoproprietarioplaca (514)<br>/leilaoconjugado (448)<br>/renajud (483) |
| Consulta Completa | /debitosrestricoesproprietarios (487)<br>/indiciosinistro (450)<br>/veicularbnacionalonline (369)<br>/precificadorfipe (454)<br>/veiculoproprietarioplaca (514)<br>/leilaoconjugado (448) | /debitosrestricoesproprietarios (487)<br>/indiciosinistro (450)<br>/veicularbnacionalonline (369)<br>/precificadorfipe (454)<br>/veiculoproprietarioplaca (514)<br>/leilaoconjugado (448) | /debitosrestricoesproprietarios (487)<br>/indiciosinistro (450)<br>/veicularbnacionalonline (369)<br>/recall (452)<br>/historicoroubofurto (456)<br>/precificadorfipe (454)<br>/veiculoproprietarioplaca (514)<br>/leilaoconjugado (448) |
| Consulta Premium | /debitosrestricoesproprietarios (487)<br>/indiciosinistro (450)<br>/veicularbnacionalonline (369)<br>/historicoproprietario (458)<br>/precificadorfipe (454)<br>/renainf (536)<br>/veiculoproprietarioplaca (514)<br>/leilaoconjugado (448) | /debitosrestricoesproprietarios (487)<br>/indiciosinistro (450)<br>/veicularbnacionalonline (369)<br>/historicoproprietario (458)<br>/precificadorfipe (454)<br>/renainf (536)<br>/veiculoproprietarioplaca (514)<br>/leilaoconjugado (448)<br>/gravame (533) | /debitosrestricoesproprietarios (487)<br>/indiciosinistro (450)<br>/veicularbnacionalonline (369)<br>/recall (452)<br>/historicoroubofurto (456)<br>/historicoproprietario (458)<br>/precificadorfipe (454)<br>/renainf (536)<br>/veiculoproprietarioplaca (514)<br>/leilaoconjugado (448)<br>/renajud (483) |

- **placa limpa**: cadastro sem alertas; só as APIs obrigatórias.
- **alienação sem detalhe no cadastro**: o cadastro indica financiamento mas não traz banco/contrato/data; as consultas que têm gravame no contrato buscam o detalhe.
- **placa com ocorrências**: o cadastro acusa recall, furto/roubo, alienação (com banco e contrato) e restrição judicial; só então as APIs condicionais (recall, roubo/furto, Renajud) são chamadas.

## Modelo do PDF × entregue

| Consulta | Cenário | Itens no modelo | Itens entregues | Prometidos que não vieram |
|---|---|---|---|---|
| Consulta Cadastral | placa limpa | 29 | 30 | – |
| Consulta Cadastral | alienação sem detalhe no cadastro | 29 | 30 | – |
| Consulta Cadastral | placa com ocorrências | 29 | 30 | – |
| Consulta Gravame | placa limpa | 29 | 24 | GRAVAME/RESTRICAONOMEAGENTE, GRAVAME/RESTRICAODATAINCLUSAO, GRAVAME/CGCFINANCEIRA, GRAVAME/NUMEROCONTRATOFINANCEIRA, GRAVAME/GR_DETALHES, GRAVAME/GR_VALORES |
| Consulta Gravame | alienação sem detalhe no cadastro | 29 | 30 | – |
| Consulta Gravame | placa com ocorrências | 29 | 32 | – |
| Leilão e Dados do Veículo | placa limpa | 44 | 46 | – |
| Leilão e Dados do Veículo | alienação sem detalhe no cadastro | 44 | 46 | – |
| Leilão e Dados do Veículo | placa com ocorrências | 44 | 49 | – |
| Consulta Avançada | placa limpa | 94 | 98 | – |
| Consulta Avançada | alienação sem detalhe no cadastro | 94 | 104 | – |
| Consulta Avançada | placa com ocorrências | 94 | 112 | – |
| Consulta Completa | placa limpa | 93 | 97 | – |
| Consulta Completa | alienação sem detalhe no cadastro | 93 | 99 | – |
| Consulta Completa | placa com ocorrências | 93 | 110 | – |
| Consulta Premium | placa limpa | 96 | 100 | – |
| Consulta Premium | alienação sem detalhe no cadastro | 96 | 106 | – |
| Consulta Premium | placa com ocorrências | 96 | 114 | – |

## O que cada consulta mostra ao cliente (placa com ocorrências)

### Consulta FIPE Grátis

- valor: R$ 45.000,00
- codigoFipe: 005004-1
- marca: VW - VOLKSWAGEN
- modelo: GOL 1.0 FLEX 4P
- ano: 2021
- combustivel: Flex
- mes: novembro/2026

### Consulta Cadastral

Parecer: ATTENTION - Há pontos de atenção fora deste plano · PDF: 35 KB

**Identificação do veículo**

- Placa: AAA0000 _(INFO)_
- Marca: VW _(INFO)_
- Modelo: GOL 1.0 _(INFO)_
- Marca/modelo completo: VW/GOL 1.0 FLEX _(INFO)_
- Chassi: 9BWZZZ377VT004251 _(INFO)_
- RENAVAM: 00123456789 _(INFO)_
- Número do motor: CFZ123456 _(INFO)_
- Número da caixa de câmbio: XXXXXXXXX _(INFO)_
- Remarcação de chassi: Normal _(CLEAR)_

**Características**

- Ano de fabricação: 2020 _(INFO)_
- Ano do modelo: 2021 _(INFO)_
- Cor: PRATA _(INFO)_
- Combustível: ALCOOL/GASOLINA _(INFO)_
- Potência: 76 _(INFO)_
- Cilindrada: 1000 _(INFO)_
- Tipo: XXXXXXXX _(INFO)_
- Espécie: XXXXX _(INFO)_
- Categoria: XXXXXXXX _(INFO)_
- Carroceria: INEXISTENTE _(INFO)_
- Procedência: XXXXXXXX _(INFO)_
- Eixos: X _(INFO)_
- Capacidade de passageiros: X _(INFO)_

**Registro e licenciamento**

- UF de emplacamento: XX _(INFO)_
- Município: SAO PAULO _(INFO)_
- Situação do veículo: Circulação _(INFO)_
- Exercício do licenciamento: 2023 _(INFO)_
- Data do licenciamento: 10/09/2023 _(INFO)_
- Emissão do CRV: 02/07/2012 _(INFO)_
- Comunicação de venda: Não consta comunicação de vendas _(CLEAR)_
- UF do faturamento: XX _(INFO)_


### Consulta Gravame

Parecer: HIGH_RISK - Atenção necessária · PDF: 36 KB

**Identificação do veículo**

- Placa: AAA0000 _(INFO)_
- Marca: VW _(INFO)_
- Modelo: GOL 1.0 _(INFO)_
- Marca/modelo completo: VW/GOL 1.0 FLEX _(INFO)_
- Chassi: 9BWZZZ377VT004251 _(INFO)_
- RENAVAM: 00123456789 _(INFO)_
- Número do motor: CFZ123456 _(INFO)_
- Número da caixa de câmbio: XXXXXXXXX _(INFO)_
- Remarcação de chassi: Normal _(CLEAR)_

**Características**

- Ano de fabricação: 2020 _(INFO)_
- Ano do modelo: 2021 _(INFO)_
- Cor: PRATA _(INFO)_
- Combustível: ALCOOL/GASOLINA _(INFO)_
- Potência: 76 _(INFO)_
- Cilindrada: 1000 _(INFO)_
- Tipo: XXXXXXXX _(INFO)_
- Espécie: XXXXX _(INFO)_
- Categoria: XXXXXXXX _(INFO)_
- Carroceria: INEXISTENTE _(INFO)_
- Procedência: XXXXXXXX _(INFO)_
- Eixos: X _(INFO)_
- Capacidade de passageiros: X _(INFO)_

**Financiamento e gravame**

- Restrição financeira: Alienacao fiduciaria _(ALERT)_
- Agente financeiro (restrição): BANCO EXEMPLO S.A. _(INFO)_
- Data de inclusão da restrição: 20/02/2024 _(INFO)_
- CNPJ da financeira: 00.000.000/0001-91 _(INFO)_
- Número do contrato: 0045-9981234-7 _(INFO)_
- Vigência do contrato: 20/02/2029 _(INFO)_
- Alienação fiduciária / gravame: Há gravame / alienação fiduciária ativo — BANCO EXEMPLO S.A.. _(INFO)_
- Gravames: banco, contrato e tempo: Banco/financeira: BANCO EXEMPLO S.A. (CNPJ 00000000000191) · contrato nº 0045-9981234-7 ·  _(INFO)_
- Prazo restante do contrato: Contrato vigente até 20/02/2029 (faltam 2 anos e 2 meses) _(INFO)_
- Saldo devedor, parcelas e valor financiado: As bases oficiais (Detran e Senatran) não informam saldo devedor, valor financiado, parcel _(INFO)_


### Leilão e Dados do Veículo

Parecer: HIGH_RISK - Atenção necessária · PDF: 43 KB

**Identificação do veículo**

- Placa: AAA0000 _(INFO)_
- Marca: VW _(INFO)_
- Modelo: GOL 1.0 _(INFO)_
- Marca/modelo completo: VW/GOL 1.0 FLEX _(INFO)_
- Chassi: 9BWZZZ377VT004251 _(INFO)_
- RENAVAM: 00123456789 _(INFO)_
- Número do motor: CFZ123456 _(INFO)_
- Remarcação de chassi: Normal _(CLEAR)_
- Situação do chassi: Normal _(CLEAR)_

**Características**

- Ano de fabricação: 2020 _(INFO)_
- Ano do modelo: 2021 _(INFO)_
- Cor: PRATA _(INFO)_
- Combustível: ALCOOL/GASOLINA _(INFO)_
- Potência: 76 _(INFO)_
- Cilindrada: 1000 _(INFO)_
- Tipo: XXXXXXXX _(INFO)_
- Espécie: XXXXX _(INFO)_
- Categoria: XXXXXXXX _(INFO)_
- Carroceria: INEXISTENTE _(INFO)_
- Procedência: XXXXXXXX _(INFO)_
- Eixos: X _(INFO)_
- Capacidade de passageiros: X _(INFO)_
- Alterações de características: comparação entre bases: Sem divergência de chassi, motor ou câmbio; cor ou combustível diferem entre as bases _(INFO)_
- Tipo de montagem: COMPLETA _(INFO)_

**Registro e licenciamento**

- UF de emplacamento: XX _(INFO)_
- Município: SAO PAULO _(INFO)_
- Situação do veículo: Circulação _(INFO)_
- Exercício do licenciamento: 2023 _(INFO)_
- Data do licenciamento: 10/09/2023 _(INFO)_
- Emissão do CRV: 02/07/2012 _(INFO)_
- Última atualização do cadastro: 10/01/2020 _(INFO)_

**Restrições**

- Furto/roubo: Consta ocorrencia _(ALERT)_
- Restrição judicial: Consta restrição judicial _(ALERT)_
- RENAJUD: Consta restrição renajud _(ALERT)_
- Restrição administrativa: Nada consta _(CLEAR)_
- Restrição tributária: Nada consta _(CLEAR)_
- Guincho/depósito: Nada consta _(CLEAR)_
- Restrição ambiental: Veículo com inspeção veicular OK _(CLEAR)_
- Receita Federal: Não possui restrição RFB _(CLEAR)_
- Restrição 01 (base nacional): Sem restrição _(CLEAR)_
- Restrição 02 (base nacional): Sem restrição _(CLEAR)_
- Restrição 03 (base nacional): Sem restrição _(CLEAR)_
- Restrição 04 (base nacional): Sem restrição _(CLEAR)_

**Histórico e ocorrências**

- Participação em leilão: Consta passagem por leilão _(ALERT)_
- Leilão — detalhes do registro: 1 registro de leilão _(INFO)_

**Análises da Placa na Mão**

- Nível de risco de leilão: Razoável — 1 registro de leilão. Classificação da Placa na Mão (Muito baixo, Baixo, Razoáv _(INFO)_
- Possível desvalorização: Veículos com passagem por leilão ou indício de sinistro costumam ser negociados abaixo da  _(INFO)_
- CSV do Inmetro (veículo recuperado): Se o veículo foi recuperado de dano de média ou grande monta, só pode voltar a circular co _(INFO)_
- Aceitação em seguro e revenda: Pode haver recusa ou prêmio mais alto: seguradoras costumam restringir veículos com passag _(INFO)_


### Consulta Avançada

Parecer: HIGH_RISK - Atenção necessária · PDF: 67 KB

**Identificação do veículo**

- Placa: AAA0000 _(INFO)_
- Marca: VW _(INFO)_
- Modelo: GOL 1.0 _(INFO)_
- Marca/modelo completo: VW/GOL 1.0 FLEX _(INFO)_
- Chassi: 9BWZZZ377VT004251 _(INFO)_
- RENAVAM: 00123456789 _(INFO)_
- Número do motor: CFZ123456 _(INFO)_
- Número da caixa de câmbio: XXXXXXXXX _(INFO)_
- Remarcação de chassi: Normal _(CLEAR)_
- Placa (padrão Mercosul): AAA0A00 _(INFO)_
- Situação do chassi: Normal _(CLEAR)_

**Características**

- Ano de fabricação: 2020 _(INFO)_
- Ano do modelo: 2021 _(INFO)_
- Cor: PRATA _(INFO)_
- Combustível: ALCOOL/GASOLINA _(INFO)_
- Potência: 76 _(INFO)_
- Cilindrada: 1000 _(INFO)_
- Tipo: XXXXXXXX _(INFO)_
- Espécie: XXXXX _(INFO)_
- Categoria: XXXXXXXX _(INFO)_
- Carroceria: INEXISTENTE _(INFO)_
- Procedência: XXXXXXXX _(INFO)_
- Eixos: X _(INFO)_
- Capacidade de passageiros: X _(INFO)_
- Alterações de características: comparação entre bases: Sem divergência de chassi, motor ou câmbio; cor ou combustível diferem entre as bases _(INFO)_
- Tipo de montagem: COMPLETA _(INFO)_

**Registro e licenciamento**

- UF de emplacamento: XX _(INFO)_
- Município: SAO PAULO _(INFO)_
- Situação do veículo: Circulação _(INFO)_
- Exercício do licenciamento: 2023 _(INFO)_
- Data do licenciamento: 10/09/2023 _(INFO)_
- Emissão do CRV: 02/07/2012 _(INFO)_
- Comunicação de venda: Não consta comunicação de vendas _(CLEAR)_
- UF do faturamento: XX _(INFO)_
- Data de emplacamento: 15/03/2015 _(INFO)_
- Última atualização do cadastro: 10/01/2020 _(INFO)_

**Débitos**

- IPVA: Não existe débito de IPVA _(CLEAR)_
- Valor de IPVA em aberto: R$ 0,00 _(CLEAR)_
- Licenciamento: Existe débito de licenciamento _(ALERT)_
- Valor de licenciamento em aberto: R$ 160,22 _(ALERT)_
- DPVAT: Não existe débito de DPVAT _(CLEAR)_
- Valor de DPVAT em aberto: R$ 0,00 _(CLEAR)_
- Multas: Existe débito de multa _(ALERT)_
- Total de multas em aberto: R$ 293,47 _(ALERT)_
- Multas — DETRAN: R$ 0,00 _(CLEAR)_
- Multas — DER: R$ 293,47 _(ALERT)_
- Multas — DERSA: R$ 0,00 _(CLEAR)_
- Multas — Polícia Rodoviária Federal: R$ 0,00 _(CLEAR)_
- Multas — RENAINF: R$ 0,00 _(CLEAR)_
- Débitos municipais: R$ 0,00 _(CLEAR)_
- Débitos CETESB: R$ 0,00 _(CLEAR)_
- Multas: detalhe por infração (RENAINF): 1 multa — total R$ 195,23 _(ALERT)_

**Restrições**

- Furto/roubo: Consta ocorrencia _(ALERT)_
- Restrição judicial: Consta restrição judicial _(ALERT)_
- RENAJUD: CONSTA RESTRICAO RENAJUD (1 registro) _(ALERT)_
- Restrição administrativa: Nada consta _(CLEAR)_
- Restrição tributária: Nada consta _(CLEAR)_
- Guincho/depósito: Nada consta _(CLEAR)_
- Restrição ambiental: Veículo com inspeção veicular OK _(CLEAR)_
- Receita Federal: Não possui restrição RFB _(CLEAR)_
- Outras restrições (1): Nada consta _(CLEAR)_
- Outras restrições (2): Nada consta _(CLEAR)_
- Outras restrições (3): Nada consta _(CLEAR)_
- Outras restrições (4): Nada consta _(CLEAR)_
- Restrição 01 (base nacional): Sem restrição _(CLEAR)_
- Restrição 02 (base nacional): Sem restrição _(CLEAR)_
- Restrição 03 (base nacional): Sem restrição _(CLEAR)_
- Restrição 04 (base nacional): Sem restrição _(CLEAR)_
- Restrições judiciais (Renajud): tribunal, processo e data: Processo nº 0001234-56.2024.8.26.0100 _(ALERT)_
- Busca e apreensão: Nada consta nas restrições retornadas pela fonte _(CLEAR)_

**Histórico e ocorrências**

- Indício de sinistro: Há indício de sinistro _(ALERT)_
- Histórico de roubo ou furto: Consta registro de roubo ou furto _(ALERT)_
- Participação em leilão: Consta passagem por leilão _(ALERT)_
- Roubo ou furto — detalhes do registro: UF dut: DF _(INFO)_
- Leilão — detalhes do registro: 1 registro de leilão _(INFO)_

**Financiamento e gravame**

- Restrição financeira: Alienacao fiduciaria _(ALERT)_
- Agente financeiro (restrição): BANCO EXEMPLO S.A. _(INFO)_
- Data de inclusão da restrição: 20/02/2024 _(INFO)_
- CNPJ da financeira: 00.000.000/0001-91 _(INFO)_
- Número do contrato: 0045-9981234-7 _(INFO)_
- Vigência do contrato: 20/02/2029 _(INFO)_
- Alienação fiduciária / gravame: Há gravame / alienação fiduciária ativo — BANCO EXEMPLO S.A.. _(INFO)_
- Gravames: banco, contrato e tempo: Banco/financeira: BANCO EXEMPLO S.A. (CNPJ 00000000000191) · contrato nº 0045-9981234-7 ·  _(INFO)_
- Prazo restante do contrato: Contrato vigente até 20/02/2029 (faltam 2 anos e 2 meses) _(INFO)_
- Saldo devedor, parcelas e valor financiado: As bases oficiais (Detran e Senatran) não informam saldo devedor, valor financiado, parcel _(INFO)_

**Inspeção e recall**

- Recall: Possui recall _(ALERT)_
- Recall (fabricante): Consta recall do fabricante _(ALERT)_
- Recall — campanhas registradas: Início da campanha: 04/03/2024 · Montadora: VW DO BRASIL · Campanha: VW/GOL _(INFO)_

**Valor de referência (FIPE)**

- Preço FIPE: R$ 45.000,00 _(INFO)_
- Preço médio de mercado: R$ 44.000,00 _(INFO)_
- Código FIPE: 005004-1 _(INFO)_
- Modelo na tabela FIPE: VW - VOLKSWAGEN GOL 1.0 FLEX 4P _(INFO)_
- Vigência da tabela: 11/2026 _(INFO)_
- Variação da FIPE em 12 meses: +4,2% em 12 meses (de R$ 43.200,00 para R$ 45.000,00) — tabela FIPE _(INFO)_
- Variação da FIPE em 24 meses: +8,3% em 23 meses (de R$ 41.550,00 para R$ 45.000,00) — tabela FIPE _(INFO)_
- Histórico mensal da FIPE (24 meses): Nov/2026 R$ 45.000,00 · Out/2026 R$ 44.850,00 · Set/2026 R$ 44.700,00 · Ago/2026 R$ 44.550 _(INFO)_

**Análises da Placa na Mão**

- Nível de risco de leilão: Alto — indício de sinistro. Classificação da Placa na Mão (Muito baixo, Baixo, Razoável ou _(INFO)_
- Possível desvalorização: Veículos com passagem por leilão ou indício de sinistro costumam ser negociados abaixo da  _(INFO)_
- CSV do Inmetro (veículo recuperado): Se o veículo foi recuperado de dano de média ou grande monta, só pode voltar a circular co _(INFO)_
- Aceitação em seguro e revenda: Pode haver recusa ou prêmio mais alto: seguradoras costumam restringir veículos com passag _(INFO)_
- Projeção de preço (estimativa): R$ 45.900,00 em 6 meses (+R$ 150,00 por mês). Projeção simples da variação dos últimos 12  _(INFO)_
- Quilometragem de referência (estimativa): 40 mil km a 80 mil km (média de mercado: 12 mil km por ano, 5 anos de uso). Estimativa pel _(INFO)_
- Fabricante pelo chassi: Volkswagen _(INFO)_
- Origem pelo chassi: Brasil _(INFO)_
- Ano do modelo pelo chassi: 2027 — diferente do ano do registro (pode ocorrer conforme o critério do fabricante) _(INFO)_

**Proprietário**

- Tipo de proprietário: FISICA _(INFO)_
- Nome do proprietário: XXXXXXXXXXX XXXXX XXXXXXX _(INFO)_
- Nome do proprietário anterior: XXXXXXXX XXXXXXX _(INFO)_
- CPF/CNPJ do proprietário: 123.456.789-00 _(INFO)_
- CPF/CNPJ do faturado: 123.456.789-00 _(INFO)_
- Tipo do faturado: JURIDICA _(INFO)_
- Tipo do comprador: CPF _(INFO)_


### Consulta Completa

Parecer: HIGH_RISK - Atenção necessária · PDF: 66 KB

**Identificação do veículo**

- Placa: AAA0000 _(INFO)_
- Marca: VW _(INFO)_
- Modelo: GOL 1.0 _(INFO)_
- Marca/modelo completo: VW/GOL 1.0 FLEX _(INFO)_
- Chassi: 9BWZZZ377VT004251 _(INFO)_
- RENAVAM: 00123456789 _(INFO)_
- Número do motor: CFZ123456 _(INFO)_
- Número da caixa de câmbio: XXXXXXXXX _(INFO)_
- Remarcação de chassi: Normal _(CLEAR)_
- Placa (padrão Mercosul): AAA0A00 _(INFO)_
- Situação do chassi: Normal _(CLEAR)_

**Características**

- Ano de fabricação: 2020 _(INFO)_
- Ano do modelo: 2021 _(INFO)_
- Cor: PRATA _(INFO)_
- Combustível: ALCOOL/GASOLINA _(INFO)_
- Potência: 76 _(INFO)_
- Cilindrada: 1000 _(INFO)_
- Tipo: XXXXXXXX _(INFO)_
- Espécie: XXXXX _(INFO)_
- Categoria: XXXXXXXX _(INFO)_
- Carroceria: INEXISTENTE _(INFO)_
- Procedência: XXXXXXXX _(INFO)_
- Eixos: X _(INFO)_
- Capacidade de passageiros: X _(INFO)_
- Alterações de características: comparação entre bases: Sem divergência de chassi, motor ou câmbio; cor ou combustível diferem entre as bases _(INFO)_
- Tipo de montagem: COMPLETA _(INFO)_

**Registro e licenciamento**

- UF de emplacamento: XX _(INFO)_
- Município: SAO PAULO _(INFO)_
- Situação do veículo: Circulação _(INFO)_
- Exercício do licenciamento: 2023 _(INFO)_
- Data do licenciamento: 10/09/2023 _(INFO)_
- Emissão do CRV: 02/07/2012 _(INFO)_
- Comunicação de venda: Não consta comunicação de vendas _(CLEAR)_
- UF do faturamento: XX _(INFO)_
- Data de emplacamento: 15/03/2015 _(INFO)_
- Última atualização do cadastro: 10/01/2020 _(INFO)_

**Débitos**

- IPVA: Não existe débito de IPVA _(CLEAR)_
- Valor de IPVA em aberto: R$ 0,00 _(CLEAR)_
- Licenciamento: Existe débito de licenciamento _(ALERT)_
- Valor de licenciamento em aberto: R$ 160,22 _(ALERT)_
- DPVAT: Não existe débito de DPVAT _(CLEAR)_
- Valor de DPVAT em aberto: R$ 0,00 _(CLEAR)_
- Multas: Existe débito de multa _(ALERT)_
- Total de multas em aberto: R$ 293,47 _(ALERT)_
- Multas — DETRAN: R$ 0,00 _(CLEAR)_
- Multas — DER: R$ 293,47 _(ALERT)_
- Multas — DERSA: R$ 0,00 _(CLEAR)_
- Multas — Polícia Rodoviária Federal: R$ 0,00 _(CLEAR)_
- Multas — RENAINF: R$ 0,00 _(CLEAR)_
- Débitos municipais: R$ 0,00 _(CLEAR)_
- Débitos CETESB: R$ 0,00 _(CLEAR)_

**Restrições**

- Furto/roubo: Consta ocorrencia _(ALERT)_
- Restrição judicial: Consta restrição judicial _(ALERT)_
- RENAJUD: Consta restrição renajud _(ALERT)_
- Restrição administrativa: Nada consta _(CLEAR)_
- Restrição tributária: Nada consta _(CLEAR)_
- Guincho/depósito: Nada consta _(CLEAR)_
- Restrição ambiental: Veículo com inspeção veicular OK _(CLEAR)_
- Receita Federal: Não possui restrição RFB _(CLEAR)_
- Outras restrições (1): Nada consta _(CLEAR)_
- Outras restrições (2): Nada consta _(CLEAR)_
- Outras restrições (3): Nada consta _(CLEAR)_
- Outras restrições (4): Nada consta _(CLEAR)_
- Restrição 01 (base nacional): Sem restrição _(CLEAR)_
- Restrição 02 (base nacional): Sem restrição _(CLEAR)_
- Restrição 03 (base nacional): Sem restrição _(CLEAR)_
- Restrição 04 (base nacional): Sem restrição _(CLEAR)_
- Busca e apreensão: Nada consta nas restrições retornadas pela fonte _(CLEAR)_

**Histórico e ocorrências**

- Indício de sinistro: Há indício de sinistro _(ALERT)_
- Histórico de roubo ou furto: Consta registro de roubo ou furto _(ALERT)_
- Participação em leilão: Consta passagem por leilão _(ALERT)_
- Roubo ou furto — detalhes do registro: UF dut: DF _(INFO)_
- Leilão — detalhes do registro: 1 registro de leilão _(INFO)_

**Financiamento e gravame**

- Restrição financeira: Alienacao fiduciaria _(ALERT)_
- Agente financeiro (restrição): BANCO EXEMPLO S.A. _(INFO)_
- Data de inclusão da restrição: 20/02/2024 _(INFO)_
- CNPJ da financeira: 00.000.000/0001-91 _(INFO)_
- Número do contrato: 0045-9981234-7 _(INFO)_
- Vigência do contrato: 20/02/2029 _(INFO)_
- Alienação fiduciária / gravame: Há gravame / alienação fiduciária ativo — BANCO EXEMPLO S.A.. _(INFO)_
- Gravames: banco, contrato e tempo: Banco/financeira: BANCO EXEMPLO S.A. (CNPJ 00000000000191) · contrato nº 0045-9981234-7 ·  _(INFO)_
- Prazo restante do contrato: Contrato vigente até 20/02/2029 (faltam 2 anos e 2 meses) _(INFO)_
- Saldo devedor, parcelas e valor financiado: As bases oficiais (Detran e Senatran) não informam saldo devedor, valor financiado, parcel _(INFO)_

**Inspeção e recall**

- Recall: Possui recall _(ALERT)_
- Recall (fabricante): Consta recall do fabricante _(ALERT)_
- Recall — campanhas registradas: Início da campanha: 04/03/2024 · Montadora: VW DO BRASIL · Campanha: VW/GOL _(INFO)_

**Valor de referência (FIPE)**

- Preço FIPE: R$ 45.000,00 _(INFO)_
- Preço médio de mercado: R$ 44.000,00 _(INFO)_
- Código FIPE: 005004-1 _(INFO)_
- Modelo na tabela FIPE: VW - VOLKSWAGEN GOL 1.0 FLEX 4P _(INFO)_
- Vigência da tabela: 11/2026 _(INFO)_
- Variação da FIPE em 12 meses: +4,2% em 12 meses (de R$ 43.200,00 para R$ 45.000,00) — tabela FIPE _(INFO)_
- Variação da FIPE em 24 meses: +8,3% em 23 meses (de R$ 41.550,00 para R$ 45.000,00) — tabela FIPE _(INFO)_
- Histórico mensal da FIPE (24 meses): Nov/2026 R$ 45.000,00 · Out/2026 R$ 44.850,00 · Set/2026 R$ 44.700,00 · Ago/2026 R$ 44.550 _(INFO)_

**Análises da Placa na Mão**

- Nível de risco de leilão: Alto — indício de sinistro. Classificação da Placa na Mão (Muito baixo, Baixo, Razoável ou _(INFO)_
- Possível desvalorização: Veículos com passagem por leilão ou indício de sinistro costumam ser negociados abaixo da  _(INFO)_
- CSV do Inmetro (veículo recuperado): Se o veículo foi recuperado de dano de média ou grande monta, só pode voltar a circular co _(INFO)_
- Aceitação em seguro e revenda: Pode haver recusa ou prêmio mais alto: seguradoras costumam restringir veículos com passag _(INFO)_
- Projeção de preço (estimativa): R$ 45.900,00 em 6 meses (+R$ 150,00 por mês). Projeção simples da variação dos últimos 12  _(INFO)_
- Quilometragem de referência (estimativa): 40 mil km a 80 mil km (média de mercado: 12 mil km por ano, 5 anos de uso). Estimativa pel _(INFO)_
- Fabricante pelo chassi: Volkswagen _(INFO)_
- Origem pelo chassi: Brasil _(INFO)_
- Ano do modelo pelo chassi: 2027 — diferente do ano do registro (pode ocorrer conforme o critério do fabricante) _(INFO)_

**Proprietário**

- Tipo de proprietário: FISICA _(INFO)_
- Nome do proprietário: XXXXXXXXXXX XXXXX XXXXXXX _(INFO)_
- Nome do proprietário anterior: XXXXXXXX XXXXXXX _(INFO)_
- CPF/CNPJ do proprietário: 123.456.789-00 _(INFO)_
- CPF/CNPJ do faturado: 123.456.789-00 _(INFO)_
- Tipo do faturado: JURIDICA _(INFO)_
- Tipo do comprador: CPF _(INFO)_


### Consulta Premium

Parecer: HIGH_RISK - Atenção necessária · PDF: 67 KB

**Identificação do veículo**

- Placa: AAA0000 _(INFO)_
- Marca: VW _(INFO)_
- Modelo: GOL 1.0 _(INFO)_
- Marca/modelo completo: VW/GOL 1.0 FLEX _(INFO)_
- Chassi: 9BWZZZ377VT004251 _(INFO)_
- RENAVAM: 00123456789 _(INFO)_
- Número do motor: CFZ123456 _(INFO)_
- Número da caixa de câmbio: XXXXXXXXX _(INFO)_
- Remarcação de chassi: Normal _(CLEAR)_
- Placa (padrão Mercosul): AAA0A00 _(INFO)_
- Situação do chassi: Normal _(CLEAR)_

**Características**

- Ano de fabricação: 2020 _(INFO)_
- Ano do modelo: 2021 _(INFO)_
- Cor: PRATA _(INFO)_
- Combustível: ALCOOL/GASOLINA _(INFO)_
- Potência: 76 _(INFO)_
- Cilindrada: 1000 _(INFO)_
- Tipo: XXXXXXXX _(INFO)_
- Espécie: XXXXX _(INFO)_
- Categoria: XXXXXXXX _(INFO)_
- Carroceria: INEXISTENTE _(INFO)_
- Procedência: XXXXXXXX _(INFO)_
- Eixos: X _(INFO)_
- Capacidade de passageiros: X _(INFO)_
- Alterações de características: comparação entre bases: Sem divergência de chassi, motor ou câmbio; cor ou combustível diferem entre as bases _(INFO)_
- Tipo de montagem: COMPLETA _(INFO)_

**Registro e licenciamento**

- UF de emplacamento: XX _(INFO)_
- Município: SAO PAULO _(INFO)_
- Situação do veículo: Circulação _(INFO)_
- Exercício do licenciamento: 2023 _(INFO)_
- Data do licenciamento: 10/09/2023 _(INFO)_
- Emissão do CRV: 02/07/2012 _(INFO)_
- Comunicação de venda: Não consta comunicação de vendas _(CLEAR)_
- UF do faturamento: XX _(INFO)_
- Data de emplacamento: 15/03/2015 _(INFO)_
- Última atualização do cadastro: 10/01/2020 _(INFO)_

**Débitos**

- IPVA: Não existe débito de IPVA _(CLEAR)_
- Valor de IPVA em aberto: R$ 0,00 _(CLEAR)_
- Licenciamento: Existe débito de licenciamento _(ALERT)_
- Valor de licenciamento em aberto: R$ 160,22 _(ALERT)_
- DPVAT: Não existe débito de DPVAT _(CLEAR)_
- Valor de DPVAT em aberto: R$ 0,00 _(CLEAR)_
- Multas: Existe débito de multa _(ALERT)_
- Total de multas em aberto: R$ 293,47 _(ALERT)_
- Multas — DETRAN: R$ 0,00 _(CLEAR)_
- Multas — DER: R$ 293,47 _(ALERT)_
- Multas — DERSA: R$ 0,00 _(CLEAR)_
- Multas — Polícia Rodoviária Federal: R$ 0,00 _(CLEAR)_
- Multas — RENAINF: R$ 0,00 _(CLEAR)_
- Débitos municipais: R$ 0,00 _(CLEAR)_
- Débitos CETESB: R$ 0,00 _(CLEAR)_
- Multas: detalhe por infração (RENAINF): 1 multa — total R$ 195,23 _(ALERT)_

**Restrições**

- Furto/roubo: Consta ocorrencia _(ALERT)_
- Restrição judicial: Consta restrição judicial _(ALERT)_
- RENAJUD: CONSTA RESTRICAO RENAJUD (1 registro) _(ALERT)_
- Restrição administrativa: Nada consta _(CLEAR)_
- Restrição tributária: Nada consta _(CLEAR)_
- Guincho/depósito: Nada consta _(CLEAR)_
- Restrição ambiental: Veículo com inspeção veicular OK _(CLEAR)_
- Receita Federal: Não possui restrição RFB _(CLEAR)_
- Outras restrições (1): Nada consta _(CLEAR)_
- Outras restrições (2): Nada consta _(CLEAR)_
- Outras restrições (3): Nada consta _(CLEAR)_
- Outras restrições (4): Nada consta _(CLEAR)_
- Restrição 01 (base nacional): Sem restrição _(CLEAR)_
- Restrição 02 (base nacional): Sem restrição _(CLEAR)_
- Restrição 03 (base nacional): Sem restrição _(CLEAR)_
- Restrição 04 (base nacional): Sem restrição _(CLEAR)_
- Restrições judiciais (Renajud): tribunal, processo e data: Processo nº 0001234-56.2024.8.26.0100 _(ALERT)_
- Busca e apreensão: Nada consta nas restrições retornadas pela fonte _(CLEAR)_

**Histórico e ocorrências**

- Indício de sinistro: Há indício de sinistro _(ALERT)_
- Histórico de roubo ou furto: Consta registro de roubo ou furto _(ALERT)_
- Participação em leilão: Consta passagem por leilão _(ALERT)_
- Roubo ou furto — detalhes do registro: UF dut: DF _(INFO)_
- Leilão — detalhes do registro: 1 registro de leilão _(INFO)_
- Proprietários no histórico: 2 _(INFO)_
- Histórico de proprietários: 1º · atual · 2024 · SP · JOAO SILVA SANTOS
2º · anterior · 2022 · RJ · MARIA SOUZA _(INFO)_

**Financiamento e gravame**

- Restrição financeira: Alienacao fiduciaria _(ALERT)_
- Agente financeiro (restrição): BANCO EXEMPLO S.A. _(INFO)_
- Data de inclusão da restrição: 20/02/2024 _(INFO)_
- CNPJ da financeira: 00.000.000/0001-91 _(INFO)_
- Número do contrato: 0045-9981234-7 _(INFO)_
- Vigência do contrato: 20/02/2029 _(INFO)_
- Alienação fiduciária / gravame: Há gravame / alienação fiduciária ativo — BANCO EXEMPLO S.A.. _(INFO)_
- Gravames: banco, contrato e tempo: Banco/financeira: BANCO EXEMPLO S.A. (CNPJ 00000000000191) · contrato nº 0045-9981234-7 ·  _(INFO)_
- Prazo restante do contrato: Contrato vigente até 20/02/2029 (faltam 2 anos e 2 meses) _(INFO)_
- Saldo devedor, parcelas e valor financiado: As bases oficiais (Detran e Senatran) não informam saldo devedor, valor financiado, parcel _(INFO)_

**Inspeção e recall**

- Recall: Possui recall _(ALERT)_
- Recall (fabricante): Consta recall do fabricante _(ALERT)_
- Recall — campanhas registradas: Início da campanha: 04/03/2024 · Montadora: VW DO BRASIL · Campanha: VW/GOL _(INFO)_

**Valor de referência (FIPE)**

- Preço FIPE: R$ 45.000,00 _(INFO)_
- Preço médio de mercado: R$ 44.000,00 _(INFO)_
- Código FIPE: 005004-1 _(INFO)_
- Modelo na tabela FIPE: VW - VOLKSWAGEN GOL 1.0 FLEX 4P _(INFO)_
- Vigência da tabela: 11/2026 _(INFO)_
- Variação da FIPE em 12 meses: +4,2% em 12 meses (de R$ 43.200,00 para R$ 45.000,00) — tabela FIPE _(INFO)_
- Variação da FIPE em 24 meses: +8,3% em 23 meses (de R$ 41.550,00 para R$ 45.000,00) — tabela FIPE _(INFO)_
- Histórico mensal da FIPE (24 meses): Nov/2026 R$ 45.000,00 · Out/2026 R$ 44.850,00 · Set/2026 R$ 44.700,00 · Ago/2026 R$ 44.550 _(INFO)_

**Análises da Placa na Mão**

- Nível de risco de leilão: Alto — indício de sinistro. Classificação da Placa na Mão (Muito baixo, Baixo, Razoável ou _(INFO)_
- Possível desvalorização: Veículos com passagem por leilão ou indício de sinistro costumam ser negociados abaixo da  _(INFO)_
- CSV do Inmetro (veículo recuperado): Se o veículo foi recuperado de dano de média ou grande monta, só pode voltar a circular co _(INFO)_
- Aceitação em seguro e revenda: Pode haver recusa ou prêmio mais alto: seguradoras costumam restringir veículos com passag _(INFO)_
- Projeção de preço (estimativa): R$ 45.900,00 em 6 meses (+R$ 150,00 por mês). Projeção simples da variação dos últimos 12  _(INFO)_
- Quilometragem de referência (estimativa): 40 mil km a 80 mil km (média de mercado: 12 mil km por ano, 5 anos de uso). Estimativa pel _(INFO)_
- Fabricante pelo chassi: Volkswagen _(INFO)_
- Origem pelo chassi: Brasil _(INFO)_
- Ano do modelo pelo chassi: 2027 — diferente do ano do registro (pode ocorrer conforme o critério do fabricante) _(INFO)_

**Proprietário**

- Tipo de proprietário: FISICA _(INFO)_
- Nome do proprietário: XXXXXXXXXXX XXXXX XXXXXXX _(INFO)_
- Nome do proprietário anterior: XXXXXXXX XXXXXXX _(INFO)_
- CPF/CNPJ do proprietário: 123.456.789-00 _(INFO)_
- CPF/CNPJ do faturado: 123.456.789-00 _(INFO)_
- Tipo do faturado: JURIDICA _(INFO)_
- Tipo do comprador: CPF _(INFO)_


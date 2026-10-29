# O que traz cada consulta

Fonte: Credify. O que a fonte não retornar é omitido do relatório. "Estimativa" = cálculo da Placa na Mão, sempre rotulado.

| Bloco | Cadastral | Básica | Gravame | Completa |
|---|:-:|:-:|:-:|:-:|
| Identificação (placa, marca, modelo, chassi, RENAVAM, motor) | ✔ | ✔ | dados do veículo | ✔ |
| Características (ano, cor, combustível, potência, cilindrada, categoria, procedência) | ✔ | ✔ | dados do veículo | ✔ |
| Registro (UF, município, situação, licenciamento, CRV, emplacamento) | ✔ | ✔ | – | ✔ |
| Débitos (IPVA, licenciamento, DPVAT, multas) | – | ✔ | – | ✔ |
| Restrições (furto/roubo, judicial, administrativa, tributária, RENAJUD) | – | ✔ | – | ✔ |
| Histórico: indício de sinistro, roubo/furto, leilão, nº de proprietários | – | – | – | ✔ |
| Gravame e intenção de gravame (agente, contrato, data) | – | – | ✔ | ✔ |
| Recall e inspeção veicular | – | – | – | ✔ |
| FIPE: preço, preço médio, variação 12/24 meses, histórico mensal | – | – | – | ✔ |
| Análises: decodificador de chassi, projeção de preço (estimativa), km de referência (estimativa) | – | – | – | ✔ |
| Proprietário (dados protegidos, nunca exibidos ao cliente) | – | – | – | interno |
| Leilão avulso | em breve (fonte ainda não ativada) |

## Comparação com outras plataformas (Olho no Carro, MTIX)

Já cobrimos: cadastro, débitos, multas, restrições, gravame, sinistro, roubo/furto, leilão (indício), recall, FIPE com histórico, proprietários (quantidade).

Ainda dependem de fonte externa (ver `docs/COMPARATIVO-CONCORRENTES.md`) (a Credify não oferece nas consultas atuais): histórico real de quilometragem, fotos reais do veículo, ficha técnica/equipamentos, laudo de leilão com fotos, Renajud detalhado, Farol Leilão. Ver `PENDENCIAS-PRODUCAO.md`.

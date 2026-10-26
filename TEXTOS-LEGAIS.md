# Textos legais (rascunho para revisão do advogado)

Os textos abaixo já estão no sistema. **Nenhum passou por advogado.** Eles são um ponto de partida. A responsabilidade do usuário pelo uso dos dados e os limites de responsabilidade da plataforma valem "na máxima extensão permitida em lei": contra consumidor, a lei (Código de Defesa do Consumidor, art. 51) não deixa excluir toda a responsabilidade, então o advogado precisa confirmar até onde as cláusulas aguentam.

Onde cada texto está:

| Texto | Onde | Versão |
|---|---|---|
| Contrato de compra (consulta avulsa e saldo) | `apps/api/src/purchaseContract.ts`, função `renderPurchaseContract`, modelo por caixas | `2026-10-c3` |
| Termos de Uso (site) | `apps/web/src/client/pages/Public.tsx`, `LEGAL.terms` | `2026-08` |
| Política de Privacidade (site) | `apps/web/src/client/pages/Public.tsx`, `LEGAL.privacy` | `2026-08` |

Mudou o texto: suba a versão (`CONTRACT_MODEL_VERSION_CHECKBOX` no contrato, `LEGAL_VERSION` em `apps/api/src/legalAcceptance.ts` nos documentos do site). Subir `LEGAL_VERSION` faz todo cliente marcar as duas caixas de novo na próxima consulta.

## Caixas de aceite (tela e servidor)

- "Li e aceito os Termos do Contrato de Uso." com o botão **Ler Contrato** (abre o texto em uma janela, sem sair da tela).
- "Estou ciente e concordo com a Política de Privacidade (LGPD)." com link para a política em outra aba.

As duas são obrigatórias na tela e no servidor (erros `PURCHASE_CONTRACT_REQUIRED` e `PURCHASE_PRIVACY_REQUIRED`).

## Termos de Responsabilidade (cláusulas 5 e 6 do contrato, seções 4 e 5 dos Termos de Uso)

**Responsabilidade do contratante pelo uso dos dados.** O contratante é o único e exclusivo responsável pelo uso, pela destinação, pelo armazenamento, pelo compartilhamento e pelo descarte dos dados e informações obtidos nas consultas, e responde por qualquer dano, multa, indenização ou sanção que decorra desse uso, perante si mesmo, a plataforma, os titulares dos dados e terceiros. Declara que: (a) tem finalidade legítima e base legal (LGPD, arts. 7º e 11) para cada consulta; (b) não usará os dados para perseguição, vigilância, discriminação, fraude, golpe, constrangimento ou exposição de terceiros; (c) é o controlador dos dados que obtém; (d) guardará os relatórios com segurança e os descartará quando a finalidade acabar; (e) não repassará nem revenderá relatórios; (f) informará dados verdadeiros e guardará o acesso à conta. Se a plataforma for acionada por causa desse uso, o contratante assume a defesa e ressarce custos, danos e honorários, com direito de regresso.

**Natureza do relatório e limites da plataforma.** Os dados vêm de fontes públicas e fornecedores terceiros e são entregues como foram recebidos, sem garantia de que sejam completos, exatos ou atualizados. A plataforma não responde por decisões tomadas, negócios feitos ou perdidos, lucros cessantes ou danos indiretos decorrentes do resultado da consulta. Em falha de entrega, a responsabilidade se limita a entregar o relatório ou devolver o valor pago. Os limites valem na máxima extensão permitida em lei e não afastam direitos do consumidor.

## LGPD (cláusula 8 do contrato, seção 6 da Política de Privacidade)

- Dados do cadastro: a plataforma é controladora.
- Dados consultados (veículo e proprietário): a plataforma apenas intermedeia a partir das fontes; quem consulta é o controlador do tratamento que fizer.
- Cada consulta é registrada (quem, quando, dado consultado, IP) para segurança e auditoria e pode ser fornecida a autoridades por ordem legal.
- O aceite é registrado com data, IP, navegador e versão dos documentos.

## O que fica gravado no banco

- `purchase_contracts`: texto exato do contrato, hash SHA-256, versão do modelo, data e hora do aceite, IP, IP em hash, navegador, data e versão da política aceita, vínculo com o pedido.
- `user_consents`: uma linha por documento aceito (Termos e Política) em cada compra ou consulta com saldo, com versão, IP, navegador e o que ele liberou.
- Os IPs ficam visíveis só para a equipe, em Contratos, Aceites de compra.

## Pontos para o advogado decidir

Validade do saldo, foro, prazo de 24 horas de entrega, regra de arrependimento para pessoa jurídica, tempo de guarda dos registros de aceite e de consulta (Marco Civil da Internet pede guarda de registros de acesso), cláusula de regresso contra consumidor e o limite de responsabilidade da plataforma.

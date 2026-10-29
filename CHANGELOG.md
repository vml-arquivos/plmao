# Changelog

## 1.12.13 — Volta automática do Pix, cancelar consulta e falhas da Credify visíveis

- Pagamento aprovado (Pix ou cartão): o Mercado Pago volta direto para `/app/consultar/pedido/<pedido>`, que confirma o pagamento, executa a consulta sozinha e abre o relatório. Nada de voltar para a carteira com a linha "Concluir consulta". Funciona também se o Pix demorar (a tela espera e segue sozinha, por até 15 min), se a pessoa precisar entrar de novo na conta (volta para o mesmo pedido) e se a página for atualizada (a consulta não é cobrada duas vezes). Asaas ganhou o mesmo retorno.
- Se algo falhar nessa tela: botão "Tentar de novo" (o pagamento continua válido) e "Cancelar e pedir estorno".
- Cancelar consulta: (1) em andamento, botão "Cancelar consulta" na tela "Consultando…", na tela de retorno do pagamento e no detalhe da consulta; o valor volta na hora (saldo) ou a consulta paga volta a ficar disponível; se a fonte responder depois do cancelamento, o resultado é descartado. (2) Consulta já paga e não usada, botão "Cancelar consulta" em Nova consulta com confirmação; o direito é revogado e o estorno total é pedido ao Mercado Pago (se o provedor recusar, a consulta paga continua disponível). Consulta grátis (cupom de 100%) só é encerrada. Rotas: `POST /queries/:id/cancel`, `POST /queries/cancel-processing`, `POST /payments/query/:id/cancel`.
- Falhas da consulta: a resposta passa de 502 para 424 (`QUERY_RETRY_AVAILABLE`) com mensagem clara ("Nada foi perdido..."), para o aviso sempre chegar ao cliente em vez do genérico "Não foi possível concluir a operação".
- Motivo técnico guardado: cada consulta estornada grava o detalhe da Credify (status HTTP, mensagem, bloco com erro) em `error_message`; aparece em Admin > Consultas (lista com o mouse sobre o código, e no detalhe em "Motivo"). Nada de chaves ou tokens.
- Admin > Integrações: botão "Testar login na Credify (sem consulta)": confirma ClientID/ClientSecret e mostra o IP de saída do servidor (o que precisa estar em "IPs Autorizados" na Credify).
- Tempo limite: `VEHICLE_API_TIMEOUT_MS` 15000 para 50000 e `QUERY_REQUEST_TIMEOUT_MS` 20000 para 60000 (padrões). O Veículo Total junta 8 fontes e passa de 20 s com frequência. Quem definiu esses valores no Coolify precisa trocá-los.
- Token da Credify (vale 24 h): o servidor faz o login sozinho, guarda o token em memória e renova 5 min antes de vencer ou se a Credify recusar. Novo: consultas simultâneas fazem um único login, e uma rotina em segundo plano confere a cada 30 min e renova se faltar menos de 2 h (também faz o login ao iniciar, para o primeiro cliente não esperar). Falha de renovação vai para o log (`credify_token_refresh_failed`).
- Credenciais da Credify: espaços, quebra de linha ou aspas coladas junto com o ClientID/ClientSecret no painel de variáveis são removidos antes do login.
- Admin > Integrações: campo de placa e botão "Testar consulta real (gasta 1 consulta)" ao lado do teste de login. Faz o login e uma consulta de verdade e mostra na tela o motivo exato se a Credify recusar (status, mensagem), sem passar pelo cliente.
- IdConsulta enviado à Credify: agora é um número curto (9 dígitos, décimos de segundo desde 2026-01-01, sempre crescente) em vez de 16 dígitos, para caber em qualquer campo inteiro do fornecedor. Erro 400 da consulta passa a mostrar o corpo devolvido pela Credify e o pedido enviado (placa e IdConsulta), para diagnosticar na tela do admin.
- A chave de idempotência é liberada quando a consulta é estornada: tentar de novo com a mesma chave (tela de pagamento, API pública) executa de novo em vez de ficar em "consulta em andamento".
- Estorno de pedido já revogado pelo cliente não gera mais a anotação `REVERSED_AFTER_CONSUMPTION`.
- Histórico: botão "Arquivar" em cada consulta, "Arquivar estornadas e falhas" (limpa tudo de uma vez) e aba "Arquivadas" com "Restaurar". Arquivar só esconde da lista (migração 045, coluna `archived_at`); os registros de cobrança e estorno não são apagados. Consulta em andamento não pode ser arquivada. A equipe continua vendo tudo no painel.
- Credify, cabeçalho: a documentação diz "Bearer {token}", mas o esquema OpenAPI descreve o cabeçalho como chave direta. Se o formato "Bearer" for recusado (401), o sistema tenta o token puro e passa a usar o que funcionou; depois, renova o token e tenta os dois de novo. No login, segredo só com dígitos que não gera token (401 ou resposta 200 sem token) é reenviado como número.
- Testes: `query-cancel.test.mjs` (10), novos casos em `credify-provider` e `veiculototal`, `migration-rollback` (027–045).

## 1.12.12 — Credify Veículo Total: consultas reais

- Conexão com a Credify (`POST /veiculototal`): corpo `{"Consulta":{"IdConsulta","Placa"}}` gerado sozinho (IdConsulta único por chamada, só dígitos), `Authorization: Bearer` com o token de 24 h do `/auth`. Caminho e corpo padrão passam a ser os do Veículo Total: não é mais preciso configurar `CREDIFY_QUERY_BODY_TEMPLATE` (o modelo aceita `{{queryId}}` e `{{plate}}`)
- `/auth`: se o segredo for só números e for recusado como texto, o sistema reenvia como número (a documentação descreve o campo como inteiro)
- Placa não encontrada (`RESPOSTA.CODIGO = ["2"]`): erro `PLACA_NAO_ENCONTRADA`, cobrança estornada (saldo volta; pagamento direto fica disponível para nova tentativa). Falha no bloco principal (VEICULOSBDRP código 3, EXISTE_ERRO, ou ausente) = resposta inválida, também com estorno
- Relatório: blocos novos. Histórico e ocorrências (indício de sinistro, roubo/furto, leilão, nº de proprietários), recall do fabricante, FIPE (preço, preço médio, código, vigência), placa Mercosul e data de emplacamento. Campos que o BDRP deixa vazios são completados com a base nacional
- Regra de honestidade: bloco com erro (código 3) ou "não foi possível localizar" no recall nunca vira "sem ocorrência"; fica "não informado". Roubo/furto encontrado = risco alto; leilão e sinistro = ponto de atenção
- LGPD: o histórico de proprietários só aparece para a equipe, e mascarado (nome abreviado e documento parcial). O cliente vê apenas a quantidade
- Migração 044: a Consulta Completa passa a incluir as seções Histórico e FIPE (só acrescenta; produto com modelo publicado não muda). Demais produtos: ajustar em Admin > Produtos
- Consultas antigas (formato só VEICULOSBDRP) não mudam
- Testes: `veiculototal.test.mjs` (11, com o exemplo oficial da documentação), `migration-rollback` (027–044).

## 1.12.11 — Aceite com duas caixas obrigatórias, registro auditável e textos de responsabilidade

- Causa do erro "O contrato não pôde ser gerado agora": a compra depende da razão social e do CNPJ da empresa (Admin > Notas fiscais). Sem eles o servidor responde 503 `PURCHASE_CONTRACTOR_MISSING`. Agora a empresa também pode vir das variáveis `COMPANY_LEGAL_NAME`, `COMPANY_CNPJ` e `COMPANY_ADDRESS` (usadas só se o cadastro fiscal estiver vazio), o servidor registra o problema no log com a orientação, e o cliente vê "compra temporariamente indisponível".
- Checkout (consulta e saldo): saiu o texto "ler é opcional". Entram duas caixas obrigatórias, "Li e aceito os Termos do Contrato de Uso." e "Estou ciente e concordo com a Política de Privacidade (LGPD).", com o botão **Ler Contrato** (janela, sem sair da tela) e link para a política. O servidor recusa o pedido se qualquer uma faltar (`PURCHASE_CONTRACT_REQUIRED`, `PURCHASE_PRIVACY_REQUIRED`).
- Consulta com saldo: exige aceite vigente dos dois documentos (quem se cadastrou já tem) ou as duas caixas marcadas na hora; sem isso o servidor responde `TERMS_ACCEPTANCE_REQUIRED` e nada é cobrado. Nova rota `GET /api/legal/acceptance`. A tela só mostra as caixas no saldo se ainda faltar aceite.
- Registro auditável (migração 043): contrato de compra guarda IP, IP em hash, navegador, data e hora do aceite, versão do contrato, data e versão da política; `user_consents` ganha IP, navegador e vínculo (compra ou consulta) e recebe duas linhas por aceite. A equipe vê tudo em Contratos, Aceites de compra.
- Contrato modelo `2026-10-c3`: novas cláusulas de responsabilidade exclusiva do usuário pelo uso, destinação e manuseio dos dados, regresso, limites de responsabilidade da plataforma sobre o resultado, papéis na LGPD e registro de consultas. Termos de Uso e Política de Privacidade do site receberam as mesmas regras. Rascunho, sem revisão de advogado: ver `TEXTOS-LEGAIS.md`.
- Testes: `purchase-checkbox.test.mjs` (10), `migration-rollback` (027–043).

## 1.12.10 — Contrato mais simples na compra: caixinha "Li e aceito" e comprovante por e-mail

- Checkout (consulta avulsa e saldo): some o botão "Ler contrato e confirmar por e-mail" e o código. Entra uma caixinha "Li e aceito o contrato de compra". Ler é opcional: o link abre o texto já preenchido com os dados da pessoa, da empresa e do pedido.
- Ao pagar, o servidor cria o contrato aceito no mesmo instante (texto exato, hash, data, IP em hash e navegador) e liga ao pedido. Contrato novo usa o modelo `2026-10-c2` (aceite por caixinha). Quem não tem CPF/CNPJ no perfil também consegue comprar; a linha do documento só sai do contrato.
- Depois do pagamento confirmado (ou do cupom de 100%), a pessoa recebe um e-mail de comprovante: consulta avulsa recebe o resumo do que contratou (item, dado consultado, valor, número do contrato); compra de saldo recebe o resumo e a cópia do contrato. Um e-mail por pedido, sem duplicar.
- Se o pagamento falhar ao abrir, o contrato daquela tentativa fica expirado e não aparece em Carteira, Contratos.
- O fluxo antigo com código por e-mail continua na API (`/purchase-contracts/draft` e `/confirm`), sem uso na tela. Nova rota `POST /api/purchase-contracts/preview` para ler o texto sem gravar nada.
- Checklist de implantação: o aviso de e-mail passou de bloqueio para aviso, porque a compra não depende mais de código por e-mail (o e-mail serve ao comprovante).
- Testes: `purchase-checkbox.test.mjs` (6) e ajuste dos testes de contrato.

## 1.12.9 — Segurança das dependências, retenção do dado bruto e checklist de lançamento

- Dependências: `body-parser` 1.20.9 (alerta de segurança fechado). O `nodemailer` ficou na 10.0.9: a 10.2.1 quebrou o envio nos testes de e-mail, então não entrou. O `zod` continua na versão 3: a versão 4 foi testada e mudou o comportamento de 11 testes, então não entrou. Alerta restante é de consumo de memória em listas enormes; o limite de corpo da requisição (256 kb) já restringe isso.
- Novo `RAW_RETENTION_DAYS`: apaga o dado bruto cifrado do fornecedor depois do prazo (0 = não apaga; sugestão 90). O relatório do cliente não muda. Roda a cada 6 horas e registra na auditoria.
- Checklist de implantação (Financeiro): bloqueios novos para dados da empresa do contrato de compra (razão social e CNPJ) e e-mail do comprovante (aviso); avisos para canais de atendimento e prazo do dado bruto.
- Testes: `raw-retention.test.mjs` e caso novo no checklist.

## 1.12.8 — Estoque da loja: preenchimento pela placa e importação do histórico

- Novo veículo: ao digitar a placa, o formulário preenche marca, modelo, versão, anos, cor, combustível, Km e valor FIPE com o que a equipe já tem no sistema (consulta concluída, FIPE consultada, garagem de quem é da equipe e estoque anterior da loja). Só campos vazios são preenchidos; o aviso diz de onde veio. Não chama fonte externa e não cobra. Sem dados salvos, o aviso leva à consulta.
- Estoque > Importar do histórico: lista as placas que a equipe já consultou ou guardou na garagem e que ainda não estão em estoque; escolhe vários e importa de uma vez (até 30). Entram em rascunho: sem preço, fora da vitrine, com selo ligado à consulta. Mostra "Falta preço" até o preço ser informado.
- Vitrine só liga com preço maior que zero (tela e API).
- Respeita o limite de veículos da loja (importação não cria nada pela metade) e a placa duplicada.
- Correção: as mensagens escritas para o cliente nas telas da Loja (limite atingido, placa repetida, dados inválidos) apareciam como texto genérico; agora aparecem como foram escritas.
- Rotas: `GET /api/dealer/vehicle-lookup`, `GET /api/dealer/import-candidates`, `POST /api/dealer/vehicles/import`.
- Testes: `dealer-history.test.mjs`.

## 1.12.7 — Contrato automático em cada compra, com código por e-mail

- Cada compra (pacote de saldo ou consulta avulsa, inclusive cupom de 100%) gera um **contrato de adesão** com dados do cliente (nome, CPF/CNPJ, e-mail, endereço), da empresa (razão social, CNPJ e endereço do cadastro fiscal, canais de suporte) e do pedido (item, preço, desconto, total por extenso).
- O cliente lê o contrato, recebe um **código de 6 dígitos no e-mail** e só então o pagamento abre. Código vale 10 min, 5 tentativas, reenvio com intervalo e limite. O contrato aceito vale 30 min e só serve para o mesmo item e valor.
- O aceite grava: texto exato e SHA-256, data/hora, e-mail que recebeu o código (mascarado), IP em hash, navegador e o pedido. O texto não muda depois de gerado (trava no banco). O cliente recebe aviso por e-mail (sem CPF) e vê o contrato em Carteira > Contratos, com download.
- Garantia de entrega escrita no contrato e sustentada pelo sistema: consulta que falha volta ao saldo ou ao direito de consulta; pagamento confirmado sem entrega em 24 h = entrega ou devolução.
- Painel: Contratos > Aceites de compra, com busca, texto e evidências.
- Telefone, WhatsApp, horário e e-mail de suporte por variável (`SUPPORT_*`), no rodapé, em Contato, no Suporte e no contrato.
- Migração 042. Substitui o aceite por caixinha (que não chegou a ser publicado).
- Testes: `purchase-contract.test.mjs`; testes de cupom e de busca passaram a aceitar o contrato antes do checkout.

## 1.12.6 — Modo pré-lançamento (site fechado ao público)

- Novo `SITE_MODE=prelaunch`: o endereço continua abrindo, mas o site não é indexado (robots.txt bloqueia tudo, sitemap some, todas as respostas levam `X-Robots-Tag: noindex` e a página leva meta noindex).
- Só e-mails de `PRELAUNCH_ALLOWED_EMAILS` (endereço completo ou `@domínio`) criam conta, compram saldo ou consultam. Os demais veem "O site ainda não está aberto ao público." Contas antigas fora da lista também não pagam nem consultam.
- Nenhum texto de aviso foi colocado nas páginas. Para abrir ao público: `SITE_MODE=public` e redeploy.
- Admin > Integrações mostra o estado do modo.
- Testes: `site-mode.test.mjs`; o teste de lista por período passou a pegar o dia do próprio banco (falhava à noite no horário do Brasil).

## 1.12.5 — Consulta por chassi, Renavam e documento do proprietário

- Nova consulta aceita quatro tipos de busca: placa, chassi, Renavam e CPF/CNPJ do proprietário. A tela Nova consulta ganhou o seletor de tipo, com validação de cada um (dígito verificador do Renavam, CPF e CNPJ).
- Cada fonte declara o que atende. O que a fonte atual não atende aparece como "em breve" e a API responde antes de cobrar, sem débito.
- Fonte de teste (ConsultarPlaca): placa e chassi funcionam. Renavam e CPF/CNPJ não existem como entrada nessa fonte.
- Credify e provedor genérico: novo `VEHICLE_SEARCH_TYPES` e marcadores `{chassis}`, `{renavam}`, `{document}` no caminho ou no corpo. Falta confirmar com o contrato quais tipos a Credify atende.
- Cupom grátis, pagamento direto e estorno valem para qualquer tipo; o direito pago guarda o tipo pedido.
- Em busca por chassi/Renavam, a placa mostrada no histórico e no relatório é a devolvida pela fonte.
- API pública v1 aceita `plate`, `chassis` ou `renavam`. Novo `GET /api/search-types`.
- Chassi fictício do ambiente de testes passou a ser válido (sem I, O, Q).
- Migração 041: tipo de busca em consultas, pedidos e direitos pagos.
- Testes: `search-types.test.mjs`.

## 1.12.4 — Cupom de 100% libera a consulta sem o checkout

- Cupom que zera o total em consulta avulsa agora funciona: o pedido nasce pago (valor zero, origem "coupon"), a consulta fica liberada e o cupom é resgatado na hora. Não passa pelo Mercado Pago, não gera comissão nem cobrança.
- Cada conta resgata o mesmo cupom grátis uma vez. O limite de resgates do cupom continua valendo.
- Tela Nova consulta: com cupom de 100% aparece "Consultar grátis" e a consulta roda direto.
- Cupom parcial ou sem cupom continua exigindo o checkout; sem o meio de pagamento configurado, a mensagem agora é clara.
- Corrigido: erros de cupom (inválido, indisponível, indicação inválida) apareciam como mensagem genérica. Agora saem em português.
- Migração 040: `payment_orders.amount_cents` passa a aceitar zero.
- Pacote de saldo com cupom de 100% segue não aceito (mensagem própria).
- Testes: `free-coupon.test.mjs` e ajuste em `commercial.test.mjs`.

## 1.12.3 — Correção: subida em produção com ConsultarPlaca e Credify

- Corrigido: com `DATA_PROVIDER=real`, o sistema exigia endereço e token do adaptador genérico (`VEHICLE_API_*`) mesmo com `VEHICLE_API_PROVIDER=consultarplaca` ou `credify`, e não subia (`VEHICLE_PROVIDER_ENDPOINT_REQUIRED,VEHICLE_PROVIDER_BEARER_REQUIRED`). Agora cada provedor exige só as suas credenciais.
- Testes: `config-vehicle-provider.test.mjs`.

## 1.12.2 — Consulta veicular de teste (ConsultarPlaca)

- Novo provedor `VEHICLE_API_PROVIDER=consultarplaca` (com `DATA_PROVIDER=real`) para validar o sistema enquanto a Credify não chega. Variáveis: `CONSULTARPLACA_EMAIL`, `CONSULTARPLACA_API_KEY` e, se precisar, `CONSULTARPLACA_BASE_URL`.
- A placa `AAA0000` devolve dados fictícios e não gasta crédito.
- Traz só os dados do veículo. Débitos e restrições aparecem como "não fornecido" no relatório, nunca como "nada consta".
- Admin > Integrações mostra o novo item e o que falta preencher. A chave fica fora do log.
- Testes: `consultarplaca-provider.test.mjs`.

## 1.12.1 — Loja: ciclo completo (criar, editar, arquivar, excluir) e personalização

- **Admin > Lojas**: botão **Nova loja** (e-mail do dono, nome, endereço da vitrine, WhatsApp, cidade, UF); editar todos os dados e limites; suspender; **arquivar e restaurar**; **trocar o dono** (o dono anterior vira gerente; quem já tem outra loja não recebe); **excluir de vez** confirmando o endereço. Tudo auditado.
- **Dono da loja** (responsável pelo contrato): em Minha loja > Equipe, **Arquivar loja** (vitrine sai do ar e a equipe perde o acesso, nada é apagado), **Restaurar** e **Excluir de vez** (só arquivada e digitando o endereço). Só o dono faz isso.
- **Excluir veículo** (dono e gerente; vendido fica no histórico), **excluir proposta** e **avaliação de troca** (gerente qualquer uma; vendedor as próprias). Propostas já feitas mantêm o texto se o veículo for excluído.
- **Personalização da vitrine**: logo, capa, cor de destaque, Instagram, endereço e horário (links só https, cor validada). Cor aplicada nos botões e selos da vitrine.
- Banco: migração `039_dealer_branding` (colunas novas com checagens e `archived_at`), com reversão.
- Testes: `dealer-crud.test.mjs`; helper de teste passa a enviar `content-length` (corpo em DELETE).

## 1.12.0 — Minha loja: estoque, leads, propostas e vitrine

Módulo novo para lojas, agências e vendedores. Aparece em **Minha loja** no menu; quem não vende veículos não vê nada diferente.

- **Estoque de veículos**: cadastro com preço, custo (só dono e gerente), FIPE, margem, km, fotos (links https), IPVA e licenciamento. A placa liga sozinha à última consulta concluída da equipe (selo "Verificado"). Reservar, vender (com o lead comprador), arquivar. Placa única por loja enquanto o veículo está em estoque.
- **Funil de leads**: Novo, Contato, Proposta, Visita, Fechado e Perdido, com histórico de cada mudança, anotações, próximo retorno e botão de WhatsApp. Perder exige motivo; só dono e gerente reabrem. Vendedor vê só os seus e os sem responsável (e pode assumir). Exportar CSV e excluir lead: dono e gerente.
- **Proposta em PDF**: preço, entrada, troca e simulação do financiamento do saldo (mesmo motor do simulador). Código `PRO-XXXXXXXX`, validade, QR da consulta verificada. Ao criar a proposta o lead vai para Proposta.
- **Avaliação de troca**: estimativa interna a partir da FIPE informada, margem da loja, condição e km, com faixa de 3%. Não é laudo.
- **Alertas e painel**: veículo parado, preço acima da FIPE, IPVA ou licenciamento vencendo, retorno atrasado, lead sem responsável; resumo de 30 dias (leads, conversão, vendas, lucro, dias para vender, ranking da equipe).
- **Equipe**: dono, gerente e vendedor; uma pessoa em uma loja só; limites de pessoas e veículos por loja.
- **Vitrine pública** `/loja/:slug` e `/loja/:slug/veiculo/:id`: só quando o dono liga. Mostra preço, fotos, selo e botão de WhatsApp; nunca mostra custo nem a placa inteira. Formulário de contato com aceite (LGPD), campo-isca contra robôs, limite por IP, sem duplicar o mesmo contato em 24 h e aviso por e-mail para a loja. Entra no sitemap e tem título próprio para buscadores.
- **Painel admin > Lojas**: lista, limites de veículos e pessoas, suspender e reativar (auditado).
- **Banco**: migração `038_dealerships` (7 tabelas) com reversão; chaves estrangeiras, checagens (placa, telefone, etapa, datas, valores) e índices únicos garantem a consistência mesmo fora da API. Limites aplicados com trava de linha para não estourar em requisições simultâneas.
- Novas variáveis (opcionais): `DEALER_DEFAULT_VEHICLE_LIMIT` (30) e `DEALER_DEFAULT_MEMBER_LIMIT` (3).
- Testes: `dealer.test.mjs`, `dealer-rules.test.mjs`; `migration-rollback.test.mjs` agora cobre 027 a 038.

## 1.11.1 — Mercado Pago pronto para as credenciais

- **Conferência automática de pagamentos**: se o aviso (webhook) do Mercado Pago se perder, o saldo entra mesmo assim. Ao voltar do checkout a Carteira confere os pedidos abertos (`POST /payments/sync`, no máximo uma vez a cada 3 s por pessoa) e uma varredura a cada 3 minutos confere pedidos abertos de 2 minutos a 3 dias (`PAYMENT_SYNC_WORKER`, padrão ligado). Usa o mesmo identificador do webhook, então nunca libera duas vezes. A conciliação manual do painel usa o mesmo código.
- Pagamentos feitos com credencial de teste não mandam aviso; agora também funcionam por esse caminho.
- O Access Token de teste do Mercado Pago começa com `APP_USR` (não com `TEST-`). O painel deixou de afirmar "teste" ou "produção" pelo prefixo; "Testar conexão" confirma pelo tipo da conta.
- Carteira: avisos de pagamento pendente e não aprovado ao voltar do checkout.
- `PENDENCIAS-PRODUCAO.md`: seção "Mercado Pago: configuração exata" (conta, contas de teste, variáveis, webhook, teste e produção).
- Testes: `payment-sync.test.mjs`.

## 1.11.0 — Visual limpo e consultas com filtros

- Visual mais simples em todo o site (cliente, público e painel): fonte única (Inter), letras leves (peso normal e médio), menos sombra, botões e tabelas mais finos, abas com sublinhado. A placa continua com a fonte própria.
- **Consultas** (antes "Histórico"): abas Todas, Realizadas, Em processamento, Falha e Estornadas; filtro por placa, tipo de consulta e período (30, 60, 90 dias ou datas); botão **Exportar CSV**; "Ver mais" para páginas seguintes. API: `GET /queries` aceita `status`, `product`, `plate`, `days`, `from`, `to`, `limit`, `offset`; novos `GET /queries/types` e `GET /queries.csv`.
- **Carteira**: saldo em destaque com "Adicionar saldo" e "Nova consulta"; filtro de período no extrato e nos pagamentos; extrato em CSV (`GET /wallet/transactions.csv`); nova aba **Notas fiscais** com as notas emitidas para o cliente (`GET /account/fiscal-documents`, só links https). Os cartões dos pacotes ganharam estilo (estavam sem).
- **Parceiros**: tabela de comissões **por mês** (`monthly` em `GET /affiliate/stats`).
- Menos texto nas telas do cliente; nenhuma função removida. No celular a lista de consultas quebra em duas linhas.
- Testes: `client-lists.test.mjs` (filtros, paginação, CSV, notas, comissões por mês).

## 1.10.7 — Envio de e-mail pela API do Brevo

- Novo `EMAIL_PROVIDER=brevo_api` com `BREVO_API_KEY`: o e-mail sai pela API HTTPS do Brevo (porta 443), sem depender das portas de SMTP, que a DigitalOcean bloqueia em contas novas. O restante do sistema (fila, convites, link de senha, contato, webhook de entrega) funciona igual. O teste do painel mostra "chave recusada" ou "não conectou".
- A produção só aceita o endereço oficial da API (`https://api.brevo.com/v3`).
- A mensagem de falha de conexão agora explica o bloqueio de portas e as duas saídas.

## 1.10.6 — Teste de e-mail com erro claro

- "Testar conexão" no painel agora diferencia **credenciais recusadas** (login ou chave SMTP errados) de **não foi possível conectar** (host, porta ou rede). Antes qualquer falha aparecia como credencial recusada.
- Limites de tempo na conexão SMTP (15 s de conexão, 30 s de resposta), para o botão não ficar girando.
- O texto de ajuda do webhook no painel passa a indicar o token do portador (Bearer) e os eventos certos.

## 1.10.5 — Remetente com nome e roteiro exato do e-mail (Brevo)

- Os e-mails saem como "Placa na Mão <no-reply@placanamao.com.br>" (nome vindo de `APP_NAME`); o endereço continua sendo o `EMAIL_FROM` verificado no Brevo.
- Nova variável opcional `EMAIL_REPLY_TO`: respostas dos e-mails automáticos vão para um endereço de sua escolha (ex.: o Gmail), já que o domínio não tem caixa de e-mail.
- `PENDENCIAS-PRODUCAO.md`: configuração exata do SMTP, do webhook de entrega, testes e solução de problemas.

## 1.10.4 — Verificação em 2 etapas opcional, computador confiável e hierarquia de acessos

- **2 etapas opcional** no painel: ninguém é obrigado a cadastrar o aplicativo. O padrão agora é `TEAM_TOTP_REQUIRED=false` (o `.env.example` estava como `true`). Quem quiser ativa em "Minha conta"; quem já ativou pode desativar com senha e código.
- **Confiar neste computador**: ao informar o código, a caixa "Confiar neste computador" evita pedir de novo no mesmo aparelho (padrão 90 dias, renova a cada uso; `TEAM_TRUSTED_DEVICE_DAYS`, 0 desliga). Vale até sair da conta ou limpar os dados do navegador. Em "Minha conta" dá para ver e remover os computadores. Trocar a senha ou desativar a verificação remove todos. Migração 037.
- **Hierarquia**: cada nível só vê e gerencia quem está abaixo. O administrador não enxerga super admin nem outro administrador (para ele não existem; resposta 404). Vale para `/admin/team`, `/admin/users` e a lista de responsáveis do suporte. Super admin alcança todos.
- **Dados pessoais só do próprio usuário**: ninguém edita nome ou senha de outra pessoa. Quem está acima pode bloquear, remover e zerar a verificação de quem está abaixo. Cada um edita o próprio nome em "Minha conta" (`PATCH /admin/auth/profile`).
- **Senha por link**: criar membro/cliente e "Enviar link de nova senha" mandam um e-mail para a pessoa criar a própria senha; ninguém vê senha temporária. Convite vale 3 dias. Precisa do e-mail (SMTP) configurado; sem ele a criação de membro da equipe avisa e não cria.
- Correção: o link de senha de quem é da equipe gravava a senha mas mostrava erro. Agora confirma e orienta a entrar pelo painel.

## 1.10.3 — App instalável, proposta na tela e responsivo revisado

- **Instalar o app**: botão "Instalar o app" no menu e no rodapé, aviso na parte de baixo da tela (some por 14 dias se dispensado), convite nativo no Android e no computador, passo a passo do "Adicionar à Tela de Início" no iPhone/iPad (iOS não tem convite nativo) e página `/instalar`. Manifesto com capturas de tela, atalhos (consultar, simulador, guia, FIPE, histórico) e orientação livre (antes travava em retrato).
- **Simulação na tela**: "Ver proposta completa" mostra tudo (resumo, CET, todas as parcelas, comparação com bancos) com **salvar no histórico, baixar PDF e imprimir**. Sem conta dá para ver e imprimir.
- **Histórico de simulações** em `/app/simulacoes` (ver, baixar PDF, excluir) e resumo no simulador. API: `POST /simulator/save`, `GET` e `DELETE /simulator/mine/:code`.
- **Responsivo**: corrigido estouro de largura em 360 px (início, simulador, nova consulta, painel) e no resumo da consulta em 1024 px; colunas de grade com `minmax(0, 1fr)`; alvos de toque de 40 px em telas de toque; cabeçalho compacto em telas pequenas.
- Guia de veículos: plano B dos selects (marca e modelo das fichas) quando a tabela FIPE está desligada.

## 1.10.2 — Guia de veículos: filtro por marca, modelo, versão e ano

- `/veiculos`: selects Marca → Modelo → Versão → Ano alimentados pela tabela FIPE (carros, motos e caminhões), além do campo para digitar o nome (com sugestões). Ao escolher a versão aparece a ficha do guia, quando existe, e ao escolher o ano, o valor, com atalhos para simular o financiamento (já com o valor) e consultar a placa.
- API: `GET /api/vehicles/fipe-match` liga o nome da FIPE à ficha (marca + começo do modelo, palavra inteira).
- Migração 036: descrição do Civic só com o que Inmetro e Honda informam (consumo PBEV 2024 e suspensão). `npm run db:rollback -- 10` reverte 027 a 036.

## 1.10.0 — Integrações preparadas, contratos, fiscal, e-mail seguro, chat de suporte e depoimentos

Nada aqui liga cobrança, consulta paga ou emissão real por conta própria: tudo nasce desligado e só funciona com credenciais e decisões registradas em `PENDENCIAS-PRODUCAO.md`. Migrações 027 a 035 (todas com `down`; `npm run db:rollback -- 9` reverte as nove).

### Adicionado

- **Escopo do relatório por produto** (027): campos e seções configuráveis por produto, com publicação versionada, refletidos no relatório, na API pública e no PDF.
- **Consulta veicular via Credify** (adaptador preparado): `VEHICLE_API_PROVIDER=credify`. O corpo da requisição vem de `CREDIFY_QUERY_BODY_TEMPLATE`; sem ele, nada é consultado.
- **CNPJ no servidor** (029): preenchimento revisável por BrasilAPI (`CNPJ_PROVIDER`, desligado por padrão), cache, limite por solicitante, só campos mínimos e auditoria.
- **Fila de e-mail e links seguros** (028): outbox idempotente com tentativas e espera crescente, webhook de entrega assinado (HMAC), reenvio/cancelamento no painel. Contratos e documentos fiscais saem por link seguro e expirável, nunca anexados.
- **Contratos versionados** (030): minutas de cliente, empresa e parceiro; DRAFT → revisão → aprovação (precisa de referência da revisão jurídica e de outra pessoa) → publicação. Contrato: rascunho → aprovação → assinatura → assinado, com trilha imutável. Aplicar preços e comissões é uma ação à parte, depois da assinatura.
- **Mercado Pago completo** (031): estorno total idempotente, conciliação por `external_reference`, tratamento de reembolso parcial e disputa (revisão manual), host oficial obrigatório em produção.
- **Fila fiscal** (032): provedor `disabled`/`manual`/`mock` (mock proibido em produção), idempotência, tentativas, e-mail do documento só depois de emitido.
- **Chat de suporte** (033): conversas ligadas à conta e, se quiser, a uma consulta ou pagamento; assistente que só responde com perguntas frequentes publicadas e sempre oferece "Falar com uma pessoa"; assuntos de reembolso, cobrança, fraude e LGPD vão direto para a equipe; número de cartão é ocultado; anexos validados pelo conteúdo (PNG, JPG, WebP, PDF até 2 MB); notas internas invisíveis ao cliente; atribuição, transferência, prioridade e auditoria. Avisos por e-mail sem o conteúdo da conversa.
- **Depoimentos autorizados** (034): o cliente verificado envia com consentimento registrado; a equipe aprova e publica; texto não editável pelo painel; cadastro manual exige comprovante e outra pessoa para aprovar; ocultar, remover e retirada pelo cliente apagam o texto; a home só mostra depoimentos publicados e íntegros (e some se não houver).
- **Operação**: `GET /ready` (banco e migrações), checklist de implantação ampliado (e-mail, contratos, assinatura, fiscal, Mercado Pago, fonte de consulta, CNPJ, MFA, taxas do simulador, perguntas frequentes) e aviso de taxas defasadas no simulador.

- **Painel Integrações** (`/integracoes`): mostra se cada chave está preenchida (nunca o valor), a URL de webhook a cadastrar e testa a conexão do Mercado Pago (leitura, sem cobrança) e do SMTP (envia e-mail de teste a quem clicou).
- **Brevo**: webhook de entrega `POST /api/webhooks/email/brevo` (token em `x-webhook-token`, Bearer ou Basic), correlação pelo cabeçalho `X-Mailin-custom` de cada envio.
- **Minutas**: novas variáveis calculadas (`valor.total`, `valor.total_extenso`, `desconto.total`, `vigencia.meses`, `comissao.percentual`, `signatario.nome`...), catálogo de variáveis, pré-visualização com dados de exemplo e envio de minuta própria (.txt/.md) como nova versão em rascunho.
- **Chat**: 14 perguntas e respostas de atendimento publicadas (migração 035); "esqueci minha senha" agora é respondido pela pergunta frequente em vez de ir direto para uma pessoa.

### Corrigido

- `/comparar` volta a ser indexável (sitemap, robots, sem noindex); páginas inexistentes respondem 404 com noindex e título próprio.
- HTML inicial com conteúdo semântico (título, descrição, navegação, perguntas frequentes) para quem não executa JavaScript.
- Corpo grande demais em anexos responde 413 (antes, 500).

## 1.9.0 — Minha garagem, contestação de dado, funil completo, parceiros com QR e ferramentas no SEO

### Adicionado

- **Minha garagem** (`/app/garagem`): a pessoa guarda até 10 veículos, vê os relatórios de cada placa, cria **lembretes por data ou quilometragem** (vencido / em breve), registra manutenções e gastos, exporta tudo em JSON e apaga. O que ela digita é marcado como informado por ela. Botão "Guardar na garagem" no relatório. API `/garage/*`; migration `026_garage` (colunas em `saved_vehicles` e tabela `garage_items`).
- **Informar dado incorreto** no relatório: vira chamado no Suporte com placa e código de verificação (`POST /queries/:id/report/dispute`, até 5 por dia).
- **Funil completo no painel** (30 dias): visitantes, busca de placa, cadastros, checkouts, pagamentos, relatórios entregues e abertos, falhas/estornos, contestações e quem comprou de novo (`GET /admin/funnel`; novo evento `REPORT_OPENED`).
- **Parceiros**: links por destino (início, consulta, FIPE, simulador, comparador, guia), **QR code** para baixar, visitas dos últimos 30 dias, pagamentos e estornos.
- **Páginas de SEO** com atalhos para FIPE, simulador, comparador e guia; simulador com "Copiar link desta simulação".

### Corrigido

- Links de indicação do parceiro usavam `APP_URL` direto e davam erro 500 quando a variável não estava definida; agora usam o endereço público padrão.
- `qrcode` passou a ter chunk próprio e público: sem isso, a página do parceiro carregava o arquivo do painel e quebrava. `release-verify` agora falha se qualquer arquivo público importar arquivo do painel.

### Não feito (de propósito)

- Seguro e autopeças: exigem parceiro habilitado e validação jurídica. Prévia antes do pagamento e fonte por seção do relatório dependem do contrato do provedor.

## 1.8.0 — Comparativo CDC x leasing com primeira e última parcela, parcelas decrescentes e perguntas e respostas

### Adicionado

- **Simulador**: o quadro lado a lado mostra taxa, **primeira parcela, última parcela**, valor residual do leasing, total pago, custo do crédito e CET, com a diferença em cada linha. Abaixo, "Por que a parcela é diferente?" explica o motivo com os valores da simulação (no leasing, parte do valor fica para o final como residual).
- **Tipo de parcela**: fixas (padrão, tabela Price) ou **decrescentes** (SAC: a primeira é a mais alta e a parcela cai todo mês). Campo `amortization` (`PRICE` | `SAC`) em `/simulator/calculate` e `/simulator/pdf`; parâmetro `am=sac` na URL; botão "Ver com parcelas decrescentes" no quadro. Resultados novos: `firstInstallmentCents`, `lastInstallmentCents`, `amortization`. O CET é calculado sobre as parcelas reais de cada mês.
- **Ícone "i"** (passar o mouse, tocar ou focar) explicando CDC, leasing e parcelas fixas/decrescentes, no quadro, nos cartões de resultado e no formulário. Componente `InfoTip`.
- **Perguntas e respostas** sobre diferença entre CDC e leasing, por que a parcela do leasing é menor, parcelas fixas ou decrescentes, qual é mais vantajoso, atraso, inadimplência e venda do veículo. Aparecem no simulador e no FAQ do site (migration `025_financing_faqs`, categoria "Financiamento", sem duplicar se rodar de novo).
- PDF: primeira e última parcela quando decrescente, e a frase do motivo da diferença no quadro CDC x leasing.

### Atenção

- Nada muda nas simulações existentes: sem `amortization`, o cálculo é o mesmo de antes (parcelas fixas).
- Os textos de atraso e inadimplência são informativos e gerais; as regras exatas estão no contrato de cada instituição.

## 1.7.0 — Senha de 8 caracteres, 2FA opcional, campo único de veículo e CDC x leasing lado a lado

### Alterado

- **Senha mínima de 8 caracteres** para clientes, equipe, criação de admin e senha inicial (`ADMIN_BOOTSTRAP_PASSWORD`; o código de erro virou `ADMIN_BOOTSTRAP_PASSWORD_MIN_8_CHARS`). Antes: 10 (clientes) e 12 (equipe).
- **2FA por aplicativo opcional no painel.** Sem aplicativo ativado, entra só com a senha. Em "Minha conta", a pessoa ativa (QR code, confirmação por código, códigos de recuperação) e desativa (senha + código). Ao ativar, as outras sessões abertas são encerradas. `TEAM_TOTP_REQUIRED` agora vale `false` por padrão; com `true` volta a ser obrigatório e a desativação é bloqueada. A exigência em produção (`ADMIN_TOTP_CANNOT_BE_DISABLED`) foi removida. Contas que já tinham 2FA continuam com ele ligado até desativarem.
- **Simulador**: um único campo "Qual veículo você quer financiar?". Digite e escolha na lista (ex.: "onix 2020") ou escolha marca, modelo e ano; aparece o valor FIPE com o botão "Usar este valor". Sem textos de fonte ou explicação.
- **Simulador abre comparando CDC e leasing**, com quadro lado a lado (parcela, total pago, custo do crédito, CET), a diferença em cada linha e qual sai mais vantajoso no total. A comparação por banco saiu da tela do simulador.

### Adicionado

- Busca por texto na página `/fipe` (por marca e modelo).
- Painel › Guia de veículos: ao criar modelo ou versão, "Buscar veículo na lista" preenche marca, nome, ano, combustível e código FIPE (`/admin/vehicles/fipe/search|years|price`).

### Atenção

- Senha de 8 caracteres e 2FA opcional reduzem a proteção. Mantidos: bloqueio por 15 minutos após 5 erros, host dedicado do painel e `ADMIN_ALLOWED_IPS`. Recomendado ativar o 2FA nas contas de super admin.
- O registro "escolhas no simulador" do painel (Frota e interesse) deixa de receber dados, porque o campo do simulador não usa mais a lista do Senatran.

## 1.6.0 — Escolha de veículo pela Tabela FIPE, valor FIPE automático no simulador e lista completa da frota no painel

### Adicionado

- **Simulador**: além do campo de nome (busca na frota do Senatran), um bloco **"Ou escolha pela Tabela FIPE"**: digite marca, modelo e ano (ex.: "onix 2020") ou escolha **marca, modelo/versão e ano** nas listas (com filtro de modelos). Ao escolher o ano, aparece o **valor FIPE do mês** (com mês de referência e código FIPE), o nome do veículo vai para o campo e para o PDF, e um botão "Usar como valor do veículo" preenche o valor. O valor digitado pela pessoa nunca é trocado sozinho; a tela só informa quanto ele está acima ou abaixo da FIPE. Se a FIPE estiver fora do ar, o simulador segue normalmente com valor digitado.
- **Comparador**: abaixo da busca por texto, "Ou escolher por marca, modelo, versão e ano" (listas em cascata com os veículos que têm ficha no guia). Nova rota pública `GET /vehicles/version-tree`.
- **API**: `GET /fipe/search` (busca por texto na própria FIPE, aceita apelidos como vw e chev e o ano digitado) e `GET /fipe/price` (valor FIPE de marca/modelo/ano já escolhidos; usa o cache do mês e **não gasta a cota da consulta gratuita nem cria relatório**). Ambas com limite de 90 por minuto por IP e desligadas junto com `FEATURE_FREE_FIPE`.
- **Listas da FIPE em cache de 6 horas na memória** (marcas, modelos, anos) com troca automática para o provedor secundário se o principal falhar. Reduz a chamada ao provedor e acelera o seletor, inclusive na página `/fipe`.
- **Painel › Guia de veículos › Todos os veículos**: lista paginada e pesquisável dos 40.571 nomes do catálogo (nome, frota, anos de fabricação, ficha do guia ligada), filtro "com/sem ficha", ordenação, detalhe da frota por ano e **exportação em CSV** (auditada).

### Atenção

- O Senatran publica nomes inteiros (marca/modelo/versão juntos). A separação em marca, modelo, versão e ano vem da **Tabela FIPE** (seletor) e das fichas do guia; o painel mostra o nome do Senatran como está.
- O catálogo só aparece no painel depois que a migração `023_vehicle_catalog` rodar no servidor (ela roda sozinha na inicialização). Se a lista estiver vazia, confira o log de inicialização e reimplante.
- O comparador compara só veículos com ficha no guia; veículos que só existem na FIPE aparecem no simulador e na consulta FIPE, não no comparador.

## 1.5.0 — Catálogo completo da frota, 6 destaques com foto e escolha de veículo no simulador

### Adicionado

- **Catálogo da frota brasileira (Senatran, set/2026)** (migrations `023_vehicle_catalog` e `024_vehicle_photos_free_license`): 40.571 nomes de veículos com a frota de cada um (136.424.856 no total) e a quantidade por **ano de fabricação** (não é ano-modelo). O nome fica como o Senatran cadastra; não há separação de marca/modelo/versão nem tipo de veículo, então nada é inferido. Carga embutida em `apps/api/assets/senatran/frota-2026-09.json.gz` (gerada por `scripts/build-senatran-seed.mjs`).
- **Home do guia refeita**: busca no topo e **no máximo 6 destaques com foto**, sem a lista completa. A lista de destaques usa a presença na frota (Senatran) e os modelos marcados pela equipe. "Mais consultados" e "Mais bem avaliados" só aparecem quando há dado de verdade (20 visitas por modelo em 3 modelos, ou 3 opiniões aprovadas em 3 modelos). No celular os destaques viram carrossel. Ao digitar, aparecem as fichas do guia e, abaixo, "Outros veículos da frota" (ainda sem ficha).
- **Página de veículo da frota** (`/veiculos/frota/:id`, fora do índice do Google): frota total, anos de fabricação com barras, fonte e licença, links para simular, consultar placa e FIPE.
- **Simulador com escolha de veículo**: campo com busca na lista do Senatran (teclado e leitor de tela), campo livre se o nome não existir. O nome vai para o PDF. Os botões "Simular financiamento" do guia já abrem com o nome preenchido.
- **Interesse por veículo** (tabela `vehicle_interest_events`): grava escolha no simulador, escolha na busca, visita à ficha e busca sem resultado, sem conta e sem dado pessoal (só um hash da visita; repetição em 30 min não conta; termos com cara de placa, e-mail ou número longo são descartados).
- **Fotos com licença livre e crédito** nos 6 destaques de partida (Strada, Onix, HB20, Corolla, Polo, Hilux), do Wikimedia Commons, com autor, licença e link da página de origem exibidos no card e na ficha. Novos campos por modelo: crédito, licença, página de origem, destaque editorial e posição.
- **Ficha do modelo** mostra a frota brasileira do nome (soma das versões e anos) com a data do snapshot.
- **Painel › Guia de veículos › Frota e interesse**: resumo do catálogo, importação de snapshot novo (CSV do Senatran, com prévia e bloqueio por erro de linha), ligação por modelo e relatório do que as pessoas escolhem e digitam. Na ficha de cada modelo: foto/crédito, destaque, e regras de ligação com o nome do Senatran (marcas extras, nomes alternativos, palavras excluídas).
- `ROADMAP-CRESCIMENTO.md`: análise da estratégia de crescimento e funções inteligentes propostas.

### Atenção

- A ligação entre nome do Senatran e modelo do guia é por regra de texto (marca + modelo no início do nome); "Onix Plus" e "Corolla Cross" ficam de fora de "Onix" e "Corolla", por exemplo. Revise no painel quando entrar modelo novo.
- As fotos são servidas direto do Wikimedia Commons (carregam do navegador do visitante). Para tráfego alto ou foto sem depender de terceiro, troque pela sua própria foto no painel. O crédito é obrigatório nas licenças CC BY e CC BY-SA.
- "Mais buscados" e "mais confiáveis" não são exibidos como rótulo enquanto não existir dado próprio suficiente.

## 1.4.0 — Guia de veículos reorganizado, consumo oficial com fonte e ferramentas de combustível

### Adicionado

- **Página do guia (`/veiculos`) reorganizada**: busca única com atalhos por tipo (Hatch, Sedã, SUV, Picape, Motos, Caminhões), cards compactos com os números que importam (consumo na cidade, potência, porta-malas) e selo "Inmetro" quando o consumo foi conferido, faixa de ferramentas, "Os mais econômicos do guia" e o bloco "De onde vêm os números". Sem os cards vazios de "seja o primeiro a opinar". A página avisa que o guia ainda não tem todos os modelos do mercado.
- **Consumo oficial como observação por fonte** (migration `022_vehicle_consumption_obs`): cada número guarda versão com o rótulo literal da fonte, combustível, ciclo (PBEV 2024), fonte e link, data da conferência e observações. Fontes divergentes ficam lado a lado, sem média e sem substituição silenciosa. A ficha do modelo ganhou o bloco **"Consumo oficial e fontes"**, com barras, notas e links.
- **Conferência com a tabela do Inmetro (PBE Veicular 2024)**: 12 versões já cadastradas tiveram o consumo comparado com a tabela oficial (Onix, Onix Sedan, Mobi, Argo, Cronos, HB20, Polo, Virtus, HR-V e Corolla); 11 batem. O **Corolla XEi 2.0** divergia (ficha: 11,9/14,5 km/l; Inmetro: 12,3/14,9) e foi corrigido, só se a ficha ainda tinha o valor da carga inicial.
- **Corolla Altis Hybrid e Civic Touring Hybrid** (pesquisa anexada): consumo oficial do Inmetro (18,5/15,7 e 18,3/15,9 km/l na gasolina). O catálogo da Honda traz 18,4 km/l na cidade para o Civic; o valor fica em linha própria, sem substituir o do Inmetro. O Civic entra no guia só com o consumo oficial; o resto da ficha fica em branco até haver fonte.
- **Ranking de economia** (`/veiculos/mais-economicos`): por combustível, ciclo e carroceria, com a fonte de cada linha (Inmetro ou ficha de referência).
- **Etanol ou gasolina?** (`/combustivel` e na ficha de cada versão): custo mensal pelo consumo da própria versão e ponto de equilíbrio do etanol calculado para aquele carro (não os 70% fixos). Os preços são os que a pessoa digita.
- **Painel › Guia de veículos › Consumo oficial**: importa planilha de pesquisa (colunas `marca, modelo, ano_modelo, versao_pbev, segmento_pbev, propulsao, combustivel_comparado, consumo_urbano_km_l, consumo_rodoviario_km_l, unidade_consumo, fonte_consumo, ciclo_pbev, observacoes`), com prévia e erros por linha. **Nada importado aparece no site** até alguém marcar "conferido". Auditoria: `VEHICLE_CONSUMPTION_IMPORTED/UPDATED/DELETED`.
- SEO e rodapé para as duas páginas novas.

### Atenção

- A tabela do Inmetro foi lida por ferramenta de leitura de página (o servidor de desenvolvimento não alcança o gov.br), não por importação de arquivo. Por isso só entraram como "conferido" as linhas em que duas fontes independentes concordam ou que vieram da pesquisa anexada. Dez modelos (Tracker, Pulse, Strada, Toro, Nivus, T-Cross, Creta, Kwid, Compass, Hilux e Ranger) não foram localizados na leitura: seguem como "ficha de referência", sem selo.
- Notas e resumos de proprietários de outros sites **não foram copiados** (direitos e termos de uso). As opiniões do guia continuam sendo as dos donos cadastrados.
- Os valores são de ensaio de homologação; o consumo real varia.

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

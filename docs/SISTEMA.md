# Placa na Mão — o sistema por inteiro

Documento de referência da versão 1.29.1. Explica a missão, tudo o que o sistema faz, como cada parte funciona e quais regras não podem ser quebradas. Foi escrito a partir das telas e rotas que existem no código. Onde algo depende de configuração ou de confirmação em produção, isso está dito.

Documentos de apoio: `ARCHITECTURE.md` (módulos), `DATABASE.md`, `SECURITY.md`, `DEPLOY-COOLIFY.md`, `TESTING.md`, `PRODUCT.md`, `docs/COMPARATIVO-CONCORRENTES.md` e `CHANGELOG.md`.

---

## 1. Missão

Dar a quem compra, vende ou financia um veículo no Brasil a informação certa, em linguagem simples, antes de pagar. Quem compra usado precisa saber se o carro tem dívida, restrição, gravame, passagem por leilão ou indício de sinistro. Quem vende precisa mostrar que o carro está limpo. Quem tem loja precisa de consulta confiável, estoque organizado e prova de procedência para vender mais rápido.

Princípios que valem em todo o sistema:

1. **Honestidade antes de tudo.** Cada item do relatório está em um de quatro estados: *nada consta*, *alerta*, *atenção* ou *não consultado*. O que não foi consultado nunca aparece como "nada consta".
2. **Cada produto entrega só o que promete.** O relatório do cliente mostra apenas as seções do pacote contratado. Isso é calculado no servidor, não na tela.
3. **Sem chute.** Valores estimados (projeção da FIPE, parecer de revenda) são rotulados como estimativa e explicam de onde vêm. Quando há mais de uma possibilidade, o sistema não escolhe por conta própria.
4. **Dados completos, sem máscara.** O produto é de uso profissional (crédito, avaliação de veículo, comércio): todos os dados do veículo e do proprietário aparecem completos, inclusive no link enviado ao comprador. O acesso fica protegido por login, e cada abertura de dado bruto pela equipe fica na auditoria.
5. **Nada de valor de contrato com fornecedor no sistema.** Preços e custos do contrato com a fornecedora de dados não aparecem em tela, código, comentário, changelog nem documento.
6. **Estorno automático.** Se a fonte falha, o cliente é estornado sem pedir nada.

---

## 2. Quem usa e o que cada um encontra

| Perfil | Onde entra | O que faz |
| --- | --- | --- |
| Visitante | Site público | Consulta FIPE grátis, simuladores, guia de veículos, comparador, blog, planos, validação de relatório |
| Cliente (pessoa) | `/app` | Compra e vê consultas, guarda veículos na garagem, envia relatório ao comprador, simula financiamento (perfil Cliente) |
| Lojista | `/app/loja` | Estoque, vitrine pública, leads, propostas, equipe, campanhas e selo de consulta verificada |
| Parceiro | `/app/parceiro` | Programa "Indique e ganhe" com link, comissões e repasses (perfil Afiliado) |
| Equipe | Painel (host próprio, com TOTP) | Operação, preços, conteúdo, financeiro, suporte, fiscal, contratos, auditoria |

Papéis da equipe: Super admin, Administrador, Operador, Financeiro, Suporte e Conteúdo. Cada um tem permissões próprias e só enxerga quem está abaixo na hierarquia (`permissions.ts`).

---

## 3. Site público

| Página | Função |
| --- | --- |
| `/` | Página inicial com busca de placa, produtos, perguntas frequentes e depoimentos aprovados |
| `/consultar` | Consulta de placa para visitante; leva ao cadastro e depois ao pedido |
| `/fipe` | Tabela FIPE por marca/modelo/ano e por placa (grátis, com limite diário para visitante e para logado) |
| `/veiculos` | Guia de veículos: fichas por modelo, frota, os mais econômicos |
| `/comparar` | Comparador de veículos |
| `/simulador` e `/simulador/:tipo` | Simuladores de financiamento e de custos |
| `/combustivel` | Etanol ou gasolina, consumo e custo |
| `/planos` | Produtos, pacotes de saldo e o comparador inteligente de consultas |
| `/blog`, `/perguntas-frequentes`, `/sobre`, `/contato`, `/instalar` | Conteúdo, dúvidas, institucional, contato e instalação como aplicativo (PWA) |
| `/termos`, `/privacidade` | Textos legais |
| `/validar` e `/validar/:code` | Confere se um relatório foi emitido pela Placa na Mão (código impresso no PDF) |
| `/loja/:slug` | Vitrine pública de uma loja com estoque e selo de consulta verificada |
| `/r/:token` | Relatório enviado por um cliente a um comprador (ver seção 7). Não é indexado |
| `/contrato/...`, `/documento-fiscal/...` | Links seguros para assinar contrato, ver cópia e baixar nota |

SEO por rota é montado no servidor (`seo.ts`): título, descrição, canonical, `robots`, sitemap e dados estruturados. Páginas privadas e de link seguro saem com `noindex` e ficam bloqueadas no `robots.txt`. Rota desconhecida responde 404.

---

## 4. Produtos de consulta

| Produto | Para que serve |
| --- | --- |
| FIPE por placa (grátis) | Identificação e características, com chassi e motor mascarados (o completo só nas consultas pagas), e a ficha gratuita: decodificador do chassi, FIPE por ano e 24 meses, financiamento estimado e ficha técnica do guia. A consulta por placa usa a mesma consulta Básica do fornecedor; a ficha em si é calculada pelo sistema |
| Cadastral | Identificação, características e registro do veículo |
| Débitos | IPVA, licenciamento e multas |
| Restrições | Restrições judiciais, administrativas, roubo e furto |
| Básica | Identificação, débitos e restrições |
| Gravame | Alienação fiduciária completa: banco, CNPJ, contrato, datas, UF e histórico |
| Leilão | Participação em leilão e registros (data, leilão, lote, pátio, condição) |
| Completa | Tudo da básica mais gravame, leilão, sinistro, recall, inspeção, histórico de proprietários, FIPE com projeção |
| Premium | Completa com a cobertura mais ampla do fornecedor |

Preço, descrição, selo, desconto, ordem e o que cada produto inclui são editados em *Painel → Catálogo e Preços*. O motor de preço trabalha em centavos e impede vender abaixo do piso de margem. Um produto só fica ativo quando existe regra de fonte ativa; sem credencial do fornecedor, nada é vendido como disponível.

Pacotes de saldo (Inicial, Plus, Pro) e cupons também são configuráveis no painel.

---

## 5. Como uma consulta funciona

1. O cliente informa a placa e escolhe o produto. O preço vem do motor de preço.
2. O pagamento sai do saldo (transação com `Idempotency-Key`) ou é pago direto por Pix/cartão no pedido.
3. O sistema decide quais chamadas fazer ao fornecedor conforme o produto:
   - Completa e Premium: consulta principal de veículo.
   - Básica, Débitos, Restrições, Cadastral, Leilão e Gravame: consulta de débitos e restrições, mais os complementos do produto.
   - Complementos: gravame detalhado, restrição judicial (RENAJUD) e leilão conjugado, conforme o pacote.
4. A resposta é normalizada para o **relatório v2** (`report/normalizeV2.ts`): cada campo vira um item com estado, rótulo, valor, sensibilidade e nível. O dado bruto fica cifrado (`raw_enc`) e é apagado conforme a política de retenção.
5. Ficha gratuita (decodificador do chassi, FIPE por ano e mês, financiamento, ficha técnica do guia) em Básica, Cadastral, Completa e Premium, guardada com a consulta (`report.sheet`).
6. Enriquecimento sem custo no fornecedor: valor FIPE localizado pelo cadastro quando o fornecedor não traz, variação em 12 e 24 meses e projeção dos próximos 6 meses. Falha ou demora do enriquecimento nunca derruba a consulta.
7. `viewReport` filtra por público (cliente ou equipe) e pelo escopo do produto. Só o que o pacote entrega sai do servidor.
8. O relatório é gerado na tela, em impressão e em PDF a partir do mesmo dado. Nada de PDF guardado: ele é renderizado na hora.
9. Se a fonte falha ou a consulta fica presa, o estorno é automático.

Relatório de consultas antigas: ao abrir, o sistema completa uma única vez o gravame detalhado e a FIPE quando faltam, com intervalo mínimo de 30 minutos entre tentativas. Isso pode ser desligado por variável de ambiente.

### O que o relatório mostra

- **Veredito** explicável (sem alertas relevantes, atenção, risco elevado), com os fatos que o produziram.
- **Parecer de revenda e seguro** (novo na 1.20): risco baixo, moderado ou alto de recusa por seguradoras e compradores, com os motivos. Só aparece quando o pacote traz leilão ou sinistro.
- **Antes de pagar** (novo na 1.20): lista item a item do que foi verificado (débitos, judicial, gravame, administrativas, roubo e furto, leilão, sinistro, chassi, recall), cada um como OK, atenção, alerta ou não consultado, mais seis confirmações que só a pessoa consegue fazer pessoalmente.
- Ficha do veículo, débitos e multas, restrições, gravame em tabela, leilão em tabela, proprietários, FIPE com projeção, recall, inspeção.
- Código de validação pública no PDF.

O parecer e a lista são indicativos calculados só com o que a consulta trouxe. Não são garantia, e o texto diz isso.

---

## 6. Área do cliente (`/app`)

| Tela | O que faz |
| --- | --- |
| Início | Resumo, consulta paga pendente, atalhos |
| Consultar | Nova consulta por placa (ou chassi, quando o produto permite), com escolha do produto |
| Histórico | Todas as consultas, com PDF, impressão e link de validação |
| Consulta | Relatório completo na tela, PDF (ver e baixar), imprimir, **Enviar ao comprador**, **Conferir anúncio**, guardar na garagem, informar dado incorreto |
| Em lote | Até 30 placas de uma vez, cada uma como consulta normal cobrada do saldo; tabela com veredito, débitos, gravame e leilão, e planilha (CSV) para Excel |
| Comparar consultas | Duas consultas já feitas lado a lado, destacando o que difere; sem cobrança |
| Simulações | Financiamentos simulados e salvos |
| Carteira | Saldo, recarga por Pix ou cartão, extrato em CSV |
| Garagem | Até 10 veículos, quilometragem, lembretes, manutenções e gastos, exportação em JSON e **avisos por e-mail** |
| Loja | Painel do lojista (seção 8) |
| Parceiro | Indique e ganhe (seção 9) |
| Conta | Dados, senha, segurança, privacidade |
| Suporte | Conversa com a equipe e assistente automático |

### Consulta em lote (novo na 1.21)

Em `/app/lote` a pessoa cola placas (uma por linha ou separadas por vírgula, espaço ou ponto e vírgula), escolhe o tipo de consulta e vê o total e o saldo. O lote roda duas consultas por vez, cada uma pela mesma rota de uma consulta comum (`POST /api/queries`), com chave de idempotência por placa: repetir não cobra duas vezes. Placas repetidas são ignoradas e inválidas aparecem marcadas. Se o saldo acabar, as demais ficam como "não consultadas" e nada é cobrado por elas. Consulta que falha é estornada pelas regras de sempre. O aceite do contrato e da privacidade é pedido uma vez, se ainda não existir. O resultado sai em tabela e em planilha CSV (separador ponto e vírgula, com acentos corretos para o Excel). Não há tela nem tabela nova no servidor: o lote é só uma forma de usar as consultas existentes.

### Comparar consultas (novo na 1.21)

Em `/app/comparar-consultas` (ou pelo botão "Comparar com outra" na consulta) a pessoa escolhe duas consultas concluídas e vê, lado a lado: veículo, ano, cor, veredito, valor FIPE, débitos, risco na revenda e cada verificação do "Antes de pagar". As linhas diferentes ficam em destaque. Usa só relatórios já gerados, sem consulta nova e sem cobrança. "Não consultado" é mostrado como tal.

### Enviar ao comprador (novo)

O vendedor gera, na página da consulta, um link temporário (1, 3, 7 ou 15 dias, até 100 acessos, no máximo 5 ativos por consulta). Quem recebe vê o mesmo relatório do pacote, completo e sem máscara, e baixa o PDF. O vendedor vê os links ativos, quantas vezes foram abertos e pode cancelar a qualquer momento. O link abre pelo endereço `/r/...`, não é indexado, e abrir não consulta o fornecedor nem cobra nada. Detalhes técnicos na seção 12.

### Conferir anúncio (novo)

O comprador digita o que o anúncio informa (preço, modelo, cor e ano). O sistema compara com o registro e com a FIPE da consulta:

- Preço mais de 25% abaixo da FIPE: alerta de golpe. Entre 10% e 25% abaixo: atenção. Até 10% de diferença: ok. Acima: aviso.
- Modelo, cor e ano que não batem com o registro: possível clone ou erro do anúncio.
- Sem FIPE na consulta ou sem dado no registro, o sistema diz que não dá para comparar, em vez de dizer que confere.

### Garagem com avisos por e-mail (novo)

Lembretes de IPVA, revisão e outros que a própria pessoa cadastrou geram e-mail uma vez quando faltam até 7 dias (ou 500 km) e uma vez quando vencem, em um resumo por pessoa. Quem não quer, desliga na própria garagem. Se a pessoa muda o prazo, o aviso volta a valer. O sistema não inventa calendário de IPVA por estado: só avisa o que a pessoa registrou.

### Meus veículos (novo na 1.23)

`/app/veiculos`: uma linha por placa já consultada, com a situação da consulta mais recente (sem alertas, atenção, risco alto), alertas e atenções, débitos, risco de revenda, quantas consultas existem e se a placa está monitorada. Busca por placa, modelo ou cor, filtros (com alerta, com atenção, com débitos, monitorados) e exportação em planilha. Cada linha abre a consulta, baixa o dossiê ou leva ao monitoramento. É só leitura das consultas que a pessoa já fez: não chama o fornecedor e não cobra. Mostra até 200 placas, as mais recentes. A situação é a da última consulta e pode ter mudado desde então.

### Dossiê da placa (novo na 1.23)

`GET /api/vehicles/:placa/dossier.pdf`. Reúne em um único PDF os relatórios que a própria pessoa já fez daquela placa (o mais recente de cada tipo de consulta, até 6), com uma capa: placa, veículo, lista das consultas reunidas (tipo, data, código de validação) e a pior situação de cada verificação entre elas. Os relatórios seguem exatamente como foram emitidos, cada um com o seu código de validação. Não consulta o fornecedor, não cobra e só entrega ao dono das consultas. Botões: em Meus veículos e dentro da consulta.

### Monitoramento de placa (novo na 1.23)

`/app/monitoramento`. A pessoa escolhe placa, tipo de consulta e intervalo (7, 15 ou 30 dias) e confirma que cada verificação é cobrada do saldo. Regras:

- Cada verificação é uma **consulta normal** (mesma cobrança, mesmo estorno em falha, mesmo relatório e histórico). Não há preço nem fonte diferente.
- Se a pessoa já tem uma consulta igual dessa placa, ela vira a base e a primeira verificação só vem depois do intervalo. Sem consulta anterior, a primeira verificação é feita na hora e vira a base (sem aviso).
- A cada rodada, o sistema compara as verificações do "Antes de pagar" com as da consulta anterior. **Só piora gera aviso**: ocorrência nova ou mais grave (gravame, restrição, leilão, sinistro, roubo ou furto, chassi, recall, débitos). Melhora e "não consultado" não avisam. O e-mail lista o que mudou e leva ao relatório.
- Sem saldo, o monitoramento **pausa** e avisa por e-mail. Três falhas seguidas (a falha é estornada) também pausam. A pessoa retoma quando quiser; retomar verifica logo e cobra uma verificação.
- Segurança de gasto: no máximo 20 monitoramentos por pessoa, um por placa e tipo, no máximo uma verificação cobrada por monitoramento por dia (chave de idempotência por dia) e verificação em lotes de 10 por rodada.
- A rotina roda 2 minutos depois de iniciar e a cada 30 minutos. Pode ser desligada com `PLATE_WATCH_ENABLED=false` (ninguém é reconsultado nem cobrado; a tela avisa).
- Respeita o pré-lançamento: durante o site fechado, só e-mails liberados são reconsultados.
- Tabelas: `plate_watches` e `plate_watch_events` (migração 057).

### Perfis de uso: cliente, lojista e afiliado (novo na 1.25)

Uma conta pode ter mais de um perfil e alternar sem sair (seletor no menu lateral e em Minha conta). O perfil escolhido muda o menu e a página inicial; dados e saldo são os mesmos.

| Perfil | Quem tem | Menu | Página inicial |
| --- | --- | --- | --- |
| Cliente | Toda conta | Painel, Consultas, Monitoramento, Simulações, Garagem, Carteira, Indique e ganhe, Suporte, Conta | Painel de consulta |
| Lojista | Quem participa de uma loja ativa | Cliente + Minha loja, Em lote, Meus veículos; botões de comparar consultas | Painel de consulta |
| Afiliado | Quem ativou o "Indique e ganhe" (link ativo) | Indicações, Consultas, Carteira, Suporte, Conta | Painel de indicações |

Regras: ninguém se dá um perfil que não tem (loja e link são conferidos no servidor a cada troca); se a loja for suspensa ou o link desativado, a conta volta sozinha para Cliente; contas que já participavam de uma loja foram colocadas no perfil Lojista pela migração 058, todas as outras ficaram em Cliente. O perfil é só navegação: o acesso à área da loja e ao painel de indicações continua decidido pelo servidor a cada chamada (participação na loja, dono do link), e as telas profissionais (lote, meus veículos, comparar) seguem acessíveis por endereço direto para quem já as usava, para não quebrar nada.

---

## 7. Segurança do relatório compartilhado

- O token do link é aleatório, nunca é guardado (só o hash) e nunca é devolvido depois da criação.
- Validade, limite de acessos e revogação são conferidos no servidor a cada abertura.
- O rate limit da página pública é de 60 acessos por 10 minutos por origem.
- A resposta sai com `Cache-Control: private, no-store` e `X-Robots-Tag: noindex, nofollow`.
- Criar e cancelar link ficam na auditoria; o funil registra `REPORT_SHARED`.
- O conteúdo é exatamente o relatório do pacote contratado, o mesmo que o cliente vê, sem nenhum dado mascarado.

---

## 8. Lojista (`/app/loja`)

- **Estoque**: cadastro de veículos, importação a partir de consultas já feitas, status, venda, arquivar e restaurar, datas de IPVA e licenciamento.
- **Selo "consulta verificada"**: o veículo do estoque ligado a uma consulta mostra na vitrine o código e a data da consulta, e o comprador valida em `/validar`.
- **Vitrine pública** em `/loja/:slug` e página de cada veículo.
- **Leads**: captação pela vitrine, estágios, anotações, atribuição (assumir lead), exportação em CSV.
- **Propostas**: proposta em PDF para o cliente e avaliação de troca (trade-in).
- **Equipe da loja**: membros e papéis.
- **Campanhas** e **alertas do dia** no painel da loja.

---

## 9. Parceiros e afiliados

Cada parceiro tem código e link de indicação. O cliente indicado que paga gera comissão com período de carência; estorno ou chargeback reverte a comissão. Repasses são lotes auditados, feitos pelo financeiro no painel.

---

## 10. Painel da equipe

Acesso em host próprio, com senha e TOTP, e opcionalmente restrição por IP. Tela por tela:

| Área | Para que serve |
| --- | --- |
| Dashboard | Números do dia, funil e pendências |
| Resultados | Consultas, receita, ticket médio, falhas e estornos por período, por produto, por dia, forma de pagamento e clientes que mais consultaram, mais consultas internas e monitoramentos; exportação por produto. Consulta interna não gera receita |
| Consultas | Todas as consultas (dos clientes e as internas), com filtro de origem, relatório do pacote, PDF, atualização de gravame e FIPE, estorno, cancelamento, envio ao cliente e link de visualização |
| Clientes e Empresas | Cadastro, saldo, histórico, bloqueio |
| Cobranças, Pagamentos, Financeiro | Pedidos, conciliação, ajustes, estornos, receitas e despesas |
| Preços, Catálogo, Escopo do relatório | Preço, margem, produtos, pacotes, matriz de recursos e quais seções cada produto mostra |
| Cupons | Descontos |
| Parceiros | Afiliados, comissões e repasses |
| Contratos | Modelos, versões, criação, aprovação, envio e assinatura eletrônica |
| Fiscal | Documentos fiscais e envio ao cliente |
| Suporte e Chat | Fila de atendimento, ferramentas e respostas prontas |
| Conteúdo | Artigos, perguntas frequentes, depoimentos e SEO por página |
| Simulador | Bancos e taxas usadas nos simuladores |
| Integrações | Estado das integrações e do e-mail |
| Equipe | Usuários da equipe e papéis |
| Auditoria | Registro de quem fez o quê |
| Sistema | Checklist de configuração e estado geral |

### Consulta interna do painel (novo na 1.22)

A consulta feita pela equipe em Consultas → "Consulta interna" é uma consulta de verdade, com a mesma documentação de uma consulta de cliente:

- Fica **salva** na lista de Consultas com a origem "Interna" (filtro "Origem" na lista), sem valor e sem cobrança de ninguém. O dado bruto da fonte é guardado cifrado, como nas demais.
- Tem **relatório do pacote**, **PDF** (visualizar e baixar), impressão e **código de validação** (8 primeiros caracteres do identificador), que confere em `/validar`.
- A auditoria `ADMIN_LOOKUP` aponta para a consulta salva.
- **Enviar ao cliente**: informa o e-mail de um cliente ativo; a consulta ganha uma cópia na conta dele (histórico, relatório e PDF, sem cobrança e sem nova chamada ao fornecedor) e ele recebe um aviso por e-mail com a mensagem opcional da equipe. Reenviar não duplica a cópia. Auditoria `ADMIN_QUERY_SENT`.
- **Gerar link**: link de visualização para quem não tem conta (1, 3, 7 ou 15 dias, até 100 acessos, até 10 ativos por consulta), com cópia, WhatsApp, lista dos links ativos e revogação. Auditoria `REPORT_SHARE_CREATED` e `REPORT_SHARE_REVOKED`.
- Se o banco falhar ao salvar, a tela avisa e ainda entrega o resultado e o PDF: a chamada paga nunca se perde.
- Permissão: as mesmas da consulta interna (`VIEW_SENSITIVE_DATA`). Quem só visualiza consultas vê a lista e o relatório, mas não envia nem gera link.

---

## 11. Integrações

| Integração | Uso |
| --- | --- |
| Fornecedor de dados veiculares (Credify) | Consultas de veículo, débitos e restrições, gravame, RENAJUD e leilão. Credenciais só no ambiente |
| Tabela FIPE (fonte principal e secundária) | Consulta pública e enriquecimento do relatório |
| Mercado Pago (e Asaas, se configurado) | Pix, cartão e conciliação por webhook idempotente |
| E-mail transacional por SMTP | Fila (`email_outbox`) com tentativas, atraso progressivo e idempotência; modelos de contrato, nota fiscal, código de compra e aviso geral |
| Login social | Google, Microsoft e Apple, quando configurados |
| Emissor de NFS-e (Focus NFe) | Emissão automática da nota de serviço no padrão nacional, quando contratado e ligado (ver abaixo) |

A confirmação do retorno real do fornecedor em produção (por exemplo qual versão da consulta de leilão está contratada) precisa ser feita com uma consulta real depois da publicação. O relatório lida com a ausência de dado sem inventar.


### Nota fiscal automática (novo na 1.24)

A consulta é um **serviço**, então a nota é de serviço (NFS-e), no padrão nacional. A API oficial do governo exige certificado digital da empresa e XML assinado em cada chamada; por isso o sistema usa um integrador (Focus NFe), que guarda o certificado, assina, transmite ao Sistema Nacional NFS-e e devolve número, código de verificação, XML e PDF. O sistema envia só os dados da nota e nunca guarda certificado.

Como funciona:
1. O cliente paga. O robô (a cada 2 minutos) cria o documento fiscal do pagamento confirmado e coloca na fila de emissão.
2. A fila envia ao emissor (referência única por nota, então reenviar nunca duplica), acompanha até autorizar e grava número, código, chave, XML e PDF.
3. Nota emitida: o cliente recebe o e-mail com link seguro. Falha de rede tenta de novo com atraso; recusa do emissor mostra o motivo e não repete; nota sem o CPF ou CNPJ do cliente fica pendente no painel para ajuste.

Garantias: só pagamentos dos últimos 3 dias entram sozinhos (ligar o recurso nunca emite nota de venda antiga); documentos criados ou editados por uma pessoa não são emitidos sozinhos; a emissão automática só roda com “Dados do emissor” completos; homologação e produção usam tokens diferentes, conforme o ambiente escolhido na tela Fiscal.

Para ligar (passo a passo):
1. Contratar o Focus NFe e cadastrar a empresa com o certificado digital A1 (feito no painel deles).
2. Habilitar a emissão no padrão nacional para o município (ou o Emissor Nacional, que é obrigatório para optantes do Simples a partir de 1º/09/2026 — confirmar com o contador).
3. Em Notas fiscais → Dados do emissor: razão social, CNPJ, inscrição municipal, código IBGE do município, código de tributação nacional do serviço (6 dígitos), regime e ambiente.
4. No servidor: `FISCAL_PROVIDER=focusnfe`, o token de homologação, `FISCAL_AUTO_EMIT=true`. Testar em homologação (notas de teste, sem validade), conferir a primeira nota com o contador e só então trocar o ambiente para produção e colocar o token de produção.
5. Com a reforma tributária, o contador informa `FOCUSNFE_NBS`, `FOCUSNFE_IBSCBS_CST` e `FOCUSNFE_IBSCBS_CLASS_TRIB` quando o município exigir.

Limites: o cancelamento da nota continua sendo feito no emissor (o painel só registra); os nomes de campos do emissor foram escritos pela documentação dele e precisam ser confirmados na primeira nota de homologação.

---

## 12. Como é feito por dentro

Monorepo TypeScript: `apps/api` (Express e PostgreSQL) e `apps/web` (React e Vite). Um processo serve site, app do cliente, painel e API.

Pontos principais da 1.20.0:

| Parte | Arquivo | O que faz |
| --- | --- | --- |
| Parecer e lista | `report/advice.ts` | Calcula risco de revenda e a lista "Antes de pagar" só com as seções presentes |
| Links do vendedor | `lib/secureLinks.ts`, rotas em `server.ts` | Criar, listar, cancelar e abrir (`/shared-report/:token`) |
| Conferir anúncio | `report/adCheck.ts` | Compara anúncio com registro e FIPE |
| Avisos da garagem | `lib/garageAlerts.ts` | Rodada ao iniciar e a cada 6 horas; marca cada etapa para não repetir |
| Telas | `ReportView.tsx`, `ReportTools.tsx`, `SharedReport.tsx`, `Garage.tsx` | Parecer, painéis de enviar e conferir, página pública, botão de avisos |
| PDF e impressão | `report/pdf.ts`, `report/printHtml.ts` | Parecer e lista também no papel, com estado escrito por extenso |

Migrações novas: `054_report_share_links` (finalidade REPORT_SHARE nos links seguros), `055_garage_email_alerts` (preferência da pessoa e marcas de aviso por lembrete) e `056_faq_owner_data_visible` (texto da pergunta de privacidade).

Rotas novas (cliente autenticado, salvo as públicas):

- `POST /api/queries/:id/share`, `GET /api/queries/:id/shares`, `DELETE /api/queries/:id/shares/:linkId`
- `GET /api/shared-report/:token` e `GET /api/shared-report/:token/pdf` (públicas, com rate limit)
- `POST /api/queries/:id/ad-check`
- `GET` e `PUT /api/garage/alerts`

### Segurança e LGPD

- Senhas com hash, sessões JWT separadas para cliente e equipe, TOTP obrigatório para a equipe, trava por IP opcional.
- Dado bruto do fornecedor cifrado e com retenção limitada (`RAW_RETENTION_DAYS`).
- Revelar dado pessoal no painel exige permissão própria e fica na auditoria.
- Links seguros guardam só o hash do token, com validade e limite de usos.
- Pagamentos e estornos idempotentes; comissões com carência e reversão.
- Todo cabeçalho de resposta de dado pessoal sai com `no-store`.

**Regra do produto: nenhum dado do veículo ou do proprietário é mascarado.** Nome, CPF/CNPJ, placa, chassi, RENAVAM e motor aparecem completos na tela, no PDF, na impressão e no link enviado ao comprador. O produto é de uso profissional (crédito, avaliação de veículo e comércio). Só a validação pública do código do relatório (`/validar`) abrevia a placa, para que um código digitado ao acaso não revele veículos de terceiros.

### Rotinas automáticas

| Rotina | Frequência |
| --- | --- |
| Recuperar consultas presas e estornar | A cada 2 minutos |
| Liberar comissões | A cada hora |
| Apagar dado bruto vencido | A cada 6 horas |
| Fila de e-mail | Contínua |
| Avisos da garagem | Ao iniciar (1 minuto depois) e a cada 6 horas |
| Monitoramento de placa | Ao iniciar (2 minutos depois) e a cada 30 minutos |

---

## 13. Variáveis de ambiente novas na 1.20.0

| Variável | Padrão | Para que serve |
| --- | --- | --- |
| `PLATE_WATCH_ENABLED` | `true` | Liga a rotina do monitoramento de placa. Com `false`, ninguém é reconsultado nem cobrado e a tela avisa que está desligado |
| `GARAGE_ALERTS_ENABLED` | `true` | Liga os avisos de lembrete da garagem por e-mail. Com `false`, o botão some da garagem e nenhum e-mail sai |

| `FISCAL_PROVIDER` | `disabled` | `focusnfe` liga a emissão de NFS-e pelo integrador; `disabled`/`manual` mantêm a emissão fora do sistema |
| `FOCUSNFE_TOKEN` | vazio | Token de produção do Focus NFe (obrigatório em produção com `focusnfe`) |
| `FOCUSNFE_TOKEN_HOMOLOGACAO` | vazio | Token de homologação (testes, sem validade fiscal) |
| `FOCUSNFE_BASE_URL` | vazio | Só para teste local; vazio usa os endereços oficiais |
| `FOCUSNFE_NBS` | vazio | Código NBS do serviço (reforma tributária), se exigido |
| `FOCUSNFE_IBSCBS_CST` / `FOCUSNFE_IBSCBS_CLASS_TRIB` | vazio | Situação e classificação tributária de IBS/CBS, se exigidas |
| `FISCAL_AUTO_EMIT` | `false` | Emite a nota sozinho a cada pagamento confirmado |

As demais continuam em `.env.example`. Nenhuma variável nova tem valor secreto.

---

## 14. Como testar

- `npm run build` compila API e web.
- Suíte de API: `TEST_DATABASE_URL=postgresql://...  node --test --test-concurrency=1 apps/api/test/*.test.mjs` (usa um PostgreSQL de teste isolado).
- `npm run release:source-check` confere o pacote de entrega.
- Testes novos da 1.20: `advice`, `share-link`, `ad-check`, `garage-alerts`, além de `fipe-match` da 1.19.8. Da 1.21: `batch-contract` (o que a consulta em lote usa da API).
- Depois de publicar: fazer uma consulta real de cada produto e conferir (1) que cada pacote mostra só o que promete, (2) o gravame com banco e contrato, (3) a FIPE com projeção, (4) abrir um link de comprador em janela anônima e confirmar que não há CPF.

---

## 15. O que ainda não existe

Para não prometer mais do que o sistema faz:

- Não há aviso automático de IPVA por estado: só lembretes que a pessoa cadastra.
- Não há integração com seguradoras nem cotação de seguro.
- Não há envio de relatório por WhatsApp automático: o botão abre o WhatsApp com a mensagem pronta; quem envia é a pessoa.
- O parecer de revenda é indicativo. Cada seguradora e comprador tem critério próprio.
- Não existe API para terceiros integrarem o produto.


## Consulta Completa em camadas (1.29.0)

- A Completa monta o relatório com consultas separadas ao fornecedor: base (débitos, restrições, proprietários), indício de sinistro e base nacional sempre; roubo/furto e recall em detalhe só se o cadastro indicar ocorrência; leilão em detalhe só se o Farol Leilão não for verde (ou se o Farol não estiver configurado).
- O resultado é convertido para o mesmo formato do pacote Veículo Total, então telas, PDF, API e avisos de mudança não mudam. Histórico de proprietários e FIPE do fornecedor não entram na Completa (a FIPE do site é pública); a Premium continua usando o pacote completo.
- Gravame completo (banco, CNPJ, contrato, datas): consultado quando o cadastro indica alienação sem esses dados (`CREDIFY_COMPLETE_GRAVAME=always` consulta sempre).
- Teto de custo (`CREDIFY_COST_BUDGET_CENTS` com `CREDIFY_COST_CENTS`) impede itens opcionais acima do limite; o relatório mostra "detalhes do leilão não incluídos".
- Cache criptografado em `provider_cache`, por placa e pacote, com prazo `PLATE_CACHE_HOURS` (0 desliga). Respostas parciais não são guardadas.
- Reversão: `CREDIFY_COMPLETE_MODE=total` volta a comprar o pacote completo.

## Linha de consultas: Completa e Premium (1.31.0)

- **Completa** (`COMPLETE`, R$ 32,99): camadas `SINISTRO`, `NATIONAL`, `THEFT`, `RECALL`, `AUCTION` sobre a base `/debitosrestricoesproprietarios` (1.31.1; na 1.31.0 era a fonte `TOTAL`, que continua disponível no painel). Seções: identificação, características, registro, débitos, restrições, histórico, gravame (situação), inspeção/recall, FIPE, análises e proprietário.
- **Premium** (1.32.0): fontes fixas `SINISTRO`, `NATIONAL`, `THEFT`, `RECALL`, `AUCTION`, `GRAVAME`, `RENAJUD`, `OWNERS` (`OWNERS` = Credify `/historicoproprietario`, código 458, consulta própria, preenche o bloco de proprietários do relatório). Só ela entrega proprietários. Antes da 064 valia o texto abaixo:
- **Premium** (`PREMIUM`, R$ 44,90): sem escolha de fontes, segue o modo em camadas (`CREDIFY_COMPLETE_MODE=layered`): base + sinistro + base nacional + roubo/furto/recall/leilão quando o cadastro indica, mais gravame completo e Renajud (`CREDIFY_GRAVAME_SUPPLEMENT`, `CREDIFY_JUDICIAL_SUPPLEMENT`). Com `CREDIFY_COMPLETE_MODE=total` volta ao pacote fechado.
- **1.33.0:** Completa = `SINISTRO`, `NATIONAL`, `THEFT`, `RECALL`, `AUCTION`, `FIPE`; Premium = Completa + `GRAVAME`, `RENAJUD`, `OWNERS`, `RENAINF`. `FIPE` = `/precificadorfipe` (454), `RENAINF` = `/renainf` (536, bloco `RENAINF` no envelope, item `RN_MULTAS`). O item `AL_ALTERACOES` (comparação de chassi, motor, câmbio, cor e combustível entre BDRP, base nacional e leilão) sai em qualquer resposta com a base nacional.
- **Básica** (`BASIC`) segue ativa e inalterada (R$ 29,90); o id também é usado pelas buscas internas de placa (guia de veículos e FIPE), que compram só a base de cadastro. Desativá-la na vitrine bloqueia compras por API e links antigos desse id.
- Para mudar o que cada consulta compra: Produtos do site → Editar → Fontes de dados. Para mudar o que o cliente vê: Campos do relatório.
- Custos de cada consulta (Financeiro → Produtos) precisam ser preenchidos para a trava de margem funcionar.

## Fontes de dados por consulta e leilão simples (1.30.0)

- Cada produto pode ter as fontes de dados escolhidas no painel (Produtos do site → Editar → Fontes de dados), gravadas em `query_products.data_sources`. Vazio = padrão do sistema (comportamento de antes). Valores: `SINISTRO`, `NATIONAL`, `THEFT`, `RECALL`, `AUCTION`, `AUCTION_SIMPLE`, `GRAVAME`, `RENAJUD`, `TOTAL` e `BASE` (só a base de cadastro).
- Com escolha, o produto compra a base de cadastro (Credify 487) mais as fontes marcadas, montadas no mesmo formato do Veículo Total. `TOTAL` compra o pacote Veículo Total e ignora as demais. `AUCTION` (Credify) e `AUCTION_SIMPLE` (AnyCar) não podem ser marcadas juntas.
- Gravame e Renajud, quando marcados, seguem a regra de sempre (buscam quando o cadastro indica); a regra `CREDIFY_COMPLETE_GRAVAME=always` continua valendo.
- Leilão simples (AnyCar): `POST {ANYCAR_BASE_URL}/api/consultar` com `x-api-key` e `{ "tipo": "veicular-leilao-1", "placa": "…" }`. O endereço base e o tipo vêm da documentação comercial da AnyCar e devem ser confirmados com eles (`ANYCAR_BASE_URL`, `ANYCAR_AUCTION_TYPE`). O resultado vira o bloco de leilão do relatório.
- O cache por placa inclui as fontes escolhidas na chave.

# Changelog

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

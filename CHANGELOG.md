# Changelog

## 1.55.0 — Revisão editorial de SEO: sem promessa sem prova e textos que faltavam

- **Tirado o que não tem prova:** "em segundos" (home e simuladores de carro, moto e caminhão), "poucos segundos" (pergunta de consulta de placa) e "em tempo real" (título de reserva da FIPE, que é mensal).
- **Leilão:** a pergunta "já está disponível?" deixou de afirmar que está ativa e passou a apontar para a página de preços, que mostra o status atual de cada consulta.
- **Textos novos (português simples, sem número inventado):** home, Sobre, Planos e Gravame. O de Gravame explica gravame, alienação fiduciária e Renajud.
- **Painel:** páginas que você editou à mão não são alteradas. As demais recebem o texto novo, e o valor anterior fica guardado na tabela `seo_pages_history` (para voltar, copie de lá ou use "Restaurar padrão").
- Sem variável de ambiente nova. Testes novos: `seo-revisao-editorial`.

## 1.54.0 — Conteúdo real no HTML das páginas de veículo, blog e planos (soft 404)

- **Motivo do alerta "Erro soft 404" no Search Console:** nas páginas `/veiculos/<modelo>`, `/blog/<artigo>` e `/planos` o servidor entregava só título, uma frase e o menu; o conteúdo vinha depois, pelo JavaScript. O Google leu a página como vazia.
- **Agora o servidor já entrega o conteúdo:** artigo com o texto completo; modelo com resumo, prévia da análise, nota dos donos, 2 pontos fortes e 2 de atenção e versões com destaques (o mesmo que o visitante sem conta vê, o restante continua restrito); `/planos` com consultas, preços e pacotes. Sem custo, margem ou dado de conta.
- Rascunho de artigo e modelo inexistente continuam 404. O visual do site não muda.
- Depois do deploy: Search Console → Indexação de páginas → Erro soft 404 → **Validar correção**.
- Sem variável de ambiente nova. Testes novos: `seo-conteudo-servidor`.

## 1.53.0 — Entrar com Google (cadastro e login)

- **Botão "Continuar com Google"** nas telas Entrar e Criar conta. Aparece sozinho quando `OAUTH_GOOGLE_CLIENT_ID` e `OAUTH_GOOGLE_CLIENT_SECRET` estão preenchidas; sem elas, nada muda.
- **Cliente novo pelo Google:** conta criada como cliente, com carteira e e-mail já verificado pelo Google. O aceite dos Termos de Uso e da Política de Privacidade fica registrado (origem `oauth_google`; marketing fica desligado) e o aviso aparece junto do botão. Telefone, CPF e cidade continuam sendo pedidos no primeiro uso, como em qualquer conta.
- **Cliente que já tem conta** com o mesmo e-mail entra na conta existente, sem duplicar.
- **Entra no CRM** como cadastro novo, igual ao cadastro por e-mail.
- **Contas da equipe não entram nem são ligadas pelo Google** (continuam só pelo painel, com os controles de segurança). Conta desativada também não entra.
- Variáveis novas: `OAUTH_GOOGLE_CLIENT_ID`, `OAUTH_GOOGLE_CLIENT_SECRET`. URI de redirecionamento no Google Cloud: `https://placanamao.com.br/api/auth/oauth/google/callback`. Testes novos: `google-login`.

## 1.52.0 — Pacotes de saldo calculados

- **Pacotes por quantidade de consultas:** Inicial = 3 consultas Completas, Plus = 10, Pro = 30. O saldo é o menor valor em reais que cobre as consultas e o cliente paga com desconto crescente (cerca de 4%, 8% e 12%). O valor sempre termina em ,90 e nunca dá mais desconto do que o calculado. Os destaques de cada pacote mostram "Equivale a N× Consulta Completa" e a economia em reais e em %.
- **Sem prejuízo:** o desconto máximo é o maior que ainda mantém, em todas as consultas pagas e em todas as formas de pagamento habilitadas, a margem mínima sobre o custo (margem mínima das configurações + 5 pontos, no mínimo 15%), já descontados impostos e taxas. Se algum produto já estiver abaixo da margem, a calculadora avisa e não dá desconto.
- **Painel → Catálogo → Pacotes → Calcular pacotes:** mostra saldo, valor, economia, desconto real e a pior margem de cada pacote; dá para mudar quantidade, desconto e margem mínima, recalcular e aplicar. O servidor refaz a conta ao aplicar. Exige a permissão de preços.
- Migração 083: troca os três pacotes pelos valores calculados só se ainda estiverem com os valores de fábrica; pacotes já editados não são tocados. Quem já comprou não é afetado.
- Sem variável de ambiente nova. Testes novos: `pacotes-calculados`.

## 1.51.0 — SEO: páginas "Financiamento de carro {banco}" e páginas novas criadas no painel

- **Uma página por banco, sozinha:** cada banco ativo com taxa (Banco Central ou cadastrada pela equipe) ganha `/financiamento/<banco>` (ex.: `/financiamento/bradesco`, `/financiamento/santander`, `/financiamento/c6-bank`), com título "Financiamento de carro {banco}: taxa e simulação", descrição, H1, a taxa real com o período, um exemplo de parcela (carro de R$ 60.000, entrada de R$ 12.000, 48 meses), perguntas frequentes, dados estruturados e links para os outros bancos. Entram no sitemap.
- **Índice `/financiamento`:** tabela com a taxa de cada banco; o simulador ganha o link "Veja a taxa de cada banco".
- **Painel de SEO:** as páginas dos bancos aparecem na lista (selo "Banco") e podem ter título, descrição, H1, palavra-chave, textos, perguntas, imagem e indexação editados como as demais. Novo botão **Nova página de financiamento** cria uma página em `/financiamento/<nome>` com título e descrição próprios (ex.: "Financiamento de carro usado Caixa"); páginas criadas à mão podem ser excluídas. A página de um banco some sozinha se o banco for desativado ou ficar sem taxa.
- Sem variável de ambiente nova. Sem migração nova (continua em 082). Testes novos: `seo-financiamento-bancos`.

## 1.50.0 — Simulador: coleta diária de todas as instituições e nenhum alerta de taxa atrasada

- **Sem alerta de taxa atrasada em lugar nenhum:** saiu também o alerta amarelo do Painel → Simulador (o painel só avisa se a coleta der erro).
- **Coleta diária:** o sistema refaz a coleta quando a última passou de 20 horas (verificação a cada 2 horas e também quando alguém usa o simulador), em vez de 24 h verificadas a cada 6 h.
- **Todas as instituições:** toda instituição que o Banco Central lista com taxa de financiamento de veículos (Santander, C6 Bank, BV Financeira, Bradesco, Itaú, Pan, Safra, bancos de montadora e as demais) entra sozinha na comparação por banco, com a taxa real do período mais recente. Quem já estava cadastrado não duplica; a equipe pode desativar qualquer banco no painel. Os incluídos automaticamente trazem a observação "Incluído automaticamente a partir das taxas do Banco Central."
- Sem variável de ambiente nova. Sem migração nova (continua em 082). Testes novos em `financing-referencia`.

## 1.49.1 — Simulador: taxa sempre atual e sem avisos de "desatualizada" para o cliente

- **Causa:** a série mensal do Banco Central usada (SGS 25471, 25447, 25450) estava devolvendo dados só até 02/2026, mesmo com a coleta rodando. Por isso o simulador mostrava o mês de referência antigo e os avisos de taxa desatualizada.
- **Correção:** a atualização agora também calcula a média das taxas que as instituições informam ao Banco Central (publicadas com poucos dias de atraso, as mesmas já usadas na comparação por banco). Para cada taxa, vale a série mensal oficial quando ela está em dia (até 2 meses de diferença) e, quando está parada, vale a média das instituições do período mais recente (mínimo de 3 instituições). Nenhum valor é inventado: sem dado oficial, a última taxa é mantida.
- A origem aparece de forma honesta ("Banco Central do Brasil (taxas por instituição financeira, média das instituições)" ou "SGS e taxas por instituição") e o mês de referência passa a ser o do dado real.
- **Site:** saíram os avisos de "taxa desatualizada" / "referência interna" da tela do simulador e dos resultados. O controle da idade da taxa continua só no painel (Simulador).
- Sem variável de ambiente nova. Sem migração nova (continua em 082). Testes novos em `financing-referencia`.

## 1.49.0 — Blocos de SEO visíveis em todas as páginas, taxas do simulador honestas e verificação de publicação

- **Blocos e perguntas do painel de SEO agora aparecem no site.** Causa confirmada: o servidor já enviava esses textos no HTML inicial, mas o app só os mostrava em FIPE, combustível, comparar e simulador; a home, `/sobre`, `/planos`, `/instalar`, `/contato`, `/perguntas-frequentes`, o guia, o blog e as páginas legais ignoravam os blocos, e as páginas de consulta (gravame, sinistro, leilão…) mostravam só as perguntas, não os blocos. Agora todas mostram, como texto visível (`h2` + parágrafo), o que está salvo no painel. O texto continua vindo do painel, nada foi copiado para o código.
- **Regra de composição das perguntas:** o que o painel cadastrou aparece sempre; as perguntas da central (`/faqs`) que a página já mostra (home e `/planos`: as 6 primeiras; `/perguntas-frequentes`: todas) continuam, e as do painel entram depois em "Mais perguntas…", sem repetir a mesma pergunta. Nas páginas de consulta, as perguntas do painel substituem as fixas, como antes. Página sem bloco nem pergunta cadastrados não ganha seção vazia. A lista `/faqs` agora é pedida uma vez só por tela.
- **Central de perguntas no HTML:** `/perguntas-frequentes` passa a levar também os blocos do painel no HTML inicial.
- **Taxas do simulador:** a referência agora diz de onde vem. Sem coleta do Banco Central, aparece como "referência interna (estimativa)" (antes saía com o nome do Banco Central mesmo quando era o valor de fábrica). Com coleta, mostra o mês de referência e a data da coleta. Atrasada (4 meses ou mais) ganha aviso na tela, com a sugestão de informar a taxa da proposta do banco. Falha do Banco Central mantém a última taxa e o período real, e o motivo técnico fica só no painel. A atualização agora também roda na partida do servidor e a cada 6 horas, sem depender de alguém abrir o simulador. Fórmulas, IOF e CET não mudaram.
- **Painel de SEO:** a nota agora se chama "Preenchimento editorial" e diz que não garante publicação nem indexação; o item "liberada para o Google" virou "indexação permitida no site (sem bloqueio)". Novo botão **Verificar publicação** (uma página ou as 30): compara o que está salvo com o HTML que o servidor entrega (título, descrição, canonical, indexação, H1, blocos, perguntas e schema), com data e escopo; resultado: confere, diverge ou erro. Só abre páginas da lista do sistema, no próprio servidor, sem cookies e sem seguir redirecionamentos. O painel não afirma que a página está indexada: isso só o Search Console informa.
- **Desempenho (medido):** os textos do painel agora também vão no HTML inicial (`<script id="seo-data">`, marcado com a rota), e o app os usa na primeira pintura sem pedir de novo. Isso eliminou o deslocamento de layout que o rodapé sofria quando esses textos chegavam depois: `/fipe` no computador passou de CLS 0,175 para 0,001 (Lighthouse local, nota de desempenho 91 → 99) e no celular ficou em 0,002. A lista de perguntas da central reserva a altura da lista pronta. Pendentes, sem correção aqui por falta de evidência de uma solução segura: CLS de 0,17 em `/planos` no computador (a tabela comparativa chega depois, vinda da API do catálogo) e 0,10 em `/simulador/carro` (cartão de ações depois do cálculo).
- Painel do simulador: mostra a data da coleta e avisa quando as taxas estão atrasadas ou nunca vieram do Banco Central.
- Sem variável de ambiente nova. Sem migração nova (continua em 082). Testes novos: `seo-blocos-publicos` (navegador real), `seo-publicacao`, `financing-referencia`.

## 1.48.0 — Simulador: texto para buscas, perguntas novas, links entre FIPE e simulador

- **Simulador (/simulador):** título "Simulador de financiamento de veículos grátis | Placa na Mão", descrição nova (entrada, prazo e juros; parcelas, CET e custo total de carros e motos) e texto de abertura mais claro, dizendo que é grátis, que dá para usar a taxa da proposta do banco e que não é aprovação nem oferta de crédito. Migração 082: só troca título e descrição se ainda forem os de fábrica; o que a equipe escreveu no painel fica como está.
- **3 perguntas novas** no painel de SEO e na própria página: "O simulador é gratuito?", "Posso usar a taxa da proposta do meu banco?" e "A simulação consulta ofertas de todos os bancos?" (resposta: não, calcula com os dados informados).
- **Links entre as ferramentas:** o resultado da FIPE ganhou o botão "Simular o financiamento" (já com o valor do veículo preenchido) e o rodapé do simulador leva para a Tabela FIPE grátis.
- **Acessibilidade e velocidade:** cinza dos textos de apoio escurecido (contraste passa de 4,48 para 5,0) e logos com largura e altura declaradas, para a tela não "pular" ao carregar.
- Conferido: o servidor já entrega `canonical` do simulador apontando para `/simulador` (inclusive com `?v=…&e=…&m=…`) e a descrição certa. O H1 continua "Simulador de financiamento" (regra do painel de até 30 caracteres).
- Sem variável de ambiente nova. `test/seo-simulador.test.mjs` novo; `migration-rollback` com 56 migrações.

## 1.47.1 — FIPE e Simulador sempre à mostra, página da FIPE mais limpa

- **Menu do topo:** "Tabela FIPE" e "Simulador" ficam como os demais links (sem destaque nem etiqueta). "Veículos" reúne guia, comparar, mais econômicos e etanol ou gasolina; "Ajuda" reúne blog, perguntas frequentes, sobre e contato.
- **Home:** abaixo do campo da placa, dois atalhos discretos ("FIPE grátis" e "Simulador de financiamento"), e uma faixa curta "Ferramentas grátis para decidir melhor" com os dois cartões. Etanol ou gasolina e Comparar não aparecem mais nesses atalhos. Cliques medidos como `hero_tools` e `home_tools`.
- **Página da FIPE:** sem aviso de cadastro e sem "(com conta)" na aba — abas "Por placa" e "Por marca e modelo", e o botão Consultar FIPE sempre visível. Quem digita a placa e clica em Consultar sem estar logado vê só "Crie ou entre na sua conta para consultar pela placa", com **Criar conta** e **Já tenho conta**; depois do login volta para a FIPE com a placa preenchida. O texto "sem cadastro" saiu da abertura.
- **Resultado por marca e modelo:** o valor aparece na tela para todos; baixar PDF ou imprimir exige conta ("Criar conta para baixar PDF ou imprimir" / "Já tenho conta"). A API já exigia login para salvar, gerar PDF e imprimir.
- Só layout e textos: nenhuma rota, API ou migração mudou. Sem variável de ambiente nova.
- Substitui o destaque no menu da 1.47.0 (etiqueta "Grátis", faixa de 4 ferramentas), que saiu.

## 1.46.0 — Capas de todas as páginas e imagens de todas as consultas

- **29 páginas já vêm com capa** (migração 081), em WebP 1200×630: início, FIPE, consulta de placa, consulta veicular, gravame, sinistro, leilão, débitos, multas, recall, histórico, planos, lojistas, concessionárias, sobre, instalar, contato, guia de veículos, mais econômicos, combustível, simulador (e os 4 tipos), comparar, blog, termos e privacidade. Só a página de perguntas frequentes ficou sem capa (usa a imagem da marca). A migração só troca imagem que veio de fábrica: o que a equipe enviar pelo painel nunca é sobrescrito. Para trocar, use Painel → SEO.
- **As 6 consultas têm imagem** (Cadastral, Leilão e Dados do Veículo, Gravame, Completa, Avançada, Premium). No schema de produto da home, a imagem quadrada (quando existe) vai primeiro e a de capa depois.
- As capas ficam em `/brand/capas` e `/brand/produtos` (fonte das imagens iniciais); a cópia em uso vem do banco (`seo_images`). A capa repetida da Premium (outro estilo) não foi usada.
- Sem variável de ambiente nova. `test/seo-imagens.test.mjs` confere as 29 capas (WebP 1200×630); `migration-rollback` com 55 migrações.

## 1.45.1 — Imagens iniciais das páginas e limpeza das repetidas

- **Já vêm com imagem** (migração 080): `/consulta-veicular` (arte da Consulta Completa) e `/consultar-gravame` (arte da Consulta Gravame), 1200×1200. Só entra se a página ainda não tiver imagem; o que a equipe enviar pelo painel nunca é sobrescrito. Para trocar, use Painel → SEO.
- **Limpeza:** ficaram só as 3 artes com logo usadas nos produtos (Cadastral, Completa, Gravame) em `/brand/produtos`. Saíram as versões sem logo e a da “Consulta Básica” (o produto hoje se chama Avançada, e a arte levaria o nome antigo).
- Sem variável de ambiente nova. `test/seo-imagens.test.mjs` confere as duas imagens iniciais; `migration-rollback` com 54 migrações.

## 1.45.0 — SEO: imagem de cada página, enviada pelo painel

- **Painel de SEO → Editar página → “Imagem da página (miniatura)”:** enviar, trocar e remover a imagem de qualquer das páginas indexáveis. A lista de páginas mostra a miniatura de cada uma.
- **Para onde a imagem vai:** `og:image` (WhatsApp, Facebook, Instagram, LinkedIn), `twitter:image`, `image` no schema da página e `<image:image>` no sitemap (Google Imagens). Sem imagem própria, a página continua usando a imagem padrão da marca.
- **Medidas:** 1200×1200 para consultas e produtos (o Google pede imagem quadrada para produto) e 1200×630 para páginas institucionais. PNG, JPG ou WebP, até 3 MB, mínimo de 300 px de lado; de preferência até 300 KB.
- **Guardada no banco** (migração 079, tabela `seo_images`): não se perde a cada deploy. O endereço público é `/seo-img/<página>.<extensão>?v=<versão>` e muda a cada troca, então o cache do Google e das redes se renova. O tipo é conferido pelo conteúdo do arquivo, não pelo nome.
- A ajuda do painel ganhou a linha “Imagem da página”. O `HeadSync` do app também troca `og:image` ao mudar de tela.
- Sem variável de ambiente nova. Testes em `test/seo-imagens.test.mjs`; `migration-rollback` agora com 53 migrações.

## 1.44.2 — Imagens das consultas no schema de produto

- **O que é o campo `image`:** é a foto do produto que o Google exige no dado estruturado (schema) para considerar o item válido nas listagens do comerciante. Não aparece na página, só para o Google.
- As miniaturas das consultas Cadastral, Completa e Gravame (versão com logo, 1200×1200) ficam em `/brand/produtos/` e são usadas como `image` do produto na home. 
- Consultas sem miniatura própria (Avançada, Premium, Leilão e Dados do Veículo) usam por enquanto a imagem padrão da marca. Para trocar, basta colocar o arquivo em `/brand/produtos/` e incluir o código do produto em `PRODUCT_IMAGES` (`seo.ts`).
- Sem migração e sem variável de ambiente nova. Teste em `test/seo-cabecalho.test.mjs`.

## 1.44.1 — Schema de produto com imagem (listagens do comerciante)

- **Listagens do comerciante (Search Console):** cada `Product` do schema da home passa a ter `image` (campo que o Google marcava como erro crítico). Os avisos opcionais (`aggregateRating`, `review`, política de devolução, frete) não são preenchidos de propósito: não há avaliações reais cadastradas e o produto é digital.
- Sem migração e sem variável de ambiente nova. Teste em `test/seo-cabecalho.test.mjs`.

## 1.44.0 — SEO: cabeçalho certo no navegador, schema sem erro, link real nos simuladores e FAQ do leilão atualizada

Correções a partir da auditoria de SEO de 08/11/2026.

- **Canonical e descrição por página também no navegador:** o HTML que o servidor entrega já saía certo por página (verificado nas 30 rotas), mas o service worker do app abria a cópia guardada do `index.html` (valores da home) e a troca de tela não atualizava o cabeçalho. Novo `HeadSync` no app: a cada tela ajusta canonical, `og:url`, descrição (a do painel, ou a de fábrica) e `robots` (telas de conta/app ficam `noindex`), e remove os dados estruturados da tela anterior. `/api/seo/page` passa a devolver `description`.
- **`/robots.txt` e `/sitemap.xml`:** o service worker não os intercepta mais (antes, quem já tinha o app instalado via a tela “404”). Qualquer URL com extensão de arquivo também fica de fora.
- **Schema `WebApplication` genérico removido do `index.html`:** ele ia para todas as páginas. `WebApplication` continua só nas ferramentas (FIPE, simuladores, combustível, comparador), com o tipo certo.
- **Simulador:** o seletor Carro/Moto/Caminhão/Utilitário agora são links de verdade (`/simulador/carro` etc.); o clique simples continua trocando sem recarregar.
- **Títulos H2/H3:** as páginas de consulta (placa, gravame, sinistro, leilão, débitos, multas, recall, histórico, lojistas, concessionárias) ganharam H2 (invisível) antes dos blocos de benefícios e de ferramentas, sem mudar o visual.
- **Leilão:** a pergunta “A consulta de leilão já está disponível?” da página `/consultar-leilao-veiculo` ainda dizia que a fonte seria ativada, contradizendo o preço em `/planos`. Texto de fábrica corrigido e **migração 078** atualiza o que está gravado, **só se ainda for o texto de fábrica** (texto editado pela equipe é preservado).
- **Painel de SEO:** a ajuda não promete mais “resultado enriquecido” para perguntas (o Google deixou de exibir em maio de 2026).
- Sem variável de ambiente nova. Testes em `test/seo-cabecalho.test.mjs`; `seo-pages` e `migration-rollback` (52 migrações) ajustados.

## 1.43.0 — Chave PIX também para parceiros (obrigatória para eles)

- **Parceiro precisa da chave PIX:** ao aceitar o convite de parceiro, a pessoa informa a chave PIX (ou usa a que já tem no cadastro da conta). Sem chave, o convite não é aceito e continua valendo para tentar de novo. A chave é validada por tipo (CPF, CNPJ, e-mail, celular ou aleatória) e guardada em formato padrão.
- **Painel do parceiro:** novo cartão “Chave PIX para receber”, com aviso enquanto não houver chave, chave mascarada e botão para trocar. Trocar a chave vale para o parceiro e para o perfil da conta (reembolso e cashback).
- **Indique e ganhe (cliente comum):** continua opcional. A chave do cadastro/Minha conta já é usada como chave do repasse; se a equipe tiver digitado outra chave no parceiro, ela não é apagada.
- **Repasse:** usa a chave do parceiro e, se não houver, a da conta dele. Sem nenhuma, segue bloqueado (`PARTNER_PIX_KEY_REQUIRED`).
- **Equipe cadastrando parceiro:** a chave informada passa a ser validada e normalizada (antes aceitava qualquer texto).
- Sem migração e sem variável de ambiente nova. Testes em `test/partner-convites.test.mjs`.

## 1.42.0 — CRM em quadro (Kanban), qualificação por consumo, consultas limpas e envio pela vitrine

- **CRM em quadro (Leads e CRM → Esteira):** colunas Não qualificado › Contatado › Interessado › Cadastrado › Cliente esporádico › Cliente recorrente › Perdido. Arraste o cartão para outra coluna (no celular, use “Mover para…” no cartão); a mudança fica no histórico do contato. Cada cartão mostra a origem (canal e campanha), a ferramenta do site e, para cliente, nível, tipo, nº de consultas, gasto e quais consultas fez.
- **Qualificação automática pelo consumo:** quem só simulou ou olhou a FIPE fica em “Não qualificado”; quem cria conta vai para “Cadastrado”; quem faz a primeira consulta paga e concluída sobe sozinho para Cliente. **Tipo:** esporádico (1 consulta, ou poucas e espaçadas) ou recorrente (2 ou mais nos últimos 90 dias, ou 4 ou mais no total). **Nível pelo gasto:** bronze (qualquer valor pago), prata (a partir de R$ 100) e ouro (a partir de R$ 300). Só conta consulta paga e concluída: estornada, falha, consulta sem valor e consulta interna da equipe não contam. As colunas de cliente e Cadastrado são automáticas (o quadro avisa se tentar arrastar para elas). Limites ajustáveis em `lib/leads.ts`.
- **Origem e rastreamento:** o canal vem das marcações do link (utm_source: Instagram, Facebook, Google, TikTok, YouTube, WhatsApp, e-mail; ref = indicação; link da equipe; sem marcação = site). Resumo no alto da tela, filtros por canal, tipo de cliente e nível na lista, e na exportação. Novo botão **Link rastreado (campanha)**: escolhe a página, onde vai colocar (bio do Instagram, stories, anúncio, WhatsApp, e-mail…) e o nome da campanha, e copia o link já marcado para usar nas postagens e anúncios.
- **Consultas (painel) limpo:** deixou de mostrar tudo em cartões. Agora é uma lista com abas **Concluídas** (padrão), **Estornadas**, **Falhas e pendentes** e **Todas**, com a contagem de cada uma; estornadas e falhas não se misturam com as concluídas. PDF, Link e Enviar ao cliente ficam em cada linha concluída.
- **Produtos do site → Enviar consulta:** cartões das consultas à venda (nome, preço, o que inclui). “Enviar link” gera o link da consulta e manda por WhatsApp, e-mail ou só copia; quem abrir cria o acesso e cai direto nela, e o cadastro fica ligado ao contato no CRM.
- Sem migração e sem variável de ambiente nova. Testes: `test/crm-qualificacao.test.mjs`; `crm-leads.test.mjs` ajustado (gasto passa a ser o das consultas pagas).

## 1.41.0 — FIPE grátis pela placa exige conta, cadastro simples e chave PIX

- **Criar conta ficou simples:** só nome, e-mail, WhatsApp e senha (mais o aceite dos Termos e da Privacidade). CPF, cidade, estado e o aceite de responsabilidade deixaram de ser pedidos na criação da conta e passam a ser pedidos **uma única vez, na primeira compra de consulta** (a tela avisa o que falta e leva para Minha conta; depois de preenchido não pede mais). Para usar o que é grátis (FIPE pela placa com conta) não é preciso CPF, endereço nem dado de pagamento.
- **Produto gratuito não trava:** a checagem do cadastro de compra não vale para produto marcado como gratuito. Consulta paga, checkout e monitoramento seguem exigindo os dados de compra, como antes.
- **Chave PIX no cadastro (opcional):** tipo (CPF, CNPJ, e-mail, celular ou aleatória) e chave, validados e guardados em formato padrão. Serve só para devolver valores, cashback e comissão do Indique e Ganhe; pode ser informada ou trocada em Minha conta e apagada deixando em branco. A chave nunca vai para o registro de auditoria (só “atualizada” ou “removida”). No painel, o detalhe do cliente mostra a chave (inteira para quem gerencia clientes ou fiscal, mascarada para os demais). Quem ainda não tem chave vê um aviso em Minha conta.
- Compatível: o formulário antigo (que manda CPF, cidade, estado e aceite no cadastro) continua funcionando e a conta nasce completa. Contas que já estão completas não perdem nada.
- Migração 077 (colunas `pix_key`, `pix_key_type`, `pix_key_updated_at` em `user_profiles`; reversível). Sem variável de ambiente nova.
- Testes: `test/customer-profile.test.mjs` (cadastro por etapas e PIX) e `test/migration-rollback.test.mjs` (51 migrações).

### FIPE pela placa só com conta

- **FIPE pela placa só com conta de cliente (grátis):** quem não está logado e digita a placa na Tabela FIPE vê um aviso para criar a conta ou entrar (volta para a FIPE com a placa preenchida). O servidor também recusa (401) antes de gastar cota ou consultar qualquer fonte, então não dá para burlar pela API. Os dados do veículo pela placa ficam dentro da conta; o resto das consultas (débitos, restrições, leilão…) segue sendo comprado.
- **Sem conta continua valendo:** FIPE por marca, modelo e ano (resultado na tela, sem PDF nem impressão, que já exigiam conta).
- Os pedidos recusados por falta de conta entram no funil (`FREE_QUERY_LOGIN_REQUIRED`) para medir quantos viram cadastro. Teste: `test/fipe-placa-conta.test.mjs`. Sem migração e sem variável de ambiente nova.

## 1.40.0 — CRM de leads, links de consulta pelo painel e menus enxutos

- **Leads e CRM (painel → Clientes e CRM → Leads e CRM):** quem deixa contato no simulador, na Tabela FIPE, no fale conosco, no interesse em planos, quem recebe um link da equipe e quem cria conta por qualquer caminho entra numa esteira (Novo → Contatado → Interessado → Cadastrado → Cliente → Perdido). A etapa sobe sozinha: conta criada vira Cadastrado e primeira compra paga vira Cliente. Cada contato mostra o que fez no site (páginas, FIPE, checkout, ligadas pela sessão), o histórico de contatos, etiquetas, anotações, retorno marcado e o gasto na conta. Filtros por etapa, origem, tipo, aceite de mensagens, retorno vencido e parados há 7+ dias; ações em lote; planilha.
- **Enviar link de consulta (cliente ou lojista):** o painel gera um link `/c/CÓDIGO` (validade de 1 a 90 dias, com consulta e placa opcionais), com mensagem pronta para WhatsApp ou e-mail. Quem abre cria o acesso e cai direto na consulta; o link conta aberturas e cadastros, o contato avança de etapa e a conta fica ligada a quem enviou em Convites. Dá para cancelar o link.
- **Formulário de contato nas ferramentas:** simulador e FIPE ganham um cartão discreto (nome, e-mail ou WhatsApp). O aceite de receber novidades vem desmarcado e só vale se a pessoa marcar. Tem campo-armadilha contra robô e limite de pedidos.
- **E-mail de conteúdo:** envio em lote só para quem aceitou e não saiu, com filtro por etapa, tipo e etiqueta, contagem antes de enviar, botão opcional para uma página do site e link “Não quero mais receber” em todo e-mail (página `/descadastrar`, confirmada por clique). Quem sai nunca mais recebe marketing, inclusive na conta.
- **Público para anúncios (lookalike/remarketing):** lista CSV só de quem aceitou, com e-mail e telefone em SHA-256 (formato aceito por Meta e Google). Nada legível sai. Toda exportação fica na auditoria.
- **Privacidade e segurança:** aceite de marketing só pela própria pessoa (a equipe não consegue marcar por ela); contato com conta não pode ser apagado pelo CRM; planilha neutraliza fórmula; a página do link não mostra o e-mail do destinatário; a lista de links mostra a placa mascarada; permissões: ver (Clientes), mexer/enviar/exportar (gerenciar clientes). Texto da Política de Privacidade ganhou o item 9 (contatos deixados no site).
- **Menus enxutos:** painel da equipe com 7 grupos (Convites passou para dentro do CRM; Resultados junto do Painel; Equipe em Sistema; Simulador em Site e conteúdo) e área do cliente com “Convites e indicações” num só item.
- **Correção:** `/convite/…`, `/c/…`, `/descadastrar` e `/parceiro/convite/…` voltavam status 404 do servidor (a tela abria, mas com código de erro). Agora abrem com 200, `noindex` e ficam fora do robots.txt.
- Migração 076 (tabelas `site_leads`, `site_lead_events`, `lead_links`; reversível). Sem variável de ambiente nova.

## 1.39.0 — Consulta Avançada, cartões de consultas no painel e limpeza

- **Cartões de consultas no painel (Consultas):** nova visão em cartões (e a lista de antes, com um botão para alternar). Cada cartão mostra placa, produto, cliente, data, valor e situação, com **Ver relatório**, **PDF**, **Enviar link** (link de visualização com validade, sem login, com WhatsApp) e **Enviar ao cliente** (coloca na conta dele e avisa por e-mail), tudo sem consultar o provedor de novo e sem cobrar.
- **Limpar falhas e sem pagamento (Consultas → botão no topo, só para quem tem acesso a cobrança):** mostra a contagem antes e só apaga o que não gerou receita nem entrega — consultas que falharam, consultas travadas em processamento há mais de 2 horas e pedidos sem pagamento (checkout cancelado, expirado, com falha ou aberto há mais de 24 horas). Nunca apaga consulta feita com sucesso, pedido pago ou estornado, nem nada com lançamento na carteira, comissão, contrato ou direito de uso pendente. Fica na auditoria.
- **Garantia de produção:** teste automático que faz o caminho inteiro de cada consulta à venda (dado → relatório → HTML → PDF legível → link de visualização), confere as seções que cada produto entrega e que o PDF sai sem valor quebrado, com o leilão e as análises.

### Consulta Avançada acima da Completa (migração 075)

- **Correção da escada (migração 075):** a Essencial do concorrente custa R$ 45,90 (eu tinha usado um valor menor) e traz leilão, score, desvalorização, seguro, comercialização e batidas. A consulta que a 074 chamou de Segura (R$ 32,90, abaixo da Completa) vira **Consulta Avançada, R$ 41,90**: tudo da Completa (débitos, restrições, sinistro, roubo e furto, leilão, recall, FIPE e comparação entre bases) mais gravame detalhado, restrições judiciais (Renajud) e multas por infração, com o nível de risco de leilão, a possível desvalorização e a aceitação em seguro. É a Premium sem o histórico de proprietários.
- **Escada final:** Premium R$ 62,90 › Avançada R$ 41,90 › Completa R$ 34,59 › Leilão e Dados do Veículo R$ 29,90 › Gravame R$ 11,90 › Cadastral R$ 9,90. Todas abaixo do teto de mercado e acima do preço mínimo de margem (custo normal da Avançada R$ 25,13; roubo/furto e recall ficam como reserva, igual à Completa).
- Vitrine: a Avançada aparece entre a Premium e a Completa; matriz de comparação copiada da Premium, sem proprietários; texto "Qual consulta devo escolher?" atualizado. Reverter restaura a Segura da 074.
- Sem variável de ambiente nova.

## 1.38.0 — Escada de consultas: Segura, Leilão e Dados do Veículo, e análises de leilão

- **Escada de consultas (migração 074):** Premium (R$ 62,90) › Completa (R$ 34,59) › **Segura** (R$ 32,90) › **Leilão e Dados do Veículo** (R$ 29,90) › Gravame (R$ 11,90) › Cadastral (R$ 9,90). Todas abaixo do teto de mercado (Essencial R$ 34,90, Gravame R$ 14,90, Cadastral R$ 13,90) e acima do preço mínimo de margem.
- **Consulta Segura (era a Básica):** cadastro estadual e da base nacional, débitos, multas, restrições, indício de sinistro e passagem por leilão, com nível de risco e aceitação em seguro. O id do produto (`BASIC`) e o endereço continuam os mesmos; muda o nome, o conteúdo, as fontes e o preço (de R$ 29,90 para R$ 32,90). O gravame detalhado (banco, contrato e datas) sai desta consulta e continua na consulta Gravame e na Premium; a situação do financiamento segue aparecendo.
- **Leilão e Dados do Veículo (era a Leilão):** dados do veículo com a base nacional, restrições, registros de leilão (data, leiloeiro, lote, condição) e as análises abaixo. Sem débitos e sem gravame. Preço de R$ 27,90 para R$ 29,90, porque a base nacional entra no custo (R$ 20,08) e o preço mínimo ficaria acima do preço antigo.
- **Análises novas no relatório (seção "Análises da Placa na Mão"), só com o que a consulta trouxe:** nível de risco de leilão (Muito baixo, Baixo, Razoável ou Alto), possível desvalorização (texto, sem percentual), CSV do Inmetro para veículo recuperado e aceitação em seguro. Aparecem também na Completa e na Premium. Sem leilão consultado, nada é calculado. São classificações próprias, rotuladas como tal; não são nota nem dado de órgão oficial.
- **Comparador e /planos:** duas linhas novas na matriz (nível de risco de leilão e desvalorização; aceitação em seguro e risco de revenda). O texto "Qual consulta devo escolher?" foi atualizado.
- **Custos gravados:** Segura R$ 21,41 e Leilão e Dados R$ 20,08 (sem gravame e sem Renajud, que só custam quando o cadastro indica). Preço mínimo recalculado com as taxas configuradas e histórico de preço registrado. Reverter restaura o produto anterior (guardado em `migration_074_prev`).
- Sem variável de ambiente nova.

## 1.37.1 — Página de carros mais econômicos

- Corrige o 404 de `/veiculos/mais-economicos` (a página está no sitemap): agora abre com status 200 e fica indexável. Modelo inexistente continua dando 404. Teste incluído. Sem migração e sem variável nova.

## 1.37.0 — Visual mais leve, menus agrupados, convite por usuário e guia com mais veículos

- **Convite por usuário (migração 073):** todo usuário — cliente, lojista, operador, administrador — tem o próprio código e link (`/convite/CÓDIGO`). Quem abre o link e se cadastra (e-mail e senha ou Google) fica ligado a quem convidou, com data e caminho (convite pelo site ou consulta enviada). Fica registrado também quantas vezes o link foi aberto.
- **Consulta enviada ao comprador:** o link gerado em "Enviar ao comprador" já leva o convite de quem enviou. Se o comprador se cadastrar a partir dele, o cadastro fica ligado a quem mandou a consulta.
- **Onde ver:** cliente/lojista em **Meus convites** (totais, lista dos convidados com nome e e-mail parciais, WhatsApp e e-mail); equipe em **Minha conta → Meu link de convite**; no painel, **Pessoas → Convites** mostra quem convidou quem, quando, por qual caminho e se já consultou/comprou. Na ficha do cliente aparece "Convidado por". É só rastreio, sem comissão (comissão continua no "Indique e ganhe").
- **Visual mais leve em todo o sistema (site, PWA, tablet, desktop e painel):** títulos e números menores, letras mais finas (peso 400/500; a fonte só tem esses pesos, os negritos pesados foram removidos), menos letras em caixa alta espaçadas.
- **Menus agrupados por assunto:** site (Veículos, Ferramentas, Ajuda), área do cliente/lojista/afiliado (Acompanhar, Garagem, Loja, Carteira e convites, Conta) e painel da equipe (Dinheiro e Preços e vendas separados; Integrações foi para Sistema). No celular, a aba **Menu** abre todas as páginas da conta (antes várias só apareciam por atalhos).

- **Página /planos:** os cartões das consultas avulsas agora seguem a proporção dos cartões dos pacotes — três por linha no computador (duas linhas), dois no tablet e um no celular — em vez de ficarem finos e esticados. A tabela comparativa deixou de fixar a primeira coluna no computador (só fixa em tela pequena).
- **Guia de veículos (migração 072):** +34 modelos e 38 versões de 15 marcas (Fiat, Volkswagen, Chevrolet, Toyota, Honda, Jeep, Nissan, Hyundai, Renault, Citroën, Peugeot, BYD, Mitsubishi, Ford e GWM), com ano-modelo, motor, consumo, medidas e demais dados. Só entra número que consta na fonte (Ficha Completa); o que a fonte não lista fica em branco, nada é estimado. Os modelos entram publicados, sem opinião, prós e contras escritos por nós — você complementa no painel.
- **Elétricos e híbridos:** novos campos de ficha — capacidade da bateria (kWh), autonomia (km) e consumo elétrico (kWh/100 km) —, que aparecem na ficha e na comparação.
- A carga não mexe em modelos já existentes nem sobrescreve o que a equipe editou; a frota (Senatran) é religada aos modelos novos automaticamente. Reverter remove só os modelos desta carga que não tenham opinião, dica ou consumo registrados.
- Sem variável de ambiente nova.

## 1.36.0 — Custo de cada consulta e controle de margem

- **Custo de cada consulta gravado (migração 071):** Cadastral R$ 2,15 · Financiamento R$ 3,52 · Básica R$ 3,52 · Leilão R$ 18,91 · Completa R$ 21,52 · Premium R$ 33,13. É a soma das chamadas pagas de cada consulta, pela tabela da Credify. Só preenche onde o custo está vazio: valor que você já salvou em Financeiro → Produtos não é alterado.
- **Preço mínimo (piso) calculado** com os impostos e taxas configurados, garantindo a margem mínima em todas as formas de pagamento habilitadas. Se o piso ficar acima do preço atual, ele não é gravado (não trava o salvamento) e o alerta aparece em Financeiro → Produtos.
- **Preços de venda não mudam.** Reserva de custo extra: roubo/furto (R$ 7,31) e recall (R$ 1,97) só são comprados quando a base não traz o sinal limpo, por isso ficam fora do custo normal. Detalhes e margens por forma de pagamento em docs/SISTEMA.md.
- Sem variável de ambiente nova.

## 1.35.0 — Convite de parceiro, painel do parceiro, Básica com gravame e Leilão ativo

- **Convite de parceiro por link:** em Parceiros e repasses → Convites (ou "Convidar por link"), o painel gera um link com comissão, tipo e base já definidos, validade e uso único (pode prender a um e-mail). Quem recebe cria a conta (ou entra) e aceita; vira parceiro e abre direto no painel dele. Chave Pix e documento você preenche depois, em Parceiros. Dá para cancelar o convite. Migração 070.
- **Painel do parceiro** (área do cliente, perfil Afiliado): receita gerada, vendas, comissão total, disponível, em liberação e já paga, clientes que ele trouxe, consultas feitas por eles e repasses. Tudo mascarado: só o primeiro nome, e-mail parcial e placa parcial. A página do convite não aparece em buscadores.
- **Erro ao salvar a Completa/Premium no painel corrigido:** a seção "Proprietário" já vinha marcada nesses produtos e o servidor a recusava, devolvendo a mensagem genérica. Agora é aceita, e erros de seção, fonte e margem passam a mostrar mensagem clara.
- **Básica com gravame (migração 069):** passa a comprar a base de cadastro/débitos/restrições e o gravame completo (banco, contrato e datas), só quando o cadastro indica financiamento. Sem leilão e sem proprietários. Custo: R$ 2,15 sem financiamento e até R$ 3,52 com financiamento (tabela da Credify). O texto da vitrine e a comparação foram atualizados.
- **Consulta Leilão ativa (migração 069):** sai de "em breve" e passa a ser vendida (base de cadastro + leilão conjugado, custo ≈ R$ 18,91). O relatório mostra só identificação, características e o histórico de leilão. O preço continua o que você definiu.
- Sem variável de ambiente nova.

## 1.34.0 — Preços e posição da Premium e da Completa

- **Premium** (equivalente ao Veículo Completo+ do Olho no Carro): **R$ 62,90**. Passa a ser a "Mais completa" na página de planos e vem primeiro na vitrine.
- **Completa** (equivalente ao MTix): **R$ 34,59**. Segue como "Mais vendida".
- Os dois preços ficam em modo manual (sem a regra de referência de mercado) e entram no histórico de preços. Os nomes e o conteúdo não mudaram.
- Se o piso de margem gravado estiver acima do preço (custo antigo), ele é limpo e volta a ser calculado quando você salvar os custos em Financeiro → Produtos (Completa ≈ R$ 21,50 e Premium ≈ R$ 33,15, pela tabela da Credify).
- Migração 068. Sem variável de ambiente nova.

## 1.33.0 — Completa e Premium fechando as lacunas de dados (FIPE pela placa, multas detalhadas, alterações)

- **FIPE pela placa (Completa e Premium):** nova fonte `FIPE` (Credify `/precificadorfipe`): código FIPE, preço e preço médio exatos pela placa. Antes a FIPE da Completa era localizada pelo modelo e ano.
- **Multas detalhadas (Premium):** nova fonte `RENAINF` (Credify `/renainf`): cada infração com descrição, vencimento, valor e situação. O valor segue o formato "195,23"; confira na primeira consulta real.
- **Alterações de características (Completa e Premium):** compara chassi, motor, câmbio, cor e combustível entre o cadastro estadual, a base nacional e o registro de leilão (quando há). Chassi, motor ou câmbio divergentes viram alerta. Não são dados de fábrica: é a mesma informação vista por bases diferentes. Sem custo extra.
- **Texto do gravame corrigido:** a vitrine da Premium não promete mais "valores" do financiamento (as bases não informam saldo devedor nem parcelas). Migração 066.
- Migração 067: Completa passa a usar FIPE e Premium passa a usar FIPE e RENAINF, só se as fontes ainda forem as da versão anterior. Sem variável de ambiente nova.
- Custo extra por consulta (preços do inventário): FIPE R$ 0,11 (Completa e Premium) e RENAINF R$ 0,64 (Premium).

## 1.32.0 — Completa (padrão MTix) e Premium (padrão Olho no Carro) com vitrine, área do cliente e PDF alinhados

- **Premium** passa a ter fontes fixas: sinistro, base nacional, roubo/furto, recall, leilão, gravame completo, Renajud e **histórico de proprietários** (nova fonte `OWNERS`, consulta própria da Credify, cobrada sempre que o produto a usa). Quantidade e linha do tempo de proprietários saem no relatório e no PDF só na Premium; a Completa não promete nem entrega esse item.
- **Textos da vitrine** (descrição, o que inclui, cobertura) da Completa e da Premium reescritos para dizer só o que cada uma entrega, sem repetir itens. A Premium vira "tudo da Completa + gravame detalhado + restrições judiciais + proprietários".
- **Relatório:** leilão, roubo/furto e recall que constam agora aparecem como "Consta passagem por leilão", "Consta registro de roubo ou furto" e "Consta recall do fabricante" (antes podia sair "Sucesso").
- **Modelo de exemplo (PDF e tela do site):** só mostra o histórico de proprietários nos produtos que realmente o entregam.
- Assistente de suporte reconhece "Premium" e "Completa" separadas.
- Migrações 064 (textos e fontes) e 065 (proprietários na Premium). Só mudam se o produto ainda estiver com o texto/fontes anteriores; o que você editou no painel não é sobrescrito. Preços não são alterados: ajuste em Produtos do site.
- Sem variável de ambiente nova.

## 1.31.1 — Consulta Completa em camadas (mais barata, no padrão MTix)

- A Consulta Completa deixa de comprar o pacote fechado Veículo Total e passa a ser montada em camadas: base de débitos, restrições e alienação + indício de sinistro + base nacional + leilão conjugado; roubo/furto e recall só viram consulta própria quando o cadastro indica. Sem gravame e Renajud pagos (esses ficam na Premium).
- O histórico de proprietários vinha só no pacote fechado, então saiu da lista e da comparação da Completa e da Premium para não prometer o que não entrega.
- Migração 063: só troca se a Completa ainda estiver na fonte da 062. Quem já mudou as fontes no painel não é afetado.

## 1.31.0 — Nova linha: Consulta Completa (padrão MTix) e Consulta Premium

- **Consulta Completa (R$ 32,99):** passa a comprar o pacote Veículo Total inteiro numa chamada só (indício de sinistro, roubo/furto, leilão, recall, proprietários, base nacional, FIPE e a base de débitos e restrições). O relatório já traz o resumo em semáforo, débitos, multas, restrições, alienação, FIPE com histórico e as análises do sistema. Mantém o mesmo identificador (`COMPLETE`), então links e histórico continuam valendo.
- **Consulta Premium (R$ 44,90):** o que era a Completa em camadas, agora acima dela: gravame detalhado (banco, contrato, datas, prazo e valores), restrições judiciais (Renajud), base nacional completa e leilão passagem a passagem. Usa o produto `PREMIUM`, que já existia escondido e agora fica à venda.
- **Básica (`BASIC`) não foi mexida:** continua ativa a R$ 29,90 para não quebrar quem compra pela API ou por link antigo. Para tirá-la da vitrine, desative em Produtos do site.
- A comparação do site ganhou os recursos Sinistro/roubo/furto, FIPE, Proprietários, Gravame detalhado e Renajud; o leilão deixou de aparecer como "em breve" nas duas consultas. Perguntas frequentes atualizadas.
- Preços só mudam se ainda estiverem no valor anterior e nunca ficam abaixo do piso de margem; cada mudança entra no histórico de preços. As fontes de cada consulta continuam editáveis em Produtos do site → Editar → Fontes de dados.
- Migração 062 (só soma e atualiza textos/preços; sem variável nova).

## 1.30.0 — Fontes de dados por consulta, leilão simples (AnyCar) e correção da edição no painel

- **Edição no painel:** corrigido o cursor que pulava para o primeiro campo a cada letra digitada ao editar produtos da vitrine, pacotes, recursos e demais janelas. A janela refazia o foco a cada tecla; agora foca só ao abrir. Também: com uma janela dentro de outra, o Esc fecha só a de cima.
- **Fontes de dados (APIs) por consulta:** em Produtos do site → Editar → "Fontes de dados", escolha o que a consulta COMPRA: indício de sinistro, base nacional, roubo/furto, recall, leilão (completo ou simples), gravame completo, Renajud ou o pacote Veículo Total. A base de cadastro sempre entra. Sem escolha, tudo continua como antes (padrão do sistema, nada muda). A escolha também vale para consultas internas e para o teste do painel.
- **Relatório só com o que é da consulta:** em "Campos do relatório" há o botão "Desmarcar campos de fontes não usadas", que tira do relatório o que a consulta não compra. O que o cliente vê continua definido em "Campos do relatório".
- **Leilão simples (AnyCar):** nova fonte opcional que só informa o histórico de leilão (data, leiloeiro, lote, condição, comitente, cidade/UF e valor de arremate), pago por consulta e bem mais barato que o leilão completo. Entra no relatório, PDF e API no mesmo bloco de leilão de antes. Precisa de `ANYCAR_API_KEY`; sem ela a opção aparece desativada. Em produto que só compra o leilão simples, falha da AnyCar estorna o cliente; em produto com outras fontes, o leilão fica "não informado" e o resultado não vai para o cache.
- O cache por placa agora considera as fontes escolhidas: mudar a configuração de um produto nunca devolve resposta de outra configuração.
- Variáveis novas (todas opcionais): `ANYCAR_API_KEY`, `ANYCAR_BASE_URL`, `ANYCAR_AUCTION_TYPE`, `ANYCAR_TIMEOUT_MS`. Migração 061 (coluna `data_sources`, só soma).

## 1.29.1 — Completa em camadas lê as respostas no formato da documentação

- O indício de sinistro (e as demais consultas avulsas) agora é lido tanto com os campos direto na resposta quanto dentro do bloco de mesmo nome, como mostra a documentação. Antes, no segundo formato, o alerta podia não aparecer.
- Sem migração e sem variável nova.

## 1.29.0 — Consulta Completa em camadas, preço menor e controle de custo

- A Completa agora é montada por camadas: o sistema faz a consulta base (débitos, restrições e proprietários), o indício de sinistro e a base nacional, e só busca roubo/furto, recall e leilão em detalhe quando o cadastro ou o semáforo indicam ocorrência. O relatório, o PDF, a API e os avisos de mudança continuam exatamente iguais.
- Gravame completo na Completa, igual ao padrão do mercado: banco, CNPJ, contrato, datas e tempo de gravame. É buscado quando o cadastro indica alienação; com `CREDIFY_COMPLETE_GRAVAME=always` é buscado em toda consulta.
- Leilão pelo Farol: quando o código da consulta do Farol Leilão está configurado, o semáforo verde dispensa a consulta detalhada. Amarelo ou vermelho busca o detalhe. Se o Farol não achar o veículo, usa a consulta de leilão como antes.
- Teto de custo por consulta: itens opcionais deixam de ser buscados quando passariam do teto configurado. Nesse caso o relatório avisa que o detalhe não foi incluído.
- Cache criptografado por placa e pacote (padrão 24 horas): repetir a mesma consulta não gera nova compra. Resposta incompleta nunca é guardada.
- Preço da Completa: R$ 31,99 (migração 060, só se o preço ainda estiver no valor inicial e sem passar do piso de margem).
- Volta ao modelo anterior a qualquer momento com `CREDIFY_COMPLETE_MODE=total`. A Premium segue como estava.
- Variáveis novas (todas opcionais): `CREDIFY_COMPLETE_MODE`, `CREDIFY_FAROL_QUERY_ID`, `CREDIFY_COMPLETE_NATIONAL`, `CREDIFY_COMPLETE_THEFT`, `CREDIFY_COMPLETE_GRAVAME`, `CREDIFY_COST_BUDGET_CENTS`, `CREDIFY_COST_CENTS`, `PLATE_CACHE_HOURS`.
- Migração 060.

## 1.28.0 — Consulta grátis com chassi mascarado e preços mais baixos

- A consulta grátis por placa mostra só os dados simples (identificação, características, FIPE por ano e 24 meses, financiamento e ficha técnica) com **chassi e número do motor mascarados** (chassi: 3 primeiros e 4 últimos; motor: 3 primeiros e 5 últimos), na tela, no PDF e na impressão. A "chave do chassi" também não aparece no grátis. O decodificador (fabricante, país, ano) continua funcionando por dentro.
- Para ver os números completos e os débitos, multas e restrições, o cliente faz a consulta Básica ou Completa. Nas consultas pagas nada é mascarado, como antes.
- Preços novos: Básica R$ 29,90, Completa R$ 54,90, Gravame R$ 11,90, Cadastral R$ 9,90 e Leilão R$ 27,90 (quando ativar).
- Migração 059: baixa os preços só de quem ainda está no preço inicial; produto cujo preço já foi mudado no painel não é tocado, e nenhum preço novo fica abaixo do piso de margem configurado. Cada mudança entra no histórico de preços.
- Sem variável nova.

## 1.27.0 — Cadastro simples

- Criar conta pede só: como vai usar (uso pessoal, autônomo/despachante ou loja/empresa), nome completo, e-mail, senha e confirmação, WhatsApp, CPF, cidade e estado, e um único aceite dos Termos de Uso e da Política de Privacidade (que já inclui a responsabilidade pelas informações consultadas). Sem endereço, CEP nem envio de documento.
- Minha conta segue a mesma regra; o bloco de endereço foi trocado por cidade e estado. Quem já tinha endereço guardado não perde nada.
- Quem tinha cadastro "incompleto" só por falta de endereço passa a ficar completo e pode consultar normalmente.
- Conta de loja/empresa não exige mais CNPJ nem nome da empresa no cadastro (isso fica para o portal do lojista).
- Nota fiscal: para o cliente, só o CPF ou CNPJ é obrigatório (o padrão nacional não exige endereço do tomador). Cliente sem CPF/CNPJ continua pendente.
- O servidor ainda aceita o formulário antigo com endereço (nada quebra para quem estiver com a tela em cache).
- Sem migração e sem variável nova.

## 1.26.0 — Ficha gratuita do veículo (chassi, FIPE por ano e mês, financiamento, ficha técnica)

- A consulta gratuita por placa agora mostra identificação e características completas, com chassi e número do motor sem máscara, e uma ficha com: decodificador do chassi (fabricante, chave do chassi, ano pelo chassi, região, país, motor, portas, câmbio), Tabela FIPE com valor atual, valor por ano (variação real sobre o ano anterior) e histórico dos últimos 24 meses (% sobre o mês anterior e no período), "Financie" (entrada de 20% + 48 parcelas, simulação estimada com as taxas do painel) e ficha técnica do nosso guia de veículos.
- Ficha técnica só aparece quando o modelo existe no guia (com a versão do mesmo ano ou o modelo aproximado, indicado); nunca é gerada por palpite. Campos sem fonte ficam de fora.
- A mesma ficha vem em todas as consultas pagas de placa (Básica, Cadastral, Completa e Premium), na tela, no PDF e na API (`report.sheet`). Gravame e Leilão seguem enxutos. A ficha é montada na hora da consulta, sem nenhuma chamada paga extra ao fornecedor de dados, e fica guardada com a consulta.
- Consultas antigas desses produtos recebem a ficha uma vez ao serem abertas (usa só dados públicos e o dado já guardado).
- PDF da consulta gratuita agora tem várias páginas quando precisa; corrigido o valor máximo da faixa de negociação na versão para impressão, que saía sem formatação em reais.
- Sem migração e sem variável nova.

## 1.25.0 — Perfis de uso: cliente, lojista e afiliado

- Cada conta tem perfil de uso: Cliente (todos), Lojista (quem participa de uma loja ativa) e Afiliado (quem ativou o Indique e ganhe). Troca pelo seletor no menu lateral ou em Minha conta.
- Menu e página inicial por perfil. Cliente vê só o essencial para consultar; lojista ganha Minha loja, Em lote, Meus veículos e comparar consultas; afiliado cai direto no painel de indicações.
- O servidor só aceita trocar para um perfil que a conta realmente tem. Loja suspensa ou link desativado devolve a conta para Cliente. Troca fica na auditoria (`PROFILE_SWITCHED`).
- Migração 058: coluna do perfil escolhido e mapeamento das contas existentes (quem já estava em uma loja vira Lojista; o resto, Cliente).
- Sem variável nova.

## 1.24.0 — Nota fiscal automática (NFS-e padrão nacional)

- Emissão automática de nota fiscal de serviço pelo Focus NFe: cada pagamento confirmado gera a nota, o emissor autoriza e o cliente recebe o e-mail com o link seguro. Referência única por nota (reenviar nunca duplica), tentativas com atraso, recusa com motivo e acompanhamento até autorizar.
- Só pagamentos dos últimos 3 dias entram sozinhos; documentos criados pela equipe não são emitidos automaticamente; clientes sem CPF/CNPJ ou endereço ficam pendentes no painel.
- Tela Notas fiscais: estado da emissão (ligada, ambiente de teste ou produção, o que falta preencher, notas com problema) e botão "Emitir pendentes agora".
- Novas variáveis: `FISCAL_PROVIDER=focusnfe`, `FOCUSNFE_TOKEN`, `FOCUSNFE_TOKEN_HOMOLOGACAO`, `FOCUSNFE_BASE_URL`, `FOCUSNFE_NBS`, `FOCUSNFE_IBSCBS_CST`, `FOCUSNFE_IBSCBS_CLASS_TRIB`, `FISCAL_AUTO_EMIT` (padrão desligada). Sem migração.

## 1.23.0 — Monitoramento de placa, meus veículos, dossiê em PDF e resultados da equipe

- Monitoramento de placa (`/app/monitoramento`): escolhe placa, tipo de consulta e intervalo (7, 15 ou 30 dias). Cada verificação é uma consulta normal, cobrada do saldo, e é comparada com a anterior. Se algo piorar (gravame, restrição, leilão, sinistro, roubo ou furto, chassi, recall ou débitos) chega um e-mail. Sem saldo ou após três falhas seguidas, pausa e avisa. Histórico de cada verificação na tela. Máximo de 20 por pessoa e uma verificação cobrada por dia por monitoramento.
- Meus veículos (`/app/veiculos`): uma linha por placa já consultada, com situação, alertas, débitos, risco de revenda, busca, filtros e exportação em planilha.
- Dossiê em PDF: reúne os relatórios que a pessoa já fez da placa (até 6) com uma capa de resumo. Cada relatório mantém o código de validação. Sem nova cobrança. Botão em Meus veículos e na consulta.
- Resultados no painel da equipe (`/resultados`): consultas, receita, ticket médio, falhas e estornos por período, por produto, por dia, forma de pagamento e clientes que mais consultaram, mais consultas internas e monitoramentos. Exportação por produto.
- Menu do cliente ganhou "Meus veículos" e "Monitoramento".
- Migração 057 (tabelas `plate_watches` e `plate_watch_events`). Nova variável: `PLATE_WATCH_ENABLED` (padrão ligada).

## 1.22.0 — Consulta interna salva, visível e pronta para entregar ao cliente

- Correção: a consulta feita pelo painel (Consultas → Consulta interna) não ficava guardada; só aparecia na tela naquele momento. Agora é salva como consulta de verdade, com origem "Interna", sem valor e sem cobrança.
- Cada consulta interna tem relatório do pacote, PDF, impressão e código de validação (o PDF antes saía com o código "INTERNA"; agora traz o código real, que confere em `/validar`). O dado bruto fica cifrado, como nas demais.
- Lista de Consultas: nova coluna de origem ("Interna" ou "Enviada ao cliente") e filtro de origem (internas ou feitas pelos clientes). O filtro de tipo de cliente também passou a funcionar junto com os outros.
- Enviar ao cliente: informa o e-mail de um cliente; a consulta entra no histórico dele, com relatório e PDF, sem cobrança e sem nova chamada ao fornecedor, e ele recebe um aviso por e-mail (com mensagem opcional). Reenviar não duplica.
- Gerar link: link de visualização para quem não tem conta (1 a 15 dias, até 100 acessos, até 10 ativos), com copiar, WhatsApp, lista e revogação. Disponível na consulta salva e logo após a consulta interna.
- Se o salvamento falhar, a tela avisa e ainda entrega o resultado e o PDF.
- Auditoria: `ADMIN_LOOKUP` aponta para a consulta salva; `ADMIN_QUERY_SENT` registra o envio.
- Sem migração nova e sem variável nova.

## 1.21.0 — Consulta em lote e comparação de consultas

- Consulta em lote (`/app/lote`): cola até 30 placas, escolhe o tipo de consulta e roda tudo com o saldo da conta. Cada placa é uma consulta normal, com a mesma cobrança, estorno e relatório, e chave de idempotência (repetir não cobra de novo). Mostra o total antes, ignora repetidas, marca inválidas e para sozinha se o saldo acabar. Resultado em tabela (veredito, débitos, gravame, leilão) e planilha CSV pronta para Excel.
- Comparar consultas (`/app/comparar-consultas`): duas consultas já feitas lado a lado, com destaque do que difere. Também pelo botão "Comparar com outra" na consulta. Sem cobrança.
- Atalhos "Em lote" e "Comparar" na lista de Consultas.
- Sem migração nova e sem variável nova.

## 1.20.1 — Dados do veículo e do proprietário sempre completos

- Fim de qualquer máscara nos dados do veículo e do proprietário: nome, CPF/CNPJ, placa, chassi, RENAVAM e motor aparecem inteiros na tela, no PDF, na impressão, na visão da equipe e no link enviado ao comprador.
- O link "Enviar ao comprador" agora mostra o mesmo relatório do cliente, completo, inclusive proprietário e histórico de proprietários.
- Removida a opção `REPORT_SHOW_OWNER_IDENTITY` (não é mais lida; pode apagar da configuração). Relatórios antigos que ainda estiverem mascarados são refeitos em claro ao abrir.
- A lista "Antes de pagar" só cita as verificações que o pacote cobre; o que está fora do pacote não é nomeado.
- Textos do site ajustados: a página inicial e a pergunta de privacidade das perguntas frequentes não prometem mais dados mascarados. Migração 056 troca o texto da pergunta só se ainda for o original (resposta editada no painel não é mexida).

## 1.20.0 — Parecer de revenda, link para o comprador, conferência de anúncio e avisos da garagem

- Parecer de revenda e seguro no relatório (tela, PDF e impressão): risco baixo, moderado ou alto de recusa por seguradoras e compradores, com os motivos. Só aparece quando o pacote traz leilão ou sinistro. É indicativo, calculado só com as informações da consulta.
- "Antes de pagar": lista do que a consulta verificou (débitos, restrição judicial, gravame, administrativas, roubo e furto, leilão, sinistro, chassi, recall), cada item como OK, atenção, alerta ou não consultado, e seis confirmações que só a pessoa faz pessoalmente. O que não foi consultado no pacote nunca aparece como OK.
- Enviar ao comprador: na consulta, o cliente cria um link temporário (1, 3, 7 ou 15 dias, até 100 acessos, até 5 ativos por consulta) e envia por WhatsApp ou copia. Quem recebe vê o relatório do pacote e baixa o PDF (na 1.20.1 passou a mostrar tudo, sem máscara). Dá para ver quantas vezes abriram e cancelar o link. A página pública fica em `/r/...`, não é indexada e não consulta o fornecedor nem cobra. Migração 054.
- Conferir anúncio: o comprador informa preço, modelo, cor e ano do anúncio e o sistema compara com o registro e com a FIPE da consulta. Preço muito abaixo da FIPE e divergência de modelo, cor ou ano viram alerta. Sem FIPE ou sem dado no registro, avisa que não dá para comparar.
- Garagem com avisos por e-mail: um e-mail quando um lembrete está a 7 dias (ou 500 km) de vencer e outro quando vence, em resumo único por pessoa, uma vez por etapa. Cada pessoa liga ou desliga na própria garagem. Se mudar o prazo, o aviso volta a valer. Migração 055. Desligar para todos: `GARAGE_ALERTS_ENABLED=false` (padrão: ligado).
- Documento completo do sistema em `docs/SISTEMA.md`: missão, todas as telas e funções, como a consulta funciona, segurança, rotinas e o que ainda não existe.
- `/r/` incluído nas rotas conhecidas e bloqueado para buscadores.
- Nova variável: `GARAGE_ALERTS_ENABLED`.

## 1.19.8 — Gravame completo também na Completa, e fim dos alertas falsos de "não apresentado"

- Completa e Premium: o `/gravame` agora é consultado sempre que a base principal não trouxe dados, não afirmou "sem gravame" ou indicou alienação sem banco, CNPJ, contrato e data de inclusão. Antes só consultava quando a base principal vinha vazia, e por isso a alienação aparecia sem o nome do banco.
- Consultas já feitas: ao abrir o relatório de uma consulta Completa, Premium ou Gravame que acusa alienação sem os detalhes, o sistema busca o `/gravame` uma única vez e refaz o relatório (banco, CNPJ, contrato, datas, UF e histórico). Se a fonte falhar, o relatório abre como estava e a nova tentativa só ocorre depois de 30 minutos. Desligar: `CREDIFY_GRAVAME_BACKFILL=false` (padrão: ligado). O botão "Atualizar gravames" do painel continua para fazer em lote.
- Corrigido alerta falso: quando a fonte escreve "veículo não apresentado na base de leilão / roubo e furto" ou "não possui recall pendente" com código de sucesso, o relatório mostra nada consta, e não ocorrência. Isso derrubava o veredito para risco alto sem motivo.
- "Sem informação" e "não informado" deixam de ser lidos como "nada consta".
- FIPE automática na Completa e Premium: quando a base principal não traz o valor FIPE, o sistema localiza o veículo na Tabela FIPE pelo cadastro (marca, modelo, ano e motor) e preenche valor, código, modelo e mês de referência, com o aviso "localizado pelo modelo, ano e motor; confira a versão". Só usa quando a correspondência é única; se houver mais de uma versão possível, não mostra valor em vez de chutar. O valor que vem do provedor sempre tem prioridade.
- Projeção da FIPE: com o código FIPE, o relatório mostra variação em 12 e 24 meses, a série dos últimos meses e a projeção de valor para os próximos 6 meses (estimativa, rotulada como tal). O tempo máximo da busca ao concluir a consulta subiu de 4 s para 12 s.
- Consultas Completa/Premium antigas sem FIPE ganham valor e projeção ao serem abertas, uma única vez (Tabela FIPE pública, sem custo no provedor). Falha ou demora não impede a abertura; nova tentativa só depois de 30 minutos.

## 1.19.7 — Gravame e Leilão com consulta própria, tabelas claras e PDF na consulta interna

- Consulta interna do painel: agora mostra o relatório do pacote (o mesmo que o cliente veria) e tem os botões Visualizar PDF e Baixar PDF. O JSON ficou recolhido em "Dados técnicos". O PDF sai da própria resposta, sem consultar a Credify de novo. Na página da consulta também há Visualizar PDF e Baixar PDF.
- Pacote Gravame: além de Débitos e Restrições, chama sempre o `/gravame` (533) da Credify. Se essa consulta ficar indisponível, a consulta falha e o cliente é estornado, em vez de entregar relatório sem o gravame.
- Gravame em tabela: quem financiou (banco, CNPJ, código do agente), contrato (número, início, UF), registro do gravame (número, UF, data e tempo), situação e outras informações. Gravames atuais e baixados (histórico) aparecem juntos, cada um marcado.
- Pacote Leilão: passa a usar Débitos e Restrições e chama sempre o `/leilaoconjugado` (448). Mostra "Participação em leilão" e a tabela de registros (data, leilão, lote, leiloeiro, comitente, pátio, condição e situação). "Veículo não apresentado na base de leilão" aparece como nada consta; fonte fora do ar derruba a consulta com estorno. Dados de pessoas (CPF/CNPJ de comitente) não entram.
- Tabelas de registros também no PDF, na impressão e na tela (no celular viram cartões). Os detalhes de leilão da Completa também saem em tabela.
- Produtos sem a seção de débitos (Gravame, Leilão, Cadastral) não mostram mais "Débitos: nada consta" nem "Resumo de débitos", porque débitos não foram consultados.
- Situação do chassi "N" é lida como Normal; "Existe erro: 0" não aparece mais como alerta no controle interno.
- Consultas antigas ganham o gravame detalhado: na lista de Consultas do painel, o botão "Atualizar gravames" mostra quantas consultas precisam e atualiza até 25 por vez; na página de cada consulta há "Atualizar gravame". Busca o `/gravame` da Credify, guarda a resposta junto do dado bruto cifrado e refaz o relatório (banco, CNPJ, contrato, datas, UF e histórico). Não repete quando a consulta já tem o gravame, e se a fonte falhar nada é alterado. Cada atualização faz uma chamada paga; não cobra o cliente.
- Removidos do código, dos comentários e do changelog quaisquer valores do contrato com a fornecedora. Preços do contrato não devem aparecer em nenhum lugar do sistema.
- Sem variáveis novas e sem migração.

## 1.19.6 — Relatório completo na tela, PDF sem mascaramento e cadastro completo do cliente

- O relatório abre inteiro na tela (aba "Relatório completo", com todas as seções abertas) e também em Resumo e Seções. No histórico do cliente há Visualizar PDF, Baixar PDF, Imprimir e Link de validação; a consulta fica salva em "Minhas consultas".
- Placa, chassi, RENAVAM, motor, câmbio, carroceria e eixos aparecem completos na tela, no PDF e na impressão. O número do contrato de financiamento (gravame) também.
- Nova seção "Histórico de proprietários" com um proprietário por linha (atual e anteriores, ano, município/UF). Nome e CPF/CNPJ de proprietários (pessoa física e jurídica), do comprador, do arrendatário e da financeira saem completos, sem máscara, na tela, no PDF e na impressão, para uso em crédito e comércio de veículos. Para voltar a proteger pessoa física: `REPORT_SHOW_OWNER_IDENTITY=false`.
- O PDF ganhou o bloco "Considerações importantes" e itens de várias linhas em largura total.
- Cadastro completo: ao criar a conta o cliente informa nome completo, telefone, CPF ou CNPJ (CNPJ e empresa para conta de empresa) e endereço, e aceita o termo de responsabilidade pelas informações consultadas (data e versão gravadas). Sem isso não consulta nem paga; contas antigas completam uma vez em Minha conta e voltam para a consulta. Desligar: `CUSTOMER_PROFILE_REQUIRED=false`.
- Política de Privacidade e página institucional atualizadas para refletir o que o relatório mostra.
- A consulta Completa passa a incluir a seção de proprietário no relatório do cliente (migração `053_complete_owner_section`); os modelos de relatório do painel também podem usar os campos de proprietário.
- Gravame completo: nova leitura direta "Alienação fiduciária / gravame" com banco/financeira, CNPJ, número do contrato, número da restrição, data de inclusão e tempo de gravame ("há X anos e Y meses"), mais o prazo restante do contrato quando a fonte informa a vigência. Quando a base de gravame do Veículo Total vem vazia na Completa, o sistema consulta também o `/gravame` da Credify (uma chamada a mais, só nesse caso; `CREDIFY_GRAVAME_SUPPLEMENT=false` desliga). Se nenhuma base responder, o relatório diz "não informado", nunca "nada consta". Saldo devedor, valor financiado e parcelas não existem em nenhuma consulta da Credify e o relatório avisa isso.
- Novo PDF no padrão de consulta veicular, em preto, cinza e branco (sem verde, azul ou cores por status): cabeçalho com código, data/hora, página e QR de validação em todas as páginas; faixa com modelo e placa; selos de Débitos, Restrições, Alienação/gravame, Busca e apreensão, Indício de sinistro, Roubo/furto, Leilão e Recall (nada consta / consta / não informado); seções em duas colunas e tabelas por linha. A impressão e a tela do relatório seguem o mesmo padrão neutro.
- Novo item "Busca e apreensão" em Restrições: a fonte não tem campo próprio, então o sistema procura o texto nas restrições e no gravame; achou, mostra a ocorrência (risco alto); não achou com restrições retornadas, "nada consta"; sem restrições retornadas, "não informado".
- Restrição judicial com detalhe (Renajud): na Completa, quando o Veículo Total acusa restrição judicial/Renajud ou vem sem a base de restrições, o sistema consulta também o `/renajud` da Credify (uma chamada a mais só nesse caso) e mostra tipo, tribunal, órgão, número do processo e data de cada restrição, inclusive busca e apreensão. `CREDIFY_JUDICIAL_SUPPLEMENT=false` desliga. Corrigidos os códigos de consulta conforme a proposta da Credify (RenavamOnLine = 371) e cadastrados Renajud (483), Histórico de proprietários (458), Roubo/furto (456), Recall (452) e FIPE (454).
- Mais campos da base nacional do Veículo Total: Restrição 01 a 04, data limite da restrição, situação do chassi, tipo de montagem, número de lugares, última atualização do cadastro e dados de importação (DI, data, unidade da Receita e importador), quando a fonte informa.
- Consultas antigas são atualizadas sozinhas: o relatório guardado de versões anteriores é refeito a partir do dado bruto cifrado (campos novos de gravame, busca e apreensão, débitos e restrições), ao iniciar o servidor e uma única vez. Consulta sem dado bruto guardado ou que a fonte não devolveu gravame precisa de nova consulta.
- Relatórios já gravados com máscara são refeitos em claro, uma vez, na subida do servidor, a partir do dado bruto cifrado da fonte (quando guardado). Quem não tem bruto guardado continua como estava.
- Migrações `052_customer_responsibility` e `053_complete_owner_section`. 

## 1.19.5 — Sem consulta repetida e motivo claro quando a Credify recusa

- A mesma placa e pacote do mesmo cliente não entra de novo enquanto a consulta anterior ainda processa (resposta 409, sem cobrar duas vezes).
- A consulta interna do painel só roda uma vez por placa e pacote por vez; clique duplo ou duas abas não geram duas consultas pagas.
- Teto de segurança de consultas pagas por hora e por dia (`CREDIFY_MAX_QUERIES_PER_HOUR` e `CREDIFY_MAX_QUERIES_PER_DAY`); ao atingir, a Credify não é chamada.
- Quando a Credify responde 200 mas o sistema recusa a resposta, o motivo (blocos e códigos, sem dados de pessoas) aparece no log, na auditoria e na mensagem da consulta interna, em vez do aviso genérico.
- Sem repetição automática de consulta paga em tempo esgotado ou erro 5xx.
- Consulta Completa: quando a base BDRP volta sem dados (código 2) mas a base nacional traz o veículo, a consulta é aceita e o relatório sai com a base nacional, sinistro, roubo/furto, leilão, proprietários e FIPE. Antes a resposta inteira era recusada e estornada.
- Pagamento da consulta avulsa abre em outra aba; a tela original confirma o pagamento sozinha, segue para a consulta e fecha a aba do Mercado Pago. Se o navegador bloquear a nova aba, abre na mesma aba como antes.
- O botão "Tentar novamente" some enquanto a consulta ainda está processando, para não gerar consulta repetida.

## 1.19.4 — Validação de autenticação antes da consulta

- Toda consulta Credify faz um preflight de autenticação imediatamente antes da cobrança: o sistema solicita e valida um JWT novo, confirma a validade e somente então debita e envia o `IdConsulta`/placa.
- Falha de `ClientID`, `ClientSecret`, IP autorizado ou login retorna erro específico sem débito; a consulta não fica em `PROCESSING` por falha de autenticação.
- O fluxo mantém `Authorization: Bearer`, o `IdConsulta` por endpoint e o retry já existente para resposta 401 durante a chamada.

## 1.19.3 — Consulta Credify: reuso do token e recuperação após reinício

- O JWT da Credify passa a ser reutilizado conforme a validade real documentada; a renovação ocorre quando falta menos de uma hora, reduzindo logins desnecessários e a janela de falha da consulta.
- O keeper de token continua emitindo `credify_token_ready`, mas não força novo login a cada 30 minutos quando o token ainda está válido.
- Na subida da API, consultas antigas em `PROCESSING` são estornadas pelo mesmo varredor idempotente que roda a cada dois minutos, evitando consultas órfãs indefinidamente.
- Não foram alterados endpoints, códigos `IdConsulta`, dependências ou o fallback de cabeçalho existente.

## 1.19.2 — Consulta que não volta: tempo, erro real e visibilidade

- A Credify tem códigos de recusa que valem para qualquer consulta (14 limite de consultas simultâneas/diárias, 15 limite mensal, 16/17 limite de valor, 18 sem saldo, 19 CPF excluído pela LGPD). Antes caíam em "resposta inválida"; agora viram erro próprio, com o código e a mensagem da Credify, e a consulta é estornada.
- Tempo máximo da chamada à Credify subiu para 170 s (`VEHICLE_API_TIMEOUT_MS`) e o da consulta inteira para 175 s (`QUERY_REQUEST_TIMEOUT_MS`); o teto configurável passou a 300 s. A consulta Veículo Total junta várias bases e pode demorar mais que os 100 s antigos.
- Cada consulta guarda quanto tempo levou (fonte, FIPE, tratamento e os segundos informados pela própria Credify) e, se falhar, depois de quanto tempo falhou.
- Nova tabela "Últimas consultas de clientes" em Admin → Integrações: placa, pacote, situação, tempo e o motivo exato da falha. Sem dados pessoais.

## 1.19.1 — Débito duplicado no relatório

- Quando a fonte devolve o mesmo valor em "Débitos municipais" e em "Total de multas", o valor passa a contar uma vez só: o resumo de débitos, o total em aberto, o PDF, a impressão e a tela mostram o montante correto (ex.: licenciamento R$ 126,24 + multas R$ 3.729,93 = R$ 3.856,17, e não R$ 7.586,10).
- O log agora mostra `credify_token_ready` a cada login com sucesso (na subida e a cada 30 min), para conferir o token logo depois do deploy.
- A correção vale também para relatórios já salvos, na hora de exibir. Valores diferentes continuam somando normalmente.

## 1.19.0 — Pronto para teste de produção

- Consulta sem dados (`CODIGO=2`) em qualquer pacote da Credify passa a ser "placa sem dados" (estorna e avisa o cliente), não falha técnica.
- `/ready` compara a lista exata de migrações e mostra quais faltam; uma migração extra não compensa a que falta.
- Pedidos abertos há mais de 3 dias viram `EXPIRED` automaticamente e a reserva do cupom é liberada (pagamento que chegar depois ainda é creditado).
- Clique duplo / duas abas no checkout não criam dois pagamentos: enquanto o anterior está sendo preparado (até 45 s) responde `CHECKOUT_IN_PROGRESS`.
- No painel, "Testar consulta real" pede confirmação antes de gastar uma consulta da Credify.
- Backup e restauração: `scripts/backup-db.sh`, `scripts/restore-db.sh` e `docs/BACKUP.md`.
- Dependência `qs` 6.17.1 (corrige aviso de segurança). Nodemailer 10.3.1 foi testado e quebrou o envio por SMTP nos testes, por isso ficou em 10.0.9; Zod fica para outra etapa (troca de versão maior).
- Novo `docs/TESTE-PRODUCAO.md`: roteiro de 30 minutos para validar o deploy.

## 1.18.4 — Correções da auditoria externa que cabem sem risco

- Pagamento que chega **depois** de um estorno/chargeback não reabre o pedido nem devolve saldo ou direito de consulta: o evento fica marcado `LATE_PAID_AFTER_TERMINAL_ORDER` para revisão. (Pedido vencido ou com falha continua creditando se o cliente pagou.)
- Consulta paga com estorno **solicitado ou confirmado** não pode mais ser usada (`QUERY_PAYMENT_REFUND_PENDING`).
- PDF e impressão da cotação FIPE só abrem para a conta dona do documento; resposta sem cache. Quem está logado salva a cotação antes de baixar o PDF.
- Comissão de afiliado configurada em 0 passa a valer 0 (antes caía no padrão).
- Falhas silenciosas do módulo fiscal agora vão para o log (`fiscal_delivery_failed`, `fiscal_worker_failed`); falha no rollback do banco não esconde o erro original.
- Teste do assistente de suporte não deixa mais um servidor aberto quando não há banco de teste.
- Não adotado de propósito: login da Credify continua renovado a cada 3 min; 2FA da equipe continua opcional (ligar com `TEAM_TOTP_REQUIRED=true`).

## 1.18.3 — Consulta mais rápida do nosso lado e tempo de cada etapa no log

- Ao abrir "Nova consulta" o sistema deixa o login da Credify pronto (`POST /api/queries/warm`), então a consulta não perde tempo entrando.
- Depois de pedir a consulta, a tela vai direto ao relatório; o saldo atualiza em segundo plano. O relatório e o resumo carregam juntos, e a tela de "em processamento" confere a cada 2 s.
- O log `query_completed` passa a trazer o tempo de cada etapa: `providerMs` (Credify), `enrichMs` (histórico da FIPE), `normalizeMs` e `saveMs`.
- A gravação do registro de auditoria roda junto com a leitura do resultado.
- O tempo da própria Credify (Veículo Total) continua sendo o maior trecho e depende dela.

## 1.18.2 — Login da Credify sempre fresco e com recuperação automática

- Cada consulta usa um token com no máximo 3 minutos de vida (login novo se for mais velho), igual ao que o teste do painel faz. Antes o cliente usava o token guardado no servidor, que podia estar recusado pela Credify.
- Login com falha de rede ou erro 5xx é repetido até 3 vezes. Se o login estiver fora do ar e ainda houver um token dentro da validade, a consulta segue com ele.
- Token recusado dentro de uma resposta 200 ("token expirado") faz novo login e repete a consulta uma vez. Consulta sem resposta descarta o token, e a próxima começa com login novo.
- O ciclo de renovação (a cada 30 min) agora faz login sempre e registra no log o sucesso ou o erro (`credify_login_failed`).
- Painel > Integrações: o teste mostra o estado do token. Seis testes novos em `credify-provider.test.mjs`.

## 1.18.1 — Consulta lenta da fonte de dados passa a rodar em segundo plano

- A consulta espera a Credify até 20 s (`QUERY_SYNC_WAIT_MS`). Se a fonte demorar mais, a tela vai para o relatório, que mostra "em processamento" e se atualiza sozinho a cada 3 s. O servidor continua a consulta e, no fim, grava o resultado ou estorna. Antes, o limite de 50 s encerrava a consulta com "a fonte de dados demorou para responder".
- Tempo limite da fonte subiu para 100 s (`VEHICLE_API_TIMEOUT_MS`) e o da consulta para 105 s (`QUERY_REQUEST_TIMEOUT_MS`). A espera do histórico da FIPE caiu de 8 s para 4 s.
- O log passa a registrar o tempo de cada chamada à Credify (`credify_call`, com caminho, status e ms) e a falha de rede com o motivo. A mensagem de timeout no painel diz qual consulta e quantos segundos.
- Painel > Integrações: o teste com placa mostra em quantos segundos a Credify respondeu.
- Teste novo: `query-background.test.mjs`.

## 1.18.0 — H1 por página (até 30 caracteres) e SEO pronto em todas as páginas

- Novo campo **H1** em cada página, no painel (SEO e Google). Limite recomendado de 30 caracteres, com contador e item na lista de verificação (inclui "palavra-chave no H1").
- O H1 configurado aparece no site (cabeçalho da página) e no HTML inicial que o Google lê. Na página inicial o H1 fica curto e a frase de efeito vira o subtítulo. O título da aba também segue o configurado.
- A página de contato passou a ter H1 (antes só tinha um título de seção).
- Conteúdo pronto para as 29 páginas do sitemap: H1, título (30 a 65), descrição (70 a 165), palavra-chave e perguntas frequentes onde a página exibe esse bloco. Todas saem com nota máxima na lista de verificação, sem títulos ou H1 repetidos.
- Editor com tabela "Como preencher cada campo" (tamanho ideal, regra e exemplo). Guia completo e tabela de todas as páginas em `docs/SEO-GUIA.md`.
- Migração `051_seo_h1`: cria a coluna e preenche. Páginas que alguém editou pelo painel não são sobrescritas.
- Testes: `seo-pages.test.mjs` cobre H1, unicidade, limite de 30 e nota máxima de fábrica.

## 1.17.0 — SEO por página pronto e editável no painel

- Nova tela "SEO e Google" no painel: título, descrição, palavra-chave, textos e perguntas frequentes de cada página, com prévia de como aparece no Google e lista de verificação (como num plugin de SEO). Dá para tirar uma página do Google e restaurar o texto padrão.
- Conteúdo de fábrica para as buscas principais: Tabela FIPE, simulador de financiamento (geral, carro, moto, caminhão e utilitário), etanol ou gasolina, comparador, consulta de placa e veicular, gravame, débitos, multas, sinistro, leilão, recall, histórico e preços. Cada página traz textos e de 3 a 7 perguntas frequentes, também exibidos na tela.
- O HTML inicial de cada página já leva título, descrição, textos, perguntas frequentes e dados estruturados (FAQ, aplicativo, trilha de navegação). Sitemap com data de atualização e sem as páginas marcadas como fora do Google.
- Migração `050_seo_pages`. Testes novos: `seo-pages.test.mjs`. Guia em `docs/SEO-GUIA.md`.

## 1.16.0 — Chat de suporte com assistente "Renata", painel de atendimento e relato de problemas

- Botão de chat no canto da tela, no site e no app instalado (PWA). Visitante conversa com a assistente sem criar conta; quem está logado tem a conversa salva e pode chamar uma pessoa a qualquer momento.
- Assistente "Renata" (o nome muda em `SUPPORT_ASSISTANT_NAME`): responde preço e conteúdo de cada consulta pelo catálogo vivo, FIPE, simulador, pagamento, prazo, instalação do app e contato; usa as perguntas frequentes publicadas; vê saldo, pagamento pendente e status das consultas da própria conta; assunto sensível (reembolso, cobrança, LGPD, fraude) vai direto para uma pessoa. É honesta sobre o que ainda não existe (km e fotos).
- IA opcional (`SUPPORT_LLM_PROVIDER` = `anthropic` ou `openai`, com chave): responde o que as regras não cobrem, só com o catálogo e as perguntas frequentes como base, sem prometer reembolso e passando para uma pessoa quando não souber. Sem chave ou se a IA falhar, o chat segue só com as regras.
- Problemas do sistema: consulta travada ou com falha vira relato automático para a equipe técnica; erros de tela do navegador são enviados sem dados pessoais (e-mail, placa e parâmetros da URL são removidos), agrupados por repetição; tela de erro amigável com botão de recarregar.
- Painel (Suporte): abas Visão geral (fila, conversas da semana, assuntos, problemas que mais se repetem), Problemas (analisar, resolver, ignorar), Respostas prontas (11 modelos iniciais, criar, editar, desativar, apagar) e seletor "Resposta pronta…" dentro do atendimento.
- Migração `049_support_assistant`. Testes novos: `support-assistant.test.mjs`. Comparativo com Olho no Carro e MTX em `docs/COMPARATIVO-CONCORRENTES.md`.

## 1.15.0 — Home de alta conversão: cards, pop-up, pacotes, simulador e SEO

- Cards de consulta maiores e alinhados, só com os 4 itens principais; botões "Consultar agora", "Ver detalhes" e "Ver modelo do PDF".
- "Ver detalhes" abre pop-up organizado (por seção, com preço e descrição); aba "Comparar" mostra o que cada consulta cobre por seção.
- Home na ordem: topo, consultas, pacotes de saldo, "Conheça os nossos pacotes personalizados" (lojistas e empresas), simulador, como funciona, guia de veículos.
- Simulador da home: atalhos por tipo de veículo, valores rápidos, escolha do modelo pela FIPE e comparação com leasing.
- SEO da home: novo título e descrição, dados estruturados (Organization, WebSite com busca por placa, lista de consultas com preço, FAQ) e texto com as consultas e preços para o Google.
- Google: Analytics (GA4), tag do Google Ads com conversão de compra e verificação do Search Console/Bing, tudo por variável de ambiente (`GA_MEASUREMENT_ID`, `GOOGLE_ADS_ID`, `GOOGLE_ADS_PURCHASE_LABEL`, `GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION`). O script só carrega depois do aceite de cookies (aviso novo + "Preferências de cookies" no rodapé); a política de privacidade ganhou a seção de cookies.
- Eventos do funil espelhados no GA4 (busca de placa, FIPE, cadastro, checkout, compra), sempre sem placa, e-mail ou parâmetros na URL.
- SEO das ferramentas: dados estruturados de aplicativo (FIPE, simuladores, combustível, comparador) e trilha de navegação (BreadcrumbList) nas páginas internas.
- Teste novo: `seo-google.test.mjs`.

## 1.14.0 — Modelo do PDF e detalhamento de cada consulta, home nova

- Modelo do PDF de cada consulta, com dados fictícios e marca d'água (`/api/catalog/:id/modelo.pdf`, público). Mostra exatamente as seções que o cliente recebe naquele produto.
- Novo "Detalhar": lista item a item o que vem em cada consulta e compara todas numa tabela (`/api/catalog/details`). Aparece na home, nos cartões de consulta e na tela de nova consulta, junto com "Ver modelo do PDF".
- Home: seção de consultas logo depois do topo; topo redesenhado (limpo, com prévia do relatório no lugar da foto do carro).
- Teste novo: `catalog-sample.test.mjs`.

## 1.13.0 — Menu por tipo de cliente, painel enxuto e PDF mais limpo

- Menu da área do cliente: "Minha loja" só aparece para quem tem loja liberada (pacote lojista). O cliente particular vê Painel, Consultas, Simulações, Minha garagem, Carteira, Indique e ganhe, Suporte e Minha conta. `/me` passa a devolver `storeAccess`.
- "Parceiro" virou "Indique e ganhe" (link para compartilhar e comissão).
- Minha loja sem pacote mostra a explicação do pacote lojista e leva ao suporte; novo item "Campanhas" na loja (acesso criado, módulo em breve).
- Painel e histórico mais enxutos: uma linha por consulta; estornadas e falhas saem da lista principal e ficam só nos filtros.
- Letras mais leves (Inter 300/400, títulos em peso normal).
- Migração 048: nome, descrição e itens de cada pacote (Completa, Básica, Gravame, Cadastral, Leilão) alinhados ao que o relatório entrega.
- PDF: seções sem dados saem do relatório (uma linha no fim avisa), histórico da FIPE vira gráfico e tabela, data de emplacamento em dd/mm/aaaa, medidas zeradas (eixos, carga, CMT, PBT) não aparecem mais.
- Novo `docs/CONSULTAS-CONTEUDO.md`: o que traz cada consulta.

## 1.12.17 — Teste de login da Credify mostra o que o servidor está usando

- Quando a Credify recusa o login (401), o teste em Admin > Integrações passa a mostrar o ClientID que o servidor está usando e só o tamanho do ClientSecret (e se é só número). A chave nunca aparece. Serve para achar erro de digitação ou ID trocado (ID da conta em vez do ID de logon).
- Lista de variáveis: `CREDIFY_QUERY_PATH`, `CREDIFY_QUERY_BODY_TEMPLATE` e `CREDIFY_QUERY_ID` não aparecem mais como "preenchida" quando estão vazias.

## 1.12.16 — Erro de credencial da Credify diz exatamente o que falta

- Quando o servidor não inicia por falta de `CREDIFY_CLIENT_ID` ou `CREDIFY_CLIENT_SECRET`, o log agora diz qual das duas falta (`FALTA_CREDIFY_CLIENT_ID` / `FALTA_CREDIFY_CLIENT_SECRET`) e lista os nomes das variáveis parecidas que chegaram ao servidor, com "preenchida" ou "vazia". Os valores nunca aparecem.
- Teste novo em `config-vehicle-provider`.

## 1.12.15 — FIPE histórica, decodificador de chassi e estimativas na Consulta Completa

- Novo bloco "Análises da Placa na Mão" na Consulta Completa: fabricante e país pelo chassi, ano do modelo pelo chassi (comparado ao registro), quilometragem de referência pela idade (faixa de 8 a 16 mil km por ano) e projeção simples do preço em 6 meses. Tudo rotulado como estimativa/cálculo, nunca como dado de órgão oficial. A quilometragem real não vem de nenhuma fonte ainda.
- FIPE: histórico mensal (até 24 meses), variação em 12 e 24 meses e série mensal, buscados na API da FIPE (`/{tipo}/{códigoFipe}/years/{ano}/history`) com o código FIPE que o Veículo Total devolve. Cache de 24 h por código/ano. Se a FIPE não responder, o relatório sai sem esses itens e a consulta segue (limite de 8 s).
- Novo `ENRICH_FIPE_HISTORY` (padrão ligado). `false` desliga a busca extra na FIPE.
- Migração 047: Consulta Completa passa a exibir a seção de análises e o texto do pacote cita histórico da FIPE e chassi. Limite de reversão de migrações subiu de 20 para 50.
- Testes: `enrichment.test.mjs` (7), `migration-rollback` (027–047).

## 1.12.14 — Cada pacote usa a consulta certa da Credify e o relatório traz mais detalhes

- Roteamento por pacote: Consulta Completa (e Leilão, quando ativar) consulta o Veículo Total (`/veiculototal`, código 467: sinistro, roubo/furto, leilão, recall, proprietários, FIPE, cadastro, débitos, restrições e gravame numa só chamada). Básica, Gravame e Cadastral consultam Débitos, Restrições e Proprietários (`/debitosrestricoesproprietarios`, código 487). O código (IdConsulta) e o corpo de cada consulta saem sozinhos.
- Para o roteamento valer, apague `CREDIFY_QUERY_PATH` no Coolify (com ela definida, todos os pacotes usam a mesma consulta, como antes). `CREDIFY_QUERY_BODY_TEMPLATE` e `CREDIFY_QUERY_ID` passam a ser ignoradas enquanto `CREDIFY_QUERY_PATH` não existir e podem ser apagadas.
- Corpo padrão (`Consulta.IdConsulta` + `Placa`) agora vale para todas as consultas por placa mapeadas, não só o Veículo Total.
- Relatório: detalhes do registro de leilão (data, leiloeiro, lote, condição), roubo/furto e recall (campanha, descrição) quando a fonte trouxer. Sem registro, o detalhe não aparece. Documentos de pessoas ficam de fora.
- Consulta Gravame passa a mostrar também os dados do veículo (características), como nos concorrentes. Textos da Consulta Completa e Gravame atualizados (migração 046).
- Consultas internas de apoio (guia do veículo, FIPE por placa) usam a consulta mais barata (Débitos e Restrições).
- Admin > Integrações: seletor de pacote no teste de consulta real; a resposta mostra qual consulta e código foram usados. A lista de variáveis mostra se `CREDIFY_QUERY_PATH` está atrapalhando o roteamento.
- Testes: roteamento por pacote, detalhes de ocorrência, `migration-rollback` (027–046).

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
- IdConsulta da Credify corrigido: não é um número livre por chamada, é o código fixo de cada consulta (a Credify respondia 400 "O IdConsulta não é válido para este EndPoint"). Códigos por endpoint (da documentação): Veículo Total 467, Débitos/Restrições/Proprietários 487, BNacional 369, Renavam 370, Agregados 486, Flag CNH 587, Renainf 536, Veículo por Documento 475, Indício de Sinistro 450, Leilão Conjugado 448, Gravame 533, Veículo Proprietário Placa 514, Veículo Documento Frota 510. Sem código na documentação (pedir à Credify): Recall, Farol Leilão, Precificador Fipe, Histórico Roubo e Furto, ATPVe, Renajud, Renavam Online, Histórico de Proprietários. Variável opcional `CREDIFY_QUERY_ID` para trocar o código. Erro 400 mostra o corpo devolvido pela Credify e o pedido enviado.
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

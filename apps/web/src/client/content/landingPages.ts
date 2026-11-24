/**
 * Páginas de venda de cada consulta (/consulta/<slug>).
 * Preço, selo e disponibilidade vêm do catálogo (painel); título, descrição, blocos e perguntas vêm do SEO (painel).
 * Aqui ficam só os textos de venda de cada página. Frases curtas, sem prometer o que a fonte não entrega.
 */
export interface Pain { t: string; s: string }
export interface LandingContent {
  slug: string;
  productId: string;
  path: string;
  short: string;
  kicker: string;
  h1: string;
  lead: string;
  points: string[];
  pains: Pain[];
  painsTitle: string;
  gets: string[];
  notGet: string[];
  forWho: string[];
  next: string[];
  nextLead: string;
  cta: string;
}

export const LANDINGS: LandingContent[] = [
  {
    slug: 'cadastral', productId: 'CADASTRAL', path: '/consulta/cadastral', short: 'Cadastral',
    kicker: 'Consulta Cadastral',
    h1: 'Consulta cadastral de placa',
    lead: 'Confira marca, modelo, ano, cor e dados de registro do veículo antes de ver o anúncio de perto. A forma mais barata de saber se o veículo é o que o vendedor diz.',
    points: ['Marca, modelo, ano e cor', 'Cilindrada, potência e passageiros', 'PDF com código de validação'],
    painsTitle: 'Antes de gastar tempo com a visita',
    pains: [
      { t: 'O anúncio não bate com o veículo', s: 'Ano, cor e versão mudam o preço. Veja o que está no registro.' },
      { t: 'Visita que não deu em nada', s: 'Confira os dados pela placa e só vá ver o que vale a viagem.' },
      { t: 'Dados técnicos à mão', s: 'Cilindrada, potência, combustível e passageiros num só lugar.' }
    ],
    gets: ['Marca, modelo e versão', 'Ano de fabricação e do modelo', 'Cor, combustível, categoria e espécie', 'Cilindrada, potência e número de passageiros', 'Município e UF de registro', 'PDF para guardar ou mostrar'],
    notGet: ['Débitos e multas', 'Restrições e bloqueios', 'Gravame (financiamento)', 'Leilão e sinistro'],
    forWho: ['Quem está pesquisando anúncios e quer filtrar rápido', 'Quem quer conferir marca, ano e cor antes da visita', 'Quem só precisa dos dados de registro'],
    next: ['gravame', 'completa'], nextLead: 'Vai fechar negócio? Veja também:',
    cta: 'Fazer a consulta cadastral'
  },
  {
    slug: 'gravame', productId: 'LIEN', path: '/consulta/gravame', short: 'Gravame',
    kicker: 'Consulta de Gravame',
    h1: 'Consulta de gravame por placa',
    lead: 'Descubra se o veículo está financiado antes de pagar. Com gravame ativo, a transferência fica travada até a baixa.',
    points: ['Se há financiamento registrado', 'Banco, contrato e data, quando a fonte informa', 'Dados cadastrais do veículo'],
    painsTitle: 'O risco de comprar um veículo financiado',
    pains: [
      { t: 'Transferência travada', s: 'Com o gravame ativo, o documento não passa para o seu nome sem a baixa.' },
      { t: 'Vendedor diz que está quitado', s: 'Confira pela placa antes de entregar o dinheiro.' },
      { t: 'Sabe com quem falar', s: 'Quando a fonte informa, aparecem o banco e o contrato para você pedir a baixa.' }
    ],
    gets: ['Se há gravame registrado no veículo', 'Banco ou agente financeiro, quando informado', 'Número do contrato e data de inclusão', 'Intenção de gravame', 'Dados cadastrais do veículo', 'PDF com código de validação'],
    notGet: ['Saldo devedor e parcelas em aberto', 'Débitos e multas', 'Restrições judiciais', 'Leilão e sinistro'],
    forWho: ['Quem vai comprar um usado de particular', 'Quem recebeu o veículo como parte do pagamento', 'Quem quer pedir a baixa na financeira com o contrato em mãos'],
    next: ['avancada', 'completa'], nextLead: 'Quer ver mais do que o financiamento?',
    cta: 'Consultar gravame'
  },
  {
    slug: 'leilao', productId: 'AUCTION', path: '/consulta/leilao', short: 'Leilão',
    kicker: 'Leilão e Dados do Veículo',
    h1: 'Consulta de leilão por placa',
    lead: 'Veja se o veículo passou por leilão e qual o risco para revenda e seguro. Um carro de leilão pode valer menos e ser mais difícil de segurar.',
    points: ['Passagem por leilão: data, leiloeiro e lote', 'Nível de risco de leilão', 'Aceitação em seguro e risco de revenda'],
    painsTitle: 'Leilão muda o preço do veículo',
    pains: [
      { t: 'Valor de revenda menor', s: 'Veículo com passagem por leilão costuma ser mais difícil de vender depois.' },
      { t: 'Seguro mais difícil', s: 'O relatório mostra a aceitação em seguro, para você não ser pego depois.' },
      { t: 'Argumento para negociar', s: 'Saber do leilão antes ajuda a pedir um preço justo.' }
    ],
    gets: ['Passagem por leilão: data, leiloeiro, lote e condição', 'Nível de risco de leilão', 'Aceitação em seguro e risco de revenda', 'Dados do veículo e cadastro da base nacional', 'Restrições do veículo', 'PDF com código de validação'],
    notGet: ['Débitos e multas detalhados', 'Gravame detalhado', 'Histórico de proprietários'],
    forWho: ['Quem desconfia de preço baixo demais', 'Quem vai comprar para revender', 'Quem quer segurar o veículo depois'],
    next: ['completa', 'avancada'], nextLead: 'Para olhar tudo de uma vez:',
    cta: 'Consultar leilão'
  },
  {
    slug: 'avancada', productId: 'BASIC', path: '/consulta/avancada', short: 'Avançada',
    kicker: 'Consulta Avançada',
    h1: 'Consulta veicular avançada',
    lead: 'Tudo da Completa, mais o detalhe que decide a negociação: gravame com banco e contrato, restrição judicial e multas infração por infração.',
    points: ['Tudo da Consulta Completa', 'Gravame e Renajud detalhados', 'Multas por infração'],
    painsTitle: 'Quando o resumo não basta',
    pains: [
      { t: 'Veículo financiado', s: 'Banco, contrato e datas do gravame, para pedir a baixa certa.' },
      { t: 'Bloqueio judicial', s: 'Renajud com tribunal, processo e data. Bloqueio ativo pode impedir a transferência.' },
      { t: 'Multas sem surpresa', s: 'Cada infração com descrição, vencimento e valor, para negociar o desconto.' }
    ],
    gets: ['Tudo da Consulta Completa', 'Gravame detalhado: banco, contrato, datas e alienação', 'Restrições judiciais (Renajud): tribunal, processo e data', 'Multas por infração, com descrição e valor', 'Risco de leilão e de seguro', 'PDF com código de validação'],
    notGet: ['Histórico de proprietários (está na Premium)'],
    forWho: ['Quem compra veículo financiado ou com bloqueio', 'Quem quer negociar multas e débitos com os números na mão', 'Lojistas que revendem com mais segurança'],
    next: ['premium', 'completa'], nextLead: 'Quer ver também quantos donos o veículo teve?',
    cta: 'Fazer a consulta avançada'
  },
  {
    slug: 'completa', productId: 'COMPLETE', path: '/consulta/completa', short: 'Completa',
    kicker: 'Consulta Completa · A mais vendida',
    h1: 'Consulta completa de veículo',
    lead: 'O relatório que a maioria das pessoas escolhe antes de comprar usado: débitos, multas, restrições, financiamento, sinistro, leilão, recall e FIPE em um só lugar.',
    points: ['Resumo em cores logo no topo', 'Débitos, multas, restrições e financiamento', 'Sinistro, leilão, recall e Tabela FIPE'],
    painsTitle: 'Uma consulta no lugar de dez',
    pains: [
      { t: 'Sem juntar informação solta', s: 'Tudo no mesmo relatório, sem abrir um site para cada assunto.' },
      { t: 'Leitura fácil', s: 'Um resumo em cores mostra o que merece atenção antes dos detalhes.' },
      { t: 'Preço justo na mão', s: 'Compare o valor do anúncio com a Tabela FIPE dentro do relatório.' }
    ],
    gets: ['Resumo em cores do que merece atenção', 'Dados do veículo, chassi, motor e características', 'Débitos: IPVA, licenciamento e DPVAT, e multas', 'Restrições, roubo e furto, e alienação', 'Indício de sinistro e passagem por leilão', 'Recall, inspeção e Tabela FIPE'],
    notGet: ['Gravame com banco e contrato detalhados (Avançada)', 'Restrição judicial detalhada (Avançada)', 'Histórico de proprietários (Premium)'],
    forWho: ['Quem vai comprar um usado e quer verificar o essencial', 'Quem vende e quer mostrar o relatório ao comprador', 'Quem quer uma consulta só, sem escolher várias'],
    next: ['avancada', 'premium'], nextLead: 'Precisa de mais detalhe?',
    cta: 'Fazer a consulta completa'
  },
  {
    slug: 'premium', productId: 'PREMIUM', path: '/consulta/premium', short: 'Premium',
    kicker: 'Consulta Premium · A mais completa',
    h1: 'Consulta veicular premium',
    lead: 'Tudo da Avançada e o histórico de proprietários. Para compras de maior valor e para quem revende e precisa conhecer o veículo por inteiro.',
    points: ['Tudo da Consulta Avançada', 'Histórico de proprietários', 'Para compras de maior valor'],
    painsTitle: 'Quanto maior o valor, menor a margem de erro',
    pains: [
      { t: 'Quantos donos já teve', s: 'Quantidade e linha do tempo de proprietários, quando a fonte informa.' },
      { t: 'Nada pela metade', s: 'Gravame, Renajud, multas, leilão, sinistro e FIPE no mesmo relatório.' },
      { t: 'Decisão com dados', s: 'Para pagar o preço certo e revender sem susto.' }
    ],
    gets: ['Tudo da Consulta Avançada', 'Histórico de proprietários: quantidade e linha do tempo', 'Gravame e restrições judiciais detalhados', 'Multas por infração', 'Leilão, sinistro, recall e Tabela FIPE', 'PDF com código de validação'],
    notGet: ['Nome dos donos anteriores (o relatório não expõe dados pessoais)'],
    forWho: ['Quem compra veículo de valor mais alto', 'Lojistas e revendedores', 'Quem quer o relatório mais completo, sem pensar duas vezes'],
    next: ['avancada', 'completa'], nextLead: 'Compare com as outras consultas:',
    cta: 'Fazer a consulta premium'
  }
];

export const LANDING_BY_SLUG = new Map(LANDINGS.map((l) => [l.slug, l]));

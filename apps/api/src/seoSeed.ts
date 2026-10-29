/**
 * Conteúdo de SEO pronto de cada página principal: título, descrição, palavra-chave, textos e perguntas frequentes.
 * Vira o ponto de partida da tabela seo_pages (editável no painel, em SEO) e é o que "Restaurar padrão" devolve.
 * Regra de redação: nada de promessa que o produto não cumpre; taxas, prazos e regras de banco ou de estado aparecem como "varia".
 */
export interface SeoSection { h: string; p: string }
export interface SeoFaq { q: string; a: string }
export interface SeoSeed { path: string; h1: string; keyword: string; title?: string; description?: string; sections?: SeoSection[]; faq: SeoFaq[] }

const caution = 'O relatório mostra o que a fonte de dados retorna para a placa e não substitui vistoria nem consulta aos órgãos competentes.';

export const SEO_SEED: SeoSeed[] = [
  {
    path: '/fipe', h1: 'Tabela FIPE grátis', keyword: 'tabela fipe',
    title: 'Tabela FIPE grátis: preço de carro e moto | Placa na Mão',
    description: 'Consulte a Tabela FIPE grátis: valor médio de carros, motos e caminhões por marca, modelo e ano, com histórico de preços e variação. Sem cadastro.',
    sections: [
      { h: 'O que é a Tabela FIPE', p: 'A Tabela FIPE é uma referência de preço médio de veículos no mercado brasileiro, calculada pela Fundação Instituto de Pesquisas Econômicas e atualizada todo mês. Ela serve de base para negociar compra e venda, avaliar seguro e conferir se um anúncio está acima ou abaixo da média.' },
      { h: 'Como consultar o preço FIPE de um veículo', p: 'Escolha o tipo (carro, moto ou caminhão), a marca, o modelo e o ano. A consulta é grátis e mostra o valor médio vigente, a variação em relação aos meses anteriores e o histórico de preços. Quem já sabe a placa pode pedir a consulta completa, que traz a FIPE dentro do relatório do veículo.' },
      { h: 'Por que o valor da FIPE muda todo mês', p: 'O preço médio acompanha a oferta e a procura por cada versão. Modelos muito procurados tendem a se valorizar ou desvalorizar menos; por isso a comparação mês a mês ajuda a decidir o melhor momento de comprar ou vender.' },
      { h: 'FIPE e preço anunciado: como usar na negociação', p: 'A FIPE é uma média, não um preço fixo. Quilometragem, estado de conservação, opcionais e a região mudam o valor real. Use a Tabela FIPE como ponto de partida e confira débitos, restrições e histórico do veículo antes de fechar negócio.' }
    ],
    faq: [
      { q: 'A consulta da Tabela FIPE é grátis?', a: 'Sim. Você consulta o valor médio por tipo, marca, modelo e ano sem pagar nada e sem precisar de cadastro.' },
      { q: 'O que significa o valor da Tabela FIPE?', a: 'É o preço médio de mercado de um veículo, usado como referência em compra, venda, seguro e financiamento. Não é um preço obrigatório.' },
      { q: 'Quando a Tabela FIPE é atualizada?', a: 'A Tabela FIPE é atualizada mensalmente. A Placa na Mão mostra o valor do mês de referência vigente e o histórico dos meses anteriores.' },
      { q: 'Posso consultar a FIPE pela placa?', a: 'Sim. A consulta completa por placa traz a FIPE do veículo no relatório, junto com débitos, restrições, gravame e histórico. A consulta pela tabela (marca, modelo e ano) é grátis.' },
      { q: 'Por que o preço do anúncio é diferente da Tabela FIPE?', a: 'A FIPE é uma média. Quilometragem, conservação, opcionais, cor, região e urgência da venda fazem o preço anunciado ficar acima ou abaixo dela.' },
      { q: 'Como saber se um carro está desvalorizando?', a: 'Compare o valor do mesmo modelo e ano em vários meses. O histórico de preços da consulta mostra a variação e ajuda a ver a tendência.' },
      { q: 'A FIPE vale para carro, moto e caminhão?', a: 'Sim. Há consulta para carros, motos e caminhões, cada uma com suas marcas, modelos e anos.' }
    ]
  },
  {
    path: '/simulador', h1: 'Simulador de financiamento', keyword: 'simulador de financiamento',
    title: 'Simulador de financiamento de veículo | Placa na Mão',
    description: 'Use o simulador de financiamento para ver parcela, CET e custo total em CDC ou leasing, com a taxa média do Banco Central e o IOF. Grátis, em segundos.',
    sections: [
      { h: 'Como funciona o simulador de financiamento', p: 'Informe o valor do veículo, a entrada e o prazo. O simulador calcula a parcela, o CET (custo efetivo total) e o valor total pago, usando a taxa média de mercado divulgada pelo Banco Central, o IOF e as tarifas. Você compara CDC e leasing lado a lado e baixa a simulação em PDF.' },
      { h: 'CDC ou leasing: qual compensa?', p: 'No CDC (crédito direto ao consumidor) o veículo fica em seu nome com alienação fiduciária até a quitação. No leasing, a instituição é a dona do bem durante o contrato e você tem a opção de compra no fim. O custo total muda conforme prazo, entrada e tributos, por isso vale simular os dois.' },
      { h: 'O que entra no custo de um financiamento', p: 'Além dos juros, o custo inclui IOF, tarifas de cadastro e avaliação, seguros opcionais e registro do gravame. O CET reúne tudo em uma taxa só e é o número certo para comparar propostas de bancos diferentes.' },
      { h: 'Como pagar menos juros', p: 'Uma entrada maior reduz o valor financiado. Prazos mais curtos diminuem o total de juros, embora aumentem a parcela. Compare propostas de mais de uma instituição pelo CET e confira o histórico do veículo antes de financiar.' }
    ],
    faq: [
      { q: 'Qual a taxa de juros do financiamento de veículos?', a: 'Varia por banco, prazo, entrada e perfil de crédito. O simulador usa a taxa média divulgada pelo Banco Central como referência. A taxa final é a da proposta da instituição.' },
      { q: 'O que é CET no financiamento?', a: 'CET é o custo efetivo total: juros, IOF, tarifas e seguros incluídos no contrato, expressos em uma taxa. É a melhor medida para comparar propostas.' },
      { q: 'A simulação é uma proposta oficial do banco?', a: 'Não. É uma estimativa para planejar e comparar. Aprovação, taxa e condições dependem da análise da instituição financeira.' },
      { q: 'Qual a diferença entre CDC e leasing?', a: 'No CDC o veículo é seu e fica com alienação fiduciária até a quitação. No leasing a instituição é dona do bem durante o contrato e você pode comprá-lo no fim. O custo e os tributos mudam, por isso simule os dois.' },
      { q: 'Quanto preciso dar de entrada?', a: 'Depende da instituição e do seu perfil. Quanto maior a entrada, menor a parcela e o total de juros. Simule valores diferentes para ver o efeito.' },
      { q: 'Dá para financiar carro usado?', a: 'Sim. As instituições costumam definir uma idade máxima do veículo e exigem que ele esteja sem restrições. Consulte débitos, gravame e histórico antes de financiar.' },
      { q: 'O simulador serve para moto, caminhão e utilitário?', a: 'Sim. Há simulação para carro, moto, caminhão e utilitário, cada uma com atalhos e valores de referência próprios.' }
    ]
  },
  {
    path: '/simulador/carro', h1: 'Financiamento de carro', keyword: 'financiamento de carro',
    title: 'Simulador de financiamento de carro | Placa na Mão',
    description: 'Simule o financiamento de carro, novo ou usado: parcela, CET e custo total em CDC ou leasing, com entrada e prazo à sua escolha. Grátis, em segundos.',
    sections: [
      { h: 'Financiamento de carro: simule antes de ir ao banco', p: 'Escolha o carro pela Tabela FIPE ou informe o valor, defina a entrada e o prazo e veja a parcela, o CET e o total pago em CDC e leasing. Chegar ao banco sabendo o custo real ajuda a negociar e a recusar propostas caras.' },
      { h: 'Carro novo ou usado', p: 'Para carro usado, confira também a situação do veículo: débitos, restrições, gravame e histórico. Um financiamento só é aprovado se o carro estiver apto à alienação, e problemas descobertos depois da compra saem caros.' }
    ],
    faq: [
      { q: 'Quanto fica a parcela de um carro financiado?', a: 'Depende do valor financiado, da taxa e do prazo. Informe esses dados no simulador e veja a parcela e o total pago na hora.' },
      { q: 'Qual o prazo máximo para financiar um carro?', a: 'O prazo varia por instituição e por idade do veículo. Simule diferentes prazos para ver como a parcela e o custo total mudam.' },
      { q: 'Vale a pena financiar em mais parcelas?', a: 'A parcela cai, mas o total de juros sobe. Compare pelo CET e escolha o prazo que cabe no seu orçamento com o menor custo total.' },
      { q: 'Financiamento de carro usado tem juros maiores?', a: 'Muitas vezes sim, e o prazo costuma ser menor. A taxa final depende da instituição e do seu perfil de crédito.' }
    ]
  },
  {
    path: '/simulador/moto', h1: 'Financiamento de moto', keyword: 'financiamento de moto',
    title: 'Simulador de financiamento de moto | Placa na Mão',
    description: 'Simule o financiamento de moto: parcela, CET e custo total em CDC ou leasing, com entrada e prazo à sua escolha. Grátis, em segundos.',
    sections: [
      { h: 'Financiamento de moto: veja a parcela antes de decidir', p: 'Informe o valor da moto, a entrada e o prazo. O simulador mostra parcela, CET e total pago, para você comparar propostas das concessionárias e dos bancos.' }
    ],
    faq: [
      { q: 'Dá para financiar moto sem entrada?', a: 'Algumas instituições oferecem condições com entrada baixa ou sem entrada, sujeitas à análise de crédito. Simule para comparar o custo total.' },
      { q: 'Qual o prazo para financiar uma moto?', a: 'Varia por instituição e por modelo. Simule prazos diferentes e compare a parcela com o total de juros.' },
      { q: 'Posso financiar moto usada?', a: 'Em geral sim, conforme a idade e a situação da moto. Antes, consulte débitos, restrições e gravame pela placa.' }
    ]
  },
  {
    path: '/simulador/caminhao', h1: 'Financiamento de caminhão', keyword: 'financiamento de caminhão',
    title: 'Simulador de financiamento de caminhão | Placa na Mão',
    description: 'Simule o financiamento de caminhão em CDC ou leasing: parcela, CET e custo total, com entrada e prazo ajustáveis. Grátis, em segundos.',
    sections: [
      { h: 'Financiamento de caminhão', p: 'Caminhões envolvem valores maiores e condições próprias de entrada e prazo, e algumas linhas de financiamento têm regras específicas. Use a simulação como referência para comparar propostas e confirme as condições com a instituição.' }
    ],
    faq: [
      { q: 'Financiar caminhão é diferente de financiar carro?', a: 'Costuma envolver valores, entrada e prazos próprios, e linhas específicas com regras próprias. Simule para ter uma referência e confirme as condições com a instituição.' },
      { q: 'Posso comparar CDC e leasing para caminhão?', a: 'Sim. O simulador mostra os dois lado a lado, com parcela, CET e total pago.' },
      { q: 'Dá para financiar caminhão usado?', a: 'Em geral sim, conforme a idade e a situação do veículo. Consulte débitos, restrições e gravame pela placa antes de fechar.' }
    ]
  },
  {
    path: '/simulador/utilitario', h1: 'Financiamento de utilitário', keyword: 'financiamento de utilitário',
    title: 'Financiamento de utilitário e van: simulador | Placa na Mão',
    description: 'Simule o financiamento de utilitário, van ou furgão: parcela, CET e custo total em CDC ou leasing. Compare prazos e entradas. Grátis.',
    sections: [
      { h: 'Financiamento de van e utilitário', p: 'Para quem usa o veículo no trabalho, a parcela precisa caber no fluxo de caixa. Simule entradas e prazos diferentes e compare o custo total antes de assinar.' }
    ],
    faq: [
      { q: 'Como simular financiamento de utilitário?', a: 'Informe o valor do veículo, a entrada e o prazo. O simulador mostra a parcela, o CET e o total pago em CDC ou leasing, sem custo.' },
      { q: 'Posso simular financiamento de van e furgão?', a: 'Sim. Informe o valor do veículo, a entrada e o prazo para ver parcela, CET e total pago.' },
      { q: 'Empresa e MEI também podem simular?', a: 'A simulação é livre para qualquer pessoa. As condições reais dependem da análise da instituição e do tipo de cadastro.' },
      { q: 'Qual o melhor prazo para financiar um utilitário?', a: 'Depende do fluxo de caixa. Prazos maiores reduzem a parcela, mas aumentam o total de juros. Simule alguns prazos e compare pelo CET.' }
    ]
  },
  {
    path: '/combustivel', h1: 'Etanol ou gasolina?', keyword: 'etanol ou gasolina',
    title: 'Etanol ou gasolina: qual compensa? Calculadora | Placa na Mão',
    description: 'Descubra se etanol ou gasolina compensa para o seu carro e quanto você gasta de combustível por mês, com o consumo oficial da versão.',
    sections: [
      { h: 'Etanol ou gasolina: como saber qual compensa', p: 'Compare o preço do litro com o consumo do seu carro em cada combustível. Como o etanol rende menos quilômetros por litro, ele só compensa quando o preço fica abaixo de uma proporção do preço da gasolina, que muda de carro para carro.' },
      { h: 'Quanto você gasta por mês', p: 'Informe a versão do carro, a quilometragem que você roda e os preços dos combustíveis. A calculadora usa o consumo oficial da versão e mostra o gasto mensal e a diferença entre etanol e gasolina.' }
    ],
    faq: [
      { q: 'Quando o etanol compensa mais que a gasolina?', a: 'Quando o preço do etanol, dividido pelo da gasolina, fica abaixo da relação de consumo do seu carro. Muita gente usa 70% como regra geral, mas o número real depende da versão.' },
      { q: 'A regra dos 70% vale para todos os carros?', a: 'É uma aproximação. Cada carro tem um consumo diferente com etanol e gasolina, por isso a calculadora usa os dados da versão.' },
      { q: 'De onde vem o consumo usado no cálculo?', a: 'Dos dados oficiais de consumo da versão do veículo. O consumo real varia com trânsito, estilo de direção e conservação.' }
    ]
  },
  {
    path: '/comparar', h1: 'Comparar carros', keyword: 'comparar carros',
    title: 'Comparar carros lado a lado: consumo e ficha | Placa na Mão',
    description: 'Comparar carros lado a lado: consumo, custos, ficha técnica e itens de série. Veja qual versão faz mais sentido antes de comprar.',
    sections: [
      { h: 'Compare versões antes de comprar', p: 'Coloque duas ou mais versões lado a lado e veja consumo, potência, dimensões, itens de série e custos de uso. A comparação evita decidir só pelo preço da tabela.' }
    ],
    faq: [
      { q: 'Como comparar carros no site?', a: 'Escolha as versões que quiser e veja lado a lado consumo, potência, itens de série e ficha técnica, sem precisar de cadastro.' },
      { q: 'Quantos carros posso comparar?', a: 'Você escolhe as versões que quiser comparar lado a lado e vê as diferenças de ficha técnica e consumo.' },
      { q: 'A comparação traz o preço do carro?', a: 'Para o preço de mercado, use a consulta da Tabela FIPE, que é grátis.' },
      { q: 'O que devo comparar além do preço?', a: 'Consumo, potência, itens de série, custo de manutenção e seguro, e a situação do veículo quando for usado. A ficha técnica ajuda nos três primeiros.' }
    ]
  },
  {
    path: '/consulta-placa', h1: 'Consulta de placa', keyword: 'consulta de placa',
    title: 'Consulta de placa: débitos, multas e gravame | Placa na Mão',
    description: 'Faça a consulta de placa e veja débitos, multas, restrições, gravame e histórico do veículo em um relatório com PDF. Sem mensalidade: pague só a consulta.',
    faq: [
      { q: 'Preciso informar o Renavam?', a: 'Não. A consulta é feita pela placa.' },
      { q: 'Serve para placa antiga e Mercosul?', a: 'Sim. Aceitamos os dois padrões de placa usados no Brasil.' },
      { q: 'O que aparece na consulta de placa?', a: 'Depende do tipo de consulta: dados do veículo, débitos, restrições, gravame, histórico e FIPE. Veja o detalhe de cada uma em Consultas e preços.' },
      { q: 'Quanto tempo leva para receber o resultado?', a: 'Em geral, poucos segundos. O relatório fica no seu histórico e pode ser baixado em PDF com código de validação.' },
      { q: 'O relatório é garantia de negócio seguro?', a: caution }
    ]
  },
  {
    path: '/consulta-veicular', h1: 'Consulta veicular completa', keyword: 'consulta veicular',
    title: 'Consulta veicular completa: histórico do carro | Placa na Mão',
    description: 'Entenda o que a consulta veicular completa verifica antes de comprar um usado: débitos, restrições, gravame, histórico e FIPE, conforme a fonte.',
    faq: [
      { q: 'O que é uma consulta veicular completa?', a: 'É um relatório que reúne dados do veículo, débitos, restrições, gravame, indícios de sinistro e leilão, recall e FIPE, conforme o que a fonte de dados retorna para a placa.' },
      { q: 'Quando vale a pena fazer a consulta completa?', a: 'Antes de comprar um veículo usado ou financiar. Ela reduz o risco de surpresas com pendências, restrições e histórico.' },
      { q: 'A consulta veicular substitui a vistoria?', a: caution }
    ]
  },
  {
    path: '/consultar-gravame', h1: 'Consultar gravame', keyword: 'consultar gravame',
    title: 'Consultar gravame do veículo pela placa | Placa na Mão',
    description: 'Consultar gravame pela placa mostra se o veículo tem financiamento ou alienação fiduciária registrada antes de comprar. Veja o resultado com a fonte.',
    faq: [
      { q: 'O que é gravame de veículo?', a: 'É o registro de que o veículo foi dado como garantia de um financiamento (alienação fiduciária). Enquanto o gravame existe, o veículo não pode ser transferido sem a baixa.' },
      { q: 'Como consultar gravame pela placa?', a: 'Informe a placa na consulta de gravame ou na consulta completa. O relatório mostra, quando a fonte retorna, a instituição financeira, o contrato e a data de inclusão.' },
      { q: 'Posso comprar um carro com gravame?', a: 'Só com cuidado. O ideal é exigir a baixa do gravame antes de pagar, ou que a instituição autorize a transferência da dívida. Confirme sempre com a financeira.' },
      { q: 'Como dar baixa no gravame depois de quitar?', a: 'Depois da quitação, a financeira registra a baixa. Peça o comprovante e confirme com uma nova consulta antes de transferir o veículo.' },
      { q: 'Gravame é a mesma coisa que dívida?', a: 'Não necessariamente. Interprete conforme o retorno e confirme com a instituição financeira e o órgão de trânsito antes de fechar negócio.' }
    ]
  },
  {
    path: '/consultar-debitos-veiculo', h1: 'Consultar débitos de veículo', keyword: 'consultar débitos de veículo',
    title: 'Consultar débitos de veículo pela placa | Placa na Mão',
    description: 'Consultar débitos de veículo pela placa: veja IPVA, licenciamento e multas, conforme a cobertura da fonte, e evite herdar pendências na transferência.',
    faq: [
      { q: 'Como consultar débitos de veículo?', a: 'Informe a placa e escolha a consulta de débitos. O relatório lista IPVA, licenciamento, multas e outras pendências conforme a cobertura da fonte, para você conferir antes da transferência.' },
      { q: 'Quais débitos aparecem na consulta?', a: 'IPVA, licenciamento, multas e outros débitos informados pela fonte, com o total em aberto e o detalhamento por tipo.' },
      { q: 'Posso transferir um veículo com débitos?', a: 'Em geral as pendências precisam ser regularizadas para transferir. As regras variam por estado, por isso confirme no órgão de trânsito.' },
      { q: 'Quem paga os débitos antigos do veículo?', a: 'Débitos ficam vinculados ao veículo. Na compra, combine por escrito quem quita o quê e confira tudo antes de pagar.' },
      { q: 'Por que consultar débitos antes de comprar?', a: 'Para descobrir pendências antes de fechar negócio e usar o valor na negociação.' }
    ]
  },
  {
    path: '/consultar-multas-veiculo', h1: 'Consultar multas de veículo', keyword: 'consultar multas de veículo',
    title: 'Consultar multas de veículo pela placa | Placa na Mão',
    description: 'Consultar multas de veículo pela placa antes de comprar ou transferir. O relatório separa dado não informado de nada consta, sem confundir você.',
    faq: [
      { q: 'Como consultar multas de veículo?', a: 'Informe a placa e escolha a consulta com multas. O relatório mostra as pendências que a fonte retorna e separa multa sem ocorrência de dado não informado.' },
      { q: 'Como consultar multas pela placa?', a: 'Informe a placa na consulta de multas ou na consulta completa. O relatório lista as multas encontradas pela fonte, por órgão autuador.' },
      { q: 'A multa fica no carro ou na pessoa?', a: 'A multa fica vinculada ao veículo até ser paga. A pontuação segue o condutor infrator, conforme apurado pelo órgão de trânsito.' },
      { q: 'Dá para comprar um carro com multas?', a: 'Dá, mas elas precisam ser tratadas na negociação e na transferência. Confira o valor antes de fechar negócio.' }
    ]
  },
  {
    path: '/consultar-sinistro-veiculo', h1: 'Consultar sinistro de veículo', keyword: 'consultar sinistro de veículo',
    title: 'Consultar sinistro de veículo pela placa | Placa na Mão',
    description: 'Consultar sinistro de veículo pela placa ajuda a entender o histórico que pode afetar o valor e a segurança de um usado, conforme a cobertura da fonte.',
    faq: [
      { q: 'Como consultar sinistro de veículo?', a: 'Informe a placa e escolha a consulta com histórico de sinistro. O relatório mostra o que a fonte retorna, com a data, e indica quando um dado não foi informado.' },
      { q: 'O que significa indício de sinistro?', a: 'É o apontamento de uma ocorrência de dano registrada em bases consultadas pela fonte. Não detalha reparos nem o estado atual do veículo.' },
      { q: 'Um carro com sinistro é um mau negócio?', a: 'Depende da gravidade e do reparo. Use a informação para negociar e para pedir uma vistoria cautelar.' },
      { q: 'A consulta mostra fotos do sinistro?', a: 'Hoje não. Só mostramos o que a fonte de dados retorna e rotulamos o que é estimativa.' }
    ]
  },
  {
    path: '/consultar-leilao-veiculo', h1: 'Consultar leilão de veículo', keyword: 'consultar leilão de veículo',
    title: 'Consultar leilão de veículo pela placa | Placa na Mão',
    description: 'Consultar leilão de veículo pela placa mostra se ele passou por leilão antes de você comprar. Entenda por que isso pesa no valor, conforme a fonte.',
    faq: [
      { q: 'Como consultar leilão de veículo?', a: 'Informe a placa e escolha a consulta com passagem por leilão. O relatório mostra o que a fonte retorna e diferencia um campo sem ocorrência de um dado não informado.' },
      { q: 'Por que verificar a passagem por leilão?', a: 'Veículos de leilão podem vir de seguradoras, financeiras ou órgãos públicos. Pode haver bom preço, mas também histórico que pede atenção.' },
      { q: 'Carro de leilão é ruim?', a: 'Não necessariamente. O importante é saber da passagem por leilão, avaliar o preço e fazer uma vistoria antes de comprar.' },
      { q: 'A consulta de leilão já está disponível?', a: 'Em algumas consultas a passagem por leilão aparece como indício. A consulta avulsa de leilão será liberada quando a fonte de dados for ativada.' }
    ]
  },
  {
    path: '/consultar-recall', h1: 'Consultar recall', keyword: 'consultar recall',
    title: 'Consultar recall de veículo pela placa | Placa na Mão',
    description: 'Consultar recall pela placa e descobrir se o veículo tem campanha em aberto. Entenda como interpretar o retorno antes de comprar ou vender.',
    faq: [
      { q: 'Como consultar recall?', a: 'Informe a placa e veja as campanhas de recall ligadas ao modelo. O relatório mostra o que a fonte retorna; para confirmar o reparo, procure uma concessionária da marca.' },
      { q: 'O que é recall de veículo?', a: 'É a convocação do fabricante para corrigir um defeito que afeta a segurança. O reparo é gratuito na rede autorizada.' },
      { q: 'Como saber se meu carro tem recall?', a: 'A consulta completa por placa traz o apontamento de recall e inspeção quando a fonte retorna. Em caso positivo, agende o atendimento na concessionária.' },
      { q: 'Preciso pagar para fazer o recall?', a: 'Não. O recall é gratuito na rede autorizada do fabricante.' }
    ]
  },
  {
    path: '/historico-veicular', h1: 'Histórico veicular', keyword: 'histórico veicular',
    title: 'Histórico veicular: consulta para comprar usado | Placa na Mão',
    description: 'Veja o histórico veicular antes de comprar: situação, débitos, restrições, gravame e as verificações essenciais de um usado, em um só relatório.',
    faq: [
      { q: 'O que é o histórico veicular?', a: 'É o conjunto de informações sobre a vida do veículo: situação, débitos, restrições, gravame, indícios de sinistro e leilão, proprietários e recall.' },
      { q: 'O que conferir antes de comprar um carro usado?', a: 'Preço contra a Tabela FIPE, débitos, restrições, gravame, histórico e uma vistoria física. A consulta cobre os dados; a vistoria cobre o estado do carro.' },
      { q: 'O histórico mostra quantos donos o carro teve?', a: 'A consulta completa informa a quantidade de proprietários quando a fonte retorna esse dado.' }
    ]
  },
  {
    path: '/planos', h1: 'Preço de consulta de placa', keyword: 'preço de consulta de placa',
    title: 'Preço de consulta de placa e veicular | Placa na Mão',
    description: 'Veja o preço de consulta de placa e de cada relatório antes de pagar. Sem mensalidade: pague só o que consultar, com Pix ou cartão.',
    faq: [
      { q: 'Qual o preço de consulta de placa?', a: 'O preço aparece antes do pagamento e muda conforme a consulta escolhida. Não há mensalidade: você paga só pelo que consultar.' },
      { q: 'Existe mensalidade?', a: 'Não. Você paga só pela consulta que fizer, com o preço visível antes do pagamento.' },
      { q: 'Quais formas de pagamento são aceitas?', a: 'Pix e cartão no checkout seguro. Também há pacotes de saldo para consultar com custo menor por placa.' },
      { q: 'E se a consulta não for concluída?', a: 'Se a consulta falhar, o valor volta para o seu saldo.' },
      { q: 'Tem pacote para lojistas e empresas?', a: 'Sim. Há pacotes de saldo com bônus e planos personalizados para volume. Fale com a equipe pelo chat.' }
    ]
  },
  // Páginas sem perguntas frequentes próprias: título, descrição, palavra-chave e H1 já definidos.
  { path: '/', h1: 'Consulta de placa online', keyword: 'consulta de placa', title: 'Consulta de placa, FIPE grátis e simulador | Placa na Mão', description: 'Faça a consulta de placa e receba o relatório do veículo em segundos: débitos, multas, restrições, gravame e histórico. FIPE e simulador grátis, sem mensalidade.', faq: [] },
  { path: '/veiculos', h1: 'Guia de veículos', keyword: 'guia de veículos', title: 'Guia de veículos: ficha técnica e opinião de donos | Placa na Mão', description: 'No guia de veículos, veja ficha técnica, consumo oficial, nota e opinião de quem tem o carro, dicas de cuidados e compare lado a lado antes de comprar.', faq: [] },
  { path: '/veiculos/mais-economicos', h1: 'Carros mais econômicos', keyword: 'carros mais econômicos', title: 'Carros mais econômicos: ranking de consumo | Placa na Mão', description: 'Veja os carros mais econômicos por versão: consumo em km/l na cidade e na estrada, com a fonte à vista (Inmetro e fichas de referência).', faq: [] },
  { path: '/para-lojistas', h1: 'Consulta para lojistas', keyword: 'consulta para lojistas', title: 'Consulta para lojistas: placa e histórico | Placa na Mão', description: 'Consulta para lojistas: centralize consultas de placa, histórico e relatórios para comprar e vender veículos com segurança. Pague só pelo que consultar.', faq: [
      { q: 'Como funciona a consulta para lojistas?', a: 'Você consulta a placa, recebe o relatório com a fonte e a data de cada dado e guarda tudo no histórico da conta. Paga só pelas consultas que fizer.' },
    { q: 'A Placa na Mão atende lojistas?', a: 'Sim. Lojas e revendas usam as consultas por placa, o histórico e os relatórios em PDF para avaliar veículos antes de comprar e para dar segurança ao cliente na venda.' },
    { q: 'Existe mensalidade para lojistas?', a: 'Não é obrigatória. Você paga só pelas consultas que fizer, com o preço visível antes do pagamento, e pode usar pacotes de saldo para reduzir o custo por placa.' },
    { q: 'Posso consultar várias placas por dia?', a: 'Sim. Cada consulta é independente e o histórico fica salvo na sua conta para você reabrir os relatórios quando precisar.' }
  ] },
  { path: '/para-concessionarias', h1: 'Consulta para concessionárias', keyword: 'consulta para concessionárias', title: 'Consulta para concessionárias: seminovos | Placa na Mão', description: 'Consulta para concessionárias: apoie a avaliação de seminovos com consultas por placa, relatórios em PDF e controle da operação pela equipe.', faq: [
      { q: 'Como funciona a consulta para concessionárias?', a: 'A equipe consulta a placa do seminovo, recebe o relatório com a fonte e a data de cada dado e guarda o histórico na conta da loja.' },
    { q: 'A consulta serve para avaliar seminovos?', a: 'Sim. O relatório reúne situação, débitos, restrições, gravame e histórico conforme a cobertura de cada fonte, e apoia a decisão de compra do seminovo.' },
    { q: 'Várias pessoas da equipe podem usar a mesma conta?', a: 'Sim. O pacote para lojas permite equipe, estoque, propostas e vitrine. Fale com a equipe para ajustar o acesso ao seu volume.' },
    { q: 'O relatório pode ser compartilhado com o cliente?', a: 'Sim. O PDF tem código de validação, e o cliente pode conferir a autenticidade do relatório na página de validação.' }
  ] },
  { path: '/sobre', h1: 'Sobre a Placa na Mão', keyword: 'placa na mão', title: 'Sobre a Placa na Mão | Consulta veicular por placa', description: 'Conheça a Placa na Mão: consulta veicular por placa com transparência sobre a fonte, a data e a cobertura de cada informação do relatório.', faq: [] },
  { path: '/instalar', h1: 'Instalar o app', keyword: 'instalar o app', title: 'Instalar o app Placa na Mão | Android e iPhone', description: 'Veja como instalar o app Placa na Mão na tela inicial do Android ou do iPhone, sem loja de aplicativos, e abra em tela cheia com acesso rápido.', faq: [] },
  { path: '/contato', h1: 'Contato e suporte', keyword: 'contato e suporte', title: 'Contato e suporte | Placa na Mão', description: 'Contato e suporte da Placa na Mão: fale com a equipe sobre suporte, privacidade (LGPD) e parcerias comerciais, pelo chat ou pelo formulário.', faq: [] },
  { path: '/perguntas-frequentes', h1: 'Perguntas frequentes', keyword: 'perguntas frequentes', title: 'Perguntas frequentes sobre consulta veicular | Placa na Mão', description: 'Perguntas frequentes sobre consulta de placa, pagamento, estorno, privacidade e o que cada relatório mostra, com respostas diretas e sem enrolação.', faq: [] },
  { path: '/blog', h1: 'Blog de veículos', keyword: 'blog de veículos', title: 'Blog de veículos: guias para comprar e vender | Placa na Mão', description: 'No blog de veículos, guias práticos sobre gravame, débitos, restrições, Tabela FIPE, recall e vistoria para comprar e vender com segurança.', faq: [] },
  { path: '/termos', h1: 'Termos de Uso', keyword: 'termos de uso', title: 'Termos de Uso e regras da plataforma | Placa na Mão', description: 'Leia os termos de uso: regras, limites e responsabilidades da plataforma Placa na Mão antes de criar sua conta ou fazer uma consulta.', faq: [] },
  { path: '/privacidade', h1: 'Política de Privacidade', keyword: 'política de privacidade', title: 'Política de Privacidade (LGPD) | Placa na Mão', description: 'Leia a política de privacidade: como a Placa na Mão trata dados pessoais, segurança, retenção e os direitos dos titulares, conforme a LGPD.', faq: [] }
];

/** Páginas em que perguntas frequentes não são exigidas (a página não exibe esse bloco). */
export const NO_FAQ_PATHS = new Set(['/', '/veiculos', '/veiculos/mais-economicos', '/sobre', '/instalar', '/contato', '/perguntas-frequentes', '/blog', '/termos', '/privacidade']);

export const SEO_SEED_BY_PATH = new Map(SEO_SEED.map((s) => [s.path, s]));

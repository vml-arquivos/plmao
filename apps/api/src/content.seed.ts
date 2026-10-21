/**
 * Conteúdo inicial do site (FAQ, matriz de comparação e artigos). Tudo editável no painel depois;
 * a migração 016 só semeia quando as tabelas estão vazias. Texto próprio, sem marcas de terceiros.
 */

export const SEED_FEATURES: Array<{ key: string; label: string; description: string; order: number }> = [
  { key: 'dados-veiculo', label: 'Dados do veículo', description: 'Marca, modelo, ano, cor, combustível e categoria.', order: 10 },
  { key: 'registro', label: 'Emplacamento e situação', description: 'UF, município, situação do veículo e licenciamento.', order: 20 },
  { key: 'identificadores', label: 'Chassi e RENAVAM', description: 'Identificadores do veículo, com proteção parcial dos números.', order: 30 },
  { key: 'debitos', label: 'Débitos e multas', description: 'IPVA, licenciamento e multas, com valores quando a fonte informa.', order: 40 },
  { key: 'restricoes', label: 'Restrições', description: 'Furto/roubo, judicial, administrativa, tributária e outras.', order: 50 },
  { key: 'gravame', label: 'Financiamento e gravame', description: 'Restrição financeira e intenção de gravame, quando informados.', order: 60 },
  { key: 'recall-inspecao', label: 'Recall e inspeção', description: 'Campanhas de recall e inspeção veicular, quando informadas.', order: 70 },
  { key: 'leilao', label: 'Histórico de leilão', description: 'Passagem por leilão. Disponível assim que a fonte for ativada.', order: 80 },
  { key: 'pdf', label: 'Relatório em PDF com validação', description: 'PDF para imprimir ou compartilhar, com código de verificação.', order: 90 }
];

type Status = 'INCLUDED' | 'NOT_INCLUDED' | 'SOON';
/** Matriz inicial: produto → recurso → situação. */
export const SEED_MATRIX: Record<string, Record<string, Status>> = {
  CADASTRAL: { 'dados-veiculo': 'INCLUDED', registro: 'INCLUDED', pdf: 'INCLUDED' },
  LIEN: { gravame: 'INCLUDED', pdf: 'INCLUDED' },
  BASIC: { 'dados-veiculo': 'INCLUDED', registro: 'INCLUDED', identificadores: 'INCLUDED', debitos: 'INCLUDED', restricoes: 'INCLUDED', pdf: 'INCLUDED' },
  COMPLETE: { 'dados-veiculo': 'INCLUDED', registro: 'INCLUDED', identificadores: 'INCLUDED', debitos: 'INCLUDED', restricoes: 'INCLUDED', gravame: 'INCLUDED', 'recall-inspecao': 'INCLUDED', leilao: 'SOON', pdf: 'INCLUDED' },
  AUCTION: { leilao: 'SOON', pdf: 'INCLUDED' }
};

export const SEED_FAQS: Array<{ category: string; question: string; answer: string }> = [
  { category: 'Consultas', question: 'O que eu recebo ao consultar uma placa?', answer: 'Um relatório organizado em seções (identificação, características, registro, débitos, restrições e financiamento, conforme a consulta escolhida), com um resumo da situação, valores em aberto quando informados e opção de baixar em PDF ou imprimir.' },
  { category: 'Consultas', question: 'Qual consulta devo escolher?', answer: 'Para conferir se o veículo é o que o anúncio diz, a Cadastral resolve. Se você vai comprar, a Básica soma débitos, multas e restrições. Se o valor é alto ou o veículo pode ter financiamento, a Completa reúne tudo, inclusive gravame, recall e inspeção, e costuma sair mais barata do que somar consultas avulsas. Na página de planos há um comparador que monta a combinação mais barata para o que você precisa.' },
  { category: 'Consultas', question: 'Os dados são sempre completos?', answer: 'Cada campo depende do que a fonte contratada retorna para aquela placa. Quando um dado não vem, o relatório mostra “Não informado pela fonte”, sem confundir com “nada consta”.' },
  { category: 'Consultas', question: 'Quanto tempo leva uma consulta?', answer: 'Em geral, poucos segundos. Se a fonte demorar além do esperado, você acompanha o andamento na tela e, em caso de falha técnica, o valor é devolvido automaticamente.' },
  { category: 'Consultas', question: 'Serve para placa antiga e Mercosul?', answer: 'Sim. Aceitamos os dois padrões de placa. A disponibilidade de cada informação depende da fonte para o estado do veículo.' },
  { category: 'Consultas', question: 'A consulta de leilão já está disponível?', answer: 'Ainda não. Ela aparece como “em breve” e só será vendida quando a fonte de dados estiver ativa. Nada é cobrado por informação que não possa ser entregue.' },
  { category: 'Pagamento', question: 'Como funciona o pagamento?', answer: 'Você paga por consulta avulsa (Pix ou cartão, conforme o checkout) ou recarrega saldo em pacotes, que saem mais em conta por consulta. O preço final aparece antes de você confirmar.' },
  { category: 'Pagamento', question: 'E se a consulta falhar?', answer: 'Se a consulta falhar por problema técnico, o valor é estornado automaticamente para o seu saldo ou para a forma de pagamento usada.' },
  { category: 'Pagamento', question: 'O saldo dos pacotes expira?', answer: 'Não há validade curta: o saldo fica na sua carteira e pode ser usado em qualquer consulta. As regras completas estão nos Termos de Uso.' },
  { category: 'Privacidade', question: 'Dados pessoais do proprietário aparecem?', answer: 'Não de forma aberta. Nome e documentos são protegidos conforme a LGPD, e identificadores sensíveis aparecem parcialmente mascarados no relatório.' },
  { category: 'Privacidade', question: 'Meus relatórios ficam salvos?', answer: 'Sim. Todas as consultas concluídas ficam no seu histórico, com PDF e código de verificação, para você abrir de novo quando precisar.' },
  { category: 'Uso', question: 'O relatório substitui a vistoria?', answer: 'Não. Ele apoia a decisão com os dados disponíveis, mas não substitui vistoria, certidões ou a consulta aos órgãos competentes antes de fechar negócio.' },
  { category: 'Uso', question: 'A Tabela FIPE é grátis?', answer: 'Sim. A consulta de valor médio FIPE é gratuita e não exige cadastro. Use para comparar o preço anunciado com a referência de mercado.' },
  { category: 'Uso', question: 'Posso instalar como aplicativo?', answer: 'Sim. O site funciona como aplicativo (PWA): no celular, use “Adicionar à tela inicial” no navegador. Você abre em tela cheia, com acesso rápido ao histórico e à nova consulta.' }
];

/** Perguntas e respostas sobre CDC x leasing (simulador de financiamento). Entram no FAQ do site pela migração 025. */
export const FINANCING_FAQS: Array<{ category: string; question: string; answer: string }> = [
  { category: 'Financiamento', question: "Qual a diferença entre CDC e leasing?", answer: "No CDC o banco empresta o valor e o veículo fica no seu nome, com alienação fiduciária (o banco mantém a garantia) até a última parcela. Ao quitar, ele é seu. No leasing a arrendadora compra o veículo e o disponibiliza para você; ele fica no nome dela e, no fim do contrato, você paga o valor residual para ficar com ele." },
  { category: 'Financiamento', question: "Por que a parcela do leasing costuma ser menor?", answer: "Porque parte do valor do veículo (o valor residual) fica para o final em vez de entrar nas parcelas. Você paga menos por mês, mas, se quiser ficar com o veículo, paga esse valor de uma vez. Compare sempre o total pago e o CET, não só a parcela." },
  { category: 'Financiamento', question: "A parcela é sempre a mesma do começo ao fim?", answer: "Na maioria dos contratos de veículo, sim (parcelas fixas, tabela Price). Em alguns, as parcelas são decrescentes (SAC): a primeira é a mais alta e a última a mais baixa, porque todo mês você amortiza o mesmo valor e os juros caem junto com o saldo. O total de juros costuma ser menor, mas o começo pesa mais no orçamento. No simulador, escolha em “Tipo de parcela”." },
  { category: 'Financiamento', question: "Qual é o mais vantajoso: CDC ou leasing?", answer: "Depende do que pesa mais para você. No custo, compare o total pago e o CET (no leasing, inclua o residual se for ficar com o veículo). No orçamento mensal, a parcela menor do leasing ajuda, mas deixa um valor grande para o final. Na segurança e na continuidade do pagamento, veja as respostas sobre atraso e sobre vender o veículo." },
  { category: 'Financiamento', question: "O que acontece se eu atrasar as parcelas?", answer: "Em qualquer financiamento, o atraso gera multa, juros de mora e correção, e o nome pode ser negativado. No CDC, o veículo é a garantia: se a dívida não for regularizada depois da notificação, o banco pode pedir a busca e apreensão e vender o veículo para abater a dívida. Se sobrar valor, ele volta para você; se faltar, a diferença continua sendo cobrada. No leasing, o veículo é da arrendadora, que pode rescindir o contrato e pedir a reintegração de posse. O que já foi pago e o que ainda é devido seguem o contrato." },
  { category: 'Financiamento', question: "E se eu não conseguir continuar pagando?", answer: "Procure o banco antes de atrasar. Renegociar o prazo ou vender o veículo para quitar costuma custar menos do que a retomada. Nos dois tipos, você pode antecipar parcelas ou quitar antes, com redução proporcional dos juros (Código de Defesa do Consumidor, art. 52, § 2º)." },
  { category: 'Financiamento', question: "Posso vender ou trocar o veículo antes de terminar de pagar?", answer: "No CDC, só quitando a dívida ou com a autorização do banco, porque há alienação fiduciária. No leasing, o veículo é da arrendadora até você exercer a compra no final. Nos dois casos, combine com a instituição antes de anunciar." },
];

export interface SeedArticle { slug: string; title: string; category: string; excerpt: string; tags: string[]; body: string }

export const SEED_ARTICLES: SeedArticle[] = [
  {
    slug: 'como-consultar-placa-antes-de-comprar-carro-usado',
    title: 'Como consultar a placa antes de comprar um carro usado',
    category: 'Compra segura',
    excerpt: 'Um passo a passo simples para transformar o “parece tudo certo” em informação que você pode conferir antes de pagar.',
    tags: ['compra', 'placa', 'carro usado'],
    body: `Negociar um carro usado envolve valores altos e prazos curtos. Consultar a placa antes de fechar negócio ajuda a trocar a impressão do anúncio por dados que você pode conferir.

## O que vale checar

- **Identificação:** marca, modelo, ano e cor precisam bater com o anúncio e com o documento do veículo.
- **Débitos:** IPVA, licenciamento e multas em aberto.
- **Restrições:** impedimentos como bloqueio judicial ou registro de furto/roubo.
- **Financiamento (gravame):** se o veículo ainda está alienado a uma instituição financeira.
- **Recall:** campanhas de segurança abertas pelo fabricante.

## Passo a passo

1. Peça a placa ao vendedor. Ela aparece no anúncio ou na conversa.
2. Faça a consulta e compare os dados com o documento do veículo (CRLV).
3. Compare o preço pedido com a Tabela FIPE. A consulta de valor médio é gratuita.
4. Leve o carro a uma vistoria independente.
5. Só pague depois de conferir a documentação e a quitação das pendências.

## O que a consulta não faz

Uma consulta depende do que a fonte retorna para a placa. Quando um dado não vem, o relatório diz “não informado”, e isso é diferente de “nada consta”. Por isso ela apoia a sua decisão, mas não substitui a vistoria, a conferência do documento e a consulta aos órgãos de trânsito.`
  },
  {
    slug: 'o-que-e-gravame-e-como-verificar',
    title: 'O que é gravame e como verificar antes de comprar',
    category: 'Financiamento',
    excerpt: 'Gravame é o registro de que o veículo serve de garantia a um financiamento. Entenda o risco e como se proteger.',
    tags: ['gravame', 'financiamento', 'transferência'],
    body: `Gravame é o registro, junto ao órgão de trânsito, de que o veículo foi dado em garantia de um financiamento (alienação fiduciária). Enquanto o contrato estiver vigente, a instituição financeira mantém a garantia sobre o veículo.

## Por que isso importa para quem compra

Um veículo com gravame ativo não pode ser transferido normalmente até que a instituição financeira faça a baixa do registro. Comprar sem conferir pode deixar você com um carro que não consegue regularizar no seu nome.

## Como verificar

1. Consulte a placa e veja se o relatório informa restrição financeira ou gravame.
2. Pergunte ao vendedor se o carro foi financiado e peça o comprovante de quitação.
3. Confirme com a instituição financeira que a baixa do gravame foi solicitada ou concluída.
4. Só conclua o pagamento quando a situação estiver regularizada, ou quando houver um acordo formal que proteja você.

## Atenção

Gravame não é sinônimo de dívida em atraso: muita gente financia e paga em dia. O ponto é que o registro precisa ser baixado antes da transferência. Se a consulta não trouxer essa informação, o relatório avisa que o dado não foi retornado, e vale confirmar diretamente com o órgão de trânsito do estado.`
  },
  {
    slug: 'debitos-multas-ipva-transferencia',
    title: 'Débitos, multas e IPVA: o que pode travar a transferência',
    category: 'Documentação',
    excerpt: 'Pendências ligadas ao veículo costumam aparecer só na hora de transferir. Veja como antecipar.',
    tags: ['débitos', 'multas', 'ipva', 'licenciamento'],
    body: `Muita gente só descobre pendências do veículo na hora de transferir. Conferir antes evita retrabalho e ajuda a negociar o preço.

## Quais débitos olhar

- **IPVA:** imposto anual do veículo, cobrado pelo estado.
- **Licenciamento:** taxa anual necessária para o veículo circular regularmente.
- **Multas:** infrações registradas para o veículo, com valor e órgão autuador.

## Por que importa na compra

A regra geral do Código de Trânsito é que tributos, encargos e multas vinculados ao veículo estejam quitados para a transferência de propriedade. Se há débito em aberto, alguém precisa pagá-lo, e o melhor momento para combinar quem paga é antes de fechar o negócio.

## Como se organizar

1. Consulte os débitos e anote o total em aberto e o detalhamento por tipo.
2. Combine com o vendedor quem quita cada item e em que momento.
3. Peça os comprovantes de pagamento e confira novamente depois da quitação.
4. Se houver multa em recurso, registre isso por escrito.

## Dica

Valores mudam com juros e novos lançamentos. Trate a consulta como uma fotografia do momento e confirme o valor atualizado antes de pagar.`
  },
  {
    slug: 'restricoes-veiculares-furto-roubo-judicial',
    title: 'Restrições veiculares: furto/roubo, judicial e administrativa',
    category: 'Documentação',
    excerpt: 'Nem toda restrição é igual. Entenda os principais tipos e o que fazer ao encontrar uma.',
    tags: ['restrições', 'renajud', 'furto', 'roubo'],
    body: `Restrições são registros que limitam o que pode ser feito com o veículo. Elas podem impedir a transferência, o licenciamento ou até levar à apreensão.

## Principais tipos

- **Furto ou roubo:** o veículo consta como subtraído. Não deve ser comprado, e o caso deve ser comunicado às autoridades.
- **Judicial:** determinada por decisão da Justiça, como as inseridas pelo sistema RENAJUD, que pode bloquear transferência, circulação ou licenciamento.
- **Administrativa:** imposta por órgãos públicos, por exemplo por irregularidades documentais.
- **Tributária e outras:** vinculadas a dívidas ou a situações específicas informadas pela fonte.

## O que fazer ao encontrar uma restrição

1. Não pague nada antes de entender a origem e o alcance da restrição.
2. Peça ao vendedor a documentação que comprove a regularização.
3. Confirme diretamente com o órgão responsável pelo registro.
4. Na dúvida, adie o negócio. Uma restrição ativa quase sempre custa mais caro depois.

## Lembrete

O relatório mostra o que a fonte retorna para a placa naquele momento. Restrições podem ser inseridas ou removidas depois da consulta, então confirme a situação perto da data da compra.`
  },
  {
    slug: 'tabela-fipe-como-usar-na-negociacao',
    title: 'Tabela FIPE: como usar na negociação sem cair em armadilhas',
    category: 'Preço',
    excerpt: 'A FIPE é referência, não preço fixo. Veja como comparar o anúncio com o valor de mercado.',
    tags: ['fipe', 'preço', 'negociação'],
    body: `A Tabela FIPE reúne preços médios praticados no mercado e serve como referência para comprador e vendedor. Ela ajuda, mas não é um preço tabelado.

## O que a FIPE mostra

Um valor médio por marca, modelo, versão e ano, atualizado mensalmente. Quanto mais precisa a versão escolhida, mais útil é a comparação.

## Por que o anúncio pode fugir da FIPE

- **Quilometragem e conservação:** carros muito rodados ou com desgaste valem menos.
- **Opcionais e versão:** equipamentos diferentes mudam o valor.
- **Região e demanda:** alguns modelos valem mais em certas cidades.
- **Histórico:** pendências, restrições ou reparos relevantes pesam na negociação.

## Como usar na prática

1. Consulte o valor FIPE da versão e do ano exatos. A consulta é gratuita.
2. Compare com o preço anunciado e anote a diferença.
3. Se o preço está muito abaixo da referência, desconfie e redobre a checagem de documentos, restrições e financiamento.
4. Se está acima, use os pontos do relatório (débitos, restrições, estado do carro) para negociar.

## Cuidado

Preço muito baixo com pressa para fechar é um sinal clássico de problema. Confira a placa, o documento e faça a vistoria antes de pagar.`
  },
  {
    slug: 'recall-do-veiculo-o-que-e-e-o-que-fazer',
    title: 'Recall: o que é e o que fazer se o veículo for convocado',
    category: 'Segurança',
    excerpt: 'Recall é a convocação do fabricante para corrigir um defeito de segurança. Saiba como agir.',
    tags: ['recall', 'segurança'],
    body: `Recall é a convocação feita pelo fabricante quando identifica um defeito que pode afetar a segurança ou a integridade do veículo. O reparo é feito na rede autorizada, sem custo para o proprietário.

## Por que verificar ao comprar um usado

O aviso de recall costuma ser enviado ao proprietário cadastrado. Em carros que trocaram de dono, a convocação pode não ter chegado a quem usa o veículo hoje, e o defeito continua sem correção.

## O que fazer

1. Consulte a placa e veja se há campanha de recall informada na consulta.
2. Procure a rede autorizada da marca com os dados do veículo e agende o atendimento.
3. Guarde o comprovante do reparo. Ele ajuda na revenda.
4. Se houver campanha aberta na compra, combine com o vendedor se o reparo será feito antes da entrega.

## Observação

A informação depende do que a fonte retorna para a placa e pode não cobrir toda campanha recente. Para ter certeza, confirme também no site do fabricante.`
  },
  {
    slug: 'checklist-vistoria-carro-usado',
    title: 'Checklist de vistoria: o que olhar além da consulta',
    category: 'Compra segura',
    excerpt: 'A consulta mostra o papel; a vistoria mostra o carro. Use os dois juntos.',
    tags: ['vistoria', 'checklist', 'carro usado'],
    body: `A consulta da placa mostra a situação documental. A vistoria mostra o estado do carro. Juntas, reduzem bastante o risco de surpresa.

## Documentos

- Compare chassi e placa do veículo com o documento.
- Confira se o nome do vendedor é o do proprietário registrado.
- Peça comprovantes de quitação de débitos e da baixa de gravame, se houver.

## Lataria e estrutura

- Diferenças de tom de pintura entre peças podem indicar reparo.
- Vãos desalinhados entre portas, capô e para-lamas merecem atenção.
- Sinais de oxidação ou massa fora do normal em longarinas e colunas pedem avaliação de especialista.

## Mecânica e eletrônica

- Vazamentos de óleo ou líquido de arrefecimento.
- Luzes de alerta no painel e funcionamento de vidros, travas e ar-condicionado.
- Ruídos de suspensão, direção e freios no teste de rodagem.

## Histórico

- Peça notas de revisão e manutenção.
- Considere um laudo cautelar feito por empresa especializada, principalmente em veículos de maior valor.

## Regra de ouro

Não pague sinal sem antes conferir a placa, o documento e o carro. Se algo não bater, pause a negociação.`
  }
];

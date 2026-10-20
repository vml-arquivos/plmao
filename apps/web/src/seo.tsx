import { useEffect } from 'react';
import Brand from './Brand';
import { trackFunnel } from './funnel';

export type SeoPage = {
  path: string;
  title: string;
  description: string;
  kicker: string;
  heading: string;
  lead: string;
  intent: 'free' | 'account' | 'business';
  benefits: Array<{ title: string; text: string }>;
  questions: Array<{ question: string; answer: string }>;
};

const generalQuestions = [
  { question: 'A consulta é feita em tempo real?', answer: 'A BUSCARR solicita os dados às fontes integradas no momento da consulta. A disponibilidade e a atualização de cada informação dependem do provedor e da cobertura contratada.' },
  { question: 'O resultado fica salvo?', answer: 'Quando você acessa sua conta, os relatórios concluídos ficam organizados no histórico e podem ser consultados novamente conforme as regras do produto.' },
  { question: 'O relatório garante a compra do veículo?', answer: 'Não. O relatório apoia a decisão com os dados disponíveis, mas não substitui vistoria, documentos oficiais nem avaliação profissional.' }
];

function page(path: string, title: string, description: string, kicker: string, heading: string, lead: string, intent: SeoPage['intent'], benefits: SeoPage['benefits'], extraQuestion?: SeoPage['questions'][number]): SeoPage {
  return { path, title, description, kicker, heading, lead, intent, benefits, questions: extraQuestion ? [extraQuestion, ...generalQuestions] : generalQuestions };
}

export const seoPages: Record<string, SeoPage> = Object.fromEntries([
  page('/consulta-placa', 'Consulta de placa veicular online | BUSCARR', 'Consulte a placa, compare a cobertura disponível e receba um relatório veicular organizado para apoiar sua decisão.', 'Consulta de placa', 'Consulte antes de comprar, vender ou negociar.', 'Comece com a FIPE gratuita e avance somente quando precisar investigar informações cadastrais, débitos ou restrições disponíveis no produto escolhido.', 'free', [
    { title: 'Comece sem pagar', text: 'A Consulta zero mostra o valor médio FIPE por seleção de veículo.' },
    { title: 'Cobertura transparente', text: 'Você vê o que cada produto consulta antes de seguir para o pagamento.' },
    { title: 'Relatório organizado', text: 'Os dados retornados são apresentados em blocos claros, com histórico protegido na conta.' }
  ]),
  page('/consulta-veicular', 'Consulta veicular completa online | BUSCARR', 'Entenda o que uma consulta veicular pode verificar e escolha a cobertura adequada para sua negociação.', 'Inteligência veicular', 'Mais clareza para decidir sobre um veículo.', 'Identificação, débitos, restrições e recall podem variar conforme o produto e a fonte ativa. A BUSCARR mostra a cobertura real antes da compra.', 'account', [
    { title: 'Identificação', text: 'Confira os dados cadastrais retornados para o veículo consultado.' },
    { title: 'Pendências', text: 'Veja débitos e restrições quando esses módulos estiverem incluídos e disponíveis.' },
    { title: 'Próximos passos', text: 'Use o resumo do relatório para saber quais pontos ainda precisam de verificação oficial.' }
  ]),
  page('/consultar-gravame', 'Consultar gravame de veículo | BUSCARR', 'Saiba o que é gravame, por que verificar financiamento e como consultar a cobertura disponível para o veículo.', 'Financiamento e restrições', 'Verifique sinais de vínculo financeiro antes de negociar.', 'Gravame pode indicar vínculo relacionado a financiamento. A exibição depende da fonte contratada e só é prometida quando estiver marcada como disponível no produto.', 'account', [
    { title: 'Evite surpresas', text: 'Confira se a cobertura financeira está disponível antes de concluir a compra.' },
    { title: 'Leitura simples', text: 'O retorno é organizado para destacar alertas e informações não consultadas.' },
    { title: 'Sem promessas vazias', text: 'Se a fonte não entregar o dado, o sistema informa a limitação claramente.' }
  ], { question: 'Gravame significa dívida ativa?', answer: 'Nem sempre. O apontamento deve ser interpretado conforme o retorno da fonte e confirmado nos canais oficiais antes da negociação.' }),
  page('/consultar-sinistro-veiculo', 'Consultar sinistro de veículo | BUSCARR', 'Entenda como o histórico de sinistro pode influenciar uma compra e verifique a disponibilidade dessa cobertura.', 'Histórico de ocorrências', 'Investigue o passado antes de assumir o próximo compromisso.', 'Informações de sinistro dependem de bases específicas. A BUSCARR só comercializa essa cobertura quando o provedor correspondente estiver validado e ativo.', 'account', [
    { title: 'Contexto para a vistoria', text: 'Use o histórico disponível para orientar uma inspeção física mais cuidadosa.' },
    { title: 'Cobertura explícita', text: 'Saiba antes do pagamento se o módulo de sinistro faz parte da consulta.' },
    { title: 'Resultado responsável', text: 'Ausência de apontamento não é tratada como garantia de inexistência.' }
  ]),
  page('/consultar-leilao-veiculo', 'Consultar passagem por leilão | BUSCARR', 'Veja por que a passagem por leilão merece atenção e acompanhe a disponibilidade dessa consulta veicular.', 'Origem e histórico', 'Descubra o que vale investigar antes da compra.', 'A passagem por leilão pode impactar avaliação, seguro e revenda. Essa informação só aparece quando a fonte integrada e o produto contratado oferecem a cobertura.', 'account', [
    { title: 'Negociação consciente', text: 'Use o dado disponível para avaliar preço, procedência e necessidade de vistoria.' },
    { title: 'Disponibilidade real', text: 'Produtos ainda não validados aparecem como “em breve”, sem cobrança indevida.' },
    { title: 'Relatório verificável', text: 'Consultas concluídas recebem identificação e ficam vinculadas ao histórico.' }
  ]),
  page('/consultar-debitos-veiculo', 'Consultar débitos de veículo | BUSCARR', 'Consulte a cobertura disponível para débitos veiculares e organize a verificação antes da transferência.', 'Pendências do veículo', 'Entenda os débitos antes de fechar negócio.', 'Quando incluídos na fonte e no produto, débitos são organizados por categoria e valor retornado. Sempre confirme a quitação nos canais oficiais.', 'account', [
    { title: 'Valores organizados', text: 'O relatório separa os débitos efetivamente devolvidos pela fonte.' },
    { title: 'Custo antes da compra', text: 'Confira o preço final da consulta antes de abrir o checkout.' },
    { title: 'Estorno técnico', text: 'Falhas de integração seguem as regras de registro e estorno do sistema.' }
  ]),
  page('/consultar-multas-veiculo', 'Consultar multas de veículo | BUSCARR', 'Entenda como verificar multas e outras pendências antes de comprar ou transferir um veículo.', 'Multas e pendências', 'Não deixe a transferência revelar o que poderia ser verificado antes.', 'A consulta apresenta multas somente quando a fonte integrada retorna esse bloco. Valores e situação devem ser confirmados no órgão responsável.', 'account', [
    { title: 'Triagem rápida', text: 'Identifique pendências retornadas antes de avançar na negociação.' },
    { title: 'Fonte e horário', text: 'O relatório registra quando a consulta foi realizada e qual cobertura foi usada.' },
    { title: 'Sem confundir ausência', text: 'Blocos não consultados são diferenciados de resultados sem ocorrência.' }
  ]),
  page('/consultar-recall', 'Consultar recall de veículo | BUSCARR', 'Saiba por que verificar campanhas de recall e como interpretar o retorno disponível na consulta.', 'Segurança do veículo', 'Recall é informação de segurança, não detalhe burocrático.', 'Quando disponível no produto, o retorno de recall ajuda a orientar a confirmação junto ao fabricante ou ao canal oficial.', 'account', [
    { title: 'Prioridade de segurança', text: 'Use o apontamento para procurar a rede autorizada e confirmar o atendimento.' },
    { title: 'Cobertura por produto', text: 'Veja se recall está incluído antes de iniciar a consulta.' },
    { title: 'Histórico centralizado', text: 'Mantenha o relatório junto das demais verificações do veículo.' }
  ]),
  page('/historico-veicular', 'Histórico veicular para compra segura | BUSCARR', 'Organize as principais verificações de um veículo usado antes de tomar uma decisão.', 'Checklist pré-compra', 'Uma boa decisão combina dados, documentos e vistoria.', 'A BUSCARR centraliza as informações disponíveis sem substituir a inspeção física, a análise documental e a confirmação nos órgãos oficiais.', 'free', [
    { title: 'Valor de referência', text: 'Comece comparando o preço anunciado com a FIPE vigente.' },
    { title: 'Situação documental', text: 'Escolha consultas com os blocos necessários para sua negociação.' },
    { title: 'Avaliação física', text: 'Use os alertas encontrados para orientar uma vistoria especializada.' }
  ]),
  page('/planos', 'Preços e consultas veiculares | BUSCARR', 'Compare as consultas BUSCARR, veja a cobertura disponível e confira o preço antes de pagar.', 'Produtos e preços', 'Escolha apenas a profundidade que sua decisão exige.', 'O cadastro é gratuito. Cada consulta mostra cobertura e preço próprio; módulos em validação permanecem identificados como indisponíveis ou “em breve”.', 'account', [
    { title: 'FIPE gratuita', text: 'Consulte o valor médio sem pagar e entenda os limites desse resultado.' },
    { title: 'Compra unitária', text: 'Pague somente pela consulta escolhida, conforme disponibilidade do checkout.' },
    { title: 'Comparação clara', text: 'Veja inclusões, exclusões e itens em validação antes de decidir.' }
  ]),
  page('/para-lojistas', 'Consulta veicular para lojistas | BUSCARR', 'Centralize consultas, histórico e relatórios para apoiar a operação de compra e venda de veículos.', 'BUSCARR para empresas', 'Mais organização para quem consulta veículos todos os dias.', 'A plataforma oferece contas, histórico, relatórios e condições por organização, com cobertura vinculada aos produtos realmente ativos.', 'business', [
    { title: 'Equipe organizada', text: 'Separe funções e mantenha cada consulta registrada na operação.' },
    { title: 'Condição comercial', text: 'Configure preços negociados por organização quando houver acordo vigente.' },
    { title: 'Relatórios de marca', text: 'Use identidade contextual e modelos publicados sem expor dados sensíveis.' }
  ]),
  page('/para-concessionarias', 'Consulta veicular para concessionárias | BUSCARR', 'Apoie avaliação de usados com consultas veiculares, relatórios e controle operacional para equipes.', 'Operação de usados', 'Do recebimento do veículo à decisão comercial.', 'Centralize as verificações disponíveis, preserve o histórico e acompanhe consultas e pagamentos em uma operação auditável.', 'business', [
    { title: 'Padronização', text: 'Use o mesmo fluxo de consulta e leitura em toda a equipe.' },
    { title: 'Auditoria', text: 'Acompanhe eventos operacionais e permissões administrativas.' },
    { title: 'Escala responsável', text: 'Amplie o uso conforme contratos, fontes e produtos forem validados.' }
  ])
].map((item) => [item.path, item]));

export function seoPageForPath(pathname: string): SeoPage | null {
  const normalized = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  return seoPages[normalized] ?? null;
}

export function applySeoHead(page: Pick<SeoPage, 'path' | 'title' | 'description'> | null): void {
  const title = page?.title ?? 'BUSCARR | Consulta e inteligência veicular';
  const description = page?.description ?? 'BUSCARR: comece pela FIPE grátis e avance para consultas veiculares com cobertura clara, histórico e PDF.';
  const url = `https://carpivara.casadf.com.br${page?.path ?? '/'}`;
  document.title = title;
  const setMeta = (selector: string, attribute: string, value: string) => {
    const element = document.querySelector<HTMLMetaElement>(selector);
    if (element) element.setAttribute(attribute, value);
  };
  setMeta('meta[name="description"]', 'content', description);
  setMeta('meta[property="og:title"]', 'content', title);
  setMeta('meta[property="og:description"]', 'content', description);
  setMeta('meta[property="og:url"]', 'content', url);
  setMeta('meta[name="twitter:title"]', 'content', title);
  setMeta('meta[name="twitter:description"]', 'content', description);
  document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.setAttribute('href', url);
}

export default function SeoLandingPage({ page, onAccess }: { page: SeoPage; onAccess: () => void }) {
  useEffect(() => { applySeoHead(page); trackFunnel('SEO_PAGE_VIEW', { landing: page.path, intent: page.intent }); }, [page]);
  const primary = page.intent === 'free' ? 'Consultar FIPE grátis' : page.intent === 'business' ? 'Falar sobre acesso empresarial' : 'Criar conta gratuita';
  function act() {
    trackFunnel('CTA_CLICKED', { placement: 'seo_hero', landing: page.path, intent: page.intent });
    if (page.intent === 'free') window.location.assign('/fipe'); else onAccess();
  }
  return <div className="seoPage">
    <header className="publicHeader seoHeader"><Brand compact /><nav aria-label="Navegação principal"><a href="/?site=1">Início</a><a href="/planos">Consultas e preços</a><a href="/fipe">FIPE grátis</a><button className="primaryButton compact" onClick={() => { trackFunnel('CTA_CLICKED', { placement: 'seo_header', landing: page.path, destination: 'auth' }); onAccess(); }}>Entrar</button></nav></header>
    <main>
      <section className="seoHero"><div><p className="kicker">{page.kicker}</p><h1>{page.heading}</h1><p>{page.lead}</p><div className="seoHeroActions"><button className="primaryButton" onClick={act}>{primary} <span>→</span></button><a className="secondaryButton" href="/consulta-placa">Entender as consultas</a></div><small>Nenhuma cobertura é prometida sem fonte e produto ativos. Confira sempre os itens antes de pagar.</small></div><aside><span>Jornada BUSCARR</span><ol><li><b>1</b> Comece pela informação gratuita</li><li><b>2</b> Escolha a cobertura necessária</li><li><b>3</b> Consulte e guarde o relatório</li></ol></aside></section>
      <section className="seoBenefits"><div className="sectionHeading"><p className="kicker">O que você encontra</p><h2>Informação clara em cada etapa.</h2></div><div>{page.benefits.map((benefit) => <article key={benefit.title}><span aria-hidden="true">✓</span><h3>{benefit.title}</h3><p>{benefit.text}</p></article>)}</div></section>
      <section className="seoCoverage"><div><p className="kicker">Transparência de cobertura</p><h2>“Não consultado” não significa “nada consta”.</h2></div><p>A BUSCARR diferencia um dado sem ocorrência de um bloco que não fez parte da consulta. Isso reduz interpretações erradas e ajuda você a saber o que ainda precisa confirmar.</p><a href="/planos">Comparar produtos e coberturas →</a></section>
      <section className="seoFaq"><div className="sectionHeading"><p className="kicker">Perguntas frequentes</p><h2>Antes de seguir, entenda o serviço.</h2></div><div>{page.questions.map((item) => <details key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</div></section>
      <section className="publicCta seoFinalCta"><div><p className="kicker">Próximo passo</p><h2>Comece com clareza. Aprofunde quando fizer sentido.</h2><p>Use a FIPE gratuita ou crie sua conta para conferir produtos e preços disponíveis.</p></div><button className="primaryButton" onClick={act}>{primary} <span>→</span></button></section>
    </main>
    <footer><strong>BUSCARR</strong><span>Consulta e inteligência veicular com cobertura transparente.</span><a href="/termos">Termos</a><a href="/privacidade">Privacidade</a></footer>
  </div>;
}

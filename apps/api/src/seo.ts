type SeoMeta = { title: string; description: string };

const pageMeta: Record<string, SeoMeta> = {
  '/': { title: 'Placa na Mão | Consulta e inteligência veicular', description: 'Comece pela FIPE grátis e avance para consultas veiculares com cobertura clara, histórico e PDF.' },
  '/fipe': { title: 'Consulta FIPE grátis e em tempo real | Placa na Mão', description: 'Consulte gratuitamente o valor médio FIPE vigente por tipo, marca, modelo e ano.' },
  '/consulta-placa': { title: 'Consulta de placa veicular online | Placa na Mão', description: 'Consulte a placa, compare a cobertura disponível e receba um relatório veicular organizado para apoiar sua decisão.' },
  '/consulta-veicular': { title: 'Consulta veicular completa online | Placa na Mão', description: 'Entenda o que uma consulta veicular pode verificar e escolha a cobertura adequada para sua negociação.' },
  '/consultar-gravame': { title: 'Consultar gravame de veículo | Placa na Mão', description: 'Saiba o que é gravame, por que verificar financiamento e como consultar a cobertura disponível para o veículo.' },
  '/consultar-sinistro-veiculo': { title: 'Consultar sinistro de veículo | Placa na Mão', description: 'Entenda como o histórico de sinistro pode influenciar uma compra e verifique a disponibilidade dessa cobertura.' },
  '/consultar-leilao-veiculo': { title: 'Consultar passagem por leilão | Placa na Mão', description: 'Veja por que a passagem por leilão merece atenção e acompanhe a disponibilidade dessa consulta veicular.' },
  '/consultar-debitos-veiculo': { title: 'Consultar débitos de veículo | Placa na Mão', description: 'Consulte a cobertura disponível para débitos veiculares e organize a verificação antes da transferência.' },
  '/consultar-multas-veiculo': { title: 'Consultar multas de veículo | Placa na Mão', description: 'Entenda como verificar multas e outras pendências antes de comprar ou transferir um veículo.' },
  '/consultar-recall': { title: 'Consultar recall de veículo | Placa na Mão', description: 'Saiba por que verificar campanhas de recall e como interpretar o retorno disponível na consulta.' },
  '/historico-veicular': { title: 'Histórico veicular para compra segura | Placa na Mão', description: 'Organize as principais verificações de um veículo usado antes de tomar uma decisão.' },
  '/planos': { title: 'Preços e consultas veiculares | Placa na Mão', description: 'Compare as consultas Placa na Mão, veja a cobertura disponível e confira o preço antes de pagar.' },
  '/para-lojistas': { title: 'Consulta veicular para lojistas | Placa na Mão', description: 'Centralize consultas, histórico e relatórios para apoiar a operação de compra e venda de veículos.' },
  '/para-concessionarias': { title: 'Consulta veicular para concessionárias | Placa na Mão', description: 'Apoie a avaliação de usados com consultas, relatórios e controle operacional para equipes.' },
  '/sobre': { title: 'Sobre a Placa na Mão | Consulta veicular', description: 'Conheça a Placa na Mão: consulta veicular por placa com transparência sobre fonte, data e cobertura de cada informação.' },
  '/contato': { title: 'Contato e suporte | Placa na Mão', description: 'Fale com a equipe Placa na Mão sobre suporte, privacidade (LGPD) e parcerias comerciais.' },
  '/perguntas-frequentes': { title: 'Perguntas frequentes sobre consulta veicular | Placa na Mão', description: 'Tire dúvidas sobre consulta de placa, pagamento, estorno, privacidade e o que cada relatório mostra.' },
  '/veiculos': { title: 'Guia de veículos: ficha técnica, opinião de donos e comparador | Placa na Mão', description: 'Veja ficha técnica, nota e opinião de quem tem o carro, dicas de cuidados e compare veículos lado a lado antes de comprar.' },
  '/veiculos/mais-economicos': { title: 'Carros mais econômicos: ranking de consumo por versão | Placa na Mão', description: 'Veja o consumo de cada versão em km/l, na cidade e na estrada, com a fonte à vista (Inmetro e fichas de referência). Compare e escolha o carro que gasta menos.' },
  '/combustivel': { title: 'Etanol ou gasolina? Quanto seu carro gasta por mês | Placa na Mão', description: 'Descubra se etanol ou gasolina compensa para o seu carro e quanto você gasta de combustível por mês, usando o consumo oficial da versão e os preços do posto.' },
  '/simulador': { title: 'Simulador de financiamento de veículo: CDC e leasing | Placa na Mão', description: 'Simule o financiamento do seu veículo com taxa média do Banco Central, IOF e tarifas. Veja parcela, CET e custo total em CDC ou leasing e baixe o PDF.' },
  '/simulador/carro': { title: 'Simulador de financiamento de carro: parcela, CET e custo total | Placa na Mão', description: 'Simule o financiamento do seu carro, novo ou usado, em CDC ou leasing, com IOF, tarifas e CET. Compare as modalidades e baixe o PDF.' },
  '/simulador/moto': { title: 'Simulador de financiamento de moto: parcela, CET e custo total | Placa na Mão', description: 'Simule o financiamento da sua moto com taxa média do Banco Central, IOF e tarifas. Veja a parcela e o custo total antes de ir ao banco.' },
  '/simulador/caminhao': { title: 'Simulador de financiamento de caminhão: CDC e leasing | Placa na Mão', description: 'Simule o financiamento de caminhão para pessoa física ou empresa, com taxa de mercado, IOF, tarifas e CET. Baixe o PDF da simulação.' },
  '/simulador/utilitario': { title: 'Simulador de financiamento de utilitário e van | Placa na Mão', description: 'Simule o financiamento de utilitário, van ou pick-up em CDC ou leasing, com IOF, tarifas e CET, e leve o PDF ao banco.' },
  '/comparar': { title: 'Comparar veículos lado a lado | Placa na Mão', description: 'Compare ficha técnica, consumo, espaço e nota dos donos de até 3 veículos.' },
  '/blog': { title: 'Blog: guias para comprar e vender veículo com segurança | Placa na Mão', description: 'Guias práticos sobre gravame, débitos, restrições, Tabela FIPE, recall e vistoria para decidir com segurança.' },
  '/entrar': { title: 'Entrar | Placa na Mão', description: 'Acesse sua conta Placa na Mão.' },
  '/criar-conta': { title: 'Criar conta | Placa na Mão', description: 'Crie sua conta Placa na Mão e faça sua primeira consulta veicular.' },
  '/termos': { title: 'Termos de Uso | Placa na Mão', description: 'Conheça as regras de uso, limites e responsabilidades da plataforma Placa na Mão.' },
  '/privacidade': { title: 'Política de Privacidade | Placa na Mão', description: 'Entenda como a Placa na Mão trata dados pessoais, segurança, retenção e direitos dos titulares.' }
};

/** Páginas públicas indexáveis (entram no sitemap). Telas de conta e do app ficam de fora. */
export const SITEMAP_PATHS: string[] = Object.keys(pageMeta).filter((p) => !['/entrar', '/criar-conta', '/comparar'].includes(p));
const NOINDEX = /^\/(entrar|criar-conta|recuperar-senha|app|painel|validar|validar-relatorio|consultar|comparar)(\/|$)/;

export interface SeoOverride { title?: string; description?: string; jsonLd?: unknown[] }

export function renderRobotsTxt(appUrl: string, adminHost: boolean): string {
  if (adminHost) return 'User-agent: *\nDisallow: /\n';
  const base = appUrl.replace(/\/$/, '');
  return `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /app/\nDisallow: /painel\nDisallow: /entrar\nDisallow: /criar-conta\nDisallow: /recuperar-senha\nDisallow: /validar\nDisallow: /comparar\n\nSitemap: ${base}/sitemap.xml\n`;
}

export function renderSitemapXml(appUrl: string, extra: Array<{ path: string; lastmod?: Date }> = []): string {
  const base = appUrl.replace(/\/$/, '');
  const articleUrls = extra.map((e) => `  <url><loc>${base}${e.path}</loc>${e.lastmod ? `<lastmod>${e.lastmod.toISOString().slice(0, 10)}</lastmod>` : ''}<changefreq>monthly</changefreq><priority>0.6</priority></url>`);
  const urls = [...SITEMAP_PATHS.map((p) => `  <url><loc>${base}${p === '/' ? '/' : p}</loc><changefreq>${p === '/' || p === '/planos' ? 'weekly' : 'monthly'}</changefreq><priority>${p === '/' ? '1.0' : p === '/planos' || p === '/fipe' ? '0.9' : '0.7'}</priority></url>`), ...articleUrls].join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

export function renderSeoHtml(template: string, pathname: string, appUrl: string, override: SeoOverride = {}): string {
  const normalized = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  const base0 = pageMeta[normalized] ?? pageMeta['/'];
  const meta = { title: override.title ?? base0.title, description: override.description ?? base0.description };
  const baseUrl = appUrl.replace(/\/$/, '');
  const canonical = `${baseUrl}${normalized === '/' ? '/' : normalized}`;
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const routeSchema = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: meta.title,
    description: meta.description,
    url: canonical,
    inLanguage: 'pt-BR',
    isPartOf: { '@type': 'WebSite', name: 'Placa na Mão', url: `${baseUrl}/` },
    publisher: { '@type': 'Organization', name: 'Placa na Mão', url: `${baseUrl}/` }
  }).replace(/</g, '\\u003c');
  const extraLd = (override.jsonLd ?? []).map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`).join('\n  ');
  const noindex = NOINDEX.test(normalized);
  return template
    .replace(/https:\/\/placanamao\.com\.br(?=\/brand\/)/g, baseUrl)
    .replace(/<meta name="robots" content="[^"]*"\s*\/>/, noindex ? '<meta name="robots" content="noindex,nofollow" />' : '<meta name="robots" content="index,follow,max-image-preview:large" />')
    .replace(/<title>.*?<\/title>/s, `<title>${title}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/>/, `<meta name="description" content="${description}" />`)
    .replace(/<link rel="canonical" href="[^"]*"\s*\/>/, `<link rel="canonical" href="${escapeHtml(canonical)}" />`)
    .replace(/<meta property="og:title" content="[^"]*"\s*\/>/, `<meta property="og:title" content="${title}" />`)
    .replace(/<meta property="og:description" content="[^"]*"\s*\/>/, `<meta property="og:description" content="${description}" />`)
    .replace(/<meta property="og:url" content="[^"]*"\s*\/>/, `<meta property="og:url" content="${escapeHtml(canonical)}" />`)
    .replace(/<meta name="twitter:title" content="[^"]*"\s*\/>/, `<meta name="twitter:title" content="${title}" />`)
    .replace(/<meta name="twitter:description" content="[^"]*"\s*\/>/, `<meta name="twitter:description" content="${description}" />`)
    .replace('</head>', `<script id="pnm-route-schema" type="application/ld+json">${routeSchema}</script>${extraLd ? `\n  ${extraLd}` : ''}\n  </head>`);
}

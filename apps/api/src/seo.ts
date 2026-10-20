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
  '/desenvolvedores': { title: 'API de consulta veicular para desenvolvedores | Placa na Mão', description: 'Integre consultas veiculares ao seu sistema com a API Placa na Mão: chaves, limites de uso e resposta JSON padronizada.' },
  '/entrar': { title: 'Entrar | Placa na Mão', description: 'Acesse sua conta Placa na Mão.' },
  '/criar-conta': { title: 'Criar conta | Placa na Mão', description: 'Crie sua conta Placa na Mão e faça sua primeira consulta veicular.' },
  '/termos': { title: 'Termos de Uso | Placa na Mão', description: 'Conheça as regras de uso, limites e responsabilidades da plataforma Placa na Mão.' },
  '/privacidade': { title: 'Política de Privacidade | Placa na Mão', description: 'Entenda como a Placa na Mão trata dados pessoais, segurança, retenção e direitos dos titulares.' }
};

/** Páginas públicas indexáveis (entram no sitemap). Telas de conta e do app ficam de fora. */
export const SITEMAP_PATHS: string[] = Object.keys(pageMeta).filter((p) => !['/entrar', '/criar-conta'].includes(p));
const NOINDEX = /^\/(entrar|criar-conta|recuperar-senha|app|painel|validar|validar-relatorio|consultar)(\/|$)/;

export function renderRobotsTxt(appUrl: string, adminHost: boolean): string {
  if (adminHost) return 'User-agent: *\nDisallow: /\n';
  const base = appUrl.replace(/\/$/, '');
  return `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /app/\nDisallow: /painel\nDisallow: /entrar\nDisallow: /criar-conta\nDisallow: /recuperar-senha\nDisallow: /validar\n\nSitemap: ${base}/sitemap.xml\n`;
}

export function renderSitemapXml(appUrl: string): string {
  const base = appUrl.replace(/\/$/, '');
  const urls = SITEMAP_PATHS.map((p) => `  <url><loc>${base}${p === '/' ? '/' : p}</loc><changefreq>${p === '/' || p === '/planos' ? 'weekly' : 'monthly'}</changefreq><priority>${p === '/' ? '1.0' : p === '/planos' || p === '/fipe' ? '0.9' : '0.7'}</priority></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

export function renderSeoHtml(template: string, pathname: string, appUrl: string): string {
  const normalized = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  const meta = pageMeta[normalized] ?? pageMeta['/'];
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
    .replace('</head>', `<script id="pnm-route-schema" type="application/ld+json">${routeSchema}</script>\n  </head>`);
}

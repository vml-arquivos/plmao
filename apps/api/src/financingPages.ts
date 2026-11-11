import { pool } from './db.js';
import { pageMeta, SITEMAP_PATHS } from './seo.js';
import { loadBanks, loadBcbBankRates } from './financingBanks.js';
import { loadFinancingSettings } from './financingSettings.js';
import { normalizeName, pickBankRate, type BankConfig, type BcbBankRate } from './lib/bankRates.js';
import { runBankComparison, simulationBody } from './simulator/service.js';

/**
 * Páginas "Financiamento de carro {banco}" (uma por banco com taxa) e a página-índice /financiamento.
 * Também aceita páginas criadas à mão no painel de SEO (qualquer endereço /financiamento/<nome>).
 * Elas entram no mesmo cadastro de páginas de SEO (pageMeta e sitemap), então painel, sitemap, imagem e verificação funcionam como nas demais.
 */
export const FIN_HUB = '/financiamento';
export const FIN_PREFIX = '/financiamento/';
const SITE = 'Placa na Mão';
const fem = (n: string) => /^caixa\b/i.test(n);
const de = (n: string) => `${fem(n) ? 'da' : 'do'} ${n}`;
const em = (n: string) => `${fem(n) ? 'na' : 'no'} ${n}`;
const art = (n: string) => `${fem(n) ? 'a' : 'o'} ${n}`;

export type FinKind = 'hub' | 'bank' | 'custom';
interface Registered { kind: FinKind; name: string; bankId?: string; defaultH1: string; keyword: string }
const registry = new Map<string, Registered>();
let syncedAt = 0;
let syncing: Promise<void> | null = null;
export const invalidateFinancingPages = () => { syncedAt = 0; };

export const slugify = (s: string) => normalizeName(s).toLowerCase().replace(/ /g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
export const isFinancingPath = (p: string) => p === FIN_HUB || p.startsWith(FIN_PREFIX);
export const financingInfo = (path: string): Registered | null => registry.get(path) ?? null;
export const isCustomFinancingPath = (path: string) => registry.get(path)?.kind === 'custom';

/** Primeiro candidato que cabe em `max`; nunca corta no meio da palavra. */
const firstFit = (max: number, candidates: string[]): string => candidates.find((c) => c.length <= max) ?? candidates[candidates.length - 1]!.slice(0, max).replace(/\s+\S*$/, '').trimEnd();

export function bankMeta(name: string): { title: string; description: string } {
  return {
    title: firstFit(65, [
      `Financiamento de carro ${name}: taxa e simulação | ${SITE}`,
      `Financiamento de carro ${name} | ${SITE}`,
      `Financiamento de carro ${name}`
    ]),
    description: firstFit(165, [
      `Financiamento de carro ${name}: veja a taxa de juros ${de(name)}, simule a parcela, o CET e o custo total e compare com outros bancos. Grátis.`,
      `Financiamento de carro ${name}: veja a taxa de juros ${de(name)}, simule a parcela e o CET e compare com outros bancos. Grátis.`,
      `Financiamento de carro ${name}: veja a taxa, simule a parcela e o CET e compare com outros bancos. Grátis.`,
      `Financiamento de carro ${name}: veja a taxa, simule a parcela e compare com outros bancos.`
    ])
  };
}

interface BankPage { path: string; bank: BankConfig; monthlyPct: number }

async function eligibleBanks(): Promise<{ pages: BankPage[]; bcb: BcbBankRate[]; banks: BankConfig[] }> {
  const [banks, bcb] = await Promise.all([loadBanks(true), loadBcbBankRates()]);
  const used = new Set<string>();
  const pages: BankPage[] = [];
  for (const bank of banks) {
    const rate = pickBankRate(bank, 'CDC', 'PF', bcb);
    if (!rate) continue;
    let slug = slugify(bank.name) || 'banco'; let n = 2;
    while (used.has(slug)) slug = `${slugify(bank.name)}-${n++}`;
    used.add(slug);
    pages.push({ path: `${FIN_PREFIX}${slug}`, bank, monthlyPct: rate.pct });
  }
  return { pages, bcb, banks };
}

/** Atualiza o cadastro de páginas de SEO com os bancos que têm taxa e as páginas criadas no painel. Cache de 60 s. */
export function syncFinancingPages(force = false): Promise<void> {
  if (!force && Date.now() - syncedAt < 60_000) return Promise.resolve();
  if (syncing) return syncing;
  syncing = (async () => {
    try {
      const { pages } = await eligibleBanks();
      const custom = (await pool.query(`SELECT path,h1,title,description,keyword FROM seo_pages WHERE path LIKE '/financiamento/%'`)).rows as Array<{ path: string; h1: string | null; title: string | null; description: string | null; keyword: string | null }>;
      for (const p of [...registry.keys()]) {
        delete pageMeta[p];
        const i = SITEMAP_PATHS.indexOf(p); if (i >= 0) SITEMAP_PATHS.splice(i, 1);
      }
      registry.clear();
      const add = (path: string, meta: { title: string; description: string }, reg: Registered) => { registry.set(path, reg); pageMeta[path] = meta; SITEMAP_PATHS.push(path); };
      const bankPaths = new Set<string>();
      for (const p of pages) {
        const m = bankMeta(p.bank.name);
        add(p.path, m, { kind: 'bank', name: p.bank.name, bankId: p.bank.id, defaultH1: `Financiamento de carro ${p.bank.name}`, keyword: `financiamento de carro ${p.bank.name}` });
        bankPaths.add(p.path);
      }
      for (const c of custom) {
        if (bankPaths.has(c.path) || !/^\/financiamento\/[a-z0-9]+(-[a-z0-9]+)*$/.test(c.path)) continue;
        const name = c.h1 || c.path.slice(FIN_PREFIX.length).replace(/-/g, ' ');
        add(c.path, { title: c.title || `${name} | ${SITE}`, description: c.description || `${name}: simule o financiamento e compare as taxas. Grátis.` }, { kind: 'custom', name, defaultH1: name, keyword: c.keyword ?? '' });
      }
      if (registry.size) add(FIN_HUB, {
        title: `Financiamento de carro por banco: compare taxas | ${SITE}`,
        description: 'Financiamento de carro por banco: veja a taxa de Bradesco, Santander, Caixa, C6 e outros, simule a parcela e compare o custo total.'
      }, { kind: 'hub', name: 'Financiamento de carro por banco', defaultH1: 'Financiamento de carro por banco', keyword: 'financiamento de carro por banco' });
      syncedAt = Date.now();
    } catch { /* sem banco ou sem taxa: mantém o que já estava */ } finally { syncing = null; }
  })();
  return syncing;
}

const brl = (cents: number) => `R$ ${Math.floor(cents / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${String(Math.abs(cents) % 100).padStart(2, '0')}`;
const brlRound = (cents: number) => `R$ ${Math.round(cents / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
const pct = (v: number) => `${v.toFixed(2).replace('.', ',')}%`;
const dateBr = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return d && m && y ? `${d}/${m}/${y}` : iso; };
const annualOf = (monthly: number) => (Math.pow(1 + monthly / 100, 12) - 1) * 100;

export interface FinancingLink { path: string; name: string; monthlyPct: number | null }
export interface FinancingContent {
  path: string; kind: FinKind; name: string; h1: string; title: string; description: string;
  blocks: Array<{ h: string; p: string }>;
  faq: Array<{ q: string; a: string }>;
  links: FinancingLink[];
  /** só no índice: a tabela com a taxa de cada banco */
  table: FinancingLink[];
}

/** Conteúdo gerado a partir das taxas reais (Banco Central ou cadastradas pela equipe). Sem taxa, a página do banco nem existe. */
export async function financingContent(path: string): Promise<FinancingContent | null> {
  await syncFinancingPages();
  const reg = registry.get(path);
  if (!reg) return null;
  const meta = pageMeta[path]!;
  const base = { path, kind: reg.kind, name: reg.name, h1: reg.defaultH1, title: meta.title, description: meta.description, blocks: [] as FinancingContent['blocks'], faq: [] as FinancingContent['faq'], links: [] as FinancingLink[], table: [] as FinancingLink[] };
  const { pages, bcb, banks } = await eligibleBanks();
  const asLink = (p: BankPage): FinancingLink => ({ path: p.path, name: p.bank.name, monthlyPct: p.monthlyPct });
  if (reg.kind === 'custom') {
    base.links = [{ path: '/simulador/carro', name: 'Simulador de financiamento de carro', monthlyPct: null }, ...(registry.has(FIN_HUB) ? [{ path: FIN_HUB, name: 'Financiamento de carro por banco', monthlyPct: null }] : [])];
    return base;
  }
  if (reg.kind === 'hub') {
    base.table = [...pages].sort((a, b) => a.monthlyPct - b.monthlyPct).map(asLink);
    base.blocks = [
      { h: 'Taxa de financiamento de carro em cada banco', p: 'A tabela mostra a taxa mensal de cada banco para financiamento de carro (CDC, pessoa física), com base nas taxas que as instituições informam ao Banco Central ou na taxa de referência cadastrada. A taxa que você recebe depende da análise de crédito, da entrada, do prazo e do veículo.' },
      { h: 'Como comparar bancos', p: 'Compare pelo CET (custo efetivo total), não só pela taxa: ele soma juros, IOF e tarifas. Abra a página do banco para ver um exemplo de parcela ou use o simulador gratuito com a taxa da sua proposta.' }
    ];
    base.links = [{ path: '/simulador/carro', name: 'Simulador de financiamento de carro', monthlyPct: null }];
    return base;
  }
  const mine = pages.find((p) => p.path === path);
  if (!mine) return null;
  const name = mine.bank.name;
  const rate = pickBankRate(mine.bank, 'CDC', 'PF', bcb)!;
  const annual = annualOf(rate.pct);
  const origin = rate.source === 'bcb'
    ? `Segundo as taxas que as instituições informam ao Banco Central${rate.period ? `, a taxa ${de(name)} no financiamento de veículos para pessoa física no período de ${dateBr(rate.period)}` : `, a taxa ${de(name)} no financiamento de veículos para pessoa física`} é de ${pct(rate.pct)} ao mês (cerca de ${pct(annual)} ao ano).`
    : `A taxa de referência cadastrada para ${art(name)} no financiamento de veículos para pessoa física é de ${pct(rate.pct)} ao mês (cerca de ${pct(annual)} ao ano).`;
  base.blocks.push({ h: `Taxa ${de(name)} no financiamento de carro`, p: `${origin} A taxa que você recebe depende da análise de crédito, da entrada, do prazo e do veículo.` });
  try {
    const body = simulationBody.parse({ modality: 'CDC', personType: 'PF', vehicleKind: 'CAR', condition: 'USED', vehicleValueCents: 6_000_000, downPaymentCents: 1_200_000, months: 48 });
    const offer = runBankComparison(body, await loadFinancingSettings(), [mine.bank], bcb).find((o) => o.modality === 'CDC');
    if (offer) base.blocks.push({ h: `Exemplo de parcela ${em(name)}`, p: `Financiando um carro de ${brlRound(6_000_000)} com ${brlRound(1_200_000)} de entrada em 48 meses, a taxa de ${pct(offer.ratePct)} ao mês resulta em parcela estimada de ${brl(offer.installmentCents)}, total pago de ${brl(offer.totalPaidCents)} e CET de ${pct(offer.cetAnnualPct)} ao ano. É uma estimativa com IOF e tarifas padrão: a proposta do banco pode variar.` });
  } catch { /* sem exemplo, a página continua com a taxa */ }
  base.blocks.push({ h: `Como simular o financiamento ${de(name)}`, p: `Informe o valor do veículo, a entrada e o prazo no simulador gratuito. Se você já tem a proposta ${de(name)}, digite a taxa dela para um cálculo fiel. Compare CDC e leasing, veja parcela, IOF e CET e baixe o PDF para levar ao banco.` });
  base.faq = [
    { q: `Qual a taxa de juros ${de(name)} para financiar um carro?`, a: `${origin} Sua taxa real depende da análise de crédito do banco.` },
    { q: `Como simular o financiamento de carro ${de(name)}?`, a: `Use o simulador gratuito: informe valor, entrada e prazo e, se tiver a proposta ${de(name)}, a taxa dela. Você vê a parcela, o IOF, o CET e o custo total.` },
    { q: `Vale comparar ${art(name)} com outros bancos?`, a: 'Sim. Compare pelo CET, que soma juros, IOF e tarifas, e peça propostas em mais de uma instituição antes de decidir.' }
  ];
  void banks;
  base.links = [
    { path: '/simulador/carro', name: 'Simulador de financiamento de carro', monthlyPct: null },
    ...(registry.has(FIN_HUB) ? [{ path: FIN_HUB, name: 'Financiamento de carro por banco', monthlyPct: null }] : []),
    ...pages.filter((p) => p.path !== path).sort((a, b) => a.monthlyPct - b.monthlyPct).slice(0, 8).map(asLink)
  ];
  return base;
}

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/** HTML inicial (o que o Google lê). A tela mostra os mesmos blocos, tabela e links. */
export function financingBodyHtml(c: FinancingContent, withFaq: boolean): string {
  const blocks = c.blocks.map((b) => `<section><h2>${esc(b.h)}</h2><p>${esc(b.p)}</p></section>`).join('');
  const table = c.table.length ? `<section><h2>Taxa por banco</h2><ul>${c.table.map((t) => `<li><a href="${esc(t.path)}">Financiamento de carro ${esc(t.name)}</a>${t.monthlyPct != null ? `: ${esc(pct(t.monthlyPct))} ao mês` : ''}</li>`).join('')}</ul></section>` : '';
  const faq = withFaq && c.faq.length ? `<section><h2>Perguntas frequentes</h2>${c.faq.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join('')}</section>` : '';
  const links = c.links.length ? `<section><h2>Veja também</h2><ul>${c.links.map((l) => `<li><a href="${esc(l.path)}">${l.path.startsWith(FIN_PREFIX) ? `Financiamento de carro ${esc(l.name)}` : esc(l.name)}</a>${l.monthlyPct != null ? `: ${esc(pct(l.monthlyPct))} ao mês` : ''}</li>`).join('')}</ul></section>` : '';
  return blocks + table + faq + links;
}

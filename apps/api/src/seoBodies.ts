import { pool } from './db.js';
import { SPEC_FIELDS } from './lib/vehicleSpecs.js';

/**
 * Conteúdo real no HTML inicial das páginas que o app monta no navegador (veículos, artigos, planos).
 * O Google lê esse HTML antes de rodar o JavaScript: com só título e menu ele marca a página como "soft 404".
 * Tudo aqui é público (o mesmo que qualquer visitante vê), sem custo, margem ou dado de conta.
 */

export const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
const brl = (cents: number): string => `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;

function safeHref(url: string): string | null {
  const u = url.trim();
  if (/^https?:\/\//i.test(u)) return u;
  if (/^\/(?![/\\])/.test(u) && !u.includes('\\')) return u;
  return null;
}

function inlineHtml(text: string): string {
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
  let out = ''; let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out += esc(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('**')) out += `<strong>${esc(tok.slice(2, -2))}</strong>`;
    else if (tok.startsWith('`')) out += `<code>${esc(tok.slice(1, -1))}</code>`;
    else if (tok.startsWith('[')) {
      const mm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(tok);
      const href = mm ? safeHref(mm[2]!) : null;
      out += mm && href ? `<a href="${esc(href)}">${esc(mm[1])}</a>` : esc(tok);
    } else out += `<em>${esc(tok.slice(1, -1))}</em>`;
    last = m.index + tok.length;
  }
  return out + esc(text.slice(last));
}

/** Mesmo markdown enxuto do app (títulos, listas, citação, negrito, itálico, links), já como HTML seguro. */
export function markdownToHtml(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    const h = /^(#{2,3})\s+(.+)$/.exec(line);
    if (h) { const tag = h[1]!.length === 2 ? 'h2' : 'h3'; blocks.push(`<${tag}>${inlineHtml(h[2]!.trim())}</${tag}>`); i++; continue; }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) { items.push(lines[i]!.replace(/^\s*[-*]\s+/, '')); i++; }
      blocks.push(`<ul>${items.map((t) => `<li>${inlineHtml(t)}</li>`).join('')}</ul>`); continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i]!)) { items.push(lines[i]!.replace(/^\s*\d+[.)]\s+/, '')); i++; }
      blocks.push(`<ol>${items.map((t) => `<li>${inlineHtml(t)}</li>`).join('')}</ol>`); continue;
    }
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) { quote.push(lines[i]!.replace(/^>\s?/, '')); i++; }
      blocks.push(`<blockquote>${inlineHtml(quote.join(' '))}</blockquote>`); continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() && !/^(#{2,3}\s|\s*[-*]\s+|\s*\d+[.)]\s+|>\s?)/.test(lines[i]!)) { para.push(lines[i]!.trim()); i++; }
    blocks.push(`<p>${inlineHtml(para.join(' '))}</p>`);
  }
  return blocks.join('');
}

function plainPreview(md: string, max: number): string {
  const text = md.replace(/^#{1,6}\s+/gm, '').replace(/^\s*[-*+]\s+/gm, '').replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max); const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

/** Texto completo do artigo publicado (null se não existe ou não está publicado). */
export async function articleBodyHtml(slug: string): Promise<string | null> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return null;
  const row = await pool.query(`SELECT excerpt,body,category,author,published_at FROM articles WHERE slug=$1 AND status='PUBLISHED' AND published_at <= now()`, [slug]);
  if (!row.rowCount) return null;
  const a = row.rows[0]!;
  const date = new Date(String(a.published_at)).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return `<article><p><small>${esc(a.category)} · ${esc(a.author)} · ${esc(date)}</small></p>${a.excerpt ? `<p><strong>${esc(a.excerpt)}</strong></p>` : ''}${markdownToHtml(String(a.body ?? ''))}<p><a href="/blog">Mais artigos</a> · <a href="/consulta-placa">Consulta de placa</a> · <a href="/planos">Preços</a></p></article>`;
}

const HIGHLIGHT_FIELDS = SPEC_FIELDS.filter((f) => f.highlight);

/** Ficha pública do modelo: o que qualquer visitante vê sem conta (resumo, prévia da análise, pontos fortes e fracos, versões e destaques). */
export async function vehicleBodyHtml(slug: string): Promise<string | null> {
  const m = await pool.query(`SELECT id,brand,name,summary,review,pros,cons,body_type,year_from,year_to FROM vehicle_models WHERE slug=$1 AND status='PUBLISHED' AND archived_at IS NULL`, [slug]);
  if (!m.rowCount) return null;
  const model = m.rows[0]!;
  const [versions, rating] = await Promise.all([
    pool.query('SELECT name,year_model,fuel,specs FROM vehicle_versions WHERE model_id=$1 AND active ORDER BY year_model DESC NULLS LAST, display_order, name LIMIT 12', [model.id]),
    pool.query(`SELECT count(*)::int AS n, round(avg(rating)::numeric,1) AS avg FROM vehicle_opinions WHERE status='APPROVED' AND model_id=$1`, [model.id])
  ]);
  const name = `${model.brand} ${model.name}`;
  const pros: string[] = (Array.isArray(model.pros) ? model.pros : []).slice(0, 2).map(String);
  const cons: string[] = (Array.isArray(model.cons) ? model.cons : []).slice(0, 2).map(String);
  const years = model.year_from ? `${model.year_from}${model.year_to && model.year_to !== model.year_from ? ` a ${model.year_to}` : ''}` : '';
  const n = Number(rating.rows[0]?.n ?? 0);
  const intro = [model.body_type ? `${name} é um ${String(model.body_type).toLowerCase()}` : `Ficha do ${name}`, years ? `vendido de ${years}` : ''].filter(Boolean).join(' ');
  const verRows = versions.rows.map((v) => {
    const specs = (v.specs ?? {}) as Record<string, unknown>;
    const hl = HIGHLIGHT_FIELDS.filter((f) => specs[f.key] !== undefined && specs[f.key] !== null && specs[f.key] !== '').slice(0, 4)
      .map((f) => `${f.label}: ${esc(specs[f.key])}${f.unit ? ` ${esc(f.unit)}` : ''}`).join(' · ');
    return `<li><strong>${esc(v.name)}</strong>${v.year_model ? ` (${esc(v.year_model)})` : ''}${v.fuel ? ` · ${esc(v.fuel)}` : ''}${hl ? `<br>${hl}` : ''}</li>`;
  }).join('');
  return `<article><p>${esc(intro)}.</p>${model.summary ? `<p>${esc(model.summary)}</p>` : ''}`
    + (n > 0 ? `<p>Nota dos donos: ${esc(rating.rows[0]!.avg)} de 5 em ${n} ${n === 1 ? 'avaliação' : 'avaliações'}.</p>` : '')
    + (model.review ? `<h2>Análise</h2><p>${esc(plainPreview(String(model.review), 320))}</p>` : '')
    + (pros.length ? `<h2>Pontos fortes</h2><ul>${pros.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '')
    + (cons.length ? `<h2>Pontos de atenção</h2><ul>${cons.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '')
    + (verRows ? `<h2>Versões</h2><ul>${verRows}</ul>` : '')
    + `<p><a href="/veiculos">Guia de veículos</a> · <a href="/consulta-placa">Consultar a placa antes de comprar</a> · <a href="/fipe">Tabela FIPE</a></p></article>`;
}

/** Consultas e pacotes à venda, com o preço que o visitante vê. Nada de custo ou margem. */
export async function plansBodyHtml(): Promise<string | null> {
  const [products, packages] = await Promise.all([
    pool.query(`SELECT name,tagline,description,price_cents,is_free,features FROM query_products WHERE active=true AND commercial_status <> 'HIDDEN' ORDER BY display_order,price_cents`),
    pool.query('SELECT name,description,highlights,credits,price_cents FROM credit_packages WHERE active=true ORDER BY display_order,price_cents')
  ]);
  if (!products.rowCount && !packages.rowCount) return null;
  const prod = products.rows.map((p) => {
    const price = p.is_free ? 'Grátis' : brl(Number(p.price_cents ?? 0));
    const feats = (Array.isArray(p.features) ? p.features : []).slice(0, 8).map((f: unknown) => `<li>${esc(f)}</li>`).join('');
    return `<li><h3>${esc(p.name)} · ${price}</h3>${p.tagline ? `<p><strong>${esc(p.tagline)}</strong></p>` : ''}<p>${esc(p.description)}</p>${feats ? `<ul>${feats}</ul>` : ''}</li>`;
  }).join('');
  const pack = packages.rows.map((p) => {
    const hl = (Array.isArray(p.highlights) ? p.highlights : []).map((h: unknown) => `<li>${esc(h)}</li>`).join('');
    return `<li><h3>${esc(p.name)} · ${brl(Number(p.price_cents))}</h3><p>${esc(p.description)}</p>${hl ? `<ul>${hl}</ul>` : ''}</li>`;
  }).join('');
  return `<section>${prod ? `<h2>Consultas</h2><ul>${prod}</ul>` : ''}${pack ? `<h2>Pacotes de saldo</h2><ul>${pack}</ul>` : ''}<p>Sem mensalidade: você paga só pela consulta que fizer, com o preço visível antes do pagamento.</p></section>`;
}

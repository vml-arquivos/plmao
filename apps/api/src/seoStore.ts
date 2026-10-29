import { pool } from './db.js';
import { NO_FAQ_PATHS, SEO_SEED_BY_PATH } from './seoSeed.js';
import type { SeoFaq, SeoSection } from './seoSeed.js';

/** Conteúdo de SEO editado no painel (tabela seo_pages), com cache curto e invalidação ao salvar. */
export interface SeoRow { path: string; h1: string | null; title: string | null; description: string | null; keyword: string | null; sections: SeoSection[]; faq: SeoFaq[]; noindex: boolean; updatedAt: Date }
let cache: { at: number; map: Map<string, SeoRow> } | null = null;
export const invalidateSeo = () => { cache = null; };

export async function seoRows(): Promise<Map<string, SeoRow>> {
  if (cache && Date.now() - cache.at < 60_000) return cache.map;
  const map = new Map<string, SeoRow>();
  try {
    const r = await pool.query('SELECT path,h1,title,description,keyword,sections,faq,noindex,updated_at FROM seo_pages');
    for (const x of r.rows) map.set(x.path, { path: x.path, h1: x.h1 ?? null, title: x.title, description: x.description, keyword: x.keyword, sections: Array.isArray(x.sections) ? x.sections : [], faq: Array.isArray(x.faq) ? x.faq : [], noindex: !!x.noindex, updatedAt: x.updated_at });
  } catch { /* tabela ainda não migrada: segue com os padrões */ }
  cache = { at: Date.now(), map };
  return map;
}

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/** Texto que o Google lê no HTML inicial (o app mostra o mesmo conteúdo na tela). */
export function seoBodyHtml(row: SeoRow): string {
  const sections = row.sections.map((s) => `<section><h2>${esc(s.h)}</h2><p>${esc(s.p)}</p></section>`).join('');
  const faq = row.faq.length ? `<section><h2>Perguntas frequentes</h2>${row.faq.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join('')}</section>` : '';
  return sections + faq;
}
export const seoFaqLd = (row: SeoRow) => row.faq.length ? { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: row.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) } : null;

const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
export interface SeoCheck { ok: boolean; label: string }
/** Lista de verificação no estilo dos plugins de SEO: o que está bom e o que ajustar. */
export const H1_MAX = 30;
export function seoChecks(v: { h1: string; needsFaq: boolean; title: string; description: string; keyword: string | null; sections: SeoSection[]; faq: SeoFaq[]; noindex: boolean; hasContent: boolean }): SeoCheck[] {
  const kw = v.keyword ? norm(v.keyword).trim() : '';
  const text = norm(v.sections.map((s) => `${s.h} ${s.p}`).join(' '));
  const checks: SeoCheck[] = [
    { ok: v.h1.length > 0 && v.h1.length <= H1_MAX, label: v.h1 ? `H1 com ${v.h1.length} caracteres (ideal: até ${H1_MAX})` : `H1 não definido (ideal: até ${H1_MAX} caracteres)` },
    { ok: v.title.length >= 30 && v.title.length <= 65, label: `Título com ${v.title.length} caracteres (ideal: 30 a 65)` },
    { ok: v.description.length >= 70 && v.description.length <= 165, label: `Descrição com ${v.description.length} caracteres (ideal: 70 a 165)` },
    { ok: !!kw, label: 'Palavra-chave principal definida' }
  ];
  if (kw) {
    checks.push({ ok: norm(v.h1).includes(kw), label: 'Palavra-chave no H1' });
    checks.push({ ok: norm(v.title).includes(kw), label: 'Palavra-chave no título' });
    checks.push({ ok: norm(v.description).includes(kw), label: 'Palavra-chave na descrição' });
    if (v.hasContent) checks.push({ ok: text.includes(kw) || norm(v.faq.map((f) => `${f.q} ${f.a}`).join(' ')).includes(kw), label: 'Palavra-chave no texto da página' });
  }
  if (v.needsFaq) checks.push({ ok: v.faq.length >= 3, label: `${v.faq.length} pergunta(s) frequente(s) (ideal: 3 ou mais)` });
  checks.push({ ok: !v.noindex, label: 'Página liberada para o Google (indexável)' });
  return checks;
}

export const needsFaq = (path: string) => !NO_FAQ_PATHS.has(path);
export const seedFor = (path: string) => SEO_SEED_BY_PATH.get(path) ?? null;

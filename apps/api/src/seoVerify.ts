import { SITEMAP_PATHS } from './seo.js';

/**
 * Verificação técnica de publicação: compara o que está salvo no painel de SEO com o HTML que o servidor entrega na URL pública.
 * Só olha páginas do próprio sistema (lista fixa de rotas), sem cookies e sem seguir redirecionamentos.
 * Não executa o JavaScript do app e não consulta o Google: o que aparece na tela depois do carregamento e a situação no índice ficam de fora.
 */
export const VERIFY_SCOPE = 'HTML entregue pelo servidor para a URL pública (sem executar o JavaScript do app e sem consultar o Google)';

export interface PublishCheck { ok: boolean; label: string; detail?: string }
export interface PublishVerification { path: string; at: string; scope: string; status: 'OK' | 'DIVERGENCIA' | 'ERRO'; checks: PublishCheck[]; error?: string }
export interface Expected { path: string; baseUrl: string; title: string; description: string; h1: string; sections: Array<{ h: string; p: string }>; faq: Array<{ q: string; a: string }>; noindex: boolean }

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const one = (html: string, re: RegExp) => { const m = html.match(re); return m ? decode(m[1]!) : null; };
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();

export function compareHtmlWithPanel(html: string, e: Expected): PublishCheck[] {
  const checks: PublishCheck[] = [];
  const title = one(html, /<title>([^<]*)<\/title>/);
  checks.push({ ok: title !== null && flat(title) === flat(e.title), label: 'Título publicado igual ao do painel', ...(title !== null && flat(title) !== flat(e.title) ? { detail: `publicado: ${title}` } : {}) });
  const descs = [...html.matchAll(/<meta name="description" content="([^"]*)"/g)].map((m) => decode(m[1]!));
  checks.push({ ok: descs.length === 1 && flat(descs[0]!) === flat(e.description), label: 'Descrição publicada igual à do painel (uma só)', ...(descs.length !== 1 ? { detail: `${descs.length} descrições no HTML` } : flat(descs[0]!) !== flat(e.description) ? { detail: `publicada: ${descs[0]}` } : {}) });
  const cans = [...html.matchAll(/<link rel="canonical" href="([^"]*)"/g)].map((m) => decode(m[1]!));
  const wantCan = `${e.baseUrl.replace(/\/$/, '')}${e.path === '/' ? '/' : e.path}`;
  checks.push({ ok: cans.length === 1 && cans[0] === wantCan, label: 'Canonical aponta para a própria página (um só)', ...(cans.length !== 1 || cans[0] !== wantCan ? { detail: `encontrado: ${cans.join(', ') || 'nenhum'}; esperado: ${wantCan}` } : {}) });
  const robots = one(html, /<meta name="robots" content="([^"]*)"/) ?? '';
  const blocked = /noindex/i.test(robots);
  checks.push({ ok: blocked === e.noindex, label: e.noindex ? 'Página bloqueada para indexação, como no painel' : 'Página sem bloqueio de indexação no HTML', ...(blocked !== e.noindex ? { detail: `diretiva publicada: ${robots || 'nenhuma'}` } : {}) });
  if (e.h1) {
    const h1 = one(html, /<h1[^>]*>([^<]*)<\/h1>/);
    checks.push({ ok: h1 !== null && flat(h1) === flat(e.h1), label: 'H1 publicado igual ao do painel', ...(h1 === null || flat(h1) !== flat(e.h1) ? { detail: `publicado: ${h1 ?? 'nenhum'}` } : {}) });
  }
  const missingSections = e.sections.filter((s) => !html.includes(`<h2>${escape(s.h)}</h2>`));
  if (e.sections.length) checks.push({ ok: missingSections.length === 0, label: `${e.sections.length} bloco(s) do painel presentes no HTML`, ...(missingSections.length ? { detail: `ausentes: ${missingSections.map((s) => s.h).join(' | ')}` } : {}) });
  const missingFaq = e.faq.filter((f) => !html.includes(`<h3>${escape(f.q)}</h3>`) && !html.includes(`<h2>${escape(f.q)}</h2>`));
  if (e.faq.length) {
    checks.push({ ok: missingFaq.length === 0, label: `${e.faq.length} pergunta(s) do painel presentes no HTML`, ...(missingFaq.length ? { detail: `ausentes: ${missingFaq.map((f) => f.q).join(' | ')}` } : {}) });
    checks.push({ ok: /"@type":"FAQPage"/.test(html), label: 'Schema de perguntas (FAQPage) publicado' });
  }
  return checks;
}
const escape = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

const last = new Map<string, PublishVerification>();
export const lastVerification = (path: string): PublishVerification | null => last.get(path) ?? null;

/** Só rotas conhecidas do sistema, buscadas no próprio servidor (loopback). Nunca um endereço vindo do usuário. */
export async function verifyPublished(e: Expected, port: number, fetchImpl: typeof fetch = fetch): Promise<PublishVerification> {
  const at = new Date().toISOString();
  const done = (v: Omit<PublishVerification, 'path' | 'at' | 'scope'>): PublishVerification => { const r = { path: e.path, at, scope: VERIFY_SCOPE, ...v }; last.set(e.path, r); return r; };
  if (!SITEMAP_PATHS.includes(e.path)) return done({ status: 'ERRO', checks: [], error: 'Página fora da lista do sistema.' });
  try {
    const res = await fetchImpl(`http://127.0.0.1:${port}${e.path}`, { redirect: 'manual', headers: { accept: 'text/html', 'user-agent': 'PlacaNaMao-VerificaSEO' }, signal: AbortSignal.timeout(8000) });
    if (res.status !== 200) return done({ status: 'ERRO', checks: [], error: `O servidor respondeu ${res.status} para esta página.` });
    const checks = compareHtmlWithPanel(await res.text(), e);
    return done({ status: checks.every((c) => c.ok) ? 'OK' : 'DIVERGENCIA', checks });
  } catch (err) {
    return done({ status: 'ERRO', checks: [], error: err instanceof Error && err.name === 'TimeoutError' ? 'Tempo esgotado ao abrir a página.' : 'Não foi possível abrir a página.' });
  }
}

import type { ReportItem, ReportV2 } from './normalizeV2.js';
import { brlFromCents } from './format.js';
import { ownerIdentityEnabled } from './mask.js';
import type { ReportMeta } from './pdf.js';

const esc = (v: unknown) => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const VERDICT = { CLEAR: ['ok', 'Sem alertas'], ATTENTION: ['warn', 'Atenção'], HIGH_RISK: ['bad', 'Alto risco'], INCONCLUSIVE: ['neutral', 'Análise limitada'] } as const;

function cell(i: ReportItem) {
  const cls = i.state === 'ALERT' ? 'bad' : i.state === 'CLEAR' ? 'ok' : '';
  return `<div class="cell ${cls}"><span>${esc(i.label)}</span><strong>${i.state !== 'INFO' ? '<i></i>' : ''}${esc(i.display ?? i.value ?? '').replaceAll('\n', '<br>')}</strong></div>`;
}

/** Página de impressão autocontida (sem script inline: a CSP bloqueia). O botão é ligado por /print-helper.js. */
export function renderVehicleHtml(report: ReportV2, meta: ReportMeta): string {
  const [vcls, vlabel] = VERDICT[report.verdict.level];
  const hl = report.headline;
  const title = [hl.brand, hl.model].filter(Boolean).join(' ') || hl.fullModel || 'Veículo';
  const sub = [hl.manufactureYear && hl.modelYear ? `${hl.manufactureYear}/${hl.modelYear}` : hl.modelYear ?? hl.manufactureYear, hl.color, hl.fuel, [hl.city, hl.state].filter(Boolean).join(' - ')].filter(Boolean).join(' · ');
  const when = meta.consultedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const debts = !report.debtsHidden && report.debts.items.length
    ? `<section><h2>Resumo de débitos <em>${brlFromCents(report.debts.totalCents)}</em></h2><table>${report.debts.items.map((d) => `<tr><td>${esc(d.label)}</td><td>${brlFromCents(d.amountCents)}</td></tr>`).join('')}<tr class="total"><td>Total em aberto</td><td>${brlFromCents(report.debts.totalCents)}</td></tr></table>${report.debts.fineBreakdown.length ? `<p class="note">Multas por órgão (${report.debts.fineBreakdown.map((f) => `${esc(f.label.replace('Multas — ', ''))}: ${brlFromCents(f.amountCents)}`).join('; ')}) detalham o total de multas e não são somadas novamente.</p>` : ''}</section>`
    : '';
  const sections = report.sections.map((s) => {
    const shown = s.items.filter((i) => i.state !== 'NOT_PROVIDED' && !(s.key === 'DEBITOS' && i.kind === 'money' && i.state === 'CLEAR'));
    const missing = s.items.filter((i) => i.state === 'NOT_PROVIDED');
    if (!shown.length && !missing.length) return '';
    return `<section><h2><b class="dot ${s.status === 'ALERT' ? 'bad' : s.status === 'CLEAR' ? 'ok' : ''}"></b>${esc(s.label)}</h2>${shown.length ? `<div class="grid">${shown.map(cell).join('')}</div>` : '<p class="note">O provedor não retornou informações desta categoria para esta consulta.</p>'}${missing.length && shown.length ? `<p class="note">Não fornecido pelo provedor nesta consulta: ${esc(missing.map((m) => m.label).join(', '))}.</p>` : ''}</section>`;
  }).join('');
  const locked = report.lockedAlertCount ? `<div class="locked">Há ${report.lockedAlertCount} ponto(s) de atenção fora do plano contratado.</div>` : '';
  const outside = report.scope?.notIncluded.length ? `<p class="note">Não incluído neste produto: ${esc(report.scope.notIncluded.map((n) => n.label).join(', '))}. Isso não significa ausência de ocorrências.</p>` : '';
  const brand = esc(meta.brandName ?? 'Placa na Mão');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Relatório ${esc(report.plate)} — ${brand}</title><style>
:root{--ink:#0f0f14;--text:#1f2530;--muted:#6b7280;--line:#dcdcdc;--soft:#f4f4f4;--violet:#262626;--ok:#262626;--warn:#262626;--bad:#111}
@page{size:A4;margin:14mm}*{box-sizing:border-box}
body{margin:0;background:#f3f4f8;color:var(--text);font:14px/1.45 "DM Sans",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{max-width:820px;margin:24px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(15,15,20,.08)}
header{background:#262626;color:#fff;padding:22px 28px;border-bottom:3px solid var(--violet);display:flex;justify-content:space-between;gap:16px;align-items:center}
.logo{display:flex;gap:12px;align-items:center;font:800 20px "Plus Jakarta Sans",system-ui,sans-serif}.logo i{width:36px;height:36px;border-radius:8px;background:#fff;display:inline-block}
.meta{text-align:right;font-size:12px;color:#c9c9d6}.meta b{display:block;color:#fff;font:700 13px "Plus Jakarta Sans",system-ui,sans-serif}.meta span{color:#d4d4d4}
main{padding:24px 28px}.hero{display:flex;gap:20px;align-items:center;flex-wrap:wrap}
.plate{border:2px solid var(--ink);border-radius:9px;min-width:170px;text-align:center;overflow:hidden;background:#fff}.plate small{display:block;background:#262626;color:#fff;font:700 8px/12px sans-serif;letter-spacing:.14em}.plate strong{display:block;font:800 32px/1.25 "Plus Jakarta Sans",system-ui,sans-serif;letter-spacing:.06em;color:var(--ink)}
.hero h1{margin:0;font:800 22px "Plus Jakarta Sans",system-ui,sans-serif;color:var(--ink)}.hero p{margin:2px 0 0;color:var(--muted)}
.verdict{margin:20px 0;padding:16px 18px;border-radius:4px;border-left:5px solid var(--muted);background:#f4f4f4}.verdict.ok,.verdict.warn,.verdict.bad{background:#f4f4f4;border-color:#8a8a8a}.verdict.bad,.verdict.warn{border-color:#111}
.verdict b{display:inline-block;color:#fff;border-radius:99px;padding:2px 9px;font-size:10px;letter-spacing:.06em;text-transform:uppercase;background:var(--muted);margin-right:8px}.verdict.ok b,.verdict.warn b,.verdict.bad b{background:#262626}
.verdict h3{display:inline;margin:0;font:800 16px "Plus Jakarta Sans",system-ui,sans-serif;color:var(--ink)}.verdict p{margin:6px 0 0}
section{margin-top:22px;break-inside:avoid-page}h2{display:flex;align-items:center;gap:8px;margin:0 0 10px;padding-bottom:8px;border-bottom:1px solid var(--line);font:800 15px "Plus Jakarta Sans",system-ui,sans-serif;color:var(--ink)}h2 em{margin-left:auto;font-style:normal;color:var(--ink)}
.dot{width:9px;height:9px;border-radius:50%;background:#8a8a8a;display:inline-block}.dot.ok{background:#fff;border:2px solid #262626}.dot.bad{background:#111;border-radius:1px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 24px}.cell{break-inside:avoid}.cell span{display:block;color:var(--muted);font-size:10px;text-transform:uppercase;letter-spacing:.04em;font-weight:700}.cell strong{display:flex;align-items:center;gap:6px;font:600 14px "Plus Jakarta Sans",system-ui,sans-serif;color:var(--ink);word-break:break-word}
.cell i{width:7px;height:7px;border-radius:50%;background:var(--muted);flex:none}.cell.ok i{background:#fff;border:2px solid #262626}.cell.bad strong{font-weight:800}.cell.bad i{background:#111;border-radius:1px}
table{width:100%;border-collapse:collapse}td{padding:7px 4px;border-bottom:1px solid var(--line)}td+td{text-align:right;font-weight:700}tr.total td{border:0;background:var(--soft);font-weight:800}tr.total td+td{color:var(--ink)}
.note{color:var(--muted);font-size:12px;margin:8px 0 0}.locked{margin-top:20px;padding:12px 14px;border-radius:10px;background:var(--soft);color:var(--violet);font-weight:600}
footer{margin:26px 28px 24px;padding:14px 16px;background:var(--soft);border-radius:12px;font-size:11px;color:var(--muted)}footer b{color:var(--ink)}
.print{display:inline-block;margin:0 0 16px;padding:10px 18px;border:0;border-radius:10px;background:var(--violet);color:#fff;font:700 14px "Plus Jakarta Sans",system-ui,sans-serif;cursor:pointer}
.bar{max-width:820px;margin:16px auto 0;padding:0 8px}
@media(max-width:560px){.grid{grid-template-columns:1fr}header{flex-direction:column;align-items:flex-start}.meta{text-align:left}}
@media print{body{background:#fff}.sheet{margin:0;box-shadow:none;border-radius:0;max-width:none}.bar{display:none}}
</style></head><body><div class="bar"><button class="print" type="button" id="print-btn">Imprimir / salvar PDF</button></div><div class="sheet"><header><div class="logo"><i></i>${brand}</div><div class="meta"><b>Relatório de consulta veicular</b><span>Código ${esc(meta.verificationCode)}</span><br>${esc(when)}</div></header><main>
<div class="hero"><div class="plate"><small>BRASIL</small><strong>${esc(report.plate)}</strong></div><div><h1>${esc(title)}</h1><p>${esc(sub)}</p></div></div>
<div class="verdict ${vcls}"><b>${vlabel}</b><h3>${esc(report.verdict.title)}</h3><p>${esc(report.verdict.reason)}</p></div>
${debts}${sections}${outside}${locked}</main>
<footer><b>Validação:</b> código ${esc(meta.verificationCode)} — confira em ${esc(meta.verificationUrl.replace(/^https?:\/\//, ''))}.<br>Informações fornecidas por fonte de dados contratada, conforme retornado na data e hora da consulta; não substituem documentos oficiais nem certidões. ${ownerIdentityEnabled() ? 'Os dados de proprietários constam como retornados pela fonte e o uso é de responsabilidade de quem consulta (LGPD).' : 'Dados pessoais de proprietários pessoa física (nome e CPF) não são exibidos, em conformidade com a LGPD.'}<br>Produto: ${esc(meta.productName)}.</footer></div><script src="/print-helper.js"></script></body></html>`;
}

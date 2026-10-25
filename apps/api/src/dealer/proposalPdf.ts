import { rgb } from 'pdf-lib';
import { C, CW, Doc, H, M, W, clean, drawLogo, qr, rect } from '../report/pdf.js';
import { brlFromCents } from '../report/format.js';

export interface ProposalPdfData {
  code: string;
  createdAt: Date;
  validUntil: string; // YYYY-MM-DD
  store: { name: string; whatsapp: string | null; email: string | null; city: string | null; state: string | null };
  customerName: string;
  vehicleLabel: string;
  vehicleDetails: string[];
  priceCents: number;
  downPaymentCents: number;
  tradeInCents: number;
  financing: { months: number; installmentCents: number; ratePct: number; totalPaidCents: number; cetAnnualPct: number; principalCents: number } | null;
  notes: string;
  sellerName: string | null;
  qrUrl: string | null;
  siteUrl: string;
}

const dateBr = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
const pct = (v: number) => `${v.toFixed(2).replace('.', ',')}%`;
const phoneBr = (p: string) => { const d = p.replace(/^55(?=\d{10,11}$)/, ''); return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : p; };

function section(d: Doc, label: string) {
  d.ensure(34);
  const y = d.y - 14;
  d.text(label, M, y, 12, d.jx800, C.ink);
  d.page.drawLine({ start: { x: M, y: y - 8 }, end: { x: W - M, y: y - 8 }, thickness: 0.8, color: C.line });
  d.y = y - 20;
}

function row(d: Doc, label: string, value: string, strong = false) {
  d.ensure(20);
  if (strong) rect(d.page, { x: M, y: d.y - 18, width: CW, height: 20, color: C.soft, borderRadius: 4 });
  d.text(label, M + 8, d.y - 12, 9.5, strong ? d.dm700 : d.dm500, strong ? C.ink : C.muted, { maxWidth: CW * 0.6 });
  d.text(value, W - M - 8 - (strong ? d.jx800 : d.dm700).widthOfTextAtSize(clean(value), strong ? 11 : 9.5), d.y - 12, strong ? 11 : 9.5, strong ? d.jx800 : d.dm700, C.ink);
  d.y -= 22;
}

/** Proposta comercial em PDF: veículo, condições, simulação (quando houver) e contato da loja. */
export async function renderProposalPdf(p: ProposalPdfData): Promise<Buffer> {
  const d = await Doc.create();
  d.pdf.setTitle(`Proposta ${p.code} - ${p.store.name}`);
  d.pdf.setAuthor(p.store.name);
  d.pdf.setSubject('Proposta comercial de veículo');
  d.pdf.setCreationDate(p.createdAt);
  d.addPage();

  rect(d.page, { x: 0, y: H - 100, width: W, height: 100, color: C.ink });
  rect(d.page, { x: 0, y: H - 100, width: W, height: 3, color: C.violet });
  drawLogo(d, M, H - 68, 32, true);
  d.text(p.store.name, M + 42, H - 54, 16, d.jx800, C.white, { maxWidth: CW * 0.6 });
  const place = [p.store.city, p.store.state].filter(Boolean).join(' - ');
  if (place) d.text(place, M + 42, H - 68, 8, d.dm400, rgb(0.78, 0.78, 0.85));
  const title = 'Proposta comercial';
  d.text(title, W - M - d.jx700.widthOfTextAtSize(title, 11), H - 52, 11, d.jx700, C.white);
  const code = `Código ${p.code}`;
  d.text(code, W - M - d.dm500.widthOfTextAtSize(code, 8.5), H - 67, 8.5, d.dm500, C.lilac);
  const when = `Emitida em ${p.createdAt.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;
  d.text(when, W - M - d.dm400.widthOfTextAtSize(when, 8), H - 80, 8, d.dm400, rgb(0.78, 0.78, 0.85));
  d.y = H - 100 - 26;

  d.text(`Para ${p.customerName}`, M, d.y - 4, 10, d.dm500, C.muted, { maxWidth: CW });
  d.text(p.vehicleLabel, M, d.y - 26, 18, d.jx800, C.ink, { maxWidth: CW });
  d.y -= 40;
  if (p.vehicleDetails.length) { d.text(p.vehicleDetails.join('  ·  '), M, d.y - 4, 9.5, d.dm500, C.muted, { maxWidth: CW }); d.y -= 20; }

  section(d, 'Condições');
  row(d, 'Valor do veículo', brlFromCents(p.priceCents));
  if (p.downPaymentCents > 0) row(d, 'Entrada', `- ${brlFromCents(p.downPaymentCents)}`);
  if (p.tradeInCents > 0) row(d, 'Veículo na troca', `- ${brlFromCents(p.tradeInCents)}`);
  const balance = p.priceCents - p.downPaymentCents - p.tradeInCents;
  row(d, balance > 0 && p.financing ? 'Saldo a financiar' : 'Saldo a pagar', brlFromCents(balance), true);

  if (p.financing) {
    section(d, 'Simulação do financiamento');
    row(d, 'Parcelas', `${p.financing.months}x de ${brlFromCents(p.financing.installmentCents)}`, true);
    row(d, 'Taxa de juros', `${pct(p.financing.ratePct)} ao mês`);
    row(d, 'CET (custo efetivo total)', `${pct(p.financing.cetAnnualPct)} ao ano`);
    row(d, 'Total pago no financiamento', brlFromCents(p.financing.totalPaidCents));
    const lines = d.wrap('Simulação informativa, com taxa estimada. O valor final depende da aprovação de crédito e das condições da instituição financeira escolhida.', d.dm400, 8, CW - 8);
    lines.forEach((l) => { d.ensure(12); d.text(l, M + 4, d.y - 9, 8, d.dm400, C.muted); d.y -= 11; });
    d.y -= 6;
  }

  if (p.notes) {
    section(d, 'Observações');
    d.wrap(p.notes, d.dm400, 9, CW - 8).forEach((l) => { d.ensure(13); d.text(l, M + 4, d.y - 10, 9, d.dm400, C.text); d.y -= 13; });
    d.y -= 8;
  }

  section(d, 'Contato');
  if (p.sellerName) row(d, 'Vendedor', p.sellerName);
  if (p.store.whatsapp) row(d, 'WhatsApp', phoneBr(p.store.whatsapp));
  if (p.store.email) row(d, 'E-mail', p.store.email);
  row(d, 'Proposta válida até', dateBr(p.validUntil));

  if (p.qrUrl) {
    d.ensure(110);
    await qr(d, p.qrUrl, M + 4, d.y - 88, 80);
    d.text('Confira a consulta verificada deste veículo', M + 100, d.y - 40, 10, d.dm700, C.ink);
    d.text(p.qrUrl.replace(/^https?:\/\//, ''), M + 100, d.y - 55, 8.5, d.dm400, C.muted, { maxWidth: CW - 100 });
    d.y -= 100;
  }

  const foot = `${p.store.name} · Proposta ${p.code} · gerada com ${p.siteUrl.replace(/^https?:\/\//, '')}`;
  for (const pg of d.pages) pg.drawText(fitFoot(foot), { x: M, y: 24, size: 7.5, font: d.dm400, color: C.muted });
  return Buffer.from(await d.pdf.save());
}
function fitFoot(t: string): string { return clean(t).slice(0, 150); }

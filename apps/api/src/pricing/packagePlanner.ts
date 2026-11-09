import { marginAtPrice, type ProductCostInput } from './productPricing.js';
import type { PaymentSettings } from './settings.js';

/**
 * Calculadora de pacotes de saldo.
 *
 * O pacote vende saldo (em reais) com desconto: o cliente paga `priceCents` e recebe `faceCredits` reais para gastar em qualquer consulta.
 * Como o saldo pode ir para qualquer produto, o desconto máximo é o maior que ainda deixa TODOS os produtos pagos com a margem mínima
 * (sobre o custo, na pior forma de pagamento habilitada), já descontados impostos e taxas do meio de pagamento.
 * Nenhum valor de custo aparece no resultado: só as margens.
 */
export interface PlanProduct extends ProductCostInput { priceCents: number }
export interface PlanTierInput { slug: string; units: number; discountBps: number }

export interface PlanTier {
  slug: string;
  units: number;
  /** saldo entregue, em reais inteiros (o banco guarda inteiros) */
  faceCredits: number;
  priceCents: number;
  savingsCents: number;
  requestedDiscountBps: number;
  effectiveDiscountBps: number;
  capped: boolean;
  /** pior margem sobre o custo, entre todos os produtos e meios de pagamento, ao gastar o saldo deste pacote */
  worstMarginBps: number;
  worstProduct: string | null;
  equivalents: Array<{ id: string; name: string; count: number }>;
  highlights: string[];
}
export interface PackagePlan {
  referenceId: string; referenceName: string; referencePriceCents: number;
  marginFloorBps: number; capBps: number; limitingProduct: string | null;
  tiers: PlanTier[]; warnings: string[];
}

export const DEFAULT_TIERS: PlanTierInput[] = [
  { slug: 'essencial', units: 3, discountBps: 400 },
  { slug: 'completo', units: 10, discountBps: 800 },
  { slug: 'profissional', units: 30, discountBps: 1200 }
];

const baseOf = (s: PaymentSettings, p: ProductCostInput) => p.providerCostCents + (p.supplierCostCents ?? 0) + (s.marginBase === 'TOTAL_COST' ? s.operationalCostCents : 0);

/** Pior margem sobre o custo do produto vendido a `priceCents`, entre os meios de pagamento habilitados. */
function worstMargin(s: PaymentSettings, p: PlanProduct, priceCents: number): number {
  const base = baseOf(s, p);
  const rows = marginAtPrice(s, p, priceCents).filter((r) => s.enabledMethods.includes(r.method));
  const use = rows.length ? rows : marginAtPrice(s, p, priceCents);
  return Math.min(...use.map((r) => Math.round((r.netProfitCents * 10_000) / base)));
}

/** Maior desconto (passos de 0,1%) que mantém todos os produtos com a margem mínima. */
export function safeDiscountCap(s: PaymentSettings, products: PlanProduct[], floorBps: number): { capBps: number; limitingProduct: string | null } {
  let cap = 0; let limiting: string | null = null;
  for (let d = 0; d <= 5000; d += 10) {
    let ok = true; let bad: string | null = null;
    for (const p of products) {
      if (worstMargin(s, p, Math.round((p.priceCents * (10_000 - d)) / 10_000)) < floorBps) { ok = false; bad = p.name; break; }
    }
    if (!ok) { limiting = bad; break; }
    cap = d;
  }
  return { capBps: cap, limitingProduct: limiting };
}

/** Menor valor terminado em `ending` centavos (ex.: ,90) que não seja menor que `cents`: o desconto real nunca passa do calculado. */
export const ceilToEnding = (cents: number, ending = 90) => { const c = Math.floor(cents / 100) * 100 + ending; return c >= cents ? c : c + 100; };

export const brl = (cents: number) => `R$ ${Math.floor(cents / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${String(cents % 100).padStart(2, '0')}`;
const pctText = (bps: number) => `${(bps / 100).toFixed(1).replace('.', ',')}%`;

export function planPackages(
  settings: PaymentSettings,
  allProducts: PlanProduct[],
  opts: { tiers?: PlanTierInput[]; marginFloorBps?: number; referenceId?: string } = {}
): PackagePlan {
  const warnings: string[] = [];
  const costed = allProducts.filter((p) => p.priceCents > 0 && p.providerCostCents > 0);
  const skipped = allProducts.filter((p) => p.priceCents > 0 && !(p.providerCostCents > 0));
  if (skipped.length) warnings.push(`Sem custo cadastrado (fora do cálculo): ${skipped.map((p) => p.name).join(', ')}.`);
  const floorBps = Math.max(opts.marginFloorBps ?? Math.max(settings.minMarginBps + 500, 1500), 0);
  const ref = costed.find((p) => p.id === (opts.referenceId ?? 'COMPLETE')) ?? [...costed].sort((a, b) => a.priceCents - b.priceCents)[0];
  if (!ref) return { referenceId: '', referenceName: '', referencePriceCents: 0, marginFloorBps: floorBps, capBps: 0, limitingProduct: null, tiers: [], warnings: [...warnings, 'Nenhum produto pago com custo cadastrado.'] };
  const { capBps, limitingProduct } = safeDiscountCap(settings, costed, floorBps);
  const tiers: PlanTier[] = (opts.tiers ?? DEFAULT_TIERS).map((t) => {
    const faceCredits = Math.ceil((t.units * ref.priceCents) / 100);
    const faceCents = faceCredits * 100;
    const applied = Math.min(Math.max(t.discountBps, 0), capBps);
    const priceCents = Math.min(ceilToEnding(Math.ceil((faceCents * (10_000 - applied)) / 10_000)), faceCents);
    const effective = Math.round(((faceCents - priceCents) * 10_000) / faceCents);
    const worst = costed.map((p) => ({ p, m: worstMargin(settings, p, Math.round((p.priceCents * priceCents) / faceCents)) })).reduce((a, b) => (b.m < a.m ? b : a));
    const equivalents = costed.map((p) => ({ id: p.id, name: p.name, count: Math.floor(faceCents / p.priceCents) })).filter((e) => e.count >= 1);
    const savingsCents = faceCents - priceCents;
    return {
      slug: t.slug, units: t.units, faceCredits, priceCents, savingsCents,
      requestedDiscountBps: t.discountBps, effectiveDiscountBps: effective, capped: t.discountBps > capBps,
      worstMarginBps: worst.m, worstProduct: worst.p.name, equivalents,
      highlights: [`Equivale a ${t.units}× ${ref.name}`, ...(savingsCents > 0 ? [`Economia de ${brl(savingsCents)} (${pctText(effective)})`] : [])]
    };
  });
  if (capBps === 0) warnings.push(`Nenhum desconto é seguro agora: ${limitingProduct ?? 'um produto'} já está abaixo da margem mínima com o preço atual. Ajuste o preço dele ou a margem mínima.`);
  for (const t of tiers) if (t.capped) warnings.push(`${t.slug}: desconto pedido de ${pctText(t.requestedDiscountBps)} passa do limite seguro de ${pctText(capBps)}; foi reduzido.`);
  return { referenceId: ref.id, referenceName: ref.name, referencePriceCents: ref.priceCents, marginFloorBps: floorBps, capBps, limitingProduct, tiers, warnings };
}

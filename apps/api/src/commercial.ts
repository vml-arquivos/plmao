export type CouponDiscountType = 'PERCENT' | 'FIXED';

export function calculateCouponDiscount(subtotalCents: number, discountType: CouponDiscountType, discountValue: number): number {
  if (!Number.isFinite(subtotalCents) || subtotalCents <= 0) return 0;
  if (!Number.isFinite(discountValue) || discountValue <= 0) return 0;
  const raw = discountType === 'PERCENT'
    ? Math.floor(subtotalCents * discountValue / 100)
    : Math.floor(discountValue);
  return Math.max(0, Math.min(Math.floor(subtotalCents), raw));
}

export function couponWindowIsOpen(input: {
  active: boolean;
  startsAt?: string | Date | null;
  expiresAt?: string | Date | null;
  now?: Date;
}): boolean {
  if (!input.active) return false;
  const now = (input.now ?? new Date()).getTime();
  const startsAt = input.startsAt ? new Date(input.startsAt).getTime() : null;
  const expiresAt = input.expiresAt ? new Date(input.expiresAt).getTime() : null;
  if (startsAt !== null && !Number.isFinite(startsAt)) return false;
  if (expiresAt !== null && !Number.isFinite(expiresAt)) return false;
  return (startsAt === null || startsAt <= now) && (expiresAt === null || expiresAt >= now);
}

export function couponHasCapacity(maxRedemptions: number | null | undefined, redeemedCount: number, reservedCount: number): boolean {
  if (maxRedemptions == null) return true;
  return Math.max(0, redeemedCount) + Math.max(0, reservedCount) < maxRedemptions;
}

export function calculateAffiliateCommission(amountCents: number, commissionBps: number): number {
  if (!Number.isFinite(amountCents) || amountCents <= 0 || !Number.isFinite(commissionBps) || commissionBps <= 0) return 0;
  return Math.floor(amountCents * commissionBps / 10000);
}

export function effectiveQueryPriceCents(input: { priceCents: number; negotiatedPriceCents?: number | null; isFree?: boolean }): number {
  if (input.isFree) return 0;
  const negotiated = input.negotiatedPriceCents;
  if (negotiated != null && Number.isInteger(negotiated) && negotiated >= 0) return negotiated;
  if (!Number.isInteger(input.priceCents) || input.priceCents < 0) throw new Error('INVALID_QUERY_PRICE');
  return input.priceCents;
}

export function queryAmountAfterCoupon(priceCents: number, discountType?: CouponDiscountType, discountValue?: number): { subtotalCents: number; discountCents: number; amountCents: number } {
  const subtotalCents = Math.max(0, Math.floor(priceCents));
  const discountCents = discountType && discountValue != null
    ? calculateCouponDiscount(subtotalCents, discountType, discountValue)
    : 0;
  if (subtotalCents > 0 && discountCents >= subtotalCents) throw new Error('COUPON_ZERO_TOTAL_UNSUPPORTED');
  return { subtotalCents, discountCents, amountCents: Math.max(0, subtotalCents - discountCents) };
}

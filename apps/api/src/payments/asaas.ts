import crypto from 'node:crypto';
import { env, publicAppUrl } from '../config.js';
import type { CheckoutInput, CheckoutResult, PaymentCheckoutProvider, PaymentWebhookEvent, PaymentWebhookRequest } from './types.js';

export type AsaasCheckoutInput = {
  orderId: string;
  itemName: string;
  itemDescription: string;
  amountCents: number;
  customer: { name: string; email: string; cpfCnpj?: string; phone?: string };
};

export type AsaasCheckoutResult = {
  id: string;
  link: string;
  status: string;
};

export type AsaasWebhookEvent = {
  id?: string;
  event?: string;
  payment?: { id?: string; status?: string; externalReference?: string };
  checkout?: { id?: string; status?: string; externalReference?: string };
};

function baseUrl(): string {
  const base = env.PAYMENT_API_BASE_URL;
  if (!base) throw codedError('PAYMENT_PROVIDER_NOT_CONFIGURED');
  return base.replace(/\/$/, '');
}

function codedError(code: string): Error & { code: string } {
  const error = new Error(code) as Error & { code: string };
  error.code = code;
  return error;
}

type AsaasCheckoutConfig = Pick<typeof env, 'PAYMENT_PROVIDER' | 'PAYMENT_API_BASE_URL' | 'PAYMENT_API_KEY'>;
type AsaasIntegrationConfig = AsaasCheckoutConfig & Pick<typeof env, 'PAYMENT_WEBHOOK_SECRET'>;

export function hasAsaasCheckoutConfig(config: AsaasCheckoutConfig): boolean {
  return config.PAYMENT_PROVIDER === 'asaas' && Boolean(config.PAYMENT_API_BASE_URL && config.PAYMENT_API_KEY);
}

export function hasAsaasIntegrationConfig(config: AsaasIntegrationConfig): boolean {
  return hasAsaasCheckoutConfig(config) && Boolean(config.PAYMENT_WEBHOOK_SECRET);
}

export function isAsaasCheckoutConfigured(): boolean {
  return hasAsaasCheckoutConfig(env);
}

export function isAsaasConfigured(): boolean {
  return hasAsaasIntegrationConfig(env);
}

export async function createAsaasCheckout(input: AsaasCheckoutInput): Promise<AsaasCheckoutResult> {
  if (!isAsaasCheckoutConfigured()) throw codedError('PAYMENT_PROVIDER_NOT_CONFIGURED');
  const origin = publicAppUrl();
  const customerData: Record<string, string> = { name: input.customer.name, email: input.customer.email };
  if (input.customer.cpfCnpj) customerData.cpfCnpj = input.customer.cpfCnpj.replace(/\D/g, '');
  if (input.customer.phone) customerData.phone = input.customer.phone.replace(/\D/g, '');
  const response = await fetch(`${baseUrl()}/v3/checkouts`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', access_token: env.PAYMENT_API_KEY! },
    body: JSON.stringify({
      billingTypes: ['PIX', 'CREDIT_CARD'],
      chargeTypes: ['DETACHED'],
      minutesToExpire: 60,
      externalReference: input.orderId,
      callback: {
        successUrl: `${origin}/?checkout=success`,
        cancelUrl: `${origin}/?checkout=cancelled`,
        expiredUrl: `${origin}/?checkout=expired`
      },
      customerData,
      items: [{
        externalReference: input.orderId,
        name: input.itemName,
        description: input.itemDescription,
        quantity: 1,
        value: input.amountCents / 100
      }]
    })
  });
  const body = await response.json().catch(() => ({})) as { id?: string; link?: string; status?: string; errors?: Array<{ code?: string; description?: string }> };
  if (!response.ok || !body.id || !body.link) throw codedError('PAYMENT_PROVIDER_REQUEST_FAILED');
  return { id: body.id, link: body.link, status: body.status ?? 'ACTIVE' };
}

export function hasValidAsaasWebhookToken(value: string | undefined): boolean {
  if (!env.PAYMENT_WEBHOOK_SECRET || !value) return false;
  const received = Buffer.from(value);
  const expected = Buffer.from(env.PAYMENT_WEBHOOK_SECRET);
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

export function eventReference(event: AsaasWebhookEvent): string | null {
  return event.checkout?.externalReference ?? event.payment?.externalReference ?? null;
}

export function externalPaymentId(event: AsaasWebhookEvent): string | null {
  return event.checkout?.id ?? event.payment?.id ?? null;
}

export class AsaasProvider implements PaymentCheckoutProvider {
  readonly name = 'asaas';

  isConfigured(): boolean {
    return isAsaasCheckoutConfigured();
  }

  createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    return createAsaasCheckout(input);
  }

  isValidWebhookSignature(request: PaymentWebhookRequest): boolean {
    const value = request.headers['asaas-access-token'];
    const header = Array.isArray(value) ? value[0] : value;
    return hasValidAsaasWebhookToken(header);
  }

  parseWebhookEvent(payload: unknown): PaymentWebhookEvent | null {
    const event = payload as AsaasWebhookEvent;
    const externalReference = eventReference(event);
    const paymentId = externalPaymentId(event);
    const rawStatus = typeof event.event === 'string' ? event.event : null;
    if (!externalReference && !paymentId) return null;
    return { externalReference, externalPaymentId: paymentId, rawStatus };
  }
}

export function createAsaasProvider(): PaymentCheckoutProvider {
  return new AsaasProvider();
}

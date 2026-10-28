import crypto from 'node:crypto';
import { env, publicAppUrl } from '../config.js';
import type {
  CheckoutInput,
  CheckoutResult,
  PaymentCheckoutProvider,
  PaymentStatusResult,
  PaymentWebhookEvent,
  PaymentWebhookRequest
} from './types.js';

const DEFAULT_API = 'https://api.mercadopago.com';
const api = () => (env.MP_API_BASE_URL ?? DEFAULT_API).replace(/\/+$/, '');

type MercadoPagoPreferenceResponse = {
  id?: string;
  init_point?: string;
  sandbox_init_point?: string;
};

type MercadoPagoPaymentResponse = {
  status?: string;
  external_reference?: string | null;
  payment_type_id?: string | null;
  fee_details?: Array<{ amount?: number | string; type?: string }>;
  transaction_details?: { net_received_amount?: number | string | null };
};

function toCents(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

type MercadoPagoWebhookPayload = {
  type?: unknown;
  action?: unknown;
  data?: { id?: unknown };
};

function codedError(code: string): Error & { code: string } {
  const error = new Error(code) as Error & { code: string };
  error.code = code;
  return error;
}

function headerValue(request: PaymentWebhookRequest, name: string): string | undefined {
  const value = request.headers[name] ?? request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function queryValue(request: PaymentWebhookRequest, names: string[]): string | undefined {
  for (const name of names) {
    const value = request.query?.[name];
    if (Array.isArray(value)) {
      if (typeof value[0] === 'string' && value[0]) return value[0];
    } else if (typeof value === 'string' && value) {
      return value;
    } else if (typeof value === 'number') {
      return String(value);
    }
  }
  return undefined;
}

function signatureParts(value: string): { timestamp: string; hash: string } | null {
  const parts = Object.fromEntries(value.split(',').map((part) => {
    const index = part.indexOf('=');
    return index > 0 ? [part.slice(0, index).trim(), part.slice(index + 1).trim()] : ['', ''];
  }).filter(([key, item]) => key && item));
  if (!parts.ts || !parts.v1) return null;
  return { timestamp: parts.ts, hash: parts.v1 };
}

function paymentIdFromPayload(payload: unknown): string | null {
  const data = payload as MercadoPagoWebhookPayload | null;
  const value = data?.data?.id;
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
}

function paymentIdFromRequest(request: PaymentWebhookRequest, payload?: unknown): string | null {
  return paymentIdFromPayload(payload)
    ?? paymentIdFromPayload(request.rawBody ? parseRawBody(request.rawBody) : undefined)
    ?? queryValue(request, ['data.id', 'id'])
    ?? null;
}

function parseRawBody(rawBody: Buffer): unknown {
  try { return JSON.parse(rawBody.toString('utf8')) as unknown; }
  catch { return undefined; }
}

async function requestJson<T>(url: string, init: RequestInit): Promise<{ ok: boolean; body: T }> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(env.MP_TIMEOUT_MS) });
    const body = await response.json().catch(() => ({})) as T;
    return { ok: response.ok, body };
  } catch {
    throw codedError('PAYMENT_PROVIDER_REQUEST_FAILED');
  }
}

export class MercadoPagoProvider implements PaymentCheckoutProvider {
  readonly name = 'mercadopago';

  isConfigured(): boolean {
    return Boolean(env.MP_ACCESS_TOKEN);
  }

  private accessToken(): string {
    if (!this.isConfigured()) throw codedError('PAYMENT_PROVIDER_NOT_CONFIGURED');
    return env.MP_ACCESS_TOKEN!;
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const origin = publicAppUrl();
    // Consulta avulsa: o retorno leva o pedido junto, para a tela da consulta continuar sozinha depois do pagamento.
    const back = (state: string) => `${origin}/?checkout=${state}&provider=mercadopago${input.returnQueryOrderId ? `&tipo=consulta&pedido=${encodeURIComponent(input.returnQueryOrderId)}` : ''}`;
    const response = await requestJson<MercadoPagoPreferenceResponse>(`${api()}/checkout/preferences`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${this.accessToken()}`
      },
      body: JSON.stringify({
        items: [{
          id: input.orderId,
          title: input.itemName,
          description: input.itemDescription,
          quantity: 1,
          currency_id: 'BRL',
          unit_price: Number((input.amountCents / 100).toFixed(2))
        }],
        external_reference: input.orderId,
        back_urls: {
          success: back('success'),
          failure: back('failure'),
          pending: back('pending')
        },
        auto_return: 'approved',
        ...(env.MP_BINARY_MODE ? { binary_mode: true } : {}),
        ...(env.MP_STATEMENT_DESCRIPTOR ? { statement_descriptor: env.MP_STATEMENT_DESCRIPTOR } : {}),
        ...(env.MP_EXPIRES_MINUTES > 0 ? { expires: true, expiration_date_from: new Date().toISOString(), expiration_date_to: new Date(Date.now() + env.MP_EXPIRES_MINUTES * 60_000).toISOString() } : {}),
        notification_url: `${origin}/api/payments/mercadopago/webhook`,
        payer: { name: input.customer.name, email: input.customer.email }
      })
    });
    // credenciais de teste (TEST-...) usam o link de sandbox
    const link = this.accessToken().startsWith('TEST-') ? (response.body.sandbox_init_point ?? response.body.init_point) : (response.body.init_point ?? response.body.sandbox_init_point);
    if (!response.ok || !response.body.id || !link) throw codedError('PAYMENT_PROVIDER_REQUEST_FAILED');
    return { id: response.body.id, link, status: 'ACTIVE' };
  }

  /** Estorno total pela API (POST /v1/payments/{id}/refunds). O pedido só é revertido quando o webhook confirmar o estorno. */
  async refundPayment(externalPaymentId: string, idempotencyKey: string): Promise<{ refundId: string | null; status: string | null }> {
    const response = await requestJson<{ id?: number | string; status?: string }>(`${api()}/v1/payments/${encodeURIComponent(externalPaymentId)}/refunds`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${this.accessToken()}`, 'x-idempotency-key': idempotencyKey },
      body: JSON.stringify({})
    });
    if (!response.ok) throw codedError('PAYMENT_REFUND_REJECTED');
    return { refundId: response.body.id != null ? String(response.body.id) : null, status: response.body.status ?? null };
  }

  /** Pagamentos de um pedido (GET /v1/payments/search?external_reference=...), do mais antigo ao mais novo. */
  async searchPaymentsByReference(reference: string): Promise<Array<PaymentStatusResult & { id: string }>> {
    const response = await requestJson<{ results?: Array<MercadoPagoPaymentResponse & { id?: number | string }> }>(
      `${api()}/v1/payments/search?external_reference=${encodeURIComponent(reference)}&sort=date_created&criteria=asc`,
      { headers: { accept: 'application/json', authorization: `Bearer ${this.accessToken()}` } });
    if (!response.ok || !Array.isArray(response.body.results)) throw codedError('PAYMENT_PROVIDER_REQUEST_FAILED');
    return response.body.results.filter((r) => r.id != null && typeof r.status === 'string').map((r) => {
      const fees = (r.fee_details ?? []).map((f) => toCents(f.amount)).filter((v): v is number => v !== null);
      return { id: String(r.id), status: r.status as string, externalReference: r.external_reference ?? null, paymentType: r.payment_type_id ?? null, feeCents: fees.length ? fees.reduce((a, b) => a + b, 0) : null, netCents: toCents(r.transaction_details?.net_received_amount) };
    });
  }

  isValidWebhookSignature(request: PaymentWebhookRequest): boolean {
    if (!env.MP_WEBHOOK_SECRET) return false;
    const signature = headerValue(request, 'x-signature');
    if (!signature) return false;
    const parsed = signatureParts(signature);
    const paymentId = paymentIdFromRequest(request);
    if (!parsed || !paymentId) return false;
    const timestamp = Number(parsed.timestamp);
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 5 * 60) return false;
    const requestId = headerValue(request, 'x-request-id');
    const manifest = `id:${paymentId};${requestId ? `request-id:${requestId};` : ''}ts:${parsed.timestamp};`;
    const expected = crypto.createHmac('sha256', env.MP_WEBHOOK_SECRET).update(manifest).digest();
    const received = /^[a-f0-9]{64}$/i.test(parsed.hash) ? Buffer.from(parsed.hash, 'hex') : Buffer.alloc(0);
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
  }

  parseWebhookEvent(payload: unknown, query?: Record<string, unknown>): PaymentWebhookEvent | null {
    const paymentId = paymentIdFromPayload(payload) ?? queryValue({ headers: {}, query }, ['data.id', 'id']);
    if (!paymentId) return null;
    return { externalReference: null, externalPaymentId: paymentId, rawStatus: null };
  }

  async fetchPaymentStatus(externalPaymentId: string): Promise<PaymentStatusResult | null> {
    const response = await requestJson<MercadoPagoPaymentResponse>(`${api()}/v1/payments/${encodeURIComponent(externalPaymentId)}`, {
      headers: { accept: 'application/json', authorization: `Bearer ${this.accessToken()}` }
    });
    if (!response.ok || typeof response.body.status !== 'string') throw codedError('PAYMENT_PROVIDER_REQUEST_FAILED');
    const fees = (response.body.fee_details ?? []).map((f) => toCents(f.amount)).filter((v): v is number => v !== null);
    return {
      status: response.body.status,
      externalReference: response.body.external_reference ?? null,
      paymentType: response.body.payment_type_id ?? null,
      feeCents: fees.length ? fees.reduce((a, b) => a + b, 0) : null,
      netCents: toCents(response.body.transaction_details?.net_received_amount)
    };
  }
}

export function createMercadoPagoProvider(): PaymentCheckoutProvider {
  return new MercadoPagoProvider();
}

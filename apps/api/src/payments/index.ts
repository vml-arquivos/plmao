import { env } from '../config.js';
import { AsaasProvider } from './asaas.js';
import { MercadoPagoProvider } from './mercadopago.js';
import type { PaymentCheckoutProvider } from './types.js';

export type PaymentProviderName = 'disabled' | 'sandbox' | 'asaas' | 'mercadopago';

class DisabledPaymentProvider implements PaymentCheckoutProvider {
  readonly name = 'disabled';

  isConfigured(): boolean { return false; }

  async createCheckout(): Promise<never> {
    const error = new Error('PAYMENT_PROVIDER_NOT_CONFIGURED') as Error & { code: string };
    error.code = 'PAYMENT_PROVIDER_NOT_CONFIGURED';
    throw error;
  }

  isValidWebhookSignature(): boolean { return false; }

  parseWebhookEvent(): null { return null; }
}

export function getPaymentProviderFor(name: PaymentProviderName): PaymentCheckoutProvider {
  switch (name) {
    case 'disabled': return new DisabledPaymentProvider();
    case 'asaas': return new AsaasProvider();
    case 'mercadopago': return new MercadoPagoProvider();
    case 'sandbox': return new DisabledPaymentProvider();
  }
}

export function getPaymentProvider(): PaymentCheckoutProvider {
  return getPaymentProviderFor(env.PAYMENT_PROVIDER);
}

// O contrato comum já permite adicionar PagBankProvider no futuro sem alterar server.ts.

import { env } from '../config.js';
import { AsaasProvider } from './asaas.js';
import { MercadoPagoProvider } from './mercadopago.js';
class DisabledPaymentProvider {
    name = 'disabled';
    isConfigured() { return false; }
    async createCheckout() {
        const error = new Error('PAYMENT_PROVIDER_NOT_CONFIGURED');
        error.code = 'PAYMENT_PROVIDER_NOT_CONFIGURED';
        throw error;
    }
    isValidWebhookSignature() { return false; }
    parseWebhookEvent() { return null; }
}
export function getPaymentProviderFor(name) {
    switch (name) {
        case 'disabled': return new DisabledPaymentProvider();
        case 'asaas': return new AsaasProvider();
        case 'mercadopago': return new MercadoPagoProvider();
        case 'sandbox': return new DisabledPaymentProvider();
    }
}
export function getPaymentProvider() {
    return getPaymentProviderFor(env.PAYMENT_PROVIDER);
}
// O contrato comum já permite adicionar PagBankProvider no futuro sem alterar server.ts.

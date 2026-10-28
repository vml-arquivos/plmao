export type CheckoutInput = {
  orderId: string;
  itemName: string;
  itemDescription: string;
  amountCents: number;
  customer: { name: string; email: string; cpfCnpj?: string; phone?: string };
  /** Pedido de consulta (id interno): o retorno do checkout volta direto para a consulta e a executa. */
  returnQueryOrderId?: string;
};

export type CheckoutResult = { id: string; link: string; status: string };

export type PaymentStatusResult = { status: string; externalReference?: string | null; paymentType?: string | null; feeCents?: number | null; netCents?: number | null };

export type PaymentWebhookEvent = {
  externalReference: string | null;
  externalPaymentId: string | null;
  rawStatus: string | null;
};

export type PaymentWebhookRequest = {
  headers: Record<string, string | string[] | undefined>;
  rawBody?: Buffer;
  query?: Record<string, unknown>;
};

export type PaymentCheckoutProvider = {
  readonly name: string;
  isConfigured(): boolean;
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  isValidWebhookSignature(req: PaymentWebhookRequest): boolean;
  parseWebhookEvent(payload: unknown, query?: Record<string, unknown>): PaymentWebhookEvent | null;
  fetchPaymentStatus?(externalPaymentId: string): Promise<PaymentStatusResult | null>;
};

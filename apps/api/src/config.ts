import 'dotenv/config';
import { z } from 'zod';

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}, z.boolean());

const optionalUrl = z.preprocess((value) => value === '' ? undefined : value, z.string().url().optional());
const optionalString = z.preprocess((value) => value === '' ? undefined : value, z.string().optional());

type ParsedEnv = z.infer<typeof envSchema>;

function isExampleValue(value: string | undefined): boolean {
  if (!value) return false;
  return /change[_ -]?me|replace[_ -]?me|your[_ -]?|example\.(com|test)|placeholder|dummy|sample|test-secret|demo-secret/i.test(value);
}

function requireProduction(condition: boolean, message: string, issues: string[]): void {
  if (!condition) issues.push(message);
}

function isHttpsUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch {
    return false;
  }
}

/** O corpo precisa ser JSON válido e conter {{plate}} em algum valor; sem isso a consulta nunca identificaria a placa. */
export function credifyBodyTemplateValid(template: string | undefined): boolean {
  if (!template) return false;
  try {
    const parsed = JSON.parse(template) as unknown;
    return Boolean(parsed) && typeof parsed === 'object' && !Array.isArray(parsed) && JSON.stringify(parsed).includes('{{plate}}');
  } catch { return false; }
}

function validateProductionConfig(value: ParsedEnv): void {
  const issues: string[] = [];
  requireProduction(Boolean(value.DATABASE_URL), 'DATABASE_URL_REQUIRED', issues);
  requireProduction(value.JWT_SECRET.length >= 64 && !isExampleValue(value.JWT_SECRET), 'JWT_SECRET_STRONG_AND_UNIQUE_REQUIRED', issues);
  requireProduction(isHttpsUrl(value.APP_URL), 'APP_URL_HTTPS_REQUIRED', issues);
  requireProduction(isHttpsUrl(value.WEB_ORIGIN), 'WEB_ORIGIN_HTTPS_REQUIRED', issues);
  requireProduction(Boolean(value.ADMIN_JWT_SECRET) && (value.ADMIN_JWT_SECRET?.length ?? 0) >= 64 && value.ADMIN_JWT_SECRET !== value.JWT_SECRET && !isExampleValue(value.ADMIN_JWT_SECRET), 'ADMIN_JWT_SECRET_STRONG_AND_DISTINCT_REQUIRED', issues);
  requireProduction(Boolean(value.DATA_ENCRYPTION_KEY) && (value.DATA_ENCRYPTION_KEY?.length ?? 0) >= 32 && !isExampleValue(value.DATA_ENCRYPTION_KEY), 'DATA_ENCRYPTION_KEY_REQUIRED', issues);
  requireProduction(Boolean(value.ADMIN_HOSTS) || isHttpsUrl(value.ADMIN_URL), 'ADMIN_HOSTS_OR_ADMIN_URL_REQUIRED', issues);
  requireProduction(value.DATA_PROVIDER !== 'mock', 'DATA_PROVIDER_MOCK_FORBIDDEN', issues);
  requireProduction(value.PAYMENT_PROVIDER !== 'sandbox', 'PAYMENT_PROVIDER_SANDBOX_FORBIDDEN', issues);
  requireProduction(!value.SANDBOX_SEED_ENABLED, 'SANDBOX_SEED_FORBIDDEN', issues);
  requireProduction(!value.SANDBOX_CREDIT_PURCHASE_ENABLED, 'SANDBOX_CREDIT_PURCHASE_FORBIDDEN', issues);

  // As exigências genéricas (endereço e credenciais VEHICLE_API_*) valem só para o adaptador genérico; Credify e ConsultarPlaca têm as suas.
  if (value.DATA_PROVIDER === 'real' && value.VEHICLE_API_PROVIDER === 'generic') {
    requireProduction(Boolean(value.VEHICLE_API_BASE_URL && value.VEHICLE_API_QUERY_PATH), 'VEHICLE_PROVIDER_ENDPOINT_REQUIRED', issues);
    if (value.VEHICLE_API_AUTH_SCHEME === 'bearer') {
      requireProduction(Boolean(value.VEHICLE_API_TOKEN || value.APIBRASIL_BEARER_TOKEN), 'VEHICLE_PROVIDER_BEARER_REQUIRED', issues);
    } else {
      requireProduction(Boolean(value.VEHICLE_API_LOGIN && value.VEHICLE_API_PASSWORD), 'VEHICLE_PROVIDER_BASIC_AUTH_REQUIRED', issues);
    }
  }

  if (value.DATA_PROVIDER === 'real' && value.VEHICLE_API_PROVIDER === 'credify') {
    requireProduction(Boolean(value.CREDIFY_CLIENT_ID && value.CREDIFY_CLIENT_SECRET), 'CREDIFY_CREDENTIALS_REQUIRED', issues);
    requireProduction(credifyBodyTemplateValid(value.CREDIFY_QUERY_BODY_TEMPLATE), 'CREDIFY_QUERY_BODY_TEMPLATE_INVALID', issues);
    requireProduction(!value.CREDIFY_BASE_URL || isHttpsUrl(value.CREDIFY_BASE_URL), 'CREDIFY_BASE_URL_HTTPS_REQUIRED', issues);
  }
  if (value.DATA_PROVIDER === 'real' && value.VEHICLE_API_PROVIDER === 'consultarplaca') {
    requireProduction(Boolean(value.CONSULTARPLACA_EMAIL && value.CONSULTARPLACA_API_KEY), 'CONSULTARPLACA_CREDENTIALS_REQUIRED', issues);
    requireProduction(!value.CONSULTARPLACA_BASE_URL || isHttpsUrl(value.CONSULTARPLACA_BASE_URL), 'CONSULTARPLACA_BASE_URL_HTTPS_REQUIRED', issues);
  }
  requireProduction(value.FISCAL_PROVIDER !== 'mock', 'FISCAL_PROVIDER_MOCK_FORBIDDEN', issues);

  if (value.PAYMENT_PROVIDER === 'asaas') {
    requireProduction(Boolean(value.PAYMENT_API_BASE_URL && value.PAYMENT_API_KEY && value.PAYMENT_WEBHOOK_SECRET), 'ASAAS_CHECKOUT_AND_WEBHOOK_REQUIRED', issues);
    requireProduction(value.PAYMENT_API_BASE_URL !== 'https://api-sandbox.asaas.com', 'ASAAS_SANDBOX_URL_FORBIDDEN', issues);
  }
  if (value.PAYMENT_PROVIDER === 'mercadopago') {
    requireProduction(Boolean(value.MP_ACCESS_TOKEN && value.MP_WEBHOOK_SECRET), 'MERCADOPAGO_CHECKOUT_AND_WEBHOOK_REQUIRED', issues);
    requireProduction(!value.MP_API_BASE_URL || value.MP_API_BASE_URL.replace(/\/+$/, '') === 'https://api.mercadopago.com', 'MERCADOPAGO_API_URL_FORBIDDEN', issues);
  }
  if (value.EMAIL_PROVIDER === 'brevo_api') {
    requireProduction(Boolean(value.BREVO_API_KEY), 'BREVO_API_KEY_REQUIRED', issues);
    requireProduction(value.BREVO_API_BASE_URL.replace(/\/+$/, '') === 'https://api.brevo.com/v3', 'BREVO_API_URL_FORBIDDEN', issues);
  }
  if (value.EMAIL_PROVIDER === 'smtp') {
    requireProduction(Boolean(value.SMTP_HOST && value.SMTP_USER && value.SMTP_PASSWORD), 'SMTP_CREDENTIALS_REQUIRED', issues);
  }
  if (value.ADMIN_BOOTSTRAP_EMAIL || value.ADMIN_BOOTSTRAP_PASSWORD) {
    requireProduction(Boolean(value.ADMIN_BOOTSTRAP_EMAIL) && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.ADMIN_BOOTSTRAP_EMAIL ?? ''), 'ADMIN_BOOTSTRAP_EMAIL_INVALID', issues);
    requireProduction((value.ADMIN_BOOTSTRAP_PASSWORD?.length ?? 0) >= 8 && !isExampleValue(value.ADMIN_BOOTSTRAP_PASSWORD), 'ADMIN_BOOTSTRAP_PASSWORD_MIN_8_CHARS', issues);
  }
  if (value.SUPER_ADMIN_BOOTSTRAP_ENABLED) {
    requireProduction(Boolean(value.SUPER_ADMIN_BOOTSTRAP_EMAIL), 'SUPER_ADMIN_BOOTSTRAP_EMAIL_REQUIRED', issues);
  }

  const configuredSecrets = [
    value.JWT_SECRET,
    value.ADMIN_JWT_SECRET,
    value.DATA_ENCRYPTION_KEY,
    value.SMTP_PASSWORD,
    value.BREVO_API_KEY,
    value.VEHICLE_API_TOKEN,
    value.APIBRASIL_BEARER_TOKEN,
    value.APIBRASIL_DEVICE_TOKEN,
    value.VEHICLE_API_DEVICE_TOKEN,
    value.CREDIFY_CLIENT_SECRET,
    value.CONSULTARPLACA_API_KEY,
    value.ESIGN_WEBHOOK_SECRET,
    value.EMAIL_WEBHOOK_SECRET,
    value.PAYMENT_API_KEY,
    value.PAYMENT_WEBHOOK_SECRET,
    value.MP_ACCESS_TOKEN,
    value.MP_WEBHOOK_SECRET,
    value.OAUTH_GOOGLE_CLIENT_SECRET,
    value.OAUTH_MICROSOFT_CLIENT_SECRET,
    value.OAUTH_APPLE_PRIVATE_KEY,
    value.ADMIN_BOOTSTRAP_PASSWORD
  ];
  requireProduction(!configuredSecrets.some(isExampleValue), 'EXAMPLE_SECRET_FORBIDDEN', issues);

  if (issues.length > 0) throw new Error(`PRODUCTION_CONFIGURATION_INVALID:${issues.join(',')}`);
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_NAME: z.string().trim().min(1).default('Placa na Mão'),
  APP_URL: optionalUrl,
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  // smtp: envio por SMTP. brevo_api: envio pela API HTTPS do Brevo (porta 443), para servidores que bloqueiam as portas de SMTP.
  EMAIL_PROVIDER: z.enum(['disabled', 'smtp', 'brevo_api']).default('disabled'),
  BREVO_API_KEY: optionalString,
  BREVO_API_BASE_URL: z.string().trim().url().default('https://api.brevo.com/v3'),
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().positive().max(65535).default(587),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  SMTP_SECURE: booleanFromEnv.default(false),
  EMAIL_FROM: z.string().trim().email().default('no-reply@placanamao.com.br'),
  // Para onde vão as respostas dos e-mails automáticos (ex.: o Gmail da operação, já que o domínio não tem caixa de e-mail). Vazio = sem Reply-To.
  EMAIL_REPLY_TO: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().email().max(254).optional()),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(10).max(120).default(30),
  TRUST_PROXY: z.coerce.number().int().min(0).max(2).default(1),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: booleanFromEnv.default(false),
  MIGRATION_LOCK_TIMEOUT_MS: z.coerce.number().int().positive().max(300000).default(60000),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('2h'),
  // Painel administrativo: segredo/audiência de JWT próprios, 2FA (TOTP) obrigatório e restrição por host/IP.
  ADMIN_JWT_SECRET: optionalString,
  ADMIN_JWT_EXPIRES_IN: z.string().default('30m'),
  ADMIN_URL: optionalUrl,
  ADMIN_HOSTS: optionalString,
  ADMIN_ALLOWED_IPS: optionalString,
  // 2FA do painel: opcional por padrão (cada pessoa liga em "Minha conta"). true torna obrigatório para toda a equipe.
  TEAM_TOTP_REQUIRED: booleanFromEnv.default(false),
  // Dias em que um computador marcado como confiável não pede o código de novo (renova a cada uso). 0 desliga a opção.
  TEAM_TRUSTED_DEVICE_DAYS: z.coerce.number().int().min(0).max(365).default(90),
  // Chave AES-256-GCM (>=32 caracteres) para JSON bruto do provedor e dados sensíveis em repouso.
  DATA_ENCRYPTION_KEY: optionalString,
  // Mascaramento LGPD: documentos e nomes mascarados por padrão.
  PII_REVEAL_ENABLED: booleanFromEnv.default(true),
  // API pública v1 para integradores (chaves pnm_live_…). Desligada por padrão: rotas respondem 404.
  PUBLIC_API_ENABLED: booleanFromEnv.default(false),
  PUBLIC_API_RATE_LIMIT_MAX: z.coerce.number().int().positive().max(10000).default(60),

  // Consulta de CNPJ no servidor (pré-preenchimento revisável). disabled = nenhuma chamada externa.
  CNPJ_PROVIDER: z.enum(['disabled', 'brasilapi']).default('disabled'),
  CNPJ_BASE_URL: optionalUrl,
  CNPJ_API_TIMEOUT_MS: z.coerce.number().int().positive().max(30000).default(8000),
  CNPJ_CACHE_TTL_HOURS: z.coerce.number().int().min(0).max(720).default(24),

  // Fila de e-mails transacionais (outbox com retries e idempotência) e links seguros de documentos.
  EMAIL_OUTBOX_WORKER: booleanFromEnv.default(true),
  EMAIL_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(6),
  SECURE_LINK_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(72),
  // Segredo (HMAC-SHA256) do webhook genérico de eventos de entrega (entregue/bounce). Vazio = rota desligada (404).
  EMAIL_WEBHOOK_SECRET: optionalString,

  // Contratos: assinatura eletrônica. disabled = só rascunho/aprovação; internal = aceite eletrônico próprio com trilha de evidências
  // (validade jurídica sujeita à revisão do jurídico); provedores externos entram quando houver documentação e credenciais.
  ESIGN_PROVIDER: z.enum(['disabled', 'internal']).default('disabled'),
  ESIGN_WEBHOOK_SECRET: optionalString,

  // Emissão fiscal: disabled = nenhuma fila; manual = fila para emissão externa e registro do resultado; mock = só testes.
  FISCAL_PROVIDER: z.enum(['disabled', 'manual', 'mock']).default('disabled'),

  // Dados veiculares: o modo real só pode operar com contrato e credenciais válidos.
  DATA_PROVIDER: z.enum(['mock', 'real', 'disabled']).default('mock'),

  // FIPE: feature desligada por padrão; os tokens são exclusivos do backend.
  FEATURE_FREE_FIPE: booleanFromEnv.default(false),
  FEATURE_REPORT_PDF: booleanFromEnv.default(true),
  FIPE_PRIMARY_BASE_URL: optionalUrl.default('https://fipe.parallelum.com.br/api/v2'),
  FIPE_PRIMARY_TOKEN: optionalString,
  FIPE_SECONDARY_BASE_URL: optionalUrl.default('https://brasilapi.com.br/api'),
  FIPE_SECONDARY_TOKEN: optionalString,
  FIPE_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().max(120000).default(10000),
  FIPE_GUEST_DAILY_LIMIT: z.coerce.number().int().positive().max(100).default(3),
  FIPE_AUTH_DAILY_LIMIT: z.coerce.number().int().positive().max(500).default(10),
  FIPE_CACHE_TTL_DAYS: z.coerce.number().int().positive().max(31).default(31),
  VEHICLE_API_BASE_URL: optionalUrl,
  VEHICLE_API_QUERY_PATH: optionalString,
  VEHICLE_API_AUTH_SCHEME: z.enum(['bearer', 'basic']).default('bearer'),
  VEHICLE_API_QUERY_METHOD: z.enum(['get', 'post']).default('get'),
  VEHICLE_API_LOGIN: optionalString,
  VEHICLE_API_PASSWORD: optionalString,
  VEHICLE_API_TOKEN: optionalString,
  VEHICLE_API_DEVICE_TOKEN: optionalString,
  APIBRASIL_BEARER_TOKEN: optionalString,
  APIBRASIL_DEVICE_TOKEN: optionalString,
  VEHICLE_API_TIMEOUT_MS: z.coerce.number().int().positive().max(120000).default(15000),
  // Adaptador do provedor quando DATA_PROVIDER=real: generic = VEHICLE_API_*; credify = API Credify (auth por ClientID/ClientSecret → JWT 24h); consultarplaca = ConsultarPlaca v2 (Basic: e-mail + chave), para testes.
  VEHICLE_API_PROVIDER: z.enum(['generic', 'credify', 'consultarplaca']).default('generic'),
  /** Tipos de busca que o contrato do provedor (Credify ou genérico) atende, além da placa: CHASSIS, RENAVAM, OWNER_DOC. */
  VEHICLE_SEARCH_TYPES: z.string().max(80).default('PLATE'),
  CREDIFY_BASE_URL: optionalUrl,
  CREDIFY_CLIENT_ID: optionalString,
  CREDIFY_CLIENT_SECRET: optionalString,
  CREDIFY_QUERY_PATH: optionalString,
  CREDIFY_QUERY_METHOD: z.enum(['get', 'post']).default('post'),
  // Corpo da consulta (JSON com {{plate}}). Sem padrão: preencha conforme a documentação/homologação do fornecedor.
  CREDIFY_QUERY_BODY_TEMPLATE: optionalString,
  CONSULTARPLACA_BASE_URL: optionalUrl,
  CONSULTARPLACA_EMAIL: optionalString,
  CONSULTARPLACA_API_KEY: optionalString,

  // Pagamentos: credenciais runtime-only; nunca disponibilizar no build ou frontend.
  PAYMENT_PROVIDER: z.enum(['disabled', 'sandbox', 'asaas', 'mercadopago']).default('sandbox'),
  PAYMENT_API_BASE_URL: optionalUrl,
  PAYMENT_API_KEY: optionalString,
  PAYMENT_WEBHOOK_SECRET: optionalString,
  MP_ACCESS_TOKEN: optionalString,
  MP_WEBHOOK_SECRET: optionalString,
  MP_TIMEOUT_MS: z.coerce.number().int().positive().max(120000).default(15000),
  // Só para homologação/testes com servidor simulado. Em produção precisa ser o host oficial (ou vazio).
  MP_API_BASE_URL: optionalUrl,
  // Validade do link de pagamento em minutos (0 = sem validade definida pela plataforma).
  MP_EXPIRES_MINUTES: z.coerce.number().int().min(0).max(10080).default(0),
  MP_STATEMENT_DESCRIPTOR: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().max(22).optional()),
  DEALER_DEFAULT_VEHICLE_LIMIT: z.coerce.number().int().min(0).max(100000).default(30),
  DEALER_DEFAULT_MEMBER_LIMIT: z.coerce.number().int().min(1).max(1000).default(3),
  PAYMENT_SYNC_WORKER: booleanFromEnv.default(true),
  MP_BINARY_MODE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  SANDBOX_SEED_ENABLED: booleanFromEnv.default(false),
  SANDBOX_CREDIT_PURCHASE_ENABLED: booleanFromEnv.default(false),

  QUERY_CACHE_ENABLED: booleanFromEnv.default(true),
  QUERY_CACHE_TTL_SECONDS: z.coerce.number().int().positive().max(604800).default(3600),
  QUERY_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().max(120000).default(20000),
  RATE_LIMIT_ENABLED: booleanFromEnv.default(true),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().max(100).default(10),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  LOG_SENSITIVE_DATA: booleanFromEnv.default(false),
  AUDIT_LOG_ENABLED: booleanFromEnv.default(true),
  QUERY_STUCK_MINUTES: z.coerce.number().int().min(2).max(240).default(10),
  STORE_RAW_PROVIDER_RESPONSE: booleanFromEnv.default(true),

  // Bootstrap administrativo: uso pontual, explicitamente habilitado e removido após a promoção auditada.
  SUPER_ADMIN_BOOTSTRAP_ENABLED: booleanFromEnv.default(false),
  SUPER_ADMIN_BOOTSTRAP_EMAIL: optionalString,

  // Primeiro administrador criado no startup: só age se ainda NÃO existir nenhum SUPER_ADMIN ativo (idempotente; nunca sobrescreve).
  // Depois do primeiro acesso, REMOVA ADMIN_BOOTSTRAP_PASSWORD do ambiente. O 2FA (aplicativo autenticador) é opcional: cada pessoa ativa em "Minha conta". Com TEAM_TOTP_REQUIRED=true ele passa a ser obrigatório.
  ADMIN_BOOTSTRAP_EMAIL: optionalString,
  ADMIN_BOOTSTRAP_PASSWORD: optionalString,
  ADMIN_BOOTSTRAP_NAME: optionalString,
  // Recuperação de acesso: redefine a senha (e zera o 2FA) do ADMIN_BOOTSTRAP_EMAIL mesmo que já exista administrador. Remova depois do uso.
  ADMIN_BOOTSTRAP_FORCE_RESET: booleanFromEnv.default(false),

  // OIDC/OAuth: client secrets are runtime-only values and must never be committed or enabled at build time.
  OAUTH_STATE_TTL_SECONDS: z.coerce.number().int().min(60).max(1800).default(600),
  OAUTH_LOGIN_TICKET_TTL_SECONDS: z.coerce.number().int().min(30).max(600).default(120),
  OAUTH_GOOGLE_CLIENT_ID: optionalString,
  OAUTH_GOOGLE_CLIENT_SECRET: optionalString,
  OAUTH_MICROSOFT_CLIENT_ID: optionalString,
  OAUTH_MICROSOFT_CLIENT_SECRET: optionalString,
  OAUTH_MICROSOFT_TENANT: z.string().trim().min(1).max(200).default('common'),
  OAUTH_APPLE_CLIENT_ID: optionalString,
  OAUTH_APPLE_TEAM_ID: optionalString,
  OAUTH_APPLE_KEY_ID: optionalString,
  OAUTH_APPLE_PRIVATE_KEY: optionalString
});

const parsedEnv = envSchema.parse(process.env);
if (parsedEnv.NODE_ENV === 'production') validateProductionConfig(parsedEnv);
export const env = parsedEnv;

export { validateProductionConfig };

export function publicAppUrl(): string {
  return (env.APP_URL ?? env.WEB_ORIGIN).replace(/\/$/, '');
}

export function oauthCallbackUrl(provider: 'google' | 'microsoft' | 'apple'): string {
  return `${publicAppUrl()}/api/auth/oauth/${provider}/callback`;
}

export function adminHosts(): string[] {
  const hosts = new Set<string>();
  for (const part of (env.ADMIN_HOSTS ?? '').split(',')) { const h = part.trim().toLowerCase(); if (h) hosts.add(h); }
  if (env.ADMIN_URL) { try { hosts.add(new URL(env.ADMIN_URL).host.toLowerCase()); } catch { /* ignorado: validado na produção */ } }
  return [...hosts];
}

export function adminAllowedIps(): string[] {
  return (env.ADMIN_ALLOWED_IPS ?? '').split(',').map((v) => v.trim()).filter(Boolean);
}

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

function validateProductionConfig(value: ParsedEnv): void {
  const issues: string[] = [];
  requireProduction(Boolean(value.DATABASE_URL), 'DATABASE_URL_REQUIRED', issues);
  requireProduction(value.JWT_SECRET.length >= 64 && !isExampleValue(value.JWT_SECRET), 'JWT_SECRET_STRONG_AND_UNIQUE_REQUIRED', issues);
  requireProduction(isHttpsUrl(value.APP_URL), 'APP_URL_HTTPS_REQUIRED', issues);
  requireProduction(isHttpsUrl(value.WEB_ORIGIN), 'WEB_ORIGIN_HTTPS_REQUIRED', issues);
  requireProduction(Boolean(value.ADMIN_JWT_SECRET) && (value.ADMIN_JWT_SECRET?.length ?? 0) >= 64 && value.ADMIN_JWT_SECRET !== value.JWT_SECRET && !isExampleValue(value.ADMIN_JWT_SECRET), 'ADMIN_JWT_SECRET_STRONG_AND_DISTINCT_REQUIRED', issues);
  requireProduction(Boolean(value.DATA_ENCRYPTION_KEY) && (value.DATA_ENCRYPTION_KEY?.length ?? 0) >= 32 && !isExampleValue(value.DATA_ENCRYPTION_KEY), 'DATA_ENCRYPTION_KEY_REQUIRED', issues);
  requireProduction(Boolean(value.ADMIN_HOSTS) || isHttpsUrl(value.ADMIN_URL), 'ADMIN_HOSTS_OR_ADMIN_URL_REQUIRED', issues);
  requireProduction(value.TEAM_TOTP_REQUIRED !== false, 'ADMIN_TOTP_CANNOT_BE_DISABLED', issues);
  requireProduction(value.DATA_PROVIDER !== 'mock', 'DATA_PROVIDER_MOCK_FORBIDDEN', issues);
  requireProduction(value.PAYMENT_PROVIDER !== 'sandbox', 'PAYMENT_PROVIDER_SANDBOX_FORBIDDEN', issues);
  requireProduction(!value.SANDBOX_SEED_ENABLED, 'SANDBOX_SEED_FORBIDDEN', issues);
  requireProduction(!value.SANDBOX_CREDIT_PURCHASE_ENABLED, 'SANDBOX_CREDIT_PURCHASE_FORBIDDEN', issues);

  if (value.DATA_PROVIDER === 'real') {
    requireProduction(Boolean(value.VEHICLE_API_BASE_URL && value.VEHICLE_API_QUERY_PATH), 'VEHICLE_PROVIDER_ENDPOINT_REQUIRED', issues);
    if (value.VEHICLE_API_AUTH_SCHEME === 'bearer') {
      requireProduction(Boolean(value.VEHICLE_API_TOKEN || value.APIBRASIL_BEARER_TOKEN), 'VEHICLE_PROVIDER_BEARER_REQUIRED', issues);
    } else {
      requireProduction(Boolean(value.VEHICLE_API_LOGIN && value.VEHICLE_API_PASSWORD), 'VEHICLE_PROVIDER_BASIC_AUTH_REQUIRED', issues);
    }
  }

  if (value.PAYMENT_PROVIDER === 'asaas') {
    requireProduction(Boolean(value.PAYMENT_API_BASE_URL && value.PAYMENT_API_KEY && value.PAYMENT_WEBHOOK_SECRET), 'ASAAS_CHECKOUT_AND_WEBHOOK_REQUIRED', issues);
    requireProduction(value.PAYMENT_API_BASE_URL !== 'https://api-sandbox.asaas.com', 'ASAAS_SANDBOX_URL_FORBIDDEN', issues);
  }
  if (value.PAYMENT_PROVIDER === 'mercadopago') {
    requireProduction(Boolean(value.MP_ACCESS_TOKEN && value.MP_WEBHOOK_SECRET), 'MERCADOPAGO_CHECKOUT_AND_WEBHOOK_REQUIRED', issues);
  }
  if (value.EMAIL_PROVIDER === 'smtp') {
    requireProduction(Boolean(value.SMTP_HOST && value.SMTP_USER && value.SMTP_PASSWORD), 'SMTP_CREDENTIALS_REQUIRED', issues);
  }
  if (value.SUPER_ADMIN_BOOTSTRAP_ENABLED) {
    requireProduction(Boolean(value.SUPER_ADMIN_BOOTSTRAP_EMAIL), 'SUPER_ADMIN_BOOTSTRAP_EMAIL_REQUIRED', issues);
  }

  const configuredSecrets = [
    value.JWT_SECRET,
    value.ADMIN_JWT_SECRET,
    value.DATA_ENCRYPTION_KEY,
    value.SMTP_PASSWORD,
    value.VEHICLE_API_TOKEN,
    value.APIBRASIL_BEARER_TOKEN,
    value.APIBRASIL_DEVICE_TOKEN,
    value.VEHICLE_API_DEVICE_TOKEN,
    value.PAYMENT_API_KEY,
    value.PAYMENT_WEBHOOK_SECRET,
    value.MP_ACCESS_TOKEN,
    value.MP_WEBHOOK_SECRET,
    value.OAUTH_GOOGLE_CLIENT_SECRET,
    value.OAUTH_MICROSOFT_CLIENT_SECRET,
    value.OAUTH_APPLE_PRIVATE_KEY
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
  EMAIL_PROVIDER: z.enum(['disabled', 'smtp']).default('disabled'),
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().positive().max(65535).default(587),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  SMTP_SECURE: booleanFromEnv.default(false),
  EMAIL_FROM: z.string().trim().email().default('no-reply@placanamao.com.br'),
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
  // Mantida por compatibilidade de variável; o 2FA de equipe é SEMPRE exigido (valor ignorado).
  TEAM_TOTP_REQUIRED: booleanFromEnv.default(true),
  // Chave AES-256-GCM (>=32 caracteres) para JSON bruto do provedor e dados sensíveis em repouso.
  DATA_ENCRYPTION_KEY: optionalString,
  // Mascaramento LGPD: documentos e nomes mascarados por padrão.
  PII_REVEAL_ENABLED: booleanFromEnv.default(true),
  PUBLIC_API_ENABLED: booleanFromEnv.default(false),
  PUBLIC_API_RATE_LIMIT_MAX: z.coerce.number().int().positive().max(10000).default(60),

  // Dados veiculares: o modo real só pode operar com contrato e credenciais válidos.
  DATA_PROVIDER: z.enum(['mock', 'real']).default('mock'),

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

  // Pagamentos: credenciais runtime-only; nunca disponibilizar no build ou frontend.
  PAYMENT_PROVIDER: z.enum(['disabled', 'sandbox', 'asaas', 'mercadopago']).default('sandbox'),
  PAYMENT_API_BASE_URL: optionalUrl,
  PAYMENT_API_KEY: optionalString,
  PAYMENT_WEBHOOK_SECRET: optionalString,
  MP_ACCESS_TOKEN: optionalString,
  MP_WEBHOOK_SECRET: optionalString,
  MP_TIMEOUT_MS: z.coerce.number().int().positive().max(120000).default(15000),
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

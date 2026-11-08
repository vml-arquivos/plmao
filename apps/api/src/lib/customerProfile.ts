import { env } from '../config.js';
import { pool } from '../db.js';
import { appError } from './http.js';
import { BR_STATES, isValidCnpj, isValidCpf, onlyDigits } from './br.js';
import { maskPixKey, normalizePixKey } from './pix.js';

/** Versão do termo de responsabilidade aceito no cadastro (texto: cláusulas de responsabilidade dos Termos de Uso e do Contrato). */
export const RESPONSIBILITY_VERSION = '2026-11';

/** Cadastro por etapas. Ligado por padrão; os testes automáticos partem de "desligado".
 *  Criar conta e usar o que é grátis: nome, e-mail, telefone. CPF, cidade, estado e o aceite só na primeira compra de consulta. */
export function profileRequired(): boolean {
  return env.CUSTOMER_PROFILE_REQUIRED ?? env.NODE_ENV !== 'test';
}

export interface ProfileRow {
  customer_type?: string | null; cpf_cnpj?: string | null; phone?: string | null; company_name?: string | null;
  zip?: string | null; street?: string | null; street_number?: string | null; district?: string | null; city?: string | null; state?: string | null;
  responsibility_accepted_at?: Date | string | null;
  pix_key?: string | null; pix_key_type?: string | null;
}

const text = (v: unknown) => String(v ?? '').trim();
export const validPhone = (v: unknown) => { const d = onlyDigits(text(v)); return d.length >= 10 && d.length <= 13; };
export const validDocument = (v: unknown) => isValidCpf(text(v)) || isValidCnpj(text(v));

/** Conta simples (acesso e FIPE grátis pela placa): só o telefone, além de nome e e-mail que já existem. */
export function missingAccessFields(row: ProfileRow | null | undefined): string[] {
  return validPhone((row ?? {}).phone) ? [] : ['telefone'];
}

/** Campos que faltam (ou estão inválidos) para COMPRAR consulta. Vazio = pode comprar. Pedidos uma única vez: telefone (WhatsApp), CPF, cidade, estado e o aceite. */
export function missingProfileFields(row: ProfileRow | null | undefined): string[] {
  const r = row ?? {};
  const missing: string[] = [];
  if (!validPhone(r.phone)) missing.push('telefone');
  if (!validDocument(r.cpf_cnpj)) missing.push('CPF');
  if (text(r.city).length < 2) missing.push('cidade');
  if (!(BR_STATES as readonly string[]).includes(text(r.state).toUpperCase())) missing.push('estado');
  if (!r.responsibility_accepted_at) missing.push('aceite dos termos');
  return missing;
}

export interface ProfileInput {
  phone?: string; cpfCnpj?: string; companyName?: string; zip?: string; street?: string; streetNumber?: string; complement?: string; district?: string; city?: string; state?: string; acceptResponsibility?: boolean;
  pixKey?: string; pixKeyType?: string;
}

/** Valida o cadastro vindo do formulário de criar conta: telefone é obrigatório; CPF, PIX e o resto só são conferidos se vierem preenchidos. Devolve o código de erro ou null. */
export function validateRegistrationProfile(input: ProfileInput, _accountType: string): string | null {
  if (!validPhone(input.phone)) return 'INVALID_PHONE';
  if (text(input.cpfCnpj) && !validDocument(input.cpfCnpj)) return 'INVALID_OWNER_DOC';
  if (text(input.pixKey) && !normalizePixKey(text(input.pixKey), input.pixKeyType)) return 'INVALID_PIX_KEY';
  return null;
}

/** Trava antes de COMPRAR consulta: cliente que ainda não passou pelos dados de compra é levado a completá-los (uma vez só). Equipe interna não é afetada.
 *  Produto gratuito não pede nada além da conta. */
export async function assertCustomerProfile(userId: string, role: string, opts: { productId?: unknown } = {}): Promise<void> {
  if (!profileRequired() || role !== 'CLIENTE') return;
  if (typeof opts.productId === 'string' && opts.productId) {
    const free = await pool.query('SELECT is_free FROM query_products WHERE id=$1', [opts.productId]);
    if (free.rows[0]?.is_free === true) return;
  }
  const row = await pool.query('SELECT customer_type,cpf_cnpj,phone,city,state,responsibility_accepted_at FROM user_profiles WHERE user_id=$1', [userId]);
  const missing = missingProfileFields(row.rows[0] as ProfileRow | undefined);
  if (missing.length) throw appError(`Para comprar a consulta, complete seu cadastro (só na primeira compra): falta ${missing.join(', ')}.`, { code: 'PROFILE_INCOMPLETE', http: 409, expose: true, showMessage: true });
}

/** Perfil como o app recebe: dados, endereço e se está completo. */
export function profileDto(user: { id: string; email: string; name: string; role: string; passwordEnabled: boolean }, p: Record<string, unknown> | undefined) {
  const row = (p ?? {}) as ProfileRow & Record<string, unknown>;
  const missing = missingProfileFields(row);
  return {
    id: user.id, email: user.email, name: user.name, role: user.role, passwordEnabled: user.passwordEnabled,
    cpfCnpj: row.cpf_cnpj ?? '', phone: row.phone ?? '', companyName: row.company_name ?? '', city: row.city ?? '', state: row.state ?? '',
    zip: row.zip ?? '', street: row.street ?? '', streetNumber: row.street_number ?? '', complement: (row.complement as string | null | undefined) ?? '', district: row.district ?? '',
    customerType: row.customer_type ?? 'PARTICULAR', responsibilityAccepted: Boolean(row.responsibility_accepted_at),
    marketingOptIn: Boolean(row.marketing_opt_in), profileComplete: missing.length === 0, profileMissing: missing, profileRequired: profileRequired(),
    accessMissing: missingAccessFields(row), pixKey: row.pix_key ?? '', pixKeyType: row.pix_key_type ?? '', pixKeyMasked: maskPixKey(row.pix_key, row.pix_key_type) ?? '', pixKeyMissing: !row.pix_key
  };
}

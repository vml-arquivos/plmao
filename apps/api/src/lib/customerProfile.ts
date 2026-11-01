import { env } from '../config.js';
import { pool } from '../db.js';
import { appError } from './http.js';
import { BR_STATES, isValidCnpj, isValidCpf, onlyDigits } from './br.js';

/** Versão do termo de responsabilidade aceito no cadastro (texto: cláusulas de responsabilidade dos Termos de Uso e do Contrato). */
export const RESPONSIBILITY_VERSION = '2026-11';

/** Cadastro completo obrigatório para consultar. Ligado por padrão; os testes automáticos partem de "desligado". */
export function profileRequired(): boolean {
  return env.CUSTOMER_PROFILE_REQUIRED ?? env.NODE_ENV !== 'test';
}

export interface ProfileRow {
  customer_type?: string | null; cpf_cnpj?: string | null; phone?: string | null; company_name?: string | null;
  zip?: string | null; street?: string | null; street_number?: string | null; district?: string | null; city?: string | null; state?: string | null;
  responsibility_accepted_at?: Date | string | null;
}

const text = (v: unknown) => String(v ?? '').trim();
export const validPhone = (v: unknown) => { const d = onlyDigits(text(v)); return d.length >= 10 && d.length <= 13; };
export const validDocument = (v: unknown) => isValidCpf(text(v)) || isValidCnpj(text(v));

/** Campos que faltam (ou estão inválidos) para o cadastro estar completo. Vazio = completo. */
export function missingProfileFields(row: ProfileRow | null | undefined): string[] {
  const r = row ?? {};
  const missing: string[] = [];
  if (!validPhone(r.phone)) missing.push('telefone');
  if (!validDocument(r.cpf_cnpj)) missing.push('CPF ou CNPJ');
  if (r.customer_type === 'EMPRESA' && (!text(r.company_name) || !isValidCnpj(text(r.cpf_cnpj)))) missing.push('empresa e CNPJ');
  if (onlyDigits(text(r.zip)).length !== 8) missing.push('CEP');
  if (text(r.street).length < 3) missing.push('rua');
  if (!text(r.street_number)) missing.push('número');
  if (text(r.district).length < 2) missing.push('bairro');
  if (text(r.city).length < 2) missing.push('cidade');
  if (!(BR_STATES as readonly string[]).includes(text(r.state).toUpperCase())) missing.push('estado');
  if (!r.responsibility_accepted_at) missing.push('termo de responsabilidade');
  return missing;
}

export interface ProfileInput {
  phone?: string; cpfCnpj?: string; companyName?: string; zip?: string; street?: string; streetNumber?: string; complement?: string; district?: string; city?: string; state?: string; acceptResponsibility?: boolean;
}

/** Valida o cadastro vindo do formulário de criar conta. Devolve o código de erro ou null. */
export function validateRegistrationProfile(input: ProfileInput, accountType: string): string | null {
  if (!validPhone(input.phone)) return 'INVALID_PHONE';
  if (!validDocument(input.cpfCnpj)) return 'INVALID_OWNER_DOC';
  if (accountType === 'EMPRESA' && (!text(input.companyName) || !isValidCnpj(text(input.cpfCnpj)))) return 'PROFILE_INCOMPLETE';
  if (onlyDigits(text(input.zip)).length !== 8) return 'INVALID_ZIP';
  const row: ProfileRow = { customer_type: accountType, cpf_cnpj: input.cpfCnpj, phone: input.phone, company_name: input.companyName, zip: input.zip, street: input.street, street_number: input.streetNumber, district: input.district, city: input.city, state: input.state, responsibility_accepted_at: input.acceptResponsibility ? new Date() : null };
  const missing = missingProfileFields(row);
  if (missing.includes('termo de responsabilidade')) return 'RESPONSIBILITY_REQUIRED';
  return missing.length ? 'PROFILE_INCOMPLETE' : null;
}

/** Trava antes de consultar ou pagar: cliente com cadastro incompleto é levado a completar. Equipe interna não é afetada. */
export async function assertCustomerProfile(userId: string, role: string): Promise<void> {
  if (!profileRequired() || role !== 'CLIENTE') return;
  const row = await pool.query('SELECT customer_type,cpf_cnpj,phone,company_name,zip,street,street_number,district,city,state,responsibility_accepted_at FROM user_profiles WHERE user_id=$1', [userId]);
  const missing = missingProfileFields(row.rows[0] as ProfileRow | undefined);
  if (missing.length) throw appError(`Complete seu cadastro para consultar: falta ${missing.join(', ')}.`, { code: 'PROFILE_INCOMPLETE', http: 409, expose: true, showMessage: true });
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
    marketingOptIn: Boolean(row.marketing_opt_in), profileComplete: missing.length === 0, profileMissing: missing, profileRequired: profileRequired()
  };
}

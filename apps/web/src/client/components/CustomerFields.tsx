import { Link } from 'react-router-dom';
import { Check, Field, Input, Select } from '../../shared/ui';

export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

/** Conta simples: nome, e-mail e WhatsApp. CPF, cidade, estado e o aceite só são pedidos na primeira compra de consulta (uma vez). Endereço, CEP e documentos não são pedidos. */
export interface CustomerData { phone: string; cpfCnpj: string; companyName: string; city: string; state: string; responsibility: boolean }
export const emptyCustomer: CustomerData = { phone: '', cpfCnpj: '', companyName: '', city: '', state: '', responsibility: false };

const digits = (v: string) => v.replace(/\D/g, '');

function validCpf(v: string): boolean {
  const d = digits(v);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  for (const n of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Number(d[i]) * (n + 1 - i);
    if (((sum * 10) % 11) % 10 !== Number(d[n])) return false;
  }
  return true;
}
function validCnpj(v: string): boolean {
  const d = digits(v);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  for (const n of [12, 13]) {
    const w = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Number(d[i]) * w[i]!;
    const r = sum % 11;
    if ((r < 2 ? 0 : 11 - r) !== Number(d[n])) return false;
  }
  return true;
}

/** Mesma regra do servidor: devolve a primeira pendência em português, ou '' se está tudo certo. */
export function customerProblem(c: CustomerData, _accountType: string, opts: { needResponsibility: boolean }): string {
  const phone = digits(c.phone);
  if (phone.length < 10 || phone.length > 13) return 'Informe um WhatsApp válido, com DDD.';
  if (!validCpf(c.cpfCnpj) && !validCnpj(c.cpfCnpj)) return 'Informe um CPF válido.';
  if (c.city.trim().length < 2) return 'Informe a cidade.';
  if (!UFS.includes(c.state)) return 'Escolha o estado.';
  if (opts.needResponsibility && !c.responsibility) return 'Para continuar, aceite os Termos de Uso e a Política de Privacidade.';
  return '';
}

/** Chave PIX: opcional no cadastro; usada só para reembolso, cashback e comissão do Indique e Ganhe. */
export type PixType = 'CPF' | 'CNPJ' | 'EMAIL' | 'TELEFONE' | 'ALEATORIA';
export const PIX_TYPE_LABEL: Record<PixType, string> = { CPF: 'CPF', CNPJ: 'CNPJ', EMAIL: 'E-mail', TELEFONE: 'Celular', ALEATORIA: 'Chave aleatória' };
export interface PixData { type: PixType; key: string }
export const emptyPix: PixData = { type: 'CPF', key: '' };

/** Mesma regra do servidor para a chave PIX. Vazio é permitido (campo opcional). */
export function pixProblem(p: PixData): string {
  const v = p.key.trim();
  if (!v) return '';
  const d = digits(v);
  const ok = p.type === 'CPF' ? validCpf(v) : p.type === 'CNPJ' ? validCnpj(v)
    : p.type === 'EMAIL' ? /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)
    : p.type === 'TELEFONE' ? /^(55)?\d{10,11}$/.test(d)
    : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  return ok ? '' : `A chave PIX não parece válida para o tipo "${PIX_TYPE_LABEL[p.type]}".`;
}

/** Só o WhatsApp é obrigatório na criação da conta. */
export function signupProblem(phone: string): string {
  const d = digits(phone);
  return d.length < 10 || d.length > 13 ? 'Informe um WhatsApp válido, com DDD.' : '';
}

export function PixFields({ value, onChange, hint, required }: { value: PixData; onChange: (next: PixData) => void; hint?: string; required?: boolean }) {
  return (
    <div className="form-grid cols-2">
      <Field label="Tipo da chave PIX"><Select name="pixType" value={value.type} onChange={(e) => onChange({ ...value, type: e.target.value as PixType })}>{(Object.keys(PIX_TYPE_LABEL) as PixType[]).map((t) => <option key={t} value={t}>{PIX_TYPE_LABEL[t]}</option>)}</Select></Field>
      <Field label={required ? 'Sua chave PIX' : 'Sua chave PIX (opcional)'} hint={hint ?? 'Para devolver valores, pagar cashback e comissões do Indique e Ganhe.'}><Input name="pixKey" value={value.key} onChange={(e) => onChange({ ...value, key: e.target.value })} autoComplete="off" placeholder={value.type === 'EMAIL' ? 'voce@exemplo.com' : value.type === 'ALEATORIA' ? '00000000-0000-0000-0000-000000000000' : value.type === 'TELEFONE' ? '(11) 99999-0000' : undefined} /></Field>
    </div>
  );
}

export function ResponsibilityCheck({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Check checked={checked} onChange={(e) => onChange(e.target.checked)} required>
      Declaro que os dados acima são verdadeiros e que sou o único responsável pelas informações a que tiver acesso nas consultas (incluindo dados de proprietários e histórico do veículo), usando-as apenas para finalidade legítima, como a conferência de uma compra, venda ou financiamento, e respondendo pelo seu armazenamento, compartilhamento e descarte, conforme a cláusula 4 dos <Link to="/termos" target="_blank">Termos de Uso</Link> e a <Link to="/privacidade" target="_blank">Política de Privacidade</Link>.
    </Check>
  );
}

/** Criar conta: só o WhatsApp (nome, e-mail e senha ficam no formulário). */
export function SignupFields({ phone, onPhone }: { phone: string; onPhone: (v: string) => void }) {
  return (
    <Field label="WhatsApp (com DDD)"><Input name="phone" value={phone} onChange={(e) => onPhone(e.target.value)} autoComplete="tel" inputMode="tel" required placeholder="(11) 99999-0000" /></Field>
  );
}

/** Primeira compra e Minha conta: WhatsApp, CPF, cidade e estado. */
export function CustomerFields({ value, onChange }: { value: CustomerData; onChange: (next: CustomerData) => void; accountType?: string }) {
  const set = <K extends keyof CustomerData>(k: K, v: CustomerData[K]) => onChange({ ...value, [k]: v });
  return (
    <>
      <div className="form-grid cols-2">
        <Field label="WhatsApp (com DDD)"><Input name="phone" value={value.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="tel" inputMode="tel" required placeholder="(11) 99999-0000" /></Field>
        <Field label="CPF"><Input name="cpfCnpj" value={value.cpfCnpj} onChange={(e) => set('cpfCnpj', e.target.value)} inputMode="numeric" required placeholder="000.000.000-00" /></Field>
        <Field label="Cidade"><Input name="city" value={value.city} onChange={(e) => set('city', e.target.value)} autoComplete="address-level2" required /></Field>
        <Field label="Estado"><Select name="state" value={value.state} onChange={(e) => set('state', e.target.value)} required><option value="">—</option>{UFS.map((u) => <option key={u}>{u}</option>)}</Select></Field>
      </div>
    </>
  );
}

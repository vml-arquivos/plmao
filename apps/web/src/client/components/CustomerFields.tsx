import { Link } from 'react-router-dom';
import { Check, Field, Input, Select } from '../../shared/ui';

export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

/** Cadastro enxuto: WhatsApp, CPF, cidade, estado e o aceite. Endereço, CEP e documentos não são pedidos. */
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

export function ResponsibilityCheck({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Check checked={checked} onChange={(e) => onChange(e.target.checked)} required>
      Declaro que os dados acima são verdadeiros e que sou o único responsável pelas informações a que tiver acesso nas consultas (incluindo dados de proprietários e histórico do veículo), usando-as apenas para finalidade legítima, como a conferência de uma compra, venda ou financiamento, e respondendo pelo seu armazenamento, compartilhamento e descarte, conforme a cláusula 4 dos <Link to="/termos" target="_blank">Termos de Uso</Link> e a <Link to="/privacidade" target="_blank">Política de Privacidade</Link>.
    </Check>
  );
}

/** WhatsApp, CPF, cidade e estado: usados no cadastro. */
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

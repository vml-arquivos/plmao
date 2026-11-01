import { Link } from 'react-router-dom';
import { Check, Field, Input, Select } from '../../shared/ui';

export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

export interface CustomerData { phone: string; cpfCnpj: string; companyName: string; zip: string; street: string; streetNumber: string; complement: string; district: string; city: string; state: string; responsibility: boolean }
export const emptyCustomer: CustomerData = { phone: '', cpfCnpj: '', companyName: '', zip: '', street: '', streetNumber: '', complement: '', district: '', city: '', state: '', responsibility: false };

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
export function customerProblem(c: CustomerData, accountType: string, opts: { needResponsibility: boolean }): string {
  const phone = digits(c.phone);
  if (phone.length < 10 || phone.length > 13) return 'Informe um telefone válido, com DDD.';
  if (!validCpf(c.cpfCnpj) && !validCnpj(c.cpfCnpj)) return 'Informe um CPF ou CNPJ válido.';
  if (accountType === 'EMPRESA' && (!c.companyName.trim() || !validCnpj(c.cpfCnpj))) return 'Para conta de empresa, informe o nome da empresa e o CNPJ.';
  if (digits(c.zip).length !== 8) return 'Informe o CEP com 8 números.';
  if (c.street.trim().length < 3) return 'Informe a rua ou avenida.';
  if (!c.streetNumber.trim()) return 'Informe o número do endereço (ou S/N).';
  if (c.district.trim().length < 2) return 'Informe o bairro.';
  if (c.city.trim().length < 2) return 'Informe a cidade.';
  if (!UFS.includes(c.state)) return 'Escolha o estado.';
  if (opts.needResponsibility && !c.responsibility) return 'Para continuar, aceite o termo de responsabilidade pelas informações consultadas.';
  return '';
}

const maskZip = (v: string) => { const d = digits(v).slice(0, 8); return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d; };

export function ResponsibilityCheck({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Check checked={checked} onChange={(e) => onChange(e.target.checked)} required>
      Declaro que os dados acima são verdadeiros e que sou o único responsável pelas informações a que tiver acesso nas consultas (incluindo dados de proprietários e histórico do veículo), usando-as apenas para finalidade legítima, como a conferência de uma compra, venda ou financiamento, e respondendo pelo seu armazenamento, compartilhamento e descarte, conforme a cláusula 4 dos <Link to="/termos" target="_blank">Termos de Uso</Link> e a <Link to="/privacidade" target="_blank">Política de Privacidade</Link>.
    </Check>
  );
}

/** Telefone, documento e endereço completos: usados no cadastro e em "Minha conta". */
export function CustomerFields({ value, onChange, accountType }: { value: CustomerData; onChange: (next: CustomerData) => void; accountType: string }) {
  const set = <K extends keyof CustomerData>(k: K, v: CustomerData[K]) => onChange({ ...value, [k]: v });
  const empresa = accountType === 'EMPRESA';
  return (
    <>
      <div className="form-grid cols-2">
        <Field label="Telefone com DDD"><Input name="phone" value={value.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="tel" inputMode="tel" required placeholder="(11) 99999-0000" /></Field>
        <Field label={empresa ? 'CNPJ' : 'CPF ou CNPJ'}><Input name="cpfCnpj" value={value.cpfCnpj} onChange={(e) => set('cpfCnpj', e.target.value)} inputMode="numeric" required placeholder={empresa ? '00.000.000/0000-00' : '000.000.000-00'} /></Field>
      </div>
      {empresa && <Field label="Nome da empresa"><Input name="companyName" value={value.companyName} onChange={(e) => set('companyName', e.target.value)} autoComplete="organization" required /></Field>}
      <div className="form-grid cols-2">
        <Field label="CEP"><Input name="zip" value={value.zip} onChange={(e) => set('zip', maskZip(e.target.value))} autoComplete="postal-code" inputMode="numeric" required placeholder="00000-000" /></Field>
        <Field label="Rua ou avenida"><Input name="street" value={value.street} onChange={(e) => set('street', e.target.value)} autoComplete="address-line1" required /></Field>
        <Field label="Número"><Input name="streetNumber" value={value.streetNumber} onChange={(e) => set('streetNumber', e.target.value)} required placeholder="Ex.: 120 ou S/N" /></Field>
        <Field label="Complemento (opcional)"><Input name="complement" value={value.complement} onChange={(e) => set('complement', e.target.value)} autoComplete="address-line2" /></Field>
        <Field label="Bairro"><Input name="district" value={value.district} onChange={(e) => set('district', e.target.value)} required /></Field>
        <Field label="Cidade"><Input name="city" value={value.city} onChange={(e) => set('city', e.target.value)} autoComplete="address-level2" required /></Field>
        <Field label="Estado"><Select name="state" value={value.state} onChange={(e) => set('state', e.target.value)} required><option value="">—</option>{UFS.map((u) => <option key={u}>{u}</option>)}</Select></Field>
      </div>
    </>
  );
}

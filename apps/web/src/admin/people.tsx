import { useEffect, useRef, useState } from 'react';
import { api, CUSTOMER_TYPE, type CustomerType } from './api';
import { Badge, Button, Input, Select, Spinner } from '../shared/ui';

export interface Customer {
  id: string; name: string; email: string; active: boolean; archived: boolean; createdAt: string; lastLoginAt: string | null; portalAccess: boolean;
  type: CustomerType; segment: string | null; cpfCnpj: string | null; documentKind: 'CPF' | 'CNPJ' | null; phone: string | null; companyName: string | null; legalName: string | null;
  stateRegistration: string | null; municipalRegistration: string | null; billingEmail: string | null;
  zip: string | null; street: string | null; streetNumber: string | null; complement: string | null; district: string | null; city: string | null; state: string | null; notes: string | null;
  organization: { id: string; name: string } | null;
  balanceCents: number; queriesCount: number; lastQueryAt: string | null; paidCents: number; openCents: number; overdueCents: number; fiscalReady: boolean;
}

export interface Company {
  id: string; name: string; kind: string; segment: string | null; document: string | null; legalName: string | null; contactName: string | null; email: string | null; phone: string | null;
  stateRegistration: string | null; municipalRegistration: string | null; zip: string | null; street: string | null; streetNumber: string | null; complement: string | null; district: string | null;
  city: string | null; state: string | null; notes: string | null; active: boolean; archived: boolean; createdAt: string;
  membersCount: number; queriesCount: number; paidCents: number; openCents: number; overdueCents: number;
}

export function TypeBadge({ type }: { type: string | undefined }) {
  const t = CUSTOMER_TYPE[(type as CustomerType) ?? 'PARTICULAR'] ?? CUSTOMER_TYPE.PARTICULAR;
  return <Badge tone={t.tone}>{t.label}</Badge>;
}

/** Seletor de tipo de cliente em três cartões grandes, com explicação. */
export function TypeCards({ value, onChange }: { value: CustomerType; onChange: (t: CustomerType) => void }) {
  return (
    <div className="type-cards" role="radiogroup" aria-label="Tipo de cliente">
      {(Object.keys(CUSTOMER_TYPE) as CustomerType[]).map((t) => (
        <button key={t} type="button" role="radio" aria-checked={value === t} className={`type-card ${value === t ? 'on' : ''}`} onClick={() => onChange(t)}>
          <b>{CUSTOMER_TYPE[t].label}</b><span>{CUSTOMER_TYPE[t].hint}</span>
        </button>
      ))}
    </div>
  );
}

export interface PickedCustomer { id: string; name: string; email: string; type: CustomerType }

/** Busca cliente por nome, e-mail ou CPF/CNPJ e devolve a escolha. */
export function CustomerPicker({ value, onChange, placeholder = 'Digite o nome, e-mail ou CPF/CNPJ do cliente' }: { value: PickedCustomer | null; onChange: (c: PickedCustomer | null) => void; placeholder?: string }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Customer[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    if (q.trim().length < 2) { setItems([]); return undefined; }
    const mine = ++seq.current;
    setBusy(true);
    const t = setTimeout(() => {
      api.get<{ items: Customer[] }>('/admin/customers', { query: { search: q.trim(), limit: 8, status: 'active' } })
        .then((r) => { if (mine === seq.current) setItems(r.items); }).catch(() => { if (mine === seq.current) setItems([]); }).finally(() => { if (mine === seq.current) setBusy(false); });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  if (value) {
    return <div className="picked"><div><b>{value.name}</b><div className="muted" style={{ fontSize: 12.5 }}>{value.email}</div></div><TypeBadge type={value.type} /><Button size="sm" variant="ghost" onClick={() => { onChange(null); setQ(''); }}>Trocar</Button></div>;
  }
  return (
    <div className="picker">
      <Input icon="search" placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar cliente" />
      {busy && <div className="picker-list"><div className="picker-empty"><Spinner size={16} /> Buscando…</div></div>}
      {!busy && q.trim().length >= 2 && (
        <div className="picker-list" role="listbox">
          {!items.length && <div className="picker-empty">Nenhum cliente encontrado.</div>}
          {items.map((c) => (
            <button type="button" key={c.id} role="option" aria-selected="false" onClick={() => onChange({ id: c.id, name: c.name, email: c.email, type: c.type })}>
              <span><b>{c.name}</b><small>{c.email}</small></span><TypeBadge type={c.type} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Lista de empresas ativas para escolher (vínculo de cliente ou pagador). */
export function CompanySelect({ value, onChange, allowNone = true, noneLabel = 'Sem empresa' }: { value: string; onChange: (id: string) => void; allowNone?: boolean; noneLabel?: string }) {
  const [items, setItems] = useState<Company[]>([]);
  useEffect(() => { api.get<{ items: Company[] }>('/admin/companies').then((r) => setItems(r.items)).catch(() => setItems([])); }, []);
  return <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Empresa">{allowNone && <option value="">{noneLabel}</option>}{items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>;
}

export const SITUATION: Record<string, { label: string; tone: 'ok' | 'warn' | 'danger' | 'info' | 'neutral' }> = {
  OPEN: { label: 'Em aberto', tone: 'info' }, OVERDUE: { label: 'Em atraso', tone: 'danger' }, PAID: { label: 'Paga', tone: 'ok' }, CANCELLED: { label: 'Cancelada', tone: 'neutral' }
};
export const FISCAL_STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'danger' | 'info' | 'neutral' }> = {
  PENDING: { label: 'A emitir', tone: 'warn' }, ISSUED: { label: 'Emitida', tone: 'ok' }, CANCELLED: { label: 'Cancelada', tone: 'neutral' }
};

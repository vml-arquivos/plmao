import { useState } from 'react';
import { api } from '../api';
import { Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageLoading, Select, Switch, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateTime, money, num } from '../../shared/format';
import { PageHead } from '../parts';

interface C { id: string; code: string; discountType: 'PERCENT' | 'FIXED'; discountValue: number; maxRedemptions: number | null; redeemedCount: number; startsAt: string | null; expiresAt: string | null; active: boolean }
const toLocal = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date(iso).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');

export default function Coupons() {
  usePageTitle('Cupons');
  const toast = useToast();
  const list = useAsync(() => api.get<C[]>('/admin/coupons'));
  const [edit, setEdit] = useState<C | 'new' | null>(null);
  const [del, setDel] = useState<C | null>(null);
  return (
    <>
      <PageHead title="Cupons" sub="Descontos aplicados no checkout. Valor fixo em centavos; percentual de 1 a 100." actions={<Button variant="primary" icon="plus" onClick={() => setEdit('new')}>Novo cupom</Button>} />
      {list.loading && !list.data ? <PageLoading /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !list.data?.length ? <EmptyState icon="percent" title="Nenhum cupom criado" /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Código</th><th>Desconto</th><th className="r">Usos</th><th>Validade</th><th>Status</th><th /></tr></thead><tbody>
          {list.data.map((c) => (
            <tr key={c.id}><td><b className="mono">{c.code}</b></td><td>{c.discountType === 'PERCENT' ? `${c.discountValue}%` : money(c.discountValue)}</td>
              <td className="r num">{num(c.redeemedCount)}{c.maxRedemptions ? ` / ${num(c.maxRedemptions)}` : ''}</td>
              <td>{c.expiresAt ? `até ${dateTime(c.expiresAt)}` : 'Sem prazo'}</td><td><Badge tone={c.active ? 'ok' : 'neutral'} dot>{c.active ? 'Ativo' : 'Inativo'}</Badge></td>
              <td className="actions"><Button size="sm" variant="ghost" onClick={() => setEdit(c)}>Editar</Button>{c.active && <Button size="sm" variant="ghost" onClick={() => setDel(c)}>Desativar</Button>}</td></tr>
          ))}
        </tbody></table></div>
      )}
      {edit && <CouponModal coupon={edit === 'new' ? null : edit} onClose={() => { setEdit(null); list.reload(); }} />}
      {del && <ConfirmDialog title="Desativar cupom" message={<p>Desativar o cupom <b>{del.code}</b>? Ele deixa de valer imediatamente.</p>} confirmLabel="Desativar" danger onConfirm={async () => { try { await api.del(`/admin/coupons/${del.id}`); toast.ok('Cupom desativado.'); list.reload(); } catch (e) { toast.error(errorMessage(e)); } }} onClose={() => setDel(null)} />}
    </>
  );
}

function CouponModal({ coupon, onClose }: { coupon: C | null; onClose: () => void }) {
  const toast = useToast();
  const [code, setCode] = useState(coupon?.code ?? '');
  const [type, setType] = useState<'PERCENT' | 'FIXED'>(coupon?.discountType ?? 'PERCENT');
  const [value, setValue] = useState(String(coupon ? (coupon.discountType === 'FIXED' ? (coupon.discountValue / 100).toFixed(2).replace('.', ',') : coupon.discountValue) : 10));
  const [max, setMax] = useState(coupon?.maxRedemptions ? String(coupon.maxRedemptions) : '');
  const [ends, setEnds] = useState(toLocal(coupon?.expiresAt ?? null));
  const [active, setActive] = useState(coupon?.active ?? true);
  const [busy, setBusy] = useState(false);
  async function save() {
    const raw = Number(value.replace(',', '.'));
    const discountValue = type === 'FIXED' ? Math.round(raw * 100) : Math.round(raw);
    if (!Number.isFinite(raw) || discountValue <= 0) { toast.error('Informe um valor de desconto válido.'); return; }
    const body = { code: code.trim(), discountType: type, discountValue, maxRedemptions: max ? Number(max) : null, expiresAt: ends ? new Date(ends).toISOString() : null, active };
    setBusy(true);
    try { if (coupon) await api.patch(`/admin/coupons/${coupon.id}`, body); else await api.post('/admin/coupons', body); toast.ok('Cupom salvo.'); onClose(); } catch (e) { toast.error(errorMessage(e)); setBusy(false); }
  }
  return (
    <Modal title={coupon ? `Editar ${coupon.code}` : 'Novo cupom'} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} disabled={code.trim().length < 3} onClick={() => void save()}>Salvar</Button></>}>
      <div className="stack">
        <Field label="Código" hint="Letras, números, - e _"><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={40} /></Field>
        <div className="form-grid"><Field label="Tipo"><Select value={type} onChange={(e) => setType(e.target.value as 'PERCENT' | 'FIXED')}><option value="PERCENT">Percentual (%)</option><option value="FIXED">Valor fixo (R$)</option></Select></Field>
          <Field label={type === 'PERCENT' ? 'Desconto (%)' : 'Desconto (R$)'}><Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} /></Field></div>
        <div className="form-grid"><Field label="Limite de usos" hint="Vazio = ilimitado"><Input inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))} /></Field>
          <Field label="Expira em"><Input type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} /></Field></div>
        <Switch checked={active} onChange={(e) => setActive(e.target.checked)} label="Cupom ativo" />
      </div>
    </Modal>
  );
}

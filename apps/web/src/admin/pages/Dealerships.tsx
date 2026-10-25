import { useState } from 'react';
import { api } from '../api';
import { Badge, Button, EmptyState, ErrorState, Field, Input, Modal, PageLoading, Switch, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateOnly, num } from '../../shared/format';
import { PageHead } from '../parts';
import { useAdminSession } from '../session';

interface D { id: string; name: string; slug: string; city: string | null; state: string | null; active: boolean; publicEnabled: boolean; vehicleLimit: number; memberLimit: number; vehicles: number; members: number; leads: number; ownerName: string; ownerEmail: string; createdAt: string }

function Edit({ d, onClose }: { d: D; onClose: () => void }) {
  const toast = useToast();
  const [active, setActive] = useState(d.active); const [vl, setVl] = useState(String(d.vehicleLimit)); const [ml, setMl] = useState(String(d.memberLimit)); const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await api.patch(`/admin/dealerships/${d.id}`, { active, vehicleLimit: Number(vl), memberLimit: Number(ml) }); toast.ok('Salvo.'); onClose(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title={d.name} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Salvar</Button></>}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>{d.ownerName} · {d.ownerEmail}</p>
        <Switch label="Loja ativa" checked={active} onChange={(e) => setActive(e.target.checked)} />
        <div className="grid-2">
          <Field label="Limite de veículos"><Input inputMode="numeric" value={vl} onChange={(e) => setVl(e.target.value.replace(/\D/g, ''))} /></Field>
          <Field label="Limite de pessoas"><Input inputMode="numeric" value={ml} onChange={(e) => setMl(e.target.value.replace(/\D/g, ''))} /></Field>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Desativar bloqueia a equipe e tira a vitrine do ar. Nada é apagado.</p>
      </div>
    </Modal>
  );
}

export default function Dealerships() {
  usePageTitle('Lojas');
  const { can } = useAdminSession();
  const [q, setQ] = useState('');
  const list = useAsync(() => api.get<D[]>(`/admin/dealerships${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`), [q]);
  const [edit, setEdit] = useState<D | null>(null);
  return (
    <>
      <PageHead title="Lojas" sub="Concessionárias, agências e vendedores que usam estoque, leads e vitrine." actions={<Input icon="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome, endereço ou e-mail" style={{ minWidth: 240 }} />} />
      {list.loading && !list.data ? <PageLoading /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !list.data?.length ? <EmptyState icon="building" title="Nenhuma loja" /> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Loja</th><th>Responsável</th><th className="r">Veículos</th><th className="r">Pessoas</th><th className="r">Leads</th><th>Situação</th><th /></tr></thead><tbody>
          {list.data.map((d) => (
            <tr key={d.id}>
              <td><b>{d.name}</b><div className="muted" style={{ fontSize: 13 }}>/loja/{d.slug}{d.city ? ` · ${d.city}${d.state ? ` - ${d.state}` : ''}` : ''} · {dateOnly(d.createdAt)}</div></td>
              <td>{d.ownerName}<div className="muted" style={{ fontSize: 13 }}>{d.ownerEmail}</div></td>
              <td className="r num">{num(d.vehicles)} / {num(d.vehicleLimit)}</td><td className="r num">{num(d.members)} / {num(d.memberLimit)}</td><td className="r num">{num(d.leads)}</td>
              <td><Badge tone={d.active ? 'ok' : 'danger'} dot>{d.active ? 'Ativa' : 'Suspensa'}</Badge>{d.publicEnabled && <> <Badge>Vitrine</Badge></>}</td>
              <td className="actions">{can('MANAGE_CUSTOMERS') && <Button size="sm" variant="ghost" onClick={() => setEdit(d)}>Editar</Button>}</td>
            </tr>
          ))}
        </tbody></table></div>
      )}
      {edit && <Edit d={edit} onClose={() => { setEdit(null); list.reload(); }} />}
    </>
  );
}

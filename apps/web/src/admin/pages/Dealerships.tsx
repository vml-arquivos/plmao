import { useState } from 'react';
import { api } from '../api';
import { Alert, Badge, Button, EmptyState, ErrorState, Field, Input, Modal, PageLoading, Select, Switch, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateOnly, num } from '../../shared/format';
import { PageHead } from '../parts';
import { useAdminSession } from '../session';
import { CustomerPicker, type Company, type Customer, type PickedCustomer } from '../people';
import { CustomerForm } from './Customers';

interface D { id: string; name: string; slug: string; city: string | null; state: string | null; active: boolean; archived: boolean; publicEnabled: boolean; vehicleLimit: number; memberLimit: number; vehicles: number; members: number; leads: number; ownerName: string; ownerEmail: string; createdAt: string }

interface Full { id: string; name: string; slug: string; whatsapp: string | null; email: string | null; city: string | null; state: string | null; about: string; publicEnabled: boolean; active: boolean; archived: boolean; vehicleLimit: number; memberLimit: number; logoUrl: string | null; coverUrl: string | null; accentColor: string | null; instagram: string | null; address: string | null; hours: string | null; tradeInDiscountBps: number; staleDays: number; ownerName: string; ownerEmail: string }

function Edit({ d, onClose }: { d: D; onClose: () => void }) {
  const toast = useToast();
  const full = useAsync(() => api.get<Full>(`/admin/dealerships/${d.id}`), [d.id]);
  const [f, setF] = useState<Record<string, string> | null>(null);
  const [flags, setFlags] = useState({ active: d.active, publicEnabled: d.publicEnabled });
  const [busy, setBusy] = useState(false); const [transfer, setTransfer] = useState(false); const [newOwner, setNewOwner] = useState('');
  const [del, setDel] = useState(false); const [confirm, setConfirm] = useState('');
  const x = full.data;
  if (x && !f) { setF({ name: x.name, slug: x.slug, whatsapp: x.whatsapp ?? '', email: x.email ?? '', city: x.city ?? '', state: x.state ?? '', about: x.about, vehicleLimit: String(x.vehicleLimit), memberLimit: String(x.memberLimit), logoUrl: x.logoUrl ?? '', coverUrl: x.coverUrl ?? '', accentColor: x.accentColor ?? '', instagram: x.instagram ?? '', address: x.address ?? '', hours: x.hours ?? '' }); setFlags({ active: x.active, publicEnabled: x.publicEnabled }); }
  const set = (k: string) => (e: { target: { value: string } }) => setF((s) => ({ ...(s ?? {}), [k]: e.target.value }));
  const call = async (fn: () => Promise<unknown>, ok: string, done = false) => { setBusy(true); try { await fn(); toast.ok(ok); if (done) onClose(); else full.reload(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } };
  const nul = (v: string) => (v.trim() ? v.trim() : null);
  const save = () => f && call(() => api.patch(`/admin/dealerships/${d.id}`, {
    active: flags.active, publicEnabled: flags.publicEnabled, name: f.name, slug: f.slug, whatsapp: nul(f.whatsapp), email: nul(f.email), city: nul(f.city), state: nul(f.state), about: f.about,
    vehicleLimit: Number(f.vehicleLimit), memberLimit: Number(f.memberLimit), logoUrl: nul(f.logoUrl), coverUrl: nul(f.coverUrl), accentColor: nul(f.accentColor), instagram: nul(f.instagram), address: nul(f.address), hours: nul(f.hours)
  }), 'Salvo.', true);
  return (
    <Modal wide title={d.name} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Fechar</Button><Button variant="primary" loading={busy} disabled={!f} onClick={() => void save()}>Salvar</Button></>}>
      {!f || !x ? <PageLoading /> : (
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>Dono (responsável pelo contrato): <b>{x.ownerName}</b> · {x.ownerEmail}</p>
          <div className="row"><Switch label="Loja ativa" checked={flags.active} onChange={(e) => setFlags((s) => ({ ...s, active: e.target.checked }))} /><Switch label="Vitrine pública" checked={flags.publicEnabled} onChange={(e) => setFlags((s) => ({ ...s, publicEnabled: e.target.checked }))} /></div>
          <div className="grid-2">
            <Field label="Nome"><Input value={f.name} onChange={set('name')} maxLength={80} /></Field>
            <Field label="Endereço da vitrine" hint={`/loja/${f.slug}`}><Input value={f.slug} onChange={(e) => setF((s) => ({ ...(s ?? {}), slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))} maxLength={40} /></Field>
            <Field label="WhatsApp"><Input value={f.whatsapp} onChange={set('whatsapp')} /></Field>
            <Field label="E-mail"><Input value={f.email} onChange={set('email')} /></Field>
            <Field label="Cidade"><Input value={f.city} onChange={set('city')} /></Field>
            <Field label="UF"><Input value={f.state} maxLength={2} onChange={(e) => setF((s) => ({ ...(s ?? {}), state: e.target.value.toUpperCase() }))} /></Field>
            <Field label="Limite de veículos"><Input inputMode="numeric" value={f.vehicleLimit} onChange={(e) => setF((s) => ({ ...(s ?? {}), vehicleLimit: e.target.value.replace(/\D/g, '') }))} /></Field>
            <Field label="Limite de pessoas"><Input inputMode="numeric" value={f.memberLimit} onChange={(e) => setF((s) => ({ ...(s ?? {}), memberLimit: e.target.value.replace(/\D/g, '') }))} /></Field>
            <Field label="Logo (https)"><Input value={f.logoUrl} onChange={set('logoUrl')} /></Field>
            <Field label="Capa (https)"><Input value={f.coverUrl} onChange={set('coverUrl')} /></Field>
            <Field label="Cor (#RRGGBB)"><Input value={f.accentColor} onChange={set('accentColor')} maxLength={7} /></Field>
            <Field label="Instagram"><Input value={f.instagram} onChange={set('instagram')} /></Field>
            <Field label="Endereço"><Input value={f.address} onChange={set('address')} /></Field>
            <Field label="Horário"><Input value={f.hours} onChange={set('hours')} /></Field>
          </div>
          <Field label="Sobre"><Input value={f.about} onChange={set('about')} maxLength={1000} /></Field>
          <div className="row">
            <Button onClick={() => setTransfer(true)}>Trocar o dono</Button>
            {x.archived ? <Button onClick={() => void call(() => api.patch(`/admin/dealerships/${d.id}`, { archived: false }), 'Loja restaurada.', true)}>Restaurar</Button> : <Button onClick={() => void call(() => api.patch(`/admin/dealerships/${d.id}`, { archived: true }), 'Loja arquivada.', true)}>Arquivar</Button>}
            <Button variant="danger" onClick={() => setDel(true)}>Excluir</Button>
          </div>
          {x.archived && <Badge tone="warn">Arquivada</Badge>}
        </div>
      )}
      {transfer && (
        <Modal title="Trocar o dono" onClose={() => setTransfer(false)} footer={<><Button variant="ghost" onClick={() => setTransfer(false)}>Cancelar</Button><Button variant="primary" loading={busy} disabled={!newOwner} onClick={() => void call(() => api.post(`/admin/dealerships/${d.id}/transfer`, { ownerEmail: newOwner }), 'Dono trocado.', true)}>Trocar</Button></>}>
          <div className="stack"><Field label="E-mail do novo dono" hint="Conta de cliente ativa, sem outra loja. O dono atual vira gerente."><Input type="email" value={newOwner} onChange={(e) => setNewOwner(e.target.value)} autoFocus /></Field></div>
        </Modal>
      )}
      {del && (
        <Modal title="Excluir loja" onClose={() => setDel(false)} footer={<><Button variant="ghost" onClick={() => setDel(false)}>Cancelar</Button><Button variant="danger" loading={busy} disabled={confirm.trim().toLowerCase() !== d.slug} onClick={() => void call(() => api.del(`/admin/dealerships/${d.id}`, { body: { confirm } }), 'Loja excluída.', true)}>Excluir definitivamente</Button></>}>
          <div className="stack"><p>Apaga estoque, leads, propostas, avaliações e equipe. Não volta.</p><Field label={`Digite ${d.slug} para confirmar`}><Input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoFocus /></Field></div>
        </Modal>
      )}
    </Modal>
  );
}

const digits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '');

/**
 * Nova loja: o dono é um cliente já cadastrado (busca por nome, e-mail, CPF ou CNPJ) ou um cliente novo cadastrado aqui mesmo.
 * Os dados da loja vêm do cadastro do cliente, ou de uma empresa cadastrada, e dá para ajustar antes de criar.
 */
function NewStore({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [owner, setOwner] = useState<PickedCustomer | null>(null);
  const [hasStore, setHasStore] = useState<string | null>(null);
  const [newCustomer, setNewCustomer] = useState(false);
  const [f, setF] = useState({ name: '', slug: '', whatsapp: '', city: '', state: '' });
  const [pub, setPub] = useState(true); const [busy, setBusy] = useState(false);
  const companies = useAsync(() => api.get<{ items: Company[] }>('/admin/companies').then((r) => r.items).catch(() => [] as Company[]), []);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));

  /** Escolheu o cliente: traz do cadastro dele o nome (empresa ou pessoa), a cidade, a UF e o WhatsApp, e avisa se ele já tem loja. */
  async function pick(c: PickedCustomer | null) {
    setOwner(c); setHasStore(null);
    if (!c) return;
    try {
      const [d, acc] = await Promise.all([
        api.get<{ customer: Customer }>(`/admin/customers/${c.id}`),
        api.get<{ store: { name: string } | null }>(`/admin/customers/${c.id}/access`)
      ]);
      const x = d.customer;
      setF((s) => ({ ...s, name: s.name || x.companyName || x.legalName || x.name, whatsapp: s.whatsapp || digits(x.phone), city: s.city || (x.city ?? ''), state: s.state || (x.state ?? '') }));
      setHasStore(acc.store?.name ?? null);
    } catch { /* o cadastro continua preenchível à mão */ }
  }
  function useCompany(id: string) {
    const co = (companies.data ?? []).find((x) => x.id === id);
    if (!co) return;
    setF((s) => ({ ...s, name: co.name, whatsapp: digits(co.phone) || s.whatsapp, city: co.city ?? s.city, state: co.state ?? s.state }));
  }
  async function save() {
    if (!owner) return;
    setBusy(true);
    try {
      const wa = digits(f.whatsapp);
      await api.post(`/admin/customers/${owner.id}/store`, { name: f.name.trim(), slug: f.slug || undefined, whatsapp: wa.length >= 10 && wa.length <= 13 ? wa : null, city: f.city.trim() || null, state: f.state.trim() || null, publicEnabled: pub });
      toast.ok('Loja criada. O cliente já pode usar o menu de lojista.'); onClose();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <>
      <Modal title="Nova loja" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} disabled={!owner || Boolean(hasStore) || f.name.trim().length < 2} onClick={() => void save()}>Criar</Button></>}>
        <div className="stack">
          <Field label="Dono da loja" hint="Escolha um cliente já cadastrado. Os dados da loja vêm do cadastro dele."><CustomerPicker value={owner} onChange={(c) => void pick(c)} placeholder="Digite o nome, e-mail, CPF ou CNPJ do cliente" /></Field>
          {!owner && <div><Button variant="ghost" size="sm" icon="plus" onClick={() => setNewCustomer(true)}>Cadastrar novo cliente</Button></div>}
          {hasStore && <Alert tone="warn" title="Este cliente já tem loja">A loja “{hasStore}” já existe para ele. Para ativar, suspender ou liberar recursos, abra a ficha dele em Clientes (bloco Pacote e acessos) ou edite a loja na lista.</Alert>}
          <Field label="Preencher com uma empresa já cadastrada" hint="Opcional. Copia nome, cidade, UF e telefone da empresa."><Select defaultValue="" onChange={(e) => useCompany(e.target.value)} aria-label="Empresa cadastrada"><option value="">Não usar</option>{(companies.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Nome da loja"><Input value={f.name} onChange={set('name')} maxLength={80} /></Field>
          <Field label="Endereço da vitrine" hint={`/loja/${f.slug || 'nome-da-loja'}. Em branco gera pelo nome.`}><Input value={f.slug} onChange={(e) => setF((s) => ({ ...s, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))} maxLength={40} /></Field>
          <div className="grid-2">
            <Field label="WhatsApp"><Input inputMode="tel" value={f.whatsapp} onChange={set('whatsapp')} /></Field>
            <Field label="Cidade"><Input value={f.city} onChange={set('city')} /></Field>
          </div>
          <Field label="UF"><Input value={f.state} maxLength={2} onChange={(e) => setF((s) => ({ ...s, state: e.target.value.toUpperCase() }))} style={{ maxWidth: 90 }} /></Field>
          <Switch label="Vitrine pública ligada" checked={pub} onChange={(e) => setPub(e.target.checked)} />
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>Também dá para ativar a loja direto na ficha do cliente (Clientes → cliente → Pacote e acessos).</p>
        </div>
      </Modal>
      {newCustomer && <CustomerForm onClose={() => setNewCustomer(false)} onCreated={(c) => void pick({ id: c.id, name: c.name, email: c.email, type: c.type })} />}
    </>
  );
}

export default function Dealerships() {
  usePageTitle('Lojas');
  const { can } = useAdminSession();
  const [q, setQ] = useState('');
  const list = useAsync(() => api.get<D[]>(`/admin/dealerships${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`), [q]);
  const [edit, setEdit] = useState<D | null>(null); const [adding, setAdding] = useState(false);
  return (
    <>
      <PageHead title="Lojas" sub="Concessionárias, agências e vendedores que usam estoque, leads e vitrine." actions={<><Input icon="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome, endereço ou e-mail" style={{ minWidth: 240 }} />{can('MANAGE_CUSTOMERS') && <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Nova loja</Button>}</>} />
      {list.loading && !list.data ? <PageLoading /> : list.error ? <ErrorState error={list.error} onRetry={list.reload} /> : !list.data?.length ? <EmptyState icon="building" title="Nenhuma loja">O cliente ativa a própria loja em Minha loja, ou você cria aqui.</EmptyState> : (
        <div className="table-wrap"><table className="table"><thead><tr><th>Loja</th><th>Responsável</th><th className="r">Veículos</th><th className="r">Pessoas</th><th className="r">Leads</th><th>Situação</th><th /></tr></thead><tbody>
          {list.data.map((d) => (
            <tr key={d.id}>
              <td><b>{d.name}</b><div className="muted" style={{ fontSize: 13 }}>/loja/{d.slug}{d.city ? ` · ${d.city}${d.state ? ` - ${d.state}` : ''}` : ''} · {dateOnly(d.createdAt)}</div></td>
              <td>{d.ownerName}<div className="muted" style={{ fontSize: 13 }}>{d.ownerEmail}</div></td>
              <td className="r num">{num(d.vehicles)} / {num(d.vehicleLimit)}</td><td className="r num">{num(d.members)} / {num(d.memberLimit)}</td><td className="r num">{num(d.leads)}</td>
              <td><Badge tone={d.archived ? 'warn' : d.active ? 'ok' : 'danger'} dot>{d.archived ? 'Arquivada' : d.active ? 'Ativa' : 'Suspensa'}</Badge>{d.publicEnabled && <> <Badge>Vitrine</Badge></>}</td>
              <td className="actions">{can('MANAGE_CUSTOMERS') && <Button size="sm" variant="ghost" onClick={() => setEdit(d)}>Editar</Button>}</td>
            </tr>
          ))}
        </tbody></table></div>
      )}
      {adding && <NewStore onClose={() => { setAdding(false); list.reload(); }} />}
      {edit && <Edit d={edit} onClose={() => { setEdit(null); list.reload(); }} />}
    </>
  );
}

import { createContext, useContext, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { Icon } from '../../shared/icons';
import { Alert, Badge, Button, ConfirmDialog, ErrorState, Field, Input, Modal, PageLoading, Select, Stat, Switch, Textarea, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { money } from '../../shared/format';
import { api } from '../api';

export type Role = 'OWNER' | 'MANAGER' | 'SELLER';
export interface StoreInfo { id: string; name: string; slug: string; whatsapp: string | null; email: string | null; city: string | null; state: string | null; about: string; publicEnabled: boolean; active: boolean; vehicleLimit: number; memberLimit: number; tradeInDiscountBps: number; staleDays: number; logoUrl: string | null; coverUrl: string | null; accentColor: string | null; instagram: string | null; address: string | null; hours: string | null }
interface MeStore { store: StoreInfo | null; role: Role | null; canManage?: boolean; canSeeCost?: boolean; suspended?: boolean; archived?: boolean }
export interface StoreCtx { store: StoreInfo; role: Role; canManage: boolean; canSeeCost: boolean; reload: () => void }
const Ctx = createContext<StoreCtx | null>(null);
export const useStore = (): StoreCtx => { const v = useContext(Ctx); if (!v) throw new Error('Loja ausente'); return v; };

export const ROLE_LABEL: Record<Role, string> = { OWNER: 'Dono', MANAGER: 'Gerente', SELLER: 'Vendedor' };
export const toCents = (v: string): number | null => { const s = v.replace(/[^\d,]/g, '').replace(',', '.'); if (!s) return null; const n = Math.round(Number(s) * 100); return Number.isFinite(n) ? n : null; };
export const centsField = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));

function Activate({ onDone }: { onDone: () => void }) {
  void onDone;
  return (
    <div className="stack-lg" style={{ maxWidth: 620 }}>
      <div className="page-head"><div><h1>Pacote para lojistas</h1><p>Estoque, clientes, propostas, vitrine e equipe para quem vende veículos.</p></div></div>
      <section className="card card-pad stack">
        <ul className="stack" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Estoque com fotos, custos e tempo de loja</li>
          <li>Leads e funil de atendimento, com acompanhamento de cada cliente</li>
          <li>Propostas e avaliação de troca</li>
          <li>Vitrine pública com o link da sua loja</li>
          <li>Equipe com perfis de dono, gerente e vendedor</li>
          <li>Campanhas e relacionamento com clientes (em breve)</li>
        </ul>
        <p className="muted">O acesso da loja é liberado pelo nosso time quando o pacote é contratado.</p>
        <div><Link className="btn primary" to="/app/suporte">Falar com o suporte</Link></div>
      </section>
    </div>
  );
}

function Archived({ store, owner, onDone }: { store: StoreInfo; owner: boolean; onDone: () => void }) {
  const toast = useToast();
  const [del, setDel] = useState(false); const [confirm, setConfirm] = useState(''); const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok: string) => { setBusy(true); try { await fn(); toast.ok(ok); onDone(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } };
  return (
    <div className="stack" style={{ maxWidth: 560 }}>
      <h1>{store.name}</h1>
      <Alert tone="info" icon="info" title="Loja arquivada">A vitrine está fora do ar e a equipe sem acesso. Nada foi apagado.</Alert>
      {owner ? (
        <div className="row">
          <Button variant="primary" loading={busy} onClick={() => void run(() => api.post('/dealer/restore'), 'Loja restaurada.')}>Restaurar loja</Button>
          <Button variant="ghost" onClick={() => setDel(true)}>Excluir de vez</Button>
        </div>
      ) : <p className="muted">Só o dono restaura a loja.</p>}
      {del && (
        <Modal title="Excluir loja" onClose={() => setDel(false)} footer={<><Button variant="ghost" onClick={() => setDel(false)}>Cancelar</Button><Button variant="danger" loading={busy} disabled={confirm.trim().toLowerCase() !== store.slug} onClick={() => void run(() => api.del('/dealer', { body: { confirm } }), 'Loja excluída.')}>Excluir definitivamente</Button></>}>
          <div className="stack">
            <Alert tone="danger" icon="alert-triangle">Estoque, leads, propostas, avaliações e equipe são apagados e não voltam.</Alert>
            <Field label={`Digite ${store.slug} para confirmar`}><Input value={confirm} onChange={(e) => setConfirm(e.target.value)} autoFocus /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

const TABS = [
  { to: '/app/loja', label: 'Painel', end: true },
  { to: '/app/loja/estoque', label: 'Estoque' },
  { to: '/app/loja/leads', label: 'Leads' },
  { to: '/app/loja/propostas', label: 'Propostas' },
  { to: '/app/loja/equipe', label: 'Equipe' },
  { to: '/app/loja/campanhas', label: 'Campanhas' }
];

export function StoreShell() {
  usePageTitle('Minha loja');
  const me = useAsync(() => api.get<MeStore>('/dealer/me'), []);
  if (me.loading && !me.data) return <PageLoading />;
  if (me.error != null) return <ErrorState error={me.error} onRetry={me.reload} />;
  const d = me.data!;
  if (!d.store || !d.role) return <Activate onDone={me.reload} />;
  if (d.suspended) return <div className="stack"><h1>{d.store.name}</h1><Alert tone="warn" icon="alert-triangle" title="Loja suspensa">Fale com o suporte para reativar.</Alert></div>;
  if (d.archived) return <Archived store={d.store} owner={d.role === 'OWNER'} onDone={me.reload} />;
  const ctx: StoreCtx = { store: d.store, role: d.role, canManage: Boolean(d.canManage), canSeeCost: Boolean(d.canSeeCost), reload: me.reload };
  return (
    <Ctx.Provider value={ctx}>
      <div className="stack-lg">
        <div className="page-head">
          <div><h1>{d.store.name}</h1><p>{[d.store.city, d.store.state].filter(Boolean).join(' - ') || ROLE_LABEL[d.role]}</p></div>
          <div className="row">
            {d.store.publicEnabled && <Link className="btn" to={`/loja/${d.store.slug}`} target="_blank"><Icon name="external-link" /> Ver vitrine</Link>}
          </div>
        </div>
        <nav className="tabs store-tabs" aria-label="Loja">
          {TABS.map((t) => <NavLink key={t.to} to={t.to} end={t.end} className="tab">{t.label}</NavLink>)}
        </nav>
        <Outlet />
      </div>
    </Ctx.Provider>
  );
}

// ---------------------------------------------------------------- painel

interface Summary {
  stock: { open: { count: number; priceCents: number; costCents: number | null }; sold: number; available: number; reserved: number };
  funnel: Record<string, number>;
  last30: { leads: number; won: number; lost: number; conversionPct: number | null; sold: number | null; revenueCents: number | null; profitCents: number | null; avgDaysToSell: number | null };
  sellers: Array<{ userId: string; name: string; won: number; valueCents: number; open: number }> | null;
}
interface AlertItem { kind: string; severity: 'high' | 'medium'; vehicleId?: string; leadId?: string; label: string; detail: string }
const STAGE_LABEL: Record<string, string> = { NEW: 'Novos', CONTACT: 'Contato', PROPOSAL: 'Proposta', VISIT: 'Visita', WON: 'Fechados', LOST: 'Perdidos' };

export function StoreHome() {
  const { canManage } = useStore();
  const sum = useAsync(() => api.get<Summary>('/dealer/summary'), []);
  const alerts = useAsync(() => api.get<{ total: number; items: AlertItem[] }>('/dealer/alerts'), []);
  if (sum.loading && !sum.data) return <PageLoading />;
  if (sum.error != null) return <ErrorState error={sum.error} onRetry={sum.reload} />;
  const s = sum.data!;
  return (
    <div className="stack-lg">
      <div className="stat-grid">
        <Stat label="Em estoque" value={s.stock.open.count} sub={money(s.stock.open.priceCents)} />
        <Stat label="Leads (30 dias)" value={s.last30.leads} sub={s.last30.conversionPct != null ? `${s.last30.conversionPct}% fechados` : undefined} />
        {s.last30.revenueCents != null && <Stat label="Vendas (30 dias)" value={money(s.last30.revenueCents)} sub={`${s.last30.sold ?? 0} veículo${s.last30.sold === 1 ? '' : 's'}`} highlight />}
        {s.last30.avgDaysToSell != null && <Stat label="Tempo para vender" value={`${s.last30.avgDaysToSell} dias`} />}
        {canManage && s.last30.profitCents != null && <Stat label="Lucro (30 dias)" value={money(s.last30.profitCents)} />}
      </div>
      <section className="card card-pad">
        <div className="card-head"><h2>Funil</h2><Link to="/app/loja/leads" className="muted">Abrir</Link></div>
        <div className="funnel">
          {Object.keys(STAGE_LABEL).map((k) => <div key={k} className={`funnel-step st-${k}`}><b>{s.funnel[k] ?? 0}</b><span>{STAGE_LABEL[k]}</span></div>)}
        </div>
      </section>
      <section className="card card-pad">
        <div className="card-head"><h2>Atenção</h2>{alerts.data && alerts.data.total > 0 && <Badge tone="warn">{alerts.data.total}</Badge>}</div>
        {alerts.error != null ? <p className="muted">Não foi possível carregar os alertas.</p> : !alerts.data?.items.length ? <p className="muted">Nada pendente.</p> : (
          <ul className="alert-list">
            {alerts.data.items.map((a, i) => (
              <li key={`${a.kind}${a.vehicleId ?? a.leadId}${i}`}>
                <Link to={a.leadId ? '/app/loja/leads' : '/app/loja/estoque'}>
                  <Badge tone={a.severity === 'high' ? 'danger' : 'warn'}>{a.detail}</Badge> <b>{a.label}</b>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {s.sellers && s.sellers.length > 0 && (
        <section className="card card-pad">
          <div className="card-head"><h2>Equipe (30 dias)</h2></div>
          <div className="table-wrap"><table className="table"><thead><tr><th>Pessoa</th><th className="r">Fechados</th><th className="r">Valor</th><th className="r">Em aberto</th></tr></thead>
            <tbody>{s.sellers.map((x) => <tr key={x.userId}><td>{x.name}</td><td className="r">{x.won}</td><td className="r">{money(x.valueCents)}</td><td className="r">{x.open}</td></tr>)}</tbody></table></div>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- equipe e configurações

interface Member { userId: string; name: string; email: string | null; role: Role; active: boolean; since: string }

function Settings() {
  const { store, role, reload } = useStore();
  const toast = useToast();
  const [f, setF] = useState({ name: store.name, whatsapp: store.whatsapp ?? '', email: store.email ?? '', city: store.city ?? '', state: store.state ?? '', about: store.about, slug: store.slug, logoUrl: store.logoUrl ?? '', coverUrl: store.coverUrl ?? '', accent: store.accentColor ?? '#1F5FE0', instagram: store.instagram ?? '', address: store.address ?? '', hours: store.hours ?? '', discount: String(store.tradeInDiscountBps / 100).replace('.', ','), stale: String(store.staleDays) });
  const [pub, setPub] = useState(store.publicEnabled);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const owner = role === 'OWNER';
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const bps = Math.round(Number(f.discount.replace(',', '.')) * 100);
      await api.patch('/dealer', {
        name: f.name, whatsapp: f.whatsapp || null, email: f.email || null, city: f.city || null, state: f.state || null, about: f.about, tradeInDiscountBps: bps, staleDays: Number(f.stale),
        logoUrl: f.logoUrl.trim() || null, coverUrl: f.coverUrl.trim() || null, accentColor: f.accent || null, instagram: f.instagram.trim() || null, address: f.address.trim() || null, hours: f.hours.trim() || null,
        ...(owner ? { slug: f.slug, publicEnabled: pub } : {})
      });
      toast.ok('Salvo.'); reload();
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <form className="card card-pad stack" onSubmit={(e) => void save(e)}>
      <div className="card-head"><h2>Dados da loja</h2></div>
      <Field label="Nome"><Input value={f.name} onChange={set('name')} maxLength={80} /></Field>
      <div className="grid-2">
        <Field label="WhatsApp"><Input inputMode="tel" value={f.whatsapp} onChange={set('whatsapp')} /></Field>
        <Field label="E-mail"><Input type="email" value={f.email} onChange={set('email')} /></Field>
        <Field label="Cidade"><Input value={f.city} onChange={set('city')} /></Field>
        <Field label="UF"><Input value={f.state} maxLength={2} onChange={(e) => setF((s) => ({ ...s, state: e.target.value.toUpperCase() }))} /></Field>
      </div>
      <Field label="Sobre a loja"><Textarea rows={3} value={f.about} onChange={set('about')} maxLength={1000} /></Field>
      <div className="card-head" style={{ marginTop: 8 }}><h2>Aparência da vitrine</h2></div>
      <div className="grid-2">
        <Field label="Logo" hint="Link https de uma imagem quadrada."><Input value={f.logoUrl} onChange={set('logoUrl')} placeholder="https://..." /></Field>
        <Field label="Capa" hint="Link https de uma imagem larga."><Input value={f.coverUrl} onChange={set('coverUrl')} placeholder="https://..." /></Field>
        <Field label="Cor de destaque"><div className="row" style={{ flexWrap: 'nowrap' }}><input type="color" aria-label="Cor de destaque" value={f.accent} onChange={set('accent')} style={{ width: 48, height: 40, padding: 2, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)' }} /><Input value={f.accent} onChange={set('accent')} maxLength={7} /></div></Field>
        <Field label="Instagram"><Input value={f.instagram} onChange={set('instagram')} placeholder="@sualoja" maxLength={31} /></Field>
        <Field label="Endereço"><Input value={f.address} onChange={set('address')} maxLength={160} /></Field>
        <Field label="Horário"><Input value={f.hours} onChange={set('hours')} placeholder="Seg a sáb, 9h às 18h" maxLength={120} /></Field>
      </div>
      <div className="card-head" style={{ marginTop: 8 }}><h2>Regras</h2></div>
      <div className="grid-2">
        <Field label="Margem na troca (%)" hint="Descontada da FIPE na avaliação"><Input inputMode="decimal" value={f.discount} onChange={set('discount')} /></Field>
        <Field label="Veículo parado após (dias)"><Input inputMode="numeric" value={f.stale} onChange={(e) => setF((s) => ({ ...s, stale: e.target.value.replace(/\D/g, '') }))} /></Field>
      </div>
      {owner && (
        <>
          <Field label="Endereço da vitrine" hint={`${window.location.origin}/loja/${f.slug}`}><Input value={f.slug} onChange={(e) => setF((s) => ({ ...s, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))} maxLength={40} /></Field>
          <Switch label="Vitrine pública ligada" checked={pub} onChange={(e) => setPub(e.target.checked)} />
        </>
      )}
      {error && <Alert tone="warn" icon="alert-triangle">{error}</Alert>}
      <div><Button variant="primary" type="submit" loading={busy}>Salvar</Button></div>
    </form>
  );
}

function AddMember({ onClose, onDone, owner }: { onClose: () => void; onDone: () => void; owner: boolean }) {
  const toast = useToast();
  const [email, setEmail] = useState(''); const [role, setRole] = useState<'MANAGER' | 'SELLER'>('SELLER'); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(e?: FormEvent) {
    e?.preventDefault(); setBusy(true); setError('');
    try { await api.post('/dealer/members', { email, role }); toast.ok('Pessoa adicionada.'); onDone(); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  return (
    <Modal title="Adicionar pessoa" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} onClick={() => void submit()}>Adicionar</Button></>}>
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <Field label="E-mail da conta" hint="A pessoa precisa ter conta no Placa na Mão."><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field>
        <Field label="Papel"><Select value={role} onChange={(e) => setRole(e.target.value as 'MANAGER' | 'SELLER')}><option value="SELLER">Vendedor</option>{owner && <option value="MANAGER">Gerente</option>}</Select></Field>
        {error && <Alert tone="warn" icon="alert-triangle">{error}</Alert>}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function StoreTeam() {
  const { role, canManage, store, reload } = useStore();
  const toast = useToast();
  const list = useAsync(() => api.get<{ limit: number; members: Member[] }>('/dealer/members'), []);
  const [adding, setAdding] = useState(false); const [remove, setRemove] = useState<Member | null>(null); const [archive, setArchive] = useState(false);
  if (list.loading && !list.data) return <PageLoading />;
  if (list.error != null) return <ErrorState error={list.error} onRetry={list.reload} />;
  const { members, limit } = list.data!;
  const act = async (m: Member, body: { role?: string; active?: boolean }) => { try { await api.patch(`/dealer/members/${m.userId}`, body); list.reload(); } catch (e) { toast.error(errorMessage(e)); } };
  const active = members.filter((m) => m.active).length;
  const editable = (m: Member) => canManage && m.role !== 'OWNER' && (role === 'OWNER' || m.role === 'SELLER');
  return (
    <div className="stack-lg">
      <section className="card card-pad">
        <div className="card-head"><h2>Equipe <span className="muted" style={{ fontSize: 14 }}>{active}/{limit}</span></h2>{canManage && <Button variant="primary" icon="plus" disabled={active >= limit} onClick={() => setAdding(true)}>Adicionar</Button>}</div>
        <div className="table-wrap"><table className="table cards"><thead><tr><th>Pessoa</th><th>Papel</th><th /></tr></thead>
          <tbody>{members.map((m) => (
            <tr key={m.userId} style={m.active ? undefined : { opacity: 0.55 }}>
              <td><b>{m.name}</b>{m.email && <div className="muted" style={{ fontSize: 13 }}>{m.email}</div>}</td>
              <td><Badge tone={m.role === 'OWNER' ? 'violet' : m.role === 'MANAGER' ? 'info' : 'neutral'}>{ROLE_LABEL[m.role]}</Badge>{!m.active && <> <Badge>Inativo</Badge></>}</td>
              <td className="actions">{editable(m) && (m.active
                ? <>{role === 'OWNER' && <Button size="sm" variant="ghost" onClick={() => void act(m, { role: m.role === 'MANAGER' ? 'SELLER' : 'MANAGER' })}>{m.role === 'MANAGER' ? 'Tornar vendedor' : 'Tornar gerente'}</Button>}<Button size="sm" variant="ghost" onClick={() => setRemove(m)}>Remover</Button></>
                : <Button size="sm" onClick={() => void act(m, { active: true })}>Reativar</Button>)}</td>
            </tr>))}</tbody></table></div>
      </section>
      {canManage && <Settings key={store.id} />}
      {role === 'OWNER' && (
        <section className="card card-pad stack-sm">
          <div className="card-head"><h2>Encerrar loja</h2></div>
          <p className="muted" style={{ margin: 0 }}>Arquivar tira a vitrine do ar e trava a equipe. Você restaura quando quiser; depois de arquivada, pode excluir de vez.</p>
          <div><Button variant="ghost" onClick={() => setArchive(true)}>Arquivar loja</Button></div>
        </section>
      )}
      {archive && <ConfirmDialog title="Arquivar loja" message="A vitrine sai do ar e a equipe perde o acesso até você restaurar." confirmLabel="Arquivar" danger onConfirm={async () => { try { await api.post('/dealer/archive'); reload(); } catch (e) { toast.error(errorMessage(e)); } }} onClose={() => setArchive(false)} />}
      {adding && <AddMember owner={role === 'OWNER'} onClose={() => setAdding(false)} onDone={() => { setAdding(false); list.reload(); }} />}
      {remove && <ConfirmDialog title="Remover da equipe" message={<>{remove.name} perde o acesso à loja agora. Os leads dela ficam sem responsável.</>} confirmLabel="Remover" danger onConfirm={async () => { await act(remove, { active: false }); setRemove(null); }} onClose={() => setRemove(null)} />}
    </div>
  );
}


// ---------------------------------------------------------------- campanhas

export function StoreCampaigns() {
  const { canManage } = useStore();
  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <section className="card card-pad stack">
        <h2>Campanhas e relacionamento</h2>
        <p className="muted">Envio de campanhas para sua base de clientes, lembretes de retorno e acompanhamento de cada cliente num só lugar. Estamos finalizando este módulo.</p>
        <ul className="stack" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Lista de clientes com histórico de contatos</li>
          <li>Mensagens por WhatsApp e e-mail para grupos de clientes</li>
          <li>Aviso de veículos parados e ofertas para quem pediu um modelo</li>
        </ul>
        {!canManage && <p className="muted">Disponível para dono e gerente.</p>}
        <div><Link className="btn" to="/app/loja/leads">Ver leads agora</Link></div>
      </section>
    </div>
  );
}

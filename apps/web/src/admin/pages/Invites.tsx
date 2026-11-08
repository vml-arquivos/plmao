import { Link } from 'react-router-dom';
import { api, ROLE_LABEL } from '../api';
import { Badge, EmptyState, ErrorState, PageLoading, useAsync, usePageTitle } from '../../shared/ui';
import { dateTime, money } from '../../shared/format';
import { VIA_LABEL } from '../../shared/InvitePanel';
import { Card, Kpi, PageHead } from '../parts';

interface Data {
  totals: { clicks: number; signups: number };
  people: Array<{ id: string; name: string; email: string; role: string; code: string | null; clicks: number; signups: number; withQuery: number; withPurchase: number }>;
  recent: Array<{ id: string; name: string; email: string; joinedAt: string | null; via: string; inviterId: string; inviterName: string; inviterRole: string; queries: number; spentCents: number }>;
}

/** Quem convidou quem e quando: cada usuário (cliente, operador, administrador) tem o próprio link e tudo fica registrado. */
export default function Invites({ embedded = false }: { embedded?: boolean } = {}) {
  usePageTitle(embedded ? 'Leads e CRM' : 'Convites');
  const res = useAsync(() => api.get<Data>('/admin/invites'), []);
  if (res.loading && !res.data) return <PageLoading />;
  if (res.error || !res.data) return <ErrorState error={res.error} onRetry={res.reload} />;
  const d = res.data;
  return (
    <>
      {!embedded && <PageHead title="Convites" sub="Cada pessoa tem o próprio link de convite. Aqui fica quem convidou quem, quando e por qual caminho. O seu link está em Minha conta." />}
      <div className="adm-grid-4">
        <Kpi label="Cadastros por convite" value={d.totals.signups} tone="ok" />
        <Kpi label="Links abertos" value={d.totals.clicks} />
        <Kpi label="Quem mais convidou" value={d.people[0] && d.people[0].signups > 0 ? d.people[0].name.split(' ')[0] : '—'} sub={d.people[0] && d.people[0].signups > 0 ? `${d.people[0].signups} cadastros` : undefined} />
      </div>
      <Card title="Quem convida" pad={false}>
        {d.people.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Pessoa</th><th>Perfil</th><th>Código</th><th className="r">Abriram</th><th className="r">Cadastros</th><th className="r">Consultaram</th><th className="r">Compraram</th></tr></thead>
          <tbody>{d.people.map((p) => <tr key={p.id}><td><Link to={`/clientes/${p.id}`}>{p.name}</Link><div className="muted" style={{ fontSize: 12.5 }}>{p.email}</div></td><td>{ROLE_LABEL[p.role] ?? p.role}</td><td className="mono">{p.code ?? '—'}</td><td className="r">{p.clicks}</td><td className="r">{p.signups}</td><td className="r">{p.withQuery}</td><td className="r">{p.withPurchase}</td></tr>)}</tbody></table></div>
          : <EmptyState icon="users" title="Ninguém usou um link de convite ainda" />}
      </Card>
      <Card title="Últimos cadastros por convite" pad={false}>
        {d.recent.length ? <div className="table-wrap"><table className="table"><thead><tr><th>Quando</th><th>Quem entrou</th><th>Convidado por</th><th>Caminho</th><th className="r">Consultas</th><th className="r">Já pagou</th></tr></thead>
          <tbody>{d.recent.map((r) => <tr key={r.id}><td>{r.joinedAt ? dateTime(r.joinedAt) : '—'}</td><td><Link to={`/clientes/${r.id}`}>{r.name}</Link><div className="muted" style={{ fontSize: 12.5 }}>{r.email}</div></td><td>{r.inviterName} <Badge tone="neutral">{ROLE_LABEL[r.inviterRole] ?? r.inviterRole}</Badge></td><td>{VIA_LABEL[r.via] ?? r.via}</td><td className="r">{r.queries}</td><td className="r">{r.spentCents ? money(r.spentCents) : '—'}</td></tr>)}</tbody></table></div>
          : <EmptyState icon="search" title="Nenhum cadastro por convite ainda" />}
      </Card>
    </>
  );
}

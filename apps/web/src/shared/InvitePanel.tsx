import type { ReactNode } from 'react';
import { Alert, Badge, CopyField, EmptyState, ErrorState, PageLoading, Stat, useAsync } from './ui';
import { dateTime } from './format';

export interface InviteData {
  code: string; url: string;
  invitedBy: { name: string; at: string | null; via: string } | null;
  totals: { clicks: number; signups: number; viaReport: number; withQuery: number; withPurchase: number };
  invited: Array<{ name: string; email: string; joinedAt: string | null; via: string; queries: number; purchased: boolean }>;
}
export const VIA_LABEL: Record<string, string> = { LINK: 'Convite pelo site', REPORT: 'Consulta enviada' };

/** Link próprio de convite + o acompanhamento de quem entrou por ele. Serve para cliente, lojista, operador e administrador. */
export default function InvitePanel({ load, note, queryHint = true }: { load: () => Promise<InviteData>; note?: ReactNode; queryHint?: boolean }) {
  const { data, error, loading, reload } = useAsync(load, []);
  if (loading) return <PageLoading />;
  if (error || !data) return <ErrorState error={error} onRetry={reload} />;
  const text = `Faça sua consulta veicular na Placa na Mão: ${data.url}`;
  const t = data.totals;
  return (
    <div className="stack">
      <section className="card card-pad stack-sm">
        <h2 style={{ fontSize: 18 }}>Seu link de convite</h2>
        <p className="muted" style={{ fontSize: 14 }}>Cada pessoa que se cadastrar por este link fica ligada a você, com a data do cadastro.{queryHint ? ' Para mandar uma consulta específica, abra a consulta e use “Enviar ao comprador”: o link dela já leva o seu convite.' : ''}</p>
        <CopyField value={data.url} label="Seu link de convite" />
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <a className="btn btn-sm" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer">Enviar pelo WhatsApp</a>
          <a className="btn btn-sm" href={`mailto:?subject=${encodeURIComponent('Convite Placa na Mão')}&body=${encodeURIComponent(text)}`}>Enviar por e-mail</a>
          <Badge tone="neutral">Código {data.code}</Badge>
        </div>
        {note}
        {data.invitedBy && <Alert tone="info">Você entrou por convite de {data.invitedBy.name}{data.invitedBy.at ? ` em ${dateTime(data.invitedBy.at)}` : ''}.</Alert>}
      </section>
      <div className="stat-grid">
        <Stat label="Abriram o link" value={t.clicks} />
        <Stat highlight label="Se cadastraram" value={t.signups} sub={t.viaReport ? `${t.viaReport} por consulta enviada` : undefined} />
        <Stat label="Já consultaram" value={t.withQuery} />
        <Stat label="Já compraram" value={t.withPurchase} />
      </div>
      <section className="stack-sm">
        <h2 style={{ fontSize: 18 }}>Quem entrou pelo seu link</h2>
        {data.invited.length ? (
          <div className="table-wrap"><table className="table"><thead><tr><th>Nome</th><th>E-mail</th><th>Cadastro</th><th>Como entrou</th><th className="r">Consultas</th><th>Compra</th></tr></thead>
            <tbody>{data.invited.map((i, n) => (
              <tr key={n}><td>{i.name}</td><td>{i.email}</td><td>{i.joinedAt ? dateTime(i.joinedAt) : '—'}</td><td>{VIA_LABEL[i.via] ?? i.via}</td><td className="r">{i.queries}</td><td>{i.purchased ? <Badge tone="ok">Comprou</Badge> : <span className="muted">—</span>}</td></tr>
            ))}</tbody></table></div>
        ) : <EmptyState icon="users" title="Ninguém entrou pelo seu link ainda">Copie o link acima e mande para quem precisa consultar um veículo.</EmptyState>}
      </section>
    </div>
  );
}

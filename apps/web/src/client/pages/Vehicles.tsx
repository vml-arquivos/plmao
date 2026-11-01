import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Badge, Button, EmptyState, ErrorState, Input, LinkButton, PageLoading, PlateBadge, Select, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateTime, money } from '../../shared/format';
import { toCsv, downloadText } from '../../shared/csv';
import { api } from '../api';
import { VERDICT_BADGE } from '../components/QueryRow';

interface Item {
  plate: string; queryId: string; productName: string; consultedAt: string; queries: number; watching: boolean;
  vehicle: string | null; year: string | null; color: string | null; state: string | null;
  verdict: { level: string; title: string } | null; alerts: number; attention: number; debtsCents: number | null; resale: 'LOW' | 'MODERATE' | 'HIGH' | null;
}
const RESALE = { LOW: 'Baixo', MODERATE: 'Moderado', HIGH: 'Alto' } as const;
const FILTERS: Array<[string, string]> = [['', 'Todos'], ['alert', 'Com alerta'], ['attention', 'Com atenção'], ['debt', 'Com débitos'], ['watching', 'Monitorados']];

/** Meus veículos: uma linha por placa já consultada, com a situação da consulta mais recente. Dá para exportar e gerar o dossiê. */
export default function Vehicles() {
  usePageTitle('Meus veículos');
  const toast = useToast();
  const data = useAsync(() => api.get<{ items: Item[]; truncated: boolean }>('/portfolio'), []);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState('');
  const rows = useMemo(() => (data.data?.items ?? []).filter((r) => {
    if (q && !`${r.plate} ${r.vehicle ?? ''} ${r.color ?? ''}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (filter === 'alert') return r.alerts > 0;
    if (filter === 'attention') return r.attention > 0 || r.alerts > 0;
    if (filter === 'debt') return (r.debtsCents ?? 0) > 0;
    if (filter === 'watching') return r.watching;
    return true;
  }), [data.data, q, filter]);

  async function dossier(plate: string) {
    setBusy(plate);
    try { await api.download(`/vehicles/${plate}/dossier.pdf`, `dossie-${plate}.pdf`); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(''); }
  }
  function exportCsv() {
    const header = ['Placa', 'Veículo', 'Ano', 'Cor', 'UF', 'Situação', 'Alertas', 'Atenções', 'Débitos (R$)', 'Risco de revenda', 'Consultas', 'Última consulta', 'Tipo da última', 'Monitorada'];
    const body = rows.map((r) => [r.plate, r.vehicle ?? '', r.year ?? '', r.color ?? '', r.state ?? '', r.verdict ? VERDICT_BADGE[r.verdict.level]?.label ?? r.verdict.level : '', r.alerts, r.attention,
      r.debtsCents == null ? '' : (r.debtsCents / 100).toFixed(2).replace('.', ','), r.resale ? RESALE[r.resale] : '', r.queries, dateTime(r.consultedAt), r.productName, r.watching ? 'Sim' : 'Não']);
    downloadText(`meus-veiculos-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(header, body));
  }

  if (data.loading && !data.data) return <PageLoading />;
  if (data.error || !data.data) return <ErrorState error={data.error} onRetry={data.reload} />;
  const all = data.data.items;
  return (
    <div className="stack-lg">
      <div className="page-head"><div><h1>Meus veículos</h1><p>Todas as placas que você já consultou, com a situação da consulta mais recente.</p></div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><Button icon="download" disabled={!rows.length} onClick={exportCsv}>Exportar planilha</Button><LinkButton to="/app/consultar" variant="primary" icon="search">Nova consulta</LinkButton></div></div>
      {all.length === 0 ? <EmptyState title="Você ainda não consultou nenhuma placa" action={<LinkButton to="/app/consultar" variant="primary">Fazer a primeira consulta</LinkButton>} /> : (
        <>
          <div className="toolbar">
            <div className="grow"><Input icon="search" placeholder="Buscar por placa, modelo ou cor" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" /></div>
            <Select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtro">{FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
          </div>
          {data.data.truncated && <Alert tone="info">Mostrando as 200 placas mais recentes.</Alert>}
          {!rows.length ? <EmptyState title="Nenhum veículo com esse filtro" /> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Placa</th><th>Veículo</th><th>Situação</th><th className="r">Débitos</th><th>Revenda</th><th>Última consulta</th><th /></tr></thead>
                <tbody>
                  {rows.map((r) => {
                    const v = r.verdict ? VERDICT_BADGE[r.verdict.level] : null;
                    return (
                      <tr key={r.plate}>
                        <td><PlateBadge plate={r.plate} size="sm" /></td>
                        <td><b>{r.vehicle ?? '—'}</b><div className="muted" style={{ fontSize: 12.5 }}>{[r.year, r.color, r.state].filter(Boolean).join(' · ')}</div></td>
                        <td>{v ? <Badge tone={v.tone} dot>{v.label}</Badge> : '—'}{(r.alerts > 0 || r.attention > 0) && <div className="muted" style={{ fontSize: 12.5 }}>{r.alerts > 0 ? `${r.alerts} alerta(s)` : ''}{r.alerts > 0 && r.attention > 0 ? ' · ' : ''}{r.attention > 0 ? `${r.attention} atenção` : ''}</div>}</td>
                        <td className="r num">{r.debtsCents == null ? '—' : money(r.debtsCents)}</td>
                        <td>{r.resale ? RESALE[r.resale] : '—'}</td>
                        <td>{dateTime(r.consultedAt)}<div className="muted" style={{ fontSize: 12.5 }}>{r.productName} · {r.queries} consulta(s){r.watching ? ' · monitorada' : ''}</div></td>
                        <td className="r"><div className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          <Link className="btn btn-ghost" to={`/app/consulta/${r.queryId}`}>Abrir</Link>
                          <Button variant="ghost" loading={busy === r.plate} onClick={() => void dossier(r.plate)}>Dossiê PDF</Button>
                          {!r.watching && <Link className="btn btn-ghost" to={`/app/monitoramento?placa=${r.plate}`}>Monitorar</Link>}
                        </div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted" style={{ fontSize: 13 }}>A situação é a da consulta mais recente de cada placa e pode ter mudado desde então. O dossiê reúne os relatórios que você já fez da placa, sem nova cobrança.</p>
        </>
      )}
    </div>
  );
}

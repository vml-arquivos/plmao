import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Badge, EmptyState, ErrorState, Field, LinkButton, PageLoading, Select, useAsync, usePageTitle } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateTime, money } from '../../shared/format';
import type { ReportEnvelope, ReportV2 } from '../../shared/reportTypes';
import { api } from '../api';
import { VERDICT_BADGE, type QuerySummary } from '../components/QueryRow';

const CHECK = { OK: 'Nada consta', ATTENTION: 'Atenção', ALERT: 'Alerta', NOT_CHECKED: 'Não consultado' } as const;
const RESALE = { LOW: 'Baixo', MODERATE: 'Moderado', HIGH: 'Alto' } as const;
const label = (q: QuerySummary) => `${q.plate} · ${q.productName} · ${dateTime(q.createdAt)}`;

interface Line { key: string; name: string; a: string; b: string }

function lines(a: ReportEnvelope, b: ReportEnvelope): Line[] {
  const ra = a.report; const rb = b.report;
  const out: Line[] = [];
  const add = (key: string, name: string, fa: (r: ReportV2) => string, fb: (r: ReportV2) => string = fa) => out.push({ key, name, a: fa(ra) || '—', b: fb(rb) || '—' });
  add('plate', 'Placa', (r) => r.plate);
  add('model', 'Veículo', (r) => [r.headline.brand, r.headline.model].filter(Boolean).join(' ') || r.headline.fullModel || '');
  add('year', 'Ano', (r) => [r.headline.manufactureYear, r.headline.modelYear].filter(Boolean).join('/'));
  add('color', 'Cor', (r) => r.headline.color ?? '');
  add('fuel', 'Combustível', (r) => r.headline.fuel ?? '');
  add('verdict', 'Veredito', (r) => VERDICT_BADGE[r.verdict.level]?.label ?? r.verdict.level);
  const fipe = (r: ReportV2) => { const i = r.sections.flatMap((s) => s.items).find((x) => x.key === 'VT_FIPE_PRECO' && x.state !== 'NOT_PROVIDED'); return i ? `R$ ${i.display ?? i.value}` : ''; };
  add('fipe', 'Valor FIPE', fipe);
  add('debts', 'Débitos', (r) => (r.debtsHidden ? '' : r.debts.hasDebt ? money(r.debts.totalCents) : 'Nada consta'));
  add('resale', 'Risco na revenda e no seguro', (r) => (r.advice?.resale ? RESALE[r.advice.resale.level] : ''));
  const keys = new Map<string, string>();
  for (const r of [ra, rb]) for (const c of r.advice?.checks ?? []) keys.set(c.key, c.label);
  for (const [k, name] of keys) add(`chk-${k}`, name, (r) => { const c = r.advice?.checks.find((x) => x.key === k); return c ? CHECK[c.status] : ''; });
  out.push({ key: 'date', name: 'Consulta feita em', a: dateTime(a.consultedAt), b: dateTime(b.consultedAt) });
  out.push({ key: 'product', name: 'Tipo de consulta', a: a.productName, b: b.productName });
  return out;
}

/** Comparar duas consultas já feitas, lado a lado. Não gera cobrança nem consulta nova. */
export default function CompareQueries() {
  usePageTitle('Comparar consultas');
  const [params, setParams] = useSearchParams();
  const [idA, setIdA] = useState(params.get('a') ?? '');
  const [idB, setIdB] = useState(params.get('b') ?? '');
  const list = useAsync(async () => (await api.get<QuerySummary[]>('/queries?status=SUCCESS&limit=100')).filter((q) => q.productId !== 'FIPE_FREE'), []);
  const [pair, setPair] = useState<{ a: ReportEnvelope; b: ReportEnvelope } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPair(null); setError('');
    if (!idA || !idB || idA === idB) return;
    let alive = true; setBusy(true);
    Promise.all([api.get<ReportEnvelope>(`/queries/${idA}/report`), api.get<ReportEnvelope>(`/queries/${idB}/report`)])
      .then(([a, b]) => { if (alive) setPair({ a, b }); }, (e) => { if (alive) setError(errorMessage(e)); })
      .finally(() => { if (alive) setBusy(false); });
    setParams({ a: idA, b: idB }, { replace: true });
    return () => { alive = false; };
  }, [idA, idB, setParams]);

  if (list.loading && !list.data) return <PageLoading />;
  if (list.error != null) return <ErrorState error={list.error} onRetry={list.reload} />;
  const queries = list.data ?? [];
  const rows = pair ? lines(pair.a, pair.b) : [];

  return (
    <div className="stack-lg">
      <div className="page-head"><div><h1>Comparar consultas</h1><p>Escolha duas consultas que você já fez e veja as diferenças lado a lado. Não gera cobrança.</p></div></div>
      {queries.length < 2 ? (
        <div className="card"><EmptyState icon="search" title="Você precisa de pelo menos duas consultas" action={<LinkButton to="/app/consultar" variant="primary">Nova consulta</LinkButton>}>Faça outra consulta para poder comparar.</EmptyState></div>
      ) : (
        <section className="card card-pad stack">
          <div className="grid-2">
            <Field label="Primeira consulta"><Select value={idA} onChange={(e) => setIdA(e.target.value)}><option value="">Escolha</option>{queries.map((q) => <option key={q.id} value={q.id}>{label(q)}</option>)}</Select></Field>
            <Field label="Segunda consulta"><Select value={idB} onChange={(e) => setIdB(e.target.value)}><option value="">Escolha</option>{queries.map((q) => <option key={q.id} value={q.id}>{label(q)}</option>)}</Select></Field>
          </div>
          {idA && idA === idB && <Alert tone="warn">Escolha duas consultas diferentes.</Alert>}
          {error && <Alert tone="warn">{error}</Alert>}
          {busy && <p className="muted">Carregando…</p>}
        </section>
      )}
      {pair && (
        <section className="card card-pad stack">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th></th><th>{pair.a.report.plate}</th><th>{pair.b.report.plate}</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} style={r.a !== r.b && r.key !== 'plate' && r.key !== 'date' && r.key !== 'product' ? { background: 'var(--surface-2)' } : undefined}>
                    <td className="muted">{r.name}</td><td><b>{r.a}</b></td><td><b>{r.b}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row">
            <LinkButton to={`/app/consulta/${idA}`} size="sm" variant="ghost">Abrir {pair.a.report.plate}</LinkButton>
            <LinkButton to={`/app/consulta/${idB}`} size="sm" variant="ghost">Abrir {pair.b.report.plate}</LinkButton>
            <Badge tone="neutral">As linhas em destaque são as que diferem</Badge>
          </div>
          <p className="muted">Compara só o que cada consulta trouxe. "Não consultado" quer dizer que aquele pacote não verificou esse ponto, não que está tudo certo.</p>
        </section>
      )}
    </div>
  );
}

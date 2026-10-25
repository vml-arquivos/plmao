import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyState, ErrorState, Button, Input, LinkButton, Select, Skeleton, Tabs, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { normalizePlate } from '../../shared/format';
import { api } from '../api';
import QueryRow, { type QuerySummary } from '../components/QueryRow';
import PeriodFilter, { NO_PERIOD, periodParams, qs, type Period } from '../components/Period';

const PAGE = 30;
type Status = '' | 'SUCCESS' | 'PROCESSING' | 'FAILED' | 'REFUNDED';

export default function History() {
  usePageTitle('Consultas');
  const toast = useToast();
  const [status, setStatus] = useState<Status>('');
  const [plate, setPlate] = useState('');
  const [product, setProduct] = useState('');
  const [period, setPeriod] = useState<Period>(NO_PERIOD);
  const [rows, setRows] = useState<QuerySummary[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [types, setTypes] = useState<Array<{ id: string; name: string }>>([]);
  const [csvBusy, setCsvBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => { api.get<Array<{ id: string; name: string }>>('/queries/types').then(setTypes, () => setTypes([])); }, []);

  const filters = useCallback(() => ({ status, plate: plate.length >= 2 ? plate : '', product, ...periodParams(period) }), [status, plate, product, period]);
  const load = useCallback(async (offset: number) => {
    const my = ++seq.current;
    setLoading(true); setError(null);
    try {
      const data = await api.get<QuerySummary[]>(`/queries${qs({ ...filters(), limit: PAGE, offset })}`);
      if (my !== seq.current) return;
      setRows((prev) => (offset ? [...prev, ...data] : data));
      setMore(data.length === PAGE);
    } catch (e) { if (my === seq.current) setError(e); } finally { if (my === seq.current) setLoading(false); }
  }, [filters]);
  useEffect(() => { const t = setTimeout(() => void load(0), plate ? 250 : 0); return () => clearTimeout(t); }, [load, plate]);

  async function csv() {
    setCsvBusy(true);
    try { await api.download(`/queries.csv${qs(filters())}`, 'consultas.csv'); } catch (e) { toast.error(errorMessage(e)); } finally { setCsvBusy(false); }
  }
  const filtered = Boolean(status || plate || product || period.days || period.from || period.to);

  return (
    <div className="stack-lg">
      <div className="page-head"><h1>Consultas</h1><div className="row"><Button icon="download" loading={csvBusy} onClick={csv} disabled={!rows.length}>Exportar CSV</Button><LinkButton to="/app/consultar" variant="primary" icon="search">Nova consulta</LinkButton></div></div>
      <Tabs label="Situação" value={status} onChange={setStatus} items={[{ id: '', label: 'Todas' }, { id: 'SUCCESS', label: 'Realizadas' }, { id: 'PROCESSING', label: 'Em processamento' }, { id: 'FAILED', label: 'Falha' }, { id: 'REFUNDED', label: 'Estornadas' }]} />
      <div className="filters">
        <Input icon="search" aria-label="Placa" value={plate} onChange={(e) => setPlate(normalizePlate(e.target.value))} placeholder="Placa" />
        <Select aria-label="Tipo de consulta" value={product} onChange={(e) => setProduct(e.target.value)}><option value="">Todos os tipos</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
        <PeriodFilter value={period} onChange={setPeriod} />
      </div>
      {loading && !rows.length && <div className="q-list"><Skeleton h={64} r={12} /><Skeleton h={64} r={12} /><Skeleton h={64} r={12} /></div>}
      {error != null && <ErrorState error={error} onRetry={() => void load(0)} />}
      {!loading && error == null && !rows.length && <div className="card"><EmptyState icon="clock" title={filtered ? 'Nada encontrado' : 'Nenhuma consulta'} action={!filtered ? <LinkButton to="/app/consultar" variant="primary" icon="search">Nova consulta</LinkButton> : undefined}>{filtered ? 'Mude os filtros.' : 'Suas consultas ficam aqui.'}</EmptyState></div>}
      {rows.length > 0 && <div className="q-list">{rows.map((q) => <QueryRow key={q.id} q={q} />)}</div>}
      {more && <div style={{ textAlign: 'center' }}><Button loading={loading} onClick={() => void load(rows.length)}>Ver mais</Button></div>}
    </div>
  );
}

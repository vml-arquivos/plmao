import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { EmptyState, ErrorState, Field, Input, LinkButton, Select, Skeleton, useAsync, usePageTitle } from '../../shared/ui';
import { normalizePlate } from '../../shared/format';
import { api } from '../api';
import QueryRow, { type QuerySummary } from '../components/QueryRow';

export default function History() {
  usePageTitle('Histórico');
  const { data, error, loading, reload } = useAsync(() => api.get<QuerySummary[]>('/queries'), []);
  const [plate, setPlate] = useState('');
  const [status, setStatus] = useState('');
  const rows = useMemo(() => (data ?? []).filter((q) => (!plate || q.plate.startsWith(plate)) && (!status || q.status === status)), [data, plate, status]);
  return (
    <div className="stack-lg">
      <div className="page-head"><div><h1>Histórico</h1><p>Todos os relatórios das suas consultas, sempre à mão.</p></div><LinkButton to="/app/consultar" variant="primary" icon="search">Nova consulta</LinkButton></div>
      <div className="row" style={{ alignItems: 'end' }}>
        <Field label="Buscar por placa" className="grow"><Input icon="search" value={plate} onChange={(e) => setPlate(normalizePlate(e.target.value))} placeholder="ABC1D23" /></Field>
        <Field label="Situação"><Select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todas</option><option value="SUCCESS">Concluídas</option><option value="PROCESSING">Processando</option><option value="FAILED">Falharam</option><option value="REFUNDED">Estornadas</option></Select></Field>
      </div>
      {loading && <div className="q-list"><Skeleton h={74} r={16} /><Skeleton h={74} r={16} /><Skeleton h={74} r={16} /></div>}
      {error != null && <ErrorState error={error} onRetry={reload} />}
      {data && !rows.length && <div className="card"><EmptyState icon="clock" title={data.length ? 'Nada encontrado' : 'Seu histórico está vazio'} action={!data.length ? <LinkButton to="/app/consultar" variant="primary" icon="search">Fazer uma consulta</LinkButton> : undefined}>{data.length ? 'Ajuste os filtros para ver outras consultas.' : 'As consultas que você fizer ficam salvas aqui.'}</EmptyState></div>}
      {rows.length > 0 && <div className="q-list">{rows.map((q) => <QueryRow key={q.id} q={q} />)}</div>}
      {data && data.length >= 100 && <p className="muted" style={{ fontSize: 13 }}>Mostrando as 100 consultas mais recentes. <Link to="/contato">Precisa de um relatório mais antigo?</Link></p>}
    </div>
  );
}

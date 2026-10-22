import { useNavigate } from 'react-router-dom';
import { useState, type FormEvent } from 'react';
import { Icon } from '../../shared/icons';
import { Button, EmptyState, ErrorState, LinkButton, Skeleton, Stat, useAsync, usePageTitle } from '../../shared/ui';
import { isValidPlate, money, normalizePlate } from '../../shared/format';
import { api } from '../api';
import { useSession } from '../session';
import QueryRow, { type QuerySummary } from '../components/QueryRow';
import PaidQueries from '../components/PaidQueries';

export default function Dashboard() {
  usePageTitle('Painel');
  const { me } = useSession();
  const nav = useNavigate();
  const [plate, setPlate] = useState('');
  const [err, setErr] = useState('');
  const { data, error, loading, reload } = useAsync(() => api.get<QuerySummary[]>('/queries'), []);
  const month = data?.filter((q) => q.status === 'SUCCESS' && new Date(q.createdAt).getMonth() === new Date().getMonth()) ?? [];
  const spent = month.reduce((a, q) => a + (q.priceCents || 0), 0);
  function go(e: FormEvent) {
    e.preventDefault();
    const p = normalizePlate(plate);
    if (!isValidPlate(p)) return setErr('Informe uma placa válida.');
    nav(`/app/consultar?placa=${p}`);
  }
  return (
    <div className="stack-lg">
      <section className="hello">
        <div><h1>Olá, {me?.user.name.split(' ')[0]}!</h1><p>Digite uma placa e consulte em segundos.</p></div>
        <form onSubmit={go} className="grow" style={{ maxWidth: 460, flexBasis: 360 }}>
          <div className="quick-plate"><input value={plate} onChange={(e) => { setPlate(normalizePlate(e.target.value)); setErr(''); }} placeholder="Placa (ex: ABC1D23)" aria-label="Placa do veículo" maxLength={8} autoComplete="off" /><Button type="submit" variant="primary" icon="search">Consultar</Button></div>
          {err && <p role="alert" style={{ color: '#FCA5A5', marginTop: 8, fontSize: 14 }}>{err}</p>}
        </form>
      </section>
      <PaidQueries />
      <div className="stat-grid">
        <Stat highlight label="Saldo disponível" value={money(me?.balanceCents)} sub={<LinkButton to="/app/carteira" variant="ghost" size="sm" style={{ color: '#fff', padding: '0 4px', minHeight: 40 }}>Adicionar saldo →</LinkButton>} />
        <Stat label="Consultas no mês" value={month.length} sub="concluídas" />
        <Stat label="Investido no mês" value={money(spent)} sub="em consultas" />
      </div>
      <section>
        <div className="card-head"><h2 style={{ fontSize: 20 }}>Consultas recentes</h2><LinkButton to="/app/historico" variant="ghost" size="sm" iconRight="chevron-right">Ver tudo</LinkButton></div>
        {loading && <div className="q-list"><Skeleton h={74} r={16} /><Skeleton h={74} r={16} /><Skeleton h={74} r={16} /></div>}
        {error != null && <ErrorState error={error} onRetry={reload} />}
        {data && !data.length && <div className="card"><EmptyState icon="car" title="Nenhuma consulta ainda" action={<LinkButton to="/app/consultar" variant="primary" icon="search">Fazer minha primeira consulta</LinkButton>}>Informe uma placa para ver o relatório completo do veículo.</EmptyState></div>}
        {data && data.length > 0 && <div className="q-list">{data.slice(0, 5).map((q) => <QueryRow key={q.id} q={q} />)}</div>}
      </section>
      <section className="grid-2">
        <div className="card card-pad"><div className="row"><Icon name="users" size={22} /><h3>Indique e ganhe</h3></div><p className="muted" style={{ margin: '10px 0 14px' }}>Vire parceiro, compartilhe seu link e receba comissão sobre as consultas dos seus indicados.</p><LinkButton to="/app/parceiro">Conhecer o programa</LinkButton></div>
        <div className="card card-pad"><div className="row"><Icon name="file-text" size={22} /><h3>Guias do blog</h3></div><p className="muted" style={{ margin: '10px 0 14px' }}>Aprenda a ler débitos, gravame e restrições antes de fechar negócio.</p><LinkButton to="/blog">Ler artigos</LinkButton></div>
      </section>
    </div>
  );
}

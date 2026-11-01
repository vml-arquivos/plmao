import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, Badge, Button, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, PageLoading, PlateBadge, Select, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateTime, money, normalizePlate, isValidPlate } from '../../shared/format';
import { api } from '../api';

interface Change { key: string; label: string; from: string | null; to: string }
interface Watch {
  id: string; plate: string; productId: string; productName: string; priceCents: number; intervalDays: number; status: 'ACTIVE' | 'PAUSED'; pauseReason: string | null;
  runs: number; lastCheckedAt: string | null; nextCheckAt: string; running: boolean;
  lastEvent: { kind: string; at: string; queryId: string | null; changes: Change[] } | null;
}
interface WatchList { enabled: boolean; max: number; intervals: number[]; items: Watch[] }
interface QProduct { id: string; name: string; priceCents: number; isFree: boolean; commercialStatus: string }
interface EventRow { id: string; kind: string; queryId: string | null; at: string; changes: Change[]; code: string | null }

const WORD: Record<string, string> = { OK: 'sem ocorrência', ATTENTION: 'atenção', ALERT: 'alerta', NOT_CHECKED: 'não consultado' };
const PAUSE: Record<string, string> = { SALDO: 'Pausado por falta de saldo', FALHAS: 'Pausado após falhas seguidas', MANUAL: 'Pausado por você' };
const EVENT: Record<string, string> = { BASELINE: 'Primeira verificação', NO_CHANGE: 'Sem mudança', CHANGED: 'Algo piorou', FAILED: 'Não conseguiu verificar', PAUSED: 'Monitoramento pausado' };
const dayBr = (iso: string) => dateTime(iso).split(' ')[0] ?? dateTime(iso);

function Status({ w }: { w: Watch }) {
  if (w.status === 'PAUSED') return <Badge tone="warn" dot>{PAUSE[w.pauseReason ?? 'MANUAL'] ?? 'Pausado'}</Badge>;
  if (w.running) return <Badge tone="info" dot>Verificando</Badge>;
  if (w.lastEvent?.kind === 'CHANGED') return <Badge tone="danger" dot>Algo piorou</Badge>;
  return <Badge tone="ok" dot>Em dia</Badge>;
}

function AddWatch({ list, initialPlate, onClose, onDone }: { list: WatchList; initialPlate: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const products = useAsync(async () => (await api.get<QProduct[]>('/query-products')).filter((p) => !p.isFree && p.commercialStatus === 'ACTIVE'), []);
  const [plate, setPlate] = useState(initialPlate);
  const [productId, setProductId] = useState('');
  const [days, setDays] = useState(String(list.intervals[1] ?? list.intervals[0] ?? 15));
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const usable = products.data ?? [];
  const product = usable.find((p) => p.id === productId) ?? usable[0];
  async function save() {
    if (!product) return;
    setBusy(true);
    try { await api.post('/watches', { plate: normalizePlate(plate), productId: product.id, intervalDays: Number(days), acceptCharge: true }); toast.ok('Monitoramento criado.'); onDone(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title="Monitorar uma placa" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} disabled={!isValidPlate(plate) || !ok || !product} onClick={() => void save()}>Começar a monitorar</Button></>}>
      <div className="stack">
        <Field label="Placa"><Input value={plate} onChange={(e) => setPlate(normalizePlate(e.target.value))} placeholder="ABC1D23" autoComplete="off" /></Field>
        <Field label="Tipo de consulta">
          <Select value={product?.id ?? ''} onChange={(e) => setProductId(e.target.value)}>{usable.map((p) => <option key={p.id} value={p.id}>{p.name} · {money(p.priceCents)} por verificação</option>)}</Select>
        </Field>
        <Field label="Verificar a cada"><Select value={days} onChange={(e) => setDays(e.target.value)}>{list.intervals.map((n) => <option key={n} value={n}>{n} dias</option>)}</Select></Field>
        <p className="muted" style={{ fontSize: 14 }}>Em cada verificação o sistema faz uma consulta normal e compara com a anterior. Se algo piorar (gravame, restrição, leilão, débito…), você recebe um e-mail.</p>
        <label className="check-row" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
          <span>Entendo que cada verificação é cobrada do meu saldo{product ? ` (${money(product.priceCents)})` : ''} e que, sem saldo, o monitoramento pausa.</span>
        </label>
      </div>
    </Modal>
  );
}

function History({ w, onClose }: { w: Watch; onClose: () => void }) {
  const ev = useAsync(() => api.get<EventRow[]>(`/watches/${w.id}/events`), [w.id]);
  return (
    <Modal title={`Histórico · ${w.plate}`} onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Fechar</Button>}>
      {ev.loading && !ev.data ? <PageLoading /> : ev.error ? <ErrorState error={ev.error} onRetry={ev.reload} /> : !ev.data?.length ? <p className="muted">Ainda não houve nenhuma verificação.</p> : (
        <div className="stack-sm">
          {ev.data.map((e) => (
            <div key={e.id}>
              <b>{EVENT[e.kind] ?? e.kind}</b> <span className="muted">{dateTime(e.at)}</span>
              {e.changes.length > 0 && <ul style={{ margin: '4px 0 0 18px' }}>{e.changes.map((c) => <li key={c.key}>{c.label}: {c.from ? `${WORD[c.from] ?? c.from} → ` : ''}{WORD[c.to] ?? c.to}</li>)}</ul>}
              {e.queryId && <div><Link to={`/app/consulta/${e.queryId}`}>Abrir o relatório</Link></div>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

/** Monitoramento de placa: o sistema reconsulta de tempos em tempos (cobrando do saldo) e avisa por e-mail se algo piorar. */
export default function Watches() {
  usePageTitle('Monitoramento');
  const toast = useToast();
  const list = useAsync(() => api.get<WatchList>('/watches'), []);
  const [params] = useSearchParams();
  const presetPlate = normalizePlate(params.get('placa') ?? '');
  const [add, setAdd] = useState(Boolean(presetPlate));
  const [hist, setHist] = useState<Watch | null>(null);
  const [del, setDel] = useState<Watch | null>(null);
  async function patch(w: Watch, body: Record<string, unknown>, ok: string) {
    try { await api.patch(`/watches/${w.id}`, body); toast.ok(ok); list.reload(); } catch (e) { toast.error(errorMessage(e)); }
  }
  async function remove() {
    if (!del) return;
    try { await api.del(`/watches/${del.id}`); toast.ok('Monitoramento apagado.'); setDel(null); list.reload(); } catch (e) { toast.error(errorMessage(e)); }
  }
  if (list.loading && !list.data) return <PageLoading />;
  if (list.error || !list.data) return <ErrorState error={list.error} onRetry={list.reload} />;
  const d = list.data;
  return (
    <div className="stack-lg">
      <div className="page-head"><div><h1>Monitoramento</h1><p>Acompanhe uma placa sem lembrar de consultar. Você recebe um e-mail se algo piorar.</p></div>
        <Button variant="primary" icon="plus" disabled={!d.enabled || d.items.length >= d.max} onClick={() => setAdd(true)}>Monitorar placa</Button></div>
      {!d.enabled && <Alert tone="warn" title="Desligado no momento">O monitoramento está temporariamente desligado. Nenhuma verificação é feita nem cobrada.</Alert>}
      {d.items.length === 0 ? <EmptyState title="Nenhuma placa monitorada" action={d.enabled ? <Button variant="primary" onClick={() => setAdd(true)}>Monitorar uma placa</Button> : undefined}>Útil para um carro que você vai comprar, financiar ou revender: avisamos quando aparecer gravame, restrição, leilão ou débito novo.</EmptyState> : (
        <div className="stack">
          {d.items.map((w) => (
            <section key={w.id} className="card card-pad stack-sm">
              <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div className="row" style={{ gap: 10 }}><PlateBadge plate={w.plate} size="sm" /><div><b>{w.productName}</b><div className="muted" style={{ fontSize: 13 }}>A cada {w.intervalDays} dias · {money(w.priceCents)} por verificação</div></div></div>
                <Status w={w} />
              </div>
              <div className="muted" style={{ fontSize: 13 }}>
                {w.lastCheckedAt ? `Última verificação em ${dateTime(w.lastCheckedAt)}.` : 'Ainda sem verificação.'} {w.status === 'ACTIVE' ? `Próxima em ${dayBr(w.nextCheckAt)}.` : ''}
              </div>
              {w.lastEvent?.kind === 'CHANGED' && w.lastEvent.changes.length > 0 && (
                <Alert tone="warn" title="O que piorou na última verificação">{w.lastEvent.changes.map((c) => `${c.label}: ${WORD[c.to] ?? c.to}`).join(' · ')}{w.lastEvent.queryId && <> · <Link to={`/app/consulta/${w.lastEvent.queryId}`}>Abrir relatório</Link></>}</Alert>
              )}
              {w.status === 'PAUSED' && w.pauseReason === 'SALDO' && <Alert tone="info">Adicione saldo na <Link to="/app/carteira">carteira</Link> e retome.</Alert>}
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {w.status === 'ACTIVE' ? <Button onClick={() => void patch(w, { status: 'PAUSED' }, 'Monitoramento pausado.')}>Pausar</Button> : <Button variant="primary" onClick={() => void patch(w, { status: 'ACTIVE' }, 'Retomado. A próxima verificação acontece em instantes.')}>Retomar e verificar agora</Button>}
                <Select value={String(w.intervalDays)} onChange={(e) => void patch(w, { intervalDays: Number(e.target.value) }, 'Intervalo alterado.')} aria-label="Intervalo">{d.intervals.map((n) => <option key={n} value={n}>A cada {n} dias</option>)}</Select>
                <Button variant="ghost" onClick={() => setHist(w)}>Histórico</Button>
                <Button variant="ghost" onClick={() => setDel(w)}>Apagar</Button>
              </div>
            </section>
          ))}
        </div>
      )}
      <p className="muted" style={{ fontSize: 13 }}>Cada verificação é uma consulta normal, cobrada do seu saldo e guardada no seu histórico. Até {d.max} placas.</p>
      {add && <AddWatch list={d} initialPlate={presetPlate} onClose={() => setAdd(false)} onDone={() => { setAdd(false); list.reload(); }} />}
      {hist && <History w={hist} onClose={() => setHist(null)} />}
      {del && <ConfirmDialog title="Apagar monitoramento" message={`Parar de monitorar ${del.plate} e apagar o histórico? As consultas já feitas continuam no seu histórico.`} confirmLabel="Apagar" danger onConfirm={() => void remove()} onClose={() => setDel(null)} />}
    </div>
  );
}

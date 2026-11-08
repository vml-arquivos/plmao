import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Badge, Button, ErrorState, Field, LinkButton, PageLoading, Select, Textarea, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { ApiError, errorMessage } from '../../shared/api';
import { isValidSearch } from '../../shared/searchKey';
import { money } from '../../shared/format';
import { toCsv, downloadText } from '../../shared/csv';
import type { ReportEnvelope, ReportV2 } from '../../shared/reportTypes';
import { api } from '../api';
import { useSession } from '../session';
import PurchaseContract, { ACCEPT_MISSING, NO_ACCEPT, bothAccepted, type LegalAccept } from '../components/PurchaseContract';
import { VERDICT_BADGE } from '../components/QueryRow';

const MAX = 30;
const CONCURRENCY = 2;
interface QProduct { id: string; name: string; priceCents: number; isFree: boolean; commercialStatus: string }
type RowState = 'WAIT' | 'RUNNING' | 'DONE' | 'FAILED' | 'SKIPPED';
interface Row { plate: string; state: RowState; queryId?: string; report?: ReportV2; error?: string }

/** Lê placas coladas de qualquer jeito (linhas, vírgulas, espaços), tira repetidas e separa as inválidas. */
export function parsePlates(text: string): { valid: string[]; invalid: string[]; repeated: number } {
  const parts = text.toUpperCase().split(/[\s,;|]+/).map((p) => p.replace(/[^A-Z0-9]/g, '')).filter(Boolean);
  const seen = new Set<string>(); const valid: string[] = []; const invalid: string[] = []; let repeated = 0;
  for (const p of parts) {
    if (!isValidSearch('PLATE', p)) { invalid.push(p); continue; }
    if (seen.has(p)) { repeated += 1; continue; }
    seen.add(p); valid.push(p);
  }
  return { valid, invalid, repeated };
}

const title = (r?: ReportV2) => [r?.headline.brand, r?.headline.model].filter(Boolean).join(' ') || r?.headline.fullModel || '—';
const checkText = (r: ReportV2 | undefined, key: string) => {
  const c = r?.advice?.checks.find((x) => x.key === key);
  return c ? ({ OK: 'Nada consta', ATTENTION: 'Atenção', ALERT: 'Alerta', NOT_CHECKED: 'Não consultado' } as const)[c.status] : 'Não consultado';
};

/** Consulta em lote: cola até 30 placas, roda com o saldo da conta e entrega tabela e planilha. Cada consulta é uma consulta normal. */
export default function Batch() {
  usePageTitle('Consulta em lote');
  const toast = useToast();
  const { me, setBalance, refresh } = useSession();
  const [productId, setProductId] = useState('');
  const [text, setText] = useState('');
  const [accept, setAccept] = useState<LegalAccept>(NO_ACCEPT);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const stop = useRef(false);
  const legal = useAsync(async () => api.get<{ accepted: boolean }>('/legal/acceptance').catch(() => null), []);
  const products = useAsync(async () => (await api.get<QProduct[]>('/query-products')).filter((p) => !p.isFree && p.commercialStatus === 'ACTIVE'), []);

  const parsed = useMemo(() => parsePlates(text), [text]);
  if (products.loading && !products.data) return <PageLoading />;
  if (products.error != null) return <ErrorState error={products.error} onRetry={products.reload} />;
  const list = products.data ?? [];
  const product = list.find((p) => p.id === productId) ?? list[0];
  const count = Math.min(parsed.valid.length, MAX);
  const total = (product?.priceCents ?? 0) * count;
  const balance = me?.balanceCents ?? 0;
  const enough = balance >= total;
  const needAccept = !legal.loading && legal.data?.accepted !== true;
  const done = rows.filter((r) => r.state === 'DONE').length;
  const finished = rows.length > 0 && !running;

  const patch = (plate: string, p: Partial<Row>) => setRows((prev) => prev.map((r) => (r.plate === plate ? { ...r, ...p } : r)));

  /** Espera a consulta concluir (a fonte pode levar até um ou dois minutos) e devolve o relatório. */
  async function waitReport(id: string): Promise<ReportV2> {
    for (let i = 0; i < 60; i++) {
      try { return (await api.get<ReportEnvelope>(`/queries/${id}/report`)).report; }
      catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.status === 409)) {
          const s = await api.get<{ status: string; failureMessage?: string }>(`/queries/${id}`).catch(() => null);
          if (s && (s.status === 'FAILED' || s.status === 'REFUNDED')) throw new Error(s.failureMessage ?? 'A consulta não foi concluída e o valor foi estornado.');
        } else throw e;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error('A consulta ainda está em andamento. Veja o resultado em Consultas.');
  }

  async function start() {
    if (!product || !count) return;
    if (needAccept && !bothAccepted(accept)) { toast.error(ACCEPT_MISSING); return; }
    const plates = parsed.valid.slice(0, MAX);
    const run = crypto.randomUUID();
    stop.current = false; setRunning(true);
    setRows(plates.map((plate) => ({ plate, state: 'WAIT' })));
    let next = 0; let halted = '';
    const worker = async () => {
      while (!stop.current && !halted) {
        const plate = plates[next++];
        if (!plate) return;
        patch(plate, { state: 'RUNNING' });
        try {
          const r = await api.post<{ id: string; result?: { v2?: ReportV2 } }>('/queries', { searchType: 'PLATE', searchValue: plate, productId: product.id, ...(needAccept ? { acceptContract: true, acceptPrivacy: true } : {}) }, { headers: { 'Idempotency-Key': `batch-${run}-${plate}` } });
          const report = r.result?.v2 ?? await waitReport(r.id);
          patch(plate, { state: 'DONE', queryId: r.id, report });
        } catch (e) {
          const code = e instanceof ApiError ? e.code : '';
          if (code === 'INSUFFICIENT_BALANCE') { halted = 'Saldo insuficiente: as demais placas não foram consultadas.'; patch(plate, { state: 'SKIPPED', error: 'Saldo insuficiente.' }); }
          else if (code === 'PROFILE_INCOMPLETE') { halted = 'Complete seu cadastro em Minha conta para comprar consultas (só na primeira compra).'; patch(plate, { state: 'SKIPPED', error: 'Cadastro incompleto.' }); }
          else patch(plate, { state: 'FAILED', error: errorMessage(e) });
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    setRows((prev) => prev.map((r) => (r.state === 'WAIT' ? { ...r, state: 'SKIPPED', error: halted || 'Interrompida.' } : r)));
    setRunning(false);
    if (halted) toast.error(halted);
    void api.get<{ balanceCents: number }>('/me').then((m) => setBalance(m.balanceCents)).catch(() => refresh());
    void legal.reload();
  }

  function exportCsv() {
    const header = ['Placa', 'Situação', 'Veículo', 'Ano', 'Cor', 'Veredito', 'Débitos (R$)', 'Gravame', 'Restrição judicial', 'Leilão', 'Sinistro', 'Roubo/furto', 'Risco na revenda', 'Código do relatório', 'Observação'];
    const body = rows.map((r) => {
      const rep = r.report;
      const resale = rep?.advice?.resale?.level;
      return [r.plate, ({ DONE: 'Concluída', FAILED: 'Falhou', SKIPPED: 'Não consultada', WAIT: 'Aguardando', RUNNING: 'Em andamento' } as const)[r.state], title(rep), rep ? [rep.headline.manufactureYear, rep.headline.modelYear].filter(Boolean).join('/') : '', rep?.headline.color ?? '',
        rep ? VERDICT_BADGE[rep.verdict.level]?.label ?? rep.verdict.level : '', rep && !rep.debtsHidden ? (rep.debts.totalCents / 100).toFixed(2).replace('.', ',') : '',
        checkText(rep, 'lien'), checkText(rep, 'judicial'), checkText(rep, 'auction'), checkText(rep, 'claim'), checkText(rep, 'theft'),
        resale ? ({ LOW: 'Baixo', MODERATE: 'Moderado', HIGH: 'Alto' } as const)[resale] : '', r.queryId?.slice(0, 8).toUpperCase() ?? '', r.error ?? ''];
    });
    downloadText(`consulta-em-lote-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(header, body));
  }

  return (
    <div className="stack-lg">
      <div className="page-head"><div><h1>Consulta em lote</h1><p>Cole várias placas e consulte todas de uma vez. Cada uma gera um relatório normal, cobrado do seu saldo.</p></div></div>
      <section className="card card-pad stack">
        <Field label="Tipo de consulta">
          <Select value={product?.id ?? ''} onChange={(e) => setProductId(e.target.value)} disabled={running}>
            {list.map((p) => <option key={p.id} value={p.id}>{p.name} · {money(p.priceCents)} por placa</option>)}
          </Select>
        </Field>
        <Field label={`Placas (até ${MAX})`} hint="Uma por linha ou separadas por vírgula, espaço ou ponto e vírgula.">
          <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} disabled={running} placeholder={'ABC1D23\nDEF4G56\nHIJ7K89'} />
        </Field>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <Badge tone="info">{count} placa{count === 1 ? '' : 's'} para consultar</Badge>
          {parsed.repeated > 0 && <Badge tone="neutral">{parsed.repeated} repetida{parsed.repeated === 1 ? '' : 's'} ignorada{parsed.repeated === 1 ? '' : 's'}</Badge>}
          {parsed.invalid.length > 0 && <Badge tone="warn">{parsed.invalid.length} inválida{parsed.invalid.length === 1 ? '' : 's'}: {parsed.invalid.slice(0, 4).join(', ')}{parsed.invalid.length > 4 ? '…' : ''}</Badge>}
          {parsed.valid.length > MAX && <Badge tone="warn">Só as primeiras {MAX} serão consultadas</Badge>}
        </div>
        <div className="sum-line"><span className="muted">Total</span><b className="num">{money(total)}</b></div>
        <div className="sum-line"><span className="muted">Seu saldo</span><b className="num" style={{ color: enough ? 'var(--ok-ink)' : 'var(--warn-ink)' }}>{money(balance)}</b></div>
        {!enough && count > 0 && <Alert tone="warn">Saldo insuficiente para todas as placas. <Link to="/app/carteira">Adicionar saldo</Link>. Se preferir, o lote roda até o saldo acabar.</Alert>}
        {needAccept && <PurchaseContract body={{ searchType: 'PLATE', searchValue: parsed.valid[0] ?? '', productId: product?.id ?? '' }} value={accept} onChange={setAccept} disabled={running} />}
        <div className="row">
          <Button variant="primary" icon="search" loading={running} disabled={!count || !product || (needAccept && !bothAccepted(accept)) || balance < (product?.priceCents ?? 0)} onClick={() => void start()}>Consultar {count || ''} placa{count === 1 ? '' : 's'}</Button>
          {running && <Button variant="ghost" onClick={() => { stop.current = true; }}>Parar</Button>}
        </div>
      </section>

      {rows.length > 0 && (
        <section className="card card-pad stack">
          <div className="row-between">
            <b>{finished ? `Concluído: ${done} de ${rows.length}` : `Consultando… ${done} de ${rows.length}`}</b>
            <Button icon="download" onClick={exportCsv} disabled={!done}>Exportar planilha</Button>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Placa</th><th>Veículo</th><th>Veredito</th><th>Débitos</th><th>Gravame</th><th>Leilão</th><th></th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const rep = r.report; const v = rep ? VERDICT_BADGE[rep.verdict.level] : undefined;
                  return (
                    <tr key={r.plate}>
                      <td className="mono"><b>{r.plate}</b></td>
                      <td>{r.state === 'DONE' ? title(rep) : r.state === 'RUNNING' ? <span className="muted">Consultando…</span> : r.state === 'WAIT' ? <span className="muted">Aguardando</span> : <span className="muted">{r.error ?? 'Não consultada'}</span>}</td>
                      <td>{v ? <Badge tone={v.tone} dot>{v.label}</Badge> : '—'}</td>
                      <td className="num">{rep && !rep.debtsHidden ? money(rep.debts.totalCents) : '—'}</td>
                      <td>{rep ? checkText(rep, 'lien') : '—'}</td>
                      <td>{rep ? checkText(rep, 'auction') : '—'}</td>
                      <td>{r.queryId && <LinkButton to={`/app/consulta/${r.queryId}`} size="sm" variant="ghost">Abrir</LinkButton>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted">Consultas que falham são estornadas ao saldo automaticamente. Todas ficam também em Consultas.</p>
        </section>
      )}
    </div>
  );
}

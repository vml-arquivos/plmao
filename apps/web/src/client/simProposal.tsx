import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { Button, ConfirmDialog, EmptyState, IconButton, LinkButton, Logo, Modal, Skeleton, useToast } from '../shared/ui';
import { errorMessage } from '../shared/api';
import { api } from './api';
import { useSession } from './session';
import { Results } from './simResults';
import { brl, dateBr, kindByKey, pct, type BankOffer, type CalcResponse, type Kind } from './simulator';

const noop = () => undefined;
const when = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' });

/** A proposta na tela e no papel: cabeçalho, resultado completo, todas as parcelas e, se houver, a comparação com bancos. */
function Sheet({ data, label, code, notes, createdAt }: { data: CalcResponse; label: string; code: string | null; notes: string; createdAt: string }) {
  const banks: BankOffer[] = data.banks ?? [];
  return (
    <div className="sim-sheet">
      <header className="sim-sheet-head">
        <Logo height={30} />
        <div>
          <h2>Simulação de financiamento</h2>
          <p className="muted">{label ? `${label} · ` : ''}{when(createdAt)}{code ? ` · ${code}` : ''}</p>
        </div>
      </header>
      <Results data={data} loading={false} error={null} onAmortization={noop} onCopied={noop} expanded />
      {banks.length > 0 && (
        <section className="sim-sheet-banks">
          <h3>Comparação com taxas de bancos</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">Banco</th><th scope="col">Modalidade</th><th scope="col">Taxa a.m.</th><th scope="col">Parcela</th><th scope="col">Total pago</th><th scope="col">CET a.a.</th></tr></thead>
              <tbody>{banks.map((b) => <tr key={`${b.id}-${b.modality}`}><th scope="row">{b.name}</th><td>{b.modality === 'CDC' ? 'CDC' : 'Leasing'}</td><td>{pct(b.ratePct)}</td><td>{brl(b.installmentCents)}</td><td>{brl(b.totalPaidCents)}</td><td>{pct(b.cetAnnualPct)}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}
      {notes && <p className="sim-sheet-notes"><b>Observações:</b> {notes}</p>}
      <p className="muted sim-sheet-disc">Estimativa para comparar caminhos, não é proposta de crédito nem promessa de aprovação. As condições finais dependem da análise da instituição financeira. Gerado em {dateBr(createdAt.slice(0, 10))} no Placa na Mão.</p>
    </div>
  );
}

/**
 * Proposta completa na tela, com salvar no histórico, baixar PDF e imprimir.
 * Sem conta, dá para ver e imprimir; salvar e baixar pedem conta gratuita.
 */
export function SimProposalModal({ data, label, body, code: codeIn, createdAt, notes = '', onClose, onSaved }: {
  data: CalcResponse; label: string; body: Record<string, unknown> | null; code?: string | null; createdAt?: string; notes?: string; onClose: () => void; onSaved?: (code: string) => void;
}) {
  const { status } = useSession();
  const toast = useToast();
  const loc = useLocation();
  const [code, setCode] = useState<string | null>(codeIn ?? null);
  const [busy, setBusy] = useState<'' | 'save' | 'pdf'>('');
  const stamp = createdAt ?? data.generatedAt;
  useEffect(() => { document.body.classList.add('sim-printing'); return () => document.body.classList.remove('sim-printing'); }, []);

  const ensureSaved = useCallback(async (): Promise<string> => {
    if (code) return code;
    if (!body) throw new Error('Não foi possível salvar esta simulação.');
    const r = await api.post<{ code: string }>('/simulator/save', body);
    setCode(r.code); onSaved?.(r.code);
    return r.code;
  }, [code, body, onSaved]);

  const save = async () => {
    setBusy('save');
    try { await ensureSaved(); toast.ok('Simulação salva no seu histórico.'); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(''); }
  };
  const pdf = async () => {
    setBusy('pdf');
    try { const c = await ensureSaved(); await api.download(`/simulator/mine/${c}/pdf`, `simulacao-financiamento-${c}.pdf`); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(''); }
  };
  const next = encodeURIComponent(`${loc.pathname}${loc.search}`);

  return (
    <>
      <Modal wide title="Sua simulação" onClose={onClose} footer={(
        <div className="sim-proposal-actions">
          {status === 'authed' ? (
            <>
              <Button variant="primary" icon="save" loading={busy === 'save'} disabled={Boolean(code) || busy === 'pdf'} onClick={() => void save()}>{code ? 'Salva no histórico' : 'Salvar no histórico'}</Button>
              <Button icon="download" loading={busy === 'pdf'} onClick={() => void pdf()}>Baixar PDF</Button>
            </>
          ) : (
            <LinkButton to={`/criar-conta?next=${next}`} variant="primary" icon="save">Criar conta para salvar e baixar</LinkButton>
          )}
          <Button icon="printer" onClick={() => window.print()}>Imprimir</Button>
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
        </div>
      )}>
        <Sheet data={data} label={label} code={code} notes={notes} createdAt={stamp} />
      </Modal>
      {createPortal(<div className="sim-print-root" aria-hidden="true"><Sheet data={data} label={label} code={code} notes={notes} createdAt={stamp} /></div>, document.body)}
    </>
  );
}

interface Mine { code: string; modality: string; vehicleKind: Kind; label: string | null; vehicleValueCents: number; months: number; installmentCents: number; createdAt: string }
interface Detail extends CalcResponse { code: string; createdAt: string; input: Record<string, unknown> }

/** Simulações guardadas: ver na tela, baixar o PDF ou excluir. */
export function SimHistory({ reload = 0, limit, compact }: { reload?: number; limit?: number; compact?: boolean }) {
  const toast = useToast();
  const [items, setItems] = useState<Mine[] | null>(null);
  const [open, setOpen] = useState<Detail | null>(null);
  const [del, setDel] = useState<Mine | null>(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(() => { api.get<{ items: Mine[] }>('/simulator/mine').then((r) => setItems(r.items), () => setItems([])); }, []);
  useEffect(load, [load, reload]);

  const view = async (code: string) => {
    setBusy(code);
    try { setOpen(await api.get<Detail>(`/simulator/mine/${code}`)); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(''); }
  };
  if (items === null) return compact ? null : <div className="stack"><Skeleton h={64} r={14} /><Skeleton h={64} r={14} /></div>;
  if (!items.length) return compact ? null : <EmptyState icon="calculator" title="Nenhuma simulação salva" action={<LinkButton to="/simulador" variant="primary">Fazer uma simulação</LinkButton>}>As simulações que você salvar ou baixar em PDF ficam aqui.</EmptyState>;
  const shown = limit ? items.slice(0, limit) : items;
  const list = (
    <ul className="sim-mine">
      {shown.map((m) => (
        <li key={m.code}>
          <div>
            <b>{m.label || `${kindByKey(m.vehicleKind).label} · ${brl(m.vehicleValueCents)}`}</b>
            <small>{m.modality === 'BOTH' ? 'CDC e leasing' : m.modality === 'LEASING' ? 'Leasing' : 'CDC'} · {m.months}x de {brl(m.installmentCents)} · {new Date(m.createdAt).toLocaleDateString('pt-BR')}</small>
          </div>
          <div className="sim-mine-actions">
            <Button size="sm" icon="eye" loading={busy === m.code} onClick={() => void view(m.code)}>Ver</Button>
            <IconButton icon="download" label="Baixar PDF" onClick={() => { api.download(`/simulator/mine/${m.code}/pdf`, `simulacao-financiamento-${m.code}.pdf`).catch((e) => toast.error(errorMessage(e))); }} />
            <IconButton icon="trash" label="Excluir simulação" onClick={() => setDel(m)} />
          </div>
        </li>
      ))}
    </ul>
  );
  return (
    <>
      {compact ? (
        <section className="card card-pad stack" aria-labelledby="mine-h">
          <div className="between"><h3 id="mine-h">Suas simulações salvas</h3>{items.length > shown.length && <LinkButton to="/app/simulacoes" size="sm" iconRight="arrow-right">Ver todas</LinkButton>}</div>
          {list}
        </section>
      ) : <div className="card card-pad">{list}</div>}
      {open && <SimProposalModal data={open} label={String(open.input?.vehicleLabel ?? '')} notes={String(open.input?.notes ?? '')} body={null} code={open.code} createdAt={open.createdAt} onClose={() => setOpen(null)} />}
      {del && <ConfirmDialog danger title="Excluir esta simulação?" message="Ela sai do seu histórico e não dá para recuperar." confirmLabel="Excluir" onClose={() => setDel(null)}
        onConfirm={async () => { try { await api.del(`/simulator/mine/${del.code}`); setItems((x) => (x ?? []).filter((i) => i.code !== del.code)); toast.ok('Simulação excluída.'); } catch (e) { toast.error(errorMessage(e)); } }} />}
    </>
  );
}

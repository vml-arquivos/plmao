import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Field, Input, Modal } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateTime } from '../../shared/format';
import { Icon } from '../../shared/icons';
import { api } from '../api';

interface Draft { id: string; number: string; text: string; email: string; resendAfterSeconds: number }

/**
 * Contrato da compra: o servidor monta o texto com os dados do cliente, da empresa e do pedido,
 * envia um código ao e-mail do cliente, e o pagamento só abre depois que o código confere.
 * `signature` identifica item + valor: se mudar (cupom, produto), o aceite anterior deixa de valer.
 */
export default function PurchaseContract({ body, signature, contractId, onChange, disabled }: { body: Record<string, unknown>; signature: string; contractId: string; onChange: (id: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [code, setCode] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState<'' | 'draft' | 'confirm' | 'resend'>('');
  const [error, setError] = useState('');
  const [wait, setWait] = useState(0);
  const [number, setNumber] = useState('');

  useEffect(() => { setDraft(null); setCode(''); setAgree(false); setNumber(''); setError(''); onChange(''); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [signature]);
  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(t); }, [wait]);

  async function start() {
    setBusy('draft'); setError('');
    try { const d = await api.post<Draft>('/purchase-contracts/draft', body); setDraft(d); setWait(d.resendAfterSeconds); setCode(''); setAgree(false); setOpen(true); } catch (e) { setError(errorMessage(e)); } finally { setBusy(''); }
  }
  async function resend() {
    if (!draft) return;
    setBusy('resend'); setError('');
    try { const r = await api.post<{ resendAfterSeconds: number }>(`/purchase-contracts/${draft.id}/resend`, {}); setWait(r.resendAfterSeconds); } catch (e) { setError(errorMessage(e)); } finally { setBusy(''); }
  }
  async function confirm() {
    if (!draft) return;
    setBusy('confirm'); setError('');
    try {
      const r = await api.post<{ number: string }>(`/purchase-contracts/${draft.id}/confirm`, { code: code.trim(), accept: true });
      setNumber(r.number); onChange(draft.id); setOpen(false);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(''); }
  }

  if (contractId) return <Alert tone="ok" icon="check" title="Contrato aceito.">{number ? `Nº ${number}. ` : ''}Uma cópia fica em Carteira, Contratos.</Alert>;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <Button block icon="file-text" loading={busy === 'draft'} disabled={disabled} onClick={start}>Ler contrato e confirmar por e-mail</Button>
      {error && !open && <Alert tone="danger">{error}</Alert>}
      <p className="muted" style={{ fontSize: 13 }}>Antes de pagar, você lê o contrato e confirma com um código enviado ao seu e-mail.</p>
      {open && draft && (
        <Modal wide title={`Contrato ${draft.number}`} onClose={() => setOpen(false)} footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Fechar</Button><Button variant="primary" icon="check" loading={busy === 'confirm'} disabled={!agree || code.trim().length !== 6} onClick={confirm}>Aceitar contrato</Button></>}>
          <div className="stack">
            <pre className="card card-pad" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.55, maxHeight: '38vh', overflow: 'auto', margin: 0 }} tabIndex={0} aria-label="Texto do contrato">{draft.text}</pre>
            <Alert tone="info" title={`Enviamos um código de 6 dígitos para ${draft.email}.`}>Ele vale por 10 minutos. Digite abaixo para aceitar.</Alert>
            <div className="row" style={{ alignItems: 'end', flexWrap: 'nowrap' }}>
              <Field label="Código do e-mail" className="grow"><Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="000000" /></Field>
              <Button loading={busy === 'resend'} disabled={wait > 0} onClick={resend}>{wait > 0 ? `Reenviar em ${wait}s` : 'Reenviar código'}</Button>
            </div>
            <label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> Li o contrato e concordo com os termos.</label>
            {error && <Alert tone="danger">{error}</Alert>}
          </div>
        </Modal>
      )}
    </div>
  );
}

interface Row { id: string; number: string; kind: 'PACKAGE' | 'QUERY'; status: string; amount_cents: number; accepted_at: string; order_status: string | null }
interface Full extends Row { body: string; body_hash: string }

/** Lista de contratos aceitos pelo cliente, com leitura e download do texto. */
export function MyContracts({ rows, loading }: { rows: Row[] | undefined; loading: boolean }) {
  const [view, setView] = useState<Full | null>(null);
  const [error, setError] = useState('');
  async function show(id: string) { setError(''); try { setView(await api.get<Full>(`/purchase-contracts/${id}`)); } catch (e) { setError(errorMessage(e)); } }
  function save(c: Full) {
    const blob = new Blob([`${c.body}\n\nImpressão digital do texto (SHA-256): ${c.body_hash}\nAceito em: ${dateTime(c.accepted_at)}\n`], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `contrato-${c.number}.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  return (
    <>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="table-wrap"><table className="table"><thead><tr><th>Contrato</th><th>Tipo</th><th>Aceito em</th><th>Pedido</th><th /></tr></thead><tbody>
        {rows?.map((c) => <tr key={c.id}><td className="mono">{c.number}</td><td>{c.kind === 'PACKAGE' ? 'Saldo' : 'Consulta'}</td><td>{dateTime(c.accepted_at)}</td><td>{c.order_status ? <Badge tone={c.order_status === 'PAID' ? 'ok' : 'neutral'}>{c.order_status === 'PAID' ? 'Pago' : 'Em aberto'}</Badge> : <span className="muted">—</span>}</td><td className="r"><Button size="sm" icon="file-text" onClick={() => show(c.id)}>Ler</Button></td></tr>)}
        {rows && !rows.length && <tr className="empty"><td colSpan={5}>Nenhum contrato ainda. Ele é criado em cada compra.</td></tr>}
        {loading && !rows && <tr className="empty"><td colSpan={5}>Carregando…</td></tr>}
      </tbody></table></div>
      {view && (
        <Modal wide title={`Contrato ${view.number}`} onClose={() => setView(null)} footer={<><Button variant="ghost" onClick={() => setView(null)}>Fechar</Button><Button icon="download" onClick={() => save(view)}>Baixar</Button></>}>
          <pre className="card card-pad" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.55, maxHeight: '55vh', overflow: 'auto', margin: 0 }}>{view.body}</pre>
          <p className="muted mono" style={{ fontSize: 12, wordBreak: 'break-all' }}><Icon name="lock" size={12} /> SHA-256: {view.body_hash}</p>
        </Modal>
      )}
    </>
  );
}

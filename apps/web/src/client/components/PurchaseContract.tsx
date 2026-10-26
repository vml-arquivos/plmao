import { useState } from 'react';
import { Alert, Badge, Button, Modal } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateTime } from '../../shared/format';
import { Icon } from '../../shared/icons';
import { api } from '../api';

export interface LegalAccept { contract: boolean; privacy: boolean }
export const NO_ACCEPT: LegalAccept = { contract: false, privacy: false };
export const bothAccepted = (a: LegalAccept) => a.contract && a.privacy;
export const ACCEPT_MISSING = 'Marque as duas opções (Termos do Contrato de Uso e Política de Privacidade) para continuar.';

/**
 * Aceite na compra e na consulta: duas caixas obrigatórias, "Li e aceito os Termos do Contrato de Uso" e
 * "Estou ciente e concordo com a Política de Privacidade (LGPD)". O botão "Ler Contrato" abre o texto em uma janela,
 * sem sair da tela. O servidor confere as duas marcações e grava data, IP e versão no momento do pagamento ou da consulta.
 */
export default function PurchaseContract({ body, value, onChange, disabled }: { body: Record<string, unknown>; value: LegalAccept; onChange: (v: LegalAccept) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function read() {
    setBusy(true); setError('');
    try { const r = await api.post<{ text: string }>('/purchase-contracts/preview', body); setText(r.text); setOpen(true); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <label className="check" style={{ alignItems: 'flex-start' }}>
        <input type="checkbox" checked={value.contract} disabled={disabled} onChange={(e) => onChange({ ...value, contract: e.target.checked })} />
        <span>Li e aceito os Termos do Contrato de Uso. <button type="button" className="link-btn" onClick={read} disabled={disabled || busy} style={{ background: 'none', border: 0, padding: 0, color: 'var(--primary)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>{busy ? 'Abrindo…' : 'Ler Contrato'}</button></span>
      </label>
      <label className="check" style={{ alignItems: 'flex-start' }}>
        <input type="checkbox" checked={value.privacy} disabled={disabled} onChange={(e) => onChange({ ...value, privacy: e.target.checked })} />
        <span>Estou ciente e concordo com a <a href="/privacidade" target="_blank" rel="noopener noreferrer">Política de Privacidade (LGPD)</a>.</span>
      </label>
      {error && <Alert tone="danger">{error}</Alert>}
      {open && (
        <Modal wide title="Contrato de compra" onClose={() => setOpen(false)} footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Fechar</Button><Button variant="primary" icon="check" onClick={() => { onChange({ ...value, contract: true }); setOpen(false); }}>Li e aceito os Termos</Button></>}>
          <pre className="card card-pad" style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.55, maxHeight: '55vh', overflow: 'auto', margin: 0 }} tabIndex={0} aria-label="Texto do contrato">{text}</pre>
          <p className="muted" style={{ fontSize: 13 }}>O número do contrato sai quando você paga. A cópia fica em Carteira, Contratos e o comprovante vai para o seu e-mail.</p>
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

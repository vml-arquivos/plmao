import { useEffect, useState } from 'react';
import { Alert, Button, Field, Input, Modal, Select, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateTime } from '../../shared/format';
import { api } from '../api';

interface ShareLink { id: string; createdAt: string; expiresAt: string; views: number; maxViews: number }
interface CreatedLink { id: string; url: string; expiresAt: string }

/** Enviar ao comprador: link temporário com o relatório sem dados pessoais do proprietário. */
export function ShareModal({ queryId, plate, onClose }: { queryId: string; plate: string; onClose: () => void }) {
  const toast = useToast();
  const [days, setDays] = useState('7');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<CreatedLink | null>(null);
  const [links, setLinks] = useState<ShareLink[]>([]);
  const load = () => api.get<ShareLink[]>(`/queries/${queryId}/shares`).then(setLinks, () => undefined);
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [queryId]);

  async function create() {
    setBusy(true); setError('');
    try { setCreated(await api.post<CreatedLink>(`/queries/${queryId}/share`, { days: Number(days) })); void load(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function revoke(id: string) {
    try { await api.del(`/queries/${queryId}/shares/${id}`); toast.ok('Link cancelado.'); if (created?.id === id) setCreated(null); void load(); }
    catch (e) { toast.error(errorMessage(e)); }
  }
  async function copy(text: string) { try { await navigator.clipboard.writeText(text); toast.ok('Link copiado!'); } catch { toast.error('Não foi possível copiar.'); } }
  const wa = created ? `https://wa.me/?text=${encodeURIComponent(`Relatório do veículo ${plate} (válido até ${dateTime(created.expiresAt)}): ${created.url}`)}` : '';

  return (
    <Modal title="Enviar ao comprador" onClose={onClose} footer={<Button variant="ghost" onClick={onClose}>Fechar</Button>}>
      <div className="stack">
        <p className="muted">Gera um link temporário para quem você escolher ver o relatório e baixar o PDF. Quem recebe vê o mesmo relatório que você, e você pode cancelar o link quando quiser.</p>
        {!created && (
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <Field label="Validade do link"><Select value={days} onChange={(e) => setDays(e.target.value)}><option value="1">1 dia</option><option value="3">3 dias</option><option value="7">7 dias</option><option value="15">15 dias</option></Select></Field>
            <Button variant="primary" icon="link" loading={busy} onClick={() => void create()}>Criar link</Button>
          </div>
        )}
        {error && <Alert tone="warn">{error}</Alert>}
        {created && (
          <div className="stack-sm">
            <Alert tone="ok">Link criado. Vale até {dateTime(created.expiresAt)}. Guarde agora: por segurança ele não é mostrado de novo.</Alert>
            <Input readOnly value={created.url} onFocus={(e) => e.currentTarget.select()} aria-label="Link do relatório" />
            <div className="row">
              <Button variant="primary" icon="link" onClick={() => void copy(created.url)}>Copiar link</Button>
              <a className="btn" href={wa} target="_blank" rel="noopener noreferrer">Enviar pelo WhatsApp</a>
              <Button variant="ghost" onClick={() => setCreated(null)}>Criar outro</Button>
            </div>
          </div>
        )}
        {links.length > 0 && (
          <div className="stack-sm">
            <b>Links ativos</b>
            <ul className="stack-sm" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {links.map((l) => (
                <li key={l.id} className="row-between">
                  <span className="muted">Criado {dateTime(l.createdAt)} · vale até {dateTime(l.expiresAt)} · {l.views} {l.views === 1 ? 'acesso' : 'acessos'}</span>
                  <Button size="sm" variant="ghost" onClick={() => void revoke(l.id)}>Cancelar</Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

interface AdField { field: 'year' | 'color' | 'model'; status: 'OK' | 'ATTENTION' | 'MISMATCH'; registered: string; informed: string; message: string }
interface AdResult { price?: { level: 'ALERT' | 'ATTENTION' | 'OK' | 'ABOVE' | 'NO_REFERENCE'; message: string }; fields: AdField[]; summary: string; hasRisk: boolean }
const FIELD_LABEL: Record<AdField['field'], string> = { year: 'Ano', color: 'Cor', model: 'Modelo' };
const TONE = { OK: 'ok', ATTENTION: 'warn', MISMATCH: 'danger' } as const;
const PRICE_TONE = { ALERT: 'danger', ATTENTION: 'warn', OK: 'ok', ABOVE: 'info', NO_REFERENCE: 'info' } as const;

/** Conferir anúncio: compara preço, modelo, cor e ano do anúncio com o registro e a FIPE desta consulta. */
export function AdCheckModal({ queryId, onClose }: { queryId: string; onClose: () => void }) {
  const [price, setPrice] = useState(''); const [model, setModel] = useState(''); const [color, setColor] = useState(''); const [year, setYear] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [result, setResult] = useState<AdResult | null>(null);
  async function run() {
    setBusy(true); setError(''); setResult(null);
    const digits = price.replace(/[^\d,]/g, '').replace(/\./g, '');
    const cents = digits ? Math.round(Number(digits.replace(',', '.')) * 100) : undefined;
    const body: Record<string, unknown> = {};
    if (cents && Number.isFinite(cents)) body.priceCents = cents;
    if (model.trim()) body.model = model.trim();
    if (color.trim()) body.color = color.trim();
    if (year.trim()) body.year = Number(year);
    try { setResult(await api.post<AdResult>(`/queries/${queryId}/ad-check`, body)); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title="Conferir anúncio" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Fechar</Button><Button variant="primary" loading={busy} onClick={() => void run()}>Conferir</Button></>}>
      <div className="stack">
        <p className="muted">Preencha o que o anúncio informa. Comparamos com o registro do veículo e com a tabela FIPE desta consulta.</p>
        <Field label="Preço do anúncio (R$)"><Input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Ex.: 32.500" /></Field>
        <Field label="Modelo"><Input value={model} onChange={(e) => setModel(e.target.value)} maxLength={80} placeholder="Ex.: Uno Mille" /></Field>
        <div className="row">
          <Field label="Cor" className="grow"><Input value={color} onChange={(e) => setColor(e.target.value)} maxLength={30} placeholder="Ex.: Branca" /></Field>
          <Field label="Ano" className="grow"><Input inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="Ex.: 2013" /></Field>
        </div>
        {error && <Alert tone="warn">{error}</Alert>}
        {result && (
          <div className="stack-sm">
            <Alert tone={result.hasRisk ? 'danger' : 'info'} title={result.hasRisk ? 'Atenção.' : 'Resultado.'}>{result.summary}</Alert>
            {result.price && <Alert tone={PRICE_TONE[result.price.level]} title="Preço.">{result.price.message}</Alert>}
            {result.fields.map((f) => <Alert key={f.field} tone={TONE[f.status]} title={`${FIELD_LABEL[f.field]}.`}>{f.message} <span className="muted">(Registro: {f.registered} · Anúncio: {f.informed})</span></Alert>)}
            <p className="muted">É uma conferência de apoio. Não substitui a vistoria e a checagem do documento.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

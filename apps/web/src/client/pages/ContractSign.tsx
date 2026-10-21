import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Alert, Button, Check, Field, Input, PageLoading, usePageTitle } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateTime } from '../../shared/format';
import { api } from '../api';

const box = { whiteSpace: 'pre-wrap', fontFamily: 'inherit', lineHeight: 1.6, maxHeight: '55vh', overflow: 'auto', border: '1px solid #d7ddd9', borderRadius: 8, padding: 16, background: 'var(--surface, #fff)' } as const;
const shell = (children: React.ReactNode) => <main className="container" style={{ maxWidth: 820, padding: '32px 16px' }}>{children}</main>;

/** Página de assinatura por link seguro. Sem login: o link é a credencial e expira. */
export function ContractSign() {
  usePageTitle('Assinar contrato');
  const { token = '' } = useParams();
  const [data, setData] = useState<{ number: string; signerName: string; body: string; bodyHash: string; canSign: boolean; status: string; expiresAt: string | null } | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'invalid' | 'done'>('loading');
  const [name, setName] = useState('');
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get<NonNullable<typeof data>>(`/contracts/sign/${encodeURIComponent(token)}`).then((r) => { setData(r); setState('ready'); }).catch(() => setState('invalid'));
  }, [token]);
  if (state === 'loading') return <PageLoading />;
  if (state === 'invalid' || !data) return shell(<Alert tone="warn">Este link é inválido ou expirou. Peça um novo envio a quem lhe enviou o contrato.</Alert>);
  if (state === 'done') return shell(<Alert tone="ok">Contrato assinado. Você receberá uma cópia por e-mail.</Alert>);
  async function sign() {
    setBusy(true); setError('');
    try { await api.post(`/contracts/sign/${encodeURIComponent(token)}`, { name: name.trim(), accept, bodyHash: data!.bodyHash }); setState('done'); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  return shell(<>
    <h1 style={{ fontSize: 24 }}>Contrato {data.number}</h1>
    <p className="muted">Leia o contrato até o fim. Para assinar, digite seu nome como aparece abaixo e confirme o aceite. {data.expiresAt && <>Link válido até {dateTime(data.expiresAt)}.</>}</p>
    <pre style={box} tabIndex={0} aria-label="Texto do contrato">{data.body}</pre>
    {data.canSign ? (
      <div className="stack" style={{ marginTop: 16 }}>
        <Field label={`Digite seu nome completo: ${data.signerName}`}><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} /></Field>
        <Check checked={accept} onChange={(e) => setAccept(e.target.checked)}>Li o contrato e concordo com seus termos. Entendo que esta é uma assinatura eletrônica.</Check>
        {error && <Alert tone="danger">{error}</Alert>}
        <div><Button variant="primary" loading={busy} disabled={name.trim().length < 3 || !accept} onClick={() => void sign()}>Assinar contrato</Button></div>
      </div>
    ) : <Alert tone="warn" >Este contrato não está aberto para assinatura.</Alert>}
  </>);
}

/** Cópia do contrato assinado, por link seguro. */
export function ContractCopy() {
  usePageTitle('Contrato assinado');
  const { token = '' } = useParams();
  const [data, setData] = useState<{ number: string; body: string; bodyHash: string; signedAt: string; signers: Array<{ name: string; signed_at: string }> } | null>(null);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { api.get<NonNullable<typeof data>>(`/contracts/view/${encodeURIComponent(token)}`).then(setData).catch(() => setInvalid(true)); }, [token]);
  if (invalid) return shell(<Alert tone="warn">Este link é inválido ou expirou.</Alert>);
  if (!data) return <PageLoading />;
  return shell(<>
    <h1 style={{ fontSize: 24 }}>Contrato {data.number}</h1>
    <p className="muted">Assinado em {dateTime(data.signedAt)}. Código de integridade (SHA-256): <span className="mono" style={{ wordBreak: 'break-all' }}>{data.bodyHash}</span></p>
    <pre style={box} tabIndex={0}>{data.body}</pre>
    <p className="muted">{data.signers.map((s) => `${s.name} — assinou em ${dateTime(s.signed_at)}`).join(' · ')}</p>
    <div className="no-print"><Button variant="ghost" onClick={() => window.print()}>Imprimir ou salvar em PDF</Button></div>
  </>);
}

/** Documento fiscal por link seguro (sem dados pessoais do cliente). */
export function FiscalDocumentPage() {
  usePageTitle('Documento fiscal');
  const { token = '' } = useParams();
  const [d, setD] = useState<{ kind: string; number: string; series: string | null; issuedAt: string; amountCents: number; description: string; verificationCode: string | null; pdfUrl: string | null; xmlUrl: string | null } | null>(null);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { api.get<NonNullable<typeof d>>(`/fiscal/documents/${encodeURIComponent(token)}`).then(setD).catch(() => setInvalid(true)); }, [token]);
  if (invalid) return shell(<Alert tone="warn">Este link é inválido ou expirou. Peça um novo envio ao atendimento.</Alert>);
  if (!d) return <PageLoading />;
  return shell(<>
    <h1 style={{ fontSize: 24 }}>{d.kind === 'NFSE' ? 'Nota fiscal de serviço' : 'Nota fiscal'} nº {d.number}{d.series ? ` (série ${d.series})` : ''}</h1>
    <p>{d.description}</p>
    <p>Valor: <b>{(d.amountCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</b> · Emitida em {dateTime(d.issuedAt)}{d.verificationCode ? <> · Código de verificação: <span className="mono">{d.verificationCode}</span></> : null}</p>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {d.pdfUrl && <a className="btn btn-primary" href={d.pdfUrl} target="_blank" rel="noopener noreferrer">Abrir nota (PDF)</a>}
      {d.xmlUrl && <a className="btn btn-ghost" href={d.xmlUrl} target="_blank" rel="noopener noreferrer">Abrir XML</a>}
      {!d.pdfUrl && !d.xmlUrl && <Alert tone="info">O arquivo da nota será enviado separadamente pelo atendimento.</Alert>}
    </div>
  </>);
}

import { useState } from 'react';
import { api } from '../api';
import { Alert, Badge, Button, CopyField, EmptyState, ErrorState, PageLoading, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { Card, PageHead } from '../parts';

interface Var { name: string; set: boolean; required: boolean; hint?: string }
interface Item { key: string; name: string; state: 'OFF' | 'PARTIAL' | 'READY'; vars: Var[]; webhookUrl?: string; webhookNote?: string; mode?: string | null; canTest?: boolean; workerOn?: boolean }
const STATE = { OFF: { l: 'Desligada', t: 'neutral' }, PARTIAL: { l: 'Faltam chaves', t: 'warn' }, READY: { l: 'Pronta', t: 'ok' } } as const;

export default function Integrations() {
  usePageTitle('Integrações');
  const toast = useToast();
  const list = useAsync(() => api.get<{ items: Item[] }>('/admin/integrations'));
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState<Record<string, string>>({});
  async function test(key: string) {
    setBusy(key); setResult((r) => ({ ...r, [key]: '' }));
    try {
      const r = await api.post<Record<string, unknown>>(`/admin/integrations/${key}/test`);
      const msg = key === 'mercadopago'
        ? `Conexão ok. Credencial de ${String(r.mode)}${r.siteId ? ` (site ${String(r.siteId)})` : ''}. ${r.webhookSecretSet ? 'Segredo do webhook definido.' : 'Falta MP_WEBHOOK_SECRET.'} ${r.checkoutActive ? 'Checkout ativo.' : 'Checkout ainda não ativo: defina PAYMENT_PROVIDER=mercadopago.'}`
        : `Conexão SMTP ok. Enviamos um e-mail de teste para você${r.workerOn ? '' : ' (o envio automático está desligado: EMAIL_OUTBOX_WORKER=false)'}.`;
      setResult((x) => ({ ...x, [key]: msg })); toast.ok('Teste concluído.');
    } catch (e) { const m = errorMessage(e); setResult((x) => ({ ...x, [key]: `Falhou: ${m}` })); toast.error(m); } finally { setBusy(''); }
  }
  return (
    <>
      <PageHead title="Integrações" sub="Mostra se cada chave está preenchida (nunca o valor). As chaves ficam nas variáveis de ambiente do Coolify; depois de alterar, reinicie o aplicativo." />
      {list.loading && !list.data ? <PageLoading /> : list.error && !list.data ? <ErrorState error={list.error} onRetry={list.reload} /> : !(list.data?.items.length) ? <EmptyState icon="info" title="Nada para mostrar" /> : (
        <div className="stack">{list.data.items.map((i) => (
          <Card key={i.key} title={<span>{i.name}</span>} actions={<><Badge tone={STATE[i.state].t} dot>{STATE[i.state].l}</Badge>{i.mode && <Badge tone={i.mode === 'teste' ? 'info' : 'warn'}>{i.mode.startsWith('a confirmar') ? 'Credencial: testar para confirmar' : `Credencial de ${i.mode}`}</Badge>}</>}>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 4 }}>
              {i.vars.map((x) => <li key={x.name}><span aria-hidden="true">{x.set ? '✅' : '⬜'}</span> <code>{x.name}</code> <span className="muted" style={{ fontSize: 13 }}>{x.set ? 'preenchida' : 'vazia'}{x.hint ? ` · ${x.hint}` : ''}</span></li>)}
            </ul>
            {i.webhookUrl && <div style={{ marginTop: 10 }}><CopyField label="URL do webhook" value={i.webhookUrl} /></div>}
            {i.webhookNote && <p className="muted" style={{ fontSize: 13 }}>{i.webhookNote}</p>}
            {i.canTest && <div className="row" style={{ gap: 8, marginTop: 8 }}><Button size="sm" loading={busy === i.key} disabled={i.state === 'OFF' && i.key !== 'mercadopago' && i.key !== 'email'} onClick={() => void test(i.key)}>{i.key === 'email' ? 'Testar conexão e enviar e-mail de teste' : 'Testar conexão (sem cobrança)'}</Button></div>}
            {result[i.key] && <Alert tone={result[i.key]!.startsWith('Falhou') ? 'danger' : 'ok'}>{result[i.key]}</Alert>}
          </Card>
        ))}</div>
      )}
    </>
  );
}

import { useState } from 'react';
import { api } from '../api';
import { Alert, Badge, Button, CopyField, Input, EmptyState, ErrorState, PageLoading, useAsync, usePageTitle, useToast } from '../../shared/ui';
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
  const [plate, setPlate] = useState('');
  const [testProduct, setTestProduct] = useState('COMPLETE');
  async function test(key: string, withQuery = false) {
    if (withQuery && !window.confirm(`Isto faz uma consulta real na Credify e gasta 1 consulta do plano (placa ${plate}). Continuar?`)) return;
    setBusy(key); setResult((r) => ({ ...r, [key]: '' }));
    try {
      const r = await api.post<Record<string, unknown>>(`/admin/integrations/${key}/test`, withQuery ? { plate, productId: testProduct, confirmSpend: true } : undefined);
      if (key === 'vehicle') {
        const ip = r.serverIp ? ` IP de saída deste servidor: ${String(r.serverIp)} (cadastre em "IPs Autorizados" na Credify).` : '';
        if (r.ok === false) { const h = r.credentialHint as { clientId: string | null; secretLength: number; secretNumeric: boolean } | undefined; const hint = h ? ` Em uso no servidor: ClientID ${h.clientId ? `"${h.clientId}"` : 'VAZIO'}; ClientSecret com ${h.secretLength} caracteres${h.secretNumeric ? ' (só números)' : ''}.` : ''; const m = `Falhou: ${String(r.detail ?? r.code)} (${String(r.code)}).${hint}${ip}`; setResult((x) => ({ ...x, [key]: m })); toast.error(r.queryTested ? 'A consulta de teste falhou.' : 'Credify recusou o login.'); return; }
        if (r.queryOk) { const m = `Consulta real ok na placa ${String(r.plate)} (pacote ${String(r.productId ?? '-')}, consulta ${String(r.servicePath ?? '-')}${r.serviceCode ? ` código ${String(r.serviceCode)}` : ''}): a Credify respondeu${typeof r.queryMs === 'number' ? ` em ${Math.round(r.queryMs / 1000)} s` : ''}${r.providerQueryId ? ` (código ${String(r.providerQueryId)})` : ''}. Blocos recebidos: ${Array.isArray(r.blocks) ? (r.blocks as string[]).join(', ') : '-'}.${ip}`; setResult((x) => ({ ...x, [key]: m })); toast.ok('Consulta de teste concluída.'); return; }
        const m = `Login na Credify ok (token válido por cerca de ${String(r.expiresInMinutes)} min; cada consulta entra de novo se o token tiver mais de 3 min).${r.queryEnabled ? '' : ' Atenção: DATA_PROVIDER não está em real.'}${ip}`;
        setResult((x) => ({ ...x, [key]: m })); toast.ok('Teste concluído.'); return;
      }
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
            {i.canTest && <div className="row" style={{ gap: 8, marginTop: 8 }}><Button size="sm" loading={busy === i.key} disabled={i.state === 'OFF' && i.key !== 'mercadopago' && i.key !== 'email' && i.key !== 'vehicle'} onClick={() => void test(i.key)}>{i.key === 'email' ? 'Testar conexão e enviar e-mail de teste' : i.key === 'vehicle' ? 'Testar login na Credify (sem consulta)' : 'Testar conexão (sem cobrança)'}</Button>{i.key === 'vehicle' && <><Input style={{ maxWidth: 140 }} placeholder="Placa (ex: ABC1D23)" value={plate} maxLength={8} onChange={(e) => setPlate(e.target.value.toUpperCase())} aria-label="Placa para consulta de teste" /><select className="input" style={{ maxWidth: 190 }} value={testProduct} onChange={(e) => setTestProduct(e.target.value)} aria-label="Pacote a testar"><option value="COMPLETE">Pacote Completa (Veículo Total)</option><option value="BASIC">Pacote Básica/Gravame/Cadastral</option></select><Button size="sm" loading={busy === i.key} disabled={plate.replace(/[^A-Z0-9]/gi, '').length < 7} onClick={() => void test(i.key, true)}>Testar consulta real (gasta 1 consulta)</Button></>}</div>}
            {result[i.key] && <Alert tone={result[i.key]!.startsWith('Falhou') ? 'danger' : 'ok'}>{result[i.key]}</Alert>}
          </Card>
        ))}</div>
      )}
    </>
  );
}

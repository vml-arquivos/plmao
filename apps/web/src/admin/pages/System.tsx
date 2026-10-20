import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAdminSession } from '../session';
import { Alert, Badge, Button, ErrorState, Field, Input, PageLoading, Textarea, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { bpsToPercent, num, percentToBps } from '../../shared/format';
import { Card, PageHead } from '../parts';

interface Sys {
  environment: Record<string, string | number | boolean>; configured: { payment: boolean; vehicleProvider: boolean; email: boolean; fipe: boolean };
  safe: { siteTagline: string; supportEmail: string | null; maintenanceNotice: string | null; defaultAffiliateRateBps: number; fipeGuestDailyLimit: number };
}
const ENV_LABEL: Record<string, string> = { appName: 'Nome do app', appUrl: 'URL pública', webOrigin: 'Origem web', nodeEnv: 'Ambiente', paymentProvider: 'Provedor de pagamento', dataProvider: 'Provedor de dados', featureFreeFipe: 'FIPE grátis', featureReportPdf: 'PDF do relatório', queryCacheEnabled: 'Cache de consultas', queryCacheTtlSeconds: 'TTL do cache (s)', queryRequestTimeoutMs: 'Timeout do provedor (ms)', rateLimitEnabled: 'Rate limit', auditLogEnabled: 'Auditoria', logLevel: 'Nível de log' };

export default function System() {
  usePageTitle('Sistema');
  const { can } = useAdminSession();
  const toast = useToast();
  const res = useAsync(() => api.get<Sys>('/admin/settings'));
  const [tag, setTag] = useState(''); const [email, setEmail] = useState(''); const [notice, setNotice] = useState(''); const [rate, setRate] = useState(''); const [limit, setLimit] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { const s = res.data?.safe; if (!s) return; setTag(s.siteTagline); setEmail(s.supportEmail ?? ''); setNotice(s.maintenanceNotice ?? ''); setRate(String(s.defaultAffiliateRateBps / 100).replace('.', ',')); setLimit(String(s.fipeGuestDailyLimit)); }, [res.data]);
  if (res.loading && !res.data) return <PageLoading />;
  if (res.error || !res.data) return <ErrorState error={res.error} onRetry={res.reload} />;
  const { environment, configured } = res.data;
  const canEdit = can('MANAGE_PROVIDERS');
  async function save() {
    setBusy(true);
    try { await api.patch('/admin/settings', { siteTagline: tag.trim() || null, supportEmail: email.trim() || null, maintenanceNotice: notice.trim() || null, defaultAffiliateRateBps: percentToBps(rate), fipeGuestDailyLimit: Number(limit) }); toast.ok('Configurações salvas.'); res.reload(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  const prod = environment.nodeEnv === 'production';
  return (
    <>
      <PageHead title="Sistema" sub="Estado das integrações e configurações operacionais seguras. Segredos nunca aparecem aqui." />
      {prod && environment.dataProvider === 'mock' && <Alert tone="danger" title="Provedor de teste em produção">Os dados são fictícios. Configure o provedor contratado.</Alert>}
      <div className="adm-grid-2">
        <Card title="Integrações">
          <div className="stack-sm">
            {([['payment', 'Gateway de pagamento'], ['vehicleProvider', 'Provedor de consulta veicular'], ['email', 'E-mail transacional'], ['fipe', 'Fonte FIPE']] as const).map(([k, l]) => (
              <div key={k} className="row-between"><span>{l}</span><Badge tone={configured[k] ? 'ok' : 'warn'} dot>{configured[k] ? 'Configurado' : 'Não configurado'}</Badge></div>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 13 }}>Credenciais são definidas nas variáveis de ambiente do deploy. Um provedor real só fica ativo quando as credenciais existem.</p>
        </Card>
        <Card title="Ambiente"><dl className="kv">{Object.entries(environment).map(([k, v]) => <><dt key={`${k}-k`}>{ENV_LABEL[k] ?? k}</dt><dd key={`${k}-v`}>{typeof v === 'boolean' ? (v ? 'Ligado' : 'Desligado') : typeof v === 'number' ? num(v) : String(v)}</dd></>)}</dl></Card>
      </div>
      <Card title="Configurações operacionais">
        {!canEdit && <Alert tone="info">Somente leitura para o seu perfil.</Alert>}
        <div className="form-grid">
          <Field label="Chamada do site"><Input value={tag} onChange={(e) => setTag(e.target.value)} maxLength={180} disabled={!canEdit} /></Field>
          <Field label="E-mail de suporte"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={!canEdit} /></Field>
          <Field label="Comissão padrão de novos parceiros (%)" hint={`Atual: ${bpsToPercent(res.data.safe.defaultAffiliateRateBps)}`}><Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} disabled={!canEdit} /></Field>
          <Field label="Limite diário de FIPE grátis por visitante"><Input inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value.replace(/\D/g, ''))} disabled={!canEdit} /></Field>
        </div>
        <Field label="Aviso de manutenção" hint="Vazio = sem aviso."><Textarea rows={2} value={notice} onChange={(e) => setNotice(e.target.value)} maxLength={280} disabled={!canEdit} /></Field>
        {canEdit && <div><Button variant="primary" loading={busy} onClick={() => void save()}>Salvar</Button></div>}
      </Card>
    </>
  );
}

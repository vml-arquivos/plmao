import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Alert, Badge, Button, ErrorState, Field, Input, Modal, PageLoading, Switch, useAsync, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { num } from '../../shared/format';
import { Card } from '../parts';

export interface AccessState {
  customerId: string;
  features: Array<{ key: string; label: string; enabled: boolean }>;
  store: { id: string; name: string; slug: string; active: boolean; archived: boolean; publicEnabled: boolean; vehicleLimit: number; memberLimit: number; vehicles: number; role: string; city: string | null; state: string | null } | null;
  profiles: string[]; activeProfile: string; suggestedStoreName: string;
  fipeDailyLimit: number | null; fipeDefaultLimit: number; fipeUsedToday: number;
}

/** Endereço público da vitrine: o painel fica em admin.<domínio> e o site no domínio principal. */
export const storefrontUrl = (slug: string): string => `${window.location.protocol}//${window.location.host.replace(/^admin\./, '')}/loja/${slug}`;

/**
 * Pacote e acessos da conta, escolhidos pelo administrador: ativar a loja (área do lojista + vitrine pública) e ligar ou desligar recursos.
 * Cada mudança vale na hora; a pessoa vê o menu novo ao recarregar a página, sem precisar sair da conta.
 */
export function CustomerAccessCard({ customerId, customerName, canManage }: { customerId: string; customerName: string; canManage: boolean }) {
  const toast = useToast();
  const res = useAsync(() => api.get<AccessState>(`/admin/customers/${customerId}/access`), [customerId]);
  const [busy, setBusy] = useState(false);
  const [enable, setEnable] = useState(false);
  const [limits, setLimits] = useState<{ vehicleLimit: string; memberLimit: string } | null>(null);
  const [fipe, setFipe] = useState<string | null>(null);
  if (res.loading && !res.data) return <Card title="Pacote e acessos"><PageLoading /></Card>;
  if (res.error || !res.data) return <Card title="Pacote e acessos"><ErrorState error={res.error} onRetry={res.reload} /></Card>;
  const a = res.data; const s = a.store;
  const run = async (fn: () => Promise<unknown>, ok: string) => { setBusy(true); try { await fn(); toast.ok(ok); res.reload(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } };
  const storeOn = Boolean(s && s.active && !s.archived);
  return (
    <Card title="Pacote e acessos">
      <div className="stack">
        <div className="stack-sm">
          <span className="section-title">Loja (concessionária, agência, vendedor)</span>
          {!s && <p className="muted" style={{ margin: 0 }}>Esta conta não tem loja. Com a loja, {customerName.split(' ')[0]} ganha a área do lojista (estoque, leads, propostas, consulta em lote) e uma vitrine pública de veículos com página própria.</p>}
          {s && (
            <>
              <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                <b>{s.name}</b>
                <Badge tone={s.archived ? 'warn' : s.active ? 'ok' : 'danger'} dot>{s.archived ? 'Arquivada' : s.active ? 'Ativa' : 'Suspensa'}</Badge>
                {s.publicEnabled && <Badge>Vitrine ligada</Badge>}
                <span className="muted" style={{ fontSize: 13 }}>{num(s.vehicles)} de {num(s.vehicleLimit)} veículos · {s.role === 'OWNER' ? 'dono' : s.role === 'MANAGER' ? 'gerente' : 'vendedor'}</span>
              </div>
              {s.role === 'OWNER' && s.active && s.publicEnabled && <p style={{ margin: 0 }}>Vitrine: <a href={storefrontUrl(s.slug)} target="_blank" rel="noreferrer">{storefrontUrl(s.slug)}</a></p>}
              {s.role !== 'OWNER' && <Alert tone="info">Esta pessoa participa da loja de outra conta ({s.name}). Para mudar a loja, use a tela Lojas.</Alert>}
            </>
          )}
          {canManage && s?.role === 'OWNER' && (
            <div className="stack-sm">
              <Switch label="Loja ativa (menu do lojista e vitrine)" checked={storeOn} disabled={busy} onChange={(e) => void (e.target.checked
                ? run(() => api.post(`/admin/customers/${customerId}/store`, {}), 'Loja ativada. A pessoa vê o menu de lojista ao recarregar a página.')
                : run(() => api.post(`/admin/customers/${customerId}/store/disable`, {}), 'Loja suspensa.'))} />
              <Switch label="Vitrine pública ligada (página de veículos para o público)" checked={s.publicEnabled} disabled={busy || !storeOn} onChange={(e) => void run(() => api.patch(`/admin/dealerships/${s.id}`, { publicEnabled: e.target.checked }), e.target.checked ? 'Vitrine ligada.' : 'Vitrine desligada.')} />
              {limits ? (
                <div className="row" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
                  <Field label="Limite de veículos"><Input inputMode="numeric" value={limits.vehicleLimit} onChange={(e) => setLimits({ ...limits, vehicleLimit: e.target.value.replace(/\D/g, '') })} style={{ maxWidth: 140 }} /></Field>
                  <Field label="Limite de pessoas na equipe"><Input inputMode="numeric" value={limits.memberLimit} onChange={(e) => setLimits({ ...limits, memberLimit: e.target.value.replace(/\D/g, '') })} style={{ maxWidth: 140 }} /></Field>
                  <Button variant="primary" loading={busy} disabled={!Number(limits.vehicleLimit) || !Number(limits.memberLimit)} onClick={() => void run(async () => { await api.patch(`/admin/dealerships/${s.id}`, { vehicleLimit: Number(limits.vehicleLimit), memberLimit: Number(limits.memberLimit) }); setLimits(null); }, 'Limites salvos.')}>Salvar limites</Button>
                  <Button variant="ghost" onClick={() => setLimits(null)}>Cancelar</Button>
                </div>
              ) : <div className="row" style={{ flexWrap: 'wrap' }}><Button variant="ghost" size="sm" onClick={() => setLimits({ vehicleLimit: String(s.vehicleLimit), memberLimit: String(s.memberLimit) })}>Alterar limites</Button><Link className="btn btn-sm btn-ghost" to="/lojas">Editar loja completa</Link></div>}
            </div>
          )}
          {canManage && !s && <div><Button variant="primary" icon="building" onClick={() => setEnable(true)}>Ativar loja para este cliente</Button></div>}
        </div>
        <div className="stack-sm">
          <span className="section-title">FIPE grátis por dia</span>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>Hoje: {num(a.fipeUsedToday)} consulta(s) usada(s). {a.fipeDailyLimit === null ? `Esta conta usa o padrão do sistema (${num(a.fipeDefaultLimit)} por dia).` : `Limite próprio desta conta: ${num(a.fipeDailyLimit)} por dia.`}</p>
          {fipe === null ? (canManage && <div><Button variant="ghost" size="sm" onClick={() => setFipe(a.fipeDailyLimit === null ? '' : String(a.fipeDailyLimit))}>Alterar limite desta conta</Button></div>) : (
            <div className="row" style={{ flexWrap: 'wrap', alignItems: 'end' }}>
              <Field label="Consultas por dia" hint={`Vazio = padrão (${num(a.fipeDefaultLimit)})`}><Input inputMode="numeric" value={fipe} onChange={(e) => setFipe(e.target.value.replace(/\D/g, ''))} style={{ maxWidth: 140 }} /></Field>
              <Button variant="primary" loading={busy} disabled={fipe !== '' && (Number(fipe) < 1 || Number(fipe) > 100000)} onClick={() => void run(async () => { await api.put(`/admin/customers/${customerId}/fipe-limit`, { limit: fipe === '' ? null : Number(fipe) }); setFipe(null); }, 'Limite de FIPE salvo.')}>Salvar</Button>
              <Button variant="ghost" onClick={() => setFipe(null)}>Cancelar</Button>
            </div>
          )}
        </div>
        <div className="stack-sm">
          <span className="section-title">Recursos da conta</span>
          {a.features.map((f) => (
            <Switch key={f.key} label={f.label} checked={f.enabled} disabled={!canManage || busy} onChange={(e) => void run(() => api.put(`/admin/customers/${customerId}/access`, { features: { [f.key]: e.target.checked } }), e.target.checked ? `${f.label} liberado.` : `${f.label} desligado para esta conta.`)} />
          ))}
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>Desligar esconde o item do menu da pessoa e bloqueia o recurso. Ligar devolve o acesso. Vale na hora.</p>
        </div>
      </div>
      {enable && <EnableStore customerId={customerId} suggested={a.suggestedStoreName} onClose={(changed) => { setEnable(false); if (changed) res.reload(); }} />}
    </Card>
  );
}

function EnableStore({ customerId, suggested, onClose }: { customerId: string; suggested: string; onClose: (changed: boolean) => void }) {
  const toast = useToast();
  const [name, setName] = useState(suggested); const [slug, setSlug] = useState(''); const [pub, setPub] = useState(true); const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await api.post(`/admin/customers/${customerId}/store`, { name: name.trim(), slug: slug || undefined, publicEnabled: pub }); toast.ok('Loja ativada. A pessoa vê o menu de lojista ao recarregar a página.'); onClose(true); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title="Ativar loja" onClose={() => onClose(false)} footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancelar</Button><Button variant="primary" loading={busy} disabled={name.trim().length < 2} onClick={() => void save()}>Ativar loja</Button></>}>
      <div className="stack">
        <Field label="Nome da loja" hint="Já vem do cadastro (empresa ou nome). Pode trocar."><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus /></Field>
        <Field label="Endereço da vitrine" hint={`/loja/${slug || 'nome-da-loja'}. Em branco gera pelo nome.`}><Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} maxLength={40} /></Field>
        <Switch label="Vitrine pública ligada" checked={pub} onChange={(e) => setPub(e.target.checked)} />
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Cidade, UF e WhatsApp vêm do cadastro do cliente. Ele completa o resto em Minha loja (logo, capa, horários, veículos).</p>
      </div>
    </Modal>
  );
}

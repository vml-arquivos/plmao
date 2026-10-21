import { useMemo, useState } from 'react';
import { api } from '../api';
import { Alert, Badge, Button, Check, Field, Input, Modal, PageLoading, ErrorState, useAsync, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';

interface CatField { key: string; label: string; kind: string; tier: number; sensitivity: string }
interface CatSection { key: string; label: string; description: string; fields: CatField[] }
interface Cfg { model: 'CATALOG_V1'; sections: Array<{ key: string; label?: string; visible?: boolean; fields: Array<{ key: string; label?: string; visible?: boolean }> }> }
interface Version { id: string; version: number; name: string; status: string; config: Cfg; createdAt: string; lastPublishedAt: string | null }
interface ScopeRes { productName: string; currentVersion: number | null; suggested: Cfg; versions: Version[]; legacySections: string[] | null }
interface Preview { note: string; report: { sections: Array<{ key: string; label: string; items: Array<{ key: string; label: string; display?: string | null; value: string | null; state: string }> }>; scope?: { notIncluded: Array<{ key: string; label: string }> } } }

const toSet = (cfg: Cfg): Set<string> => new Set(cfg.sections.flatMap((s) => (s.visible === false ? [] : s.fields.filter((f) => f.visible !== false).map((f) => f.key))));

/** Campos do relatório por produto: marque o que o cliente recebe, veja a prévia e publique (com histórico e volta). */
export function ReportScopeEditor({ productId, onClose }: { productId: string; onClose: () => void }) {
  const toast = useToast();
  const scope = useAsync(() => api.get<ScopeRes>(`/admin/products/${productId}/report-scope`), [productId]);
  const catalog = useAsync(() => api.get<{ sections: CatSection[] }>('/admin/report-scope/catalog'), []);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const current = useMemo(() => scope.data?.versions.find((v) => v.version === scope.data?.currentVersion) ?? null, [scope.data]);
  const set = picked ?? (scope.data ? toSet(current?.config ?? scope.data.suggested) : new Set<string>());
  if ((scope.loading && !scope.data) || (catalog.loading && !catalog.data)) return <Modal title="Campos do relatório" onClose={onClose}><PageLoading /></Modal>;
  if (scope.error || !scope.data || catalog.error || !catalog.data) return <Modal title="Campos do relatório" onClose={onClose}><ErrorState error={scope.error ?? catalog.error} onRetry={() => { scope.reload(); catalog.reload(); }} /></Modal>;

  const toggle = (key: string, on: boolean) => { const next = new Set(set); if (on) next.add(key); else next.delete(key); setPicked(next); setPreview(null); };
  const toggleSection = (s: CatSection, on: boolean) => { const next = new Set(set); for (const f of s.fields) { if (on) next.add(f.key); else next.delete(f.key); } setPicked(next); setPreview(null); };
  const config = (): Cfg => ({ model: 'CATALOG_V1', sections: catalog.data!.sections.map((s) => ({ key: s.key, visible: true, fields: s.fields.filter((f) => set.has(f.key)).map((f) => ({ key: f.key, visible: true })) })).filter((s) => s.fields.length) });
  const selected = set.size;

  async function run(kind: 'preview' | 'draft' | 'publish') {
    setBusy(true);
    try {
      if (kind === 'preview') setPreview(await api.post<Preview>(`/admin/products/${productId}/report-scope/preview`, { config: config() }));
      else {
        await api.post(`/admin/products/${productId}/report-scope`, { name: name.trim() || `Versão ${scope.data!.versions.length + 1}`, config: config(), publish: kind === 'publish' });
        toast.ok(kind === 'publish' ? 'Publicado. Novas consultas já usam estes campos.' : 'Rascunho salvo.');
        setPicked(null); setName(''); scope.reload();
      }
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  async function publishOld(v: Version) {
    setBusy(true);
    try { await api.post(`/admin/report-scope/${v.id}/publish`, {}); toast.ok(`Versão ${v.version} publicada.`); setPicked(null); scope.reload(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title={`Campos do relatório: ${scope.data.productName}`} wide onClose={onClose} footer={<Button variant="ghost" onClick={onClose}>Fechar</Button>}>
      <div className="stack">
        <Alert tone="info">
          {scope.data.currentVersion ? <>Em uso: versão <b>{scope.data.currentVersion}</b>. </> : <>Nenhuma versão publicada: vale a regra padrão do produto. </>}
          O cliente só vê o que a fonte retornar. Consultas já feitas mantêm os campos da época. Dados de proprietário e controle interno nunca entram.
        </Alert>
        {catalog.data.sections.map((s) => {
          const all = s.fields.every((f) => set.has(f.key));
          const some = s.fields.some((f) => set.has(f.key));
          return (
            <fieldset key={s.key} style={{ border: '1px solid var(--line, #e5e7eb)', borderRadius: 8, padding: 12 }}>
              <legend style={{ padding: '0 6px' }}><Check checked={all} onChange={(e) => toggleSection(s, e.target.checked)}><b>{s.label}</b>{!all && some ? ' (parcial)' : ''}</Check></legend>
              <div className="form-grid cols-3">
                {s.fields.map((f) => <Check key={f.key} checked={set.has(f.key)} onChange={(e) => toggle(f.key, e.target.checked)}>{f.label}{f.sensitivity === 'PARTIAL' && <span className="muted" style={{ fontSize: 11.5 }}> (mascarado)</span>}</Check>)}
              </div>
            </fieldset>
          );
        })}
        <div className="form-grid cols-2">
          <Field label="Nome da versão" hint="Ex.: Inclui débitos estaduais."><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
          <div style={{ alignSelf: 'end', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button loading={busy} disabled={!selected} onClick={() => void run('preview')}>Prévia</Button>
            <Button loading={busy} disabled={!selected} onClick={() => void run('draft')}>Salvar rascunho</Button>
            <Button variant="primary" loading={busy} disabled={!selected} onClick={() => void run('publish')}>Publicar ({selected} campos)</Button>
          </div>
        </div>
        {preview && (
          <div>
            <Alert tone="info">{preview.note}</Alert>
            {preview.report.sections.map((s) => <p key={s.key} style={{ margin: '6px 0' }}><b>{s.label}:</b> {s.items.map((i) => i.label).join(', ')}</p>)}
            {!!preview.report.scope?.notIncluded.length && <p className="muted">Fora deste produto: {preview.report.scope.notIncluded.map((n) => n.label).join(', ')}.</p>}
          </div>
        )}
        <h4 style={{ margin: '8px 0 0' }}>Versões</h4>
        {!scope.data.versions.length && <p className="muted">Ainda não há versões.</p>}
        {scope.data.versions.map((v) => (
          <div key={v.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <b>v{v.version}</b> <span>{v.name}</span> <Badge tone={v.version === scope.data!.currentVersion ? 'ok' : 'neutral'}>{v.version === scope.data!.currentVersion ? 'Em uso' : v.status === 'DRAFT' ? 'Rascunho/anterior' : v.status}</Badge>
            <span className="muted" style={{ fontSize: 12 }}>{toSet(v.config).size} campos</span>
            <Button size="sm" variant="ghost" onClick={() => { setPicked(toSet(v.config)); setPreview(null); }}>Carregar</Button>
            {v.version !== scope.data!.currentVersion && <Button size="sm" loading={busy} onClick={() => void publishOld(v)}>Publicar esta versão</Button>}
          </div>
        ))}
      </div>
    </Modal>
  );
}

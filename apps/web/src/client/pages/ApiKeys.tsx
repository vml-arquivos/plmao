import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, ConfirmDialog, CopyField, EmptyState, ErrorState, Field, Input, Modal, PageLoading, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { ApiError, errorMessage } from '../../shared/api';
import { dateTime } from '../../shared/format';
import { api } from '../api';

interface Key { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null }

export default function ApiKeys() {
  usePageTitle('Chaves de API');
  const toast = useToast();
  const { data, error, loading, reload } = useAsync(() => api.get<Key[]>('/account/api-keys'), []);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<{ key: string; name: string } | null>(null);
  const [revoke, setRevoke] = useState<Key | null>(null);
  if (loading && !data) return <PageLoading />;
  if (error instanceof ApiError && error.status === 404) return <div className="card"><EmptyState icon="code" title="API ainda não habilitada">O acesso por API não está ativo neste ambiente. Fale com o suporte para solicitar.</EmptyState></div>;
  if (error != null) return <ErrorState error={error} onRetry={reload} />;
  async function create() {
    setBusy(true);
    try { const r = await api.post<{ key: string; name: string }>('/account/api-keys', { name: name.trim() }); setFresh(r); setCreating(false); setName(''); reload(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <div className="stack-lg">
      <div className="page-head"><div><h1>Chaves de API</h1><p>Use sua chave para consultar placas do seu sistema. A cobrança usa o saldo da sua carteira. <Link to="/desenvolvedores">Ver documentação</Link></p></div><Button variant="primary" icon="plus" onClick={() => setCreating(true)} disabled={(data?.length ?? 0) >= 5}>Nova chave</Button></div>
      <div className="table-wrap"><table className="table"><thead><tr><th>Nome</th><th>Chave</th><th>Criada em</th><th>Último uso</th><th /></tr></thead><tbody>
        {data?.map((k) => <tr key={k.id}><td><b>{k.name}</b></td><td className="mono">{k.prefix}…</td><td>{dateTime(k.createdAt)}</td><td>{k.lastUsedAt ? dateTime(k.lastUsedAt) : 'Nunca'}</td><td className="actions"><Button size="sm" variant="ghost" icon="trash" onClick={() => setRevoke(k)}>Revogar</Button></td></tr>)}
        {data && !data.length && <tr className="empty"><td colSpan={5}>Você ainda não criou nenhuma chave.</td></tr>}
      </tbody></table></div>
      <p className="muted" style={{ fontSize: 13 }}>Até 5 chaves ativas. Nunca compartilhe sua chave nem a publique em código aberto.</p>
      {creating && <Modal title="Nova chave de API" onClose={() => setCreating(false)} footer={<><Button variant="ghost" onClick={() => setCreating(false)}>Cancelar</Button><Button variant="primary" loading={busy} disabled={name.trim().length < 2} onClick={create}>Criar chave</Button></>}><Field label="Nome da chave" hint="Ex.: Sistema da loja, Integração ERP"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></Field></Modal>}
      {fresh && <Modal title="Guarde sua chave agora" onClose={() => setFresh(null)} footer={<Button variant="primary" onClick={() => setFresh(null)}>Já guardei</Button>}><div className="stack"><Alert tone="warn" title="Esta chave não será exibida novamente.">Copie e guarde em local seguro. Se perder, revogue e crie outra.</Alert><CopyField value={fresh.key} label={`Chave ${fresh.name}`} /></div></Modal>}
      {revoke && <ConfirmDialog danger title="Revogar chave?" confirmLabel="Revogar" message={`A chave “${revoke.name}” (${revoke.prefix}…) deixará de funcionar imediatamente.`} onClose={() => setRevoke(null)} onConfirm={async () => { try { await api.del(`/account/api-keys/${revoke.id}`); toast.ok('Chave revogada.'); reload(); } catch (e) { toast.error(errorMessage(e)); } }} />}
    </div>
  );
}

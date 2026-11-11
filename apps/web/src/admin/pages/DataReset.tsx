import { useState } from 'react';
import { api } from '../api';
import { useAdminSession } from '../session';
import { Alert, Badge, Button, ErrorState, Field, Input, PageLoading, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { money, num } from '../../shared/format';
import { Card, PageHead } from '../parts';

interface Counts { queries: number; orders: number; payments: number; refunds: number; clients: number; leads: number; conversations: number; simulations: number; emails: number; plateWatches: number; walletBalanceCents: number }
interface State { phrase: string; locked: boolean; counts: Counts }
type Scope = 'consultas' | 'pagamentos' | 'clientes' | 'atividade';

export default function DataReset() {
  usePageTitle('Limpar dados de teste');
  const { user } = useAdminSession();
  const toast = useToast();
  const res = useAsync(() => api.get<State>('/admin/data-reset'));
  const [scopes, setScopes] = useState<Record<Scope, boolean>>({ consultas: false, pagamentos: false, clientes: false, atividade: false });
  const [phrase, setPhrase] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  if (user?.role !== 'SUPER_ADMIN') return <Alert tone="warn" title="Acesso restrito">Esta tela é só do super admin.</Alert>;
  if (res.loading && !res.data) return <PageLoading />;
  if (res.error || !res.data) return <ErrorState error={res.error} onRetry={res.reload} />;
  const { counts, locked } = res.data;
  const chosen = (Object.keys(scopes) as Scope[]).filter((k) => scopes[k]);
  const clientsNeedsOthers = scopes.clientes && !(scopes.consultas && scopes.pagamentos);
  const ready = chosen.length > 0 && !clientsNeedsOthers && phrase.trim() === res.data.phrase && password.length > 0 && !locked;

  function toggle(k: Scope, on: boolean) { setScopes((s) => ({ ...s, [k]: on })); }
  function all(on: boolean) { setScopes({ consultas: on, pagamentos: on, clientes: on, atividade: on }); }

  async function run() {
    setBusy(true);
    try {
      await api.post('/admin/data-reset/run', { scopes: chosen, password, confirm: phrase.trim() });
      toast.ok('Pronto. Os dados escolhidos foram apagados.');
      setPhrase(''); setPassword(''); all(false); res.reload();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  async function setLock(next: boolean) {
    const pw = window.prompt(next ? 'Digite sua senha para TRAVAR a limpeza (use antes de abrir para clientes reais):' : 'Digite sua senha para liberar a limpeza:');
    if (!pw) return;
    try { await api.post('/admin/data-reset/lock', { locked: next, password: pw }); toast.ok(next ? 'Limpeza travada.' : 'Limpeza liberada.'); res.reload(); } catch (e) { toast.error(errorMessage(e)); }
  }

  const items: Array<{ k: Scope; title: string; text: string; count: string }> = [
    { k: 'consultas', title: 'Consultas', text: 'Todas as consultas (concluídas, estornadas, com falha), com resultado, PDF e links. O cache dos provedores fica (apagar faria o próximo teste pagar de novo).', count: `${num(counts.queries)} consultas` },
    { k: 'pagamentos', title: 'Pagamentos e carteira', text: 'Pedidos, recibos, estornos, eventos de webhook, comissões e repasses de parceiros, notas ainda não emitidas, movimentos da carteira (saldo vai a R$ 0,00) e uso de cupons (contador volta a zero).', count: `${num(counts.orders)} pedidos · ${num(counts.payments)} pagamentos · saldo em carteiras ${money(counts.walletBalanceCents)}` },
    { k: 'clientes', title: 'Contas de clientes', text: 'Todas as contas com perfil Cliente (e favoritos, garagem, sessões). Exige marcar Consultas e Pagamentos. Equipe e a sua conta nunca são apagadas.', count: `${num(counts.clients)} clientes` },
    { k: 'atividade', title: 'Leads, atendimento e e-mails', text: 'Leads do CRM, mensagens de contato, conversas de suporte, simulações de financiamento, alertas de placa, fila de e-mails e acessos a dados pessoais.', count: `${num(counts.leads)} leads · ${num(counts.conversations)} conversas · ${num(counts.simulations)} simulações · ${num(counts.emails)} e-mails` }
  ];

  return (
    <>
      <PageHead title="Limpar dados de teste" sub="Só o super admin vê esta tela. Deixa o sistema zerado para começar a testar em produção." />
      <Alert tone="danger" title="Não dá para desfazer">Faça um backup do banco antes (Coolify → banco → Backups). Isto só apaga registros do Placa na Mão: não devolve dinheiro, não mexe no Mercado Pago nem na Credify.</Alert>
      <Card title="O que apagar">
        <div className="stack-sm">
          {items.map((i) => (
            <label key={i.k} className="row" style={{ gap: 12, alignItems: 'flex-start', cursor: locked ? 'not-allowed' : 'pointer' }}>
              <input type="checkbox" disabled={locked} checked={scopes[i.k]} onChange={(e) => toggle(i.k, e.target.checked)} style={{ marginTop: 4 }} />
              <span><b>{i.title}</b> <Badge>{i.count}</Badge><div className="muted" style={{ fontSize: 13 }}>{i.text}</div></span>
            </label>
          ))}
          <div className="row" style={{ gap: 8 }}><Button variant="ghost" onClick={() => all(true)} disabled={locked}>Marcar tudo</Button><Button variant="ghost" onClick={() => all(false)}>Limpar seleção</Button></div>
          {clientsNeedsOthers && <Alert tone="warn">Para apagar clientes, marque também Consultas e Pagamentos.</Alert>}
        </div>
      </Card>
      <Card title="O que nunca é apagado">
        <p className="muted">Produtos, preços, pacotes, cupons (só o contador zera), textos, SEO, artigos, FAQ, guia de veículos, simulador e taxas, permissões, equipe, integrações, configurações e o histórico de auditoria.</p>
      </Card>
      <Card title="Confirmar">
        {locked
          ? <Alert tone="warn" title="Limpeza travada">Alguém travou esta função. Libere abaixo com a sua senha para continuar.</Alert>
          : (
            <div className="stack-sm">
              <Field label={`Digite exatamente: ${res.data.phrase}`}><Input value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" /></Field>
              <Field label="Sua senha de super admin"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
              <div><Button variant="danger" icon="trash" loading={busy} disabled={!ready} onClick={() => void run()}>Apagar o que marquei</Button></div>
            </div>
          )}
        <hr />
        <p className="muted" style={{ fontSize: 13 }}>Quando o site abrir para clientes de verdade, trave esta função: ela deixa de funcionar até você liberar com a senha.</p>
        <Button variant="ghost" onClick={() => void setLock(!locked)}>{locked ? 'Liberar limpeza' : 'Travar limpeza'}</Button>
      </Card>
    </>
  );
}

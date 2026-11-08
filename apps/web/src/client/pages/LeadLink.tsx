import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Alert, Button, LinkButton, PageLoading, usePageTitle } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { api } from '../api';
import { storeLeadLink } from '../funnel';
import { useSession } from '../session';

function noindex() {
  const meta = document.createElement('meta'); meta.name = 'robots'; meta.content = 'noindex, nofollow'; document.head.appendChild(meta);
  return () => { meta.remove(); };
}

interface LinkInfo { valid: boolean; expired?: boolean; kind?: 'CLIENTE' | 'LOJISTA'; firstName?: string | null; productId?: string | null; productName?: string | null; plate?: string | null }

/** Página aberta por quem recebe o link /c/CODIGO enviado pela equipe: guarda o link, cria o acesso e leva à consulta. */
export function LeadLinkLanding() {
  usePageTitle('Sua consulta');
  const { code = '' } = useParams();
  const { status } = useSession();
  const [info, setInfo] = useState<LinkInfo | null>(null);
  useEffect(noindex, []);
  useEffect(() => {
    let alive = true;
    api.get<LinkInfo>(`/lead-links/${encodeURIComponent(code)}`).then((r) => { if (!alive) return; setInfo(r); if (r.valid) storeLeadLink(code); }, () => { if (alive) setInfo({ valid: false }); });
    return () => { alive = false; };
  }, [code]);
  if (!info || status === 'loading') return <PageLoading />;
  const q = new URLSearchParams();
  if (info.plate) q.set('placa', info.plate);
  if (info.productId) q.set('produto', info.productId);
  const target = `/app/consultar${q.toString() ? `?${q}` : ''}`;
  const lojista = info.kind === 'LOJISTA';
  return (
    <main className="container" style={{ maxWidth: 640, padding: '40px 16px' }}>
      <section className="card card-pad stack">
        {info.valid ? (
          <>
            <h1 style={{ fontSize: 26 }}>{info.firstName ? `${info.firstName}, sua consulta está pronta` : 'Sua consulta está pronta'}</h1>
            <p className="muted">{lojista
              ? 'Crie o acesso da sua loja para consultar veículos pela placa: débitos, restrições, gravame, leilão e muito mais, com relatório em PDF.'
              : `Crie o seu acesso e faça a consulta${info.plate ? ` da placa ${info.plate}` : ''}${info.productName ? ` (${info.productName})` : ''}. Você recebe o relatório completo, com PDF para imprimir.`}</p>
            {status === 'authed'
              ? <div><LinkButton to={target} variant="primary" size="lg">Fazer a consulta</LinkButton></div>
              : <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}><LinkButton to={`/criar-conta?next=${encodeURIComponent(target)}`} variant="primary" size="lg">Criar meu acesso e consultar</LinkButton><LinkButton to={`/entrar?next=${encodeURIComponent(target)}`} size="lg">Já tenho conta</LinkButton></div>}
            <p className="muted" style={{ fontSize: 13 }}>Criar o acesso é grátis. Você só paga se decidir fazer uma consulta.</p>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 24 }}>{info.expired ? 'Este link venceu' : 'Link não encontrado'}</h1>
            <Alert tone="warn">{info.expired ? 'O prazo deste link acabou.' : 'Este link não existe mais.'} Você pode criar o seu acesso normalmente.</Alert>
            <div><LinkButton to="/criar-conta" variant="primary">Criar minha conta</LinkButton></div>
          </>
        )}
      </section>
    </main>
  );
}

/** Página do "Não quero mais receber": o clique do botão confirma (abrir o e-mail sozinho não descadastra ninguém). */
export function Unsubscribe() {
  usePageTitle('Cancelar mensagens');
  const [params] = useSearchParams();
  const token = params.get('t') ?? '';
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState('');
  useEffect(noindex, []);
  async function go() {
    setState('busy'); setError('');
    try { await api.post('/leads/unsubscribe', { token }); setState('done'); } catch (e) { setError(errorMessage(e)); setState('idle'); }
  }
  return (
    <main className="container" style={{ maxWidth: 560, padding: '40px 16px' }}>
      <section className="card card-pad stack">
        {state === 'done' ? (
          <><h1 style={{ fontSize: 24 }}>Pronto, você não vai mais receber</h1><p className="muted">Paramos de enviar novidades e ofertas para este contato. Mensagens sobre consultas e pagamentos que você mesmo pedir continuam chegando.</p></>
        ) : (
          <>
            <h1 style={{ fontSize: 24 }}>Não quer mais receber nossas mensagens?</h1>
            <p className="muted">Confirme abaixo e paramos de enviar novidades e ofertas da Placa na Mão para este contato.</p>
            {error && <Alert tone="danger">Este link não é válido ou já foi usado.</Alert>}
            <div><Button variant="primary" loading={state === 'busy'} disabled={!token} onClick={() => void go()}>Confirmar</Button></div>
          </>
        )}
      </section>
    </main>
  );
}

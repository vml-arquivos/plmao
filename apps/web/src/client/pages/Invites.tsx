import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, LinkButton, PageLoading, usePageTitle } from '../../shared/ui';
import InvitePanel, { type InviteData } from '../../shared/InvitePanel';
import { api } from '../api';
import { storeInvite } from '../funnel';
import { useSession } from '../session';

/** Área logada: o link próprio de convite e o acompanhamento de quem entrou por ele. */
export default function Invites() {
  usePageTitle('Meus convites');
  return (
    <div className="stack">
      <header className="page-head"><h1>Meus convites</h1><p>Convide quem precisa consultar um veículo e acompanhe quem entrou pelo seu link.</p></header>
      <InvitePanel
        load={() => api.get<InviteData>('/me/invite')}
        note={<p className="muted" style={{ fontSize: 13 }}>Este convite é só para acompanhar quem você trouxe. Para ganhar comissão nas compras, ative o <Link to="/app/parceiro">Indique e ganhe</Link>.</p>}
      />
    </div>
  );
}

/** Página aberta por quem recebe o link /convite/CODIGO: guarda o convite e leva para criar a conta. */
export function InviteLanding() {
  usePageTitle('Você foi convidado');
  const { code = '' } = useParams();
  const { status } = useSession();
  const [info, setInfo] = useState<{ valid: boolean; inviterName: string | null } | null>(null);
  useEffect(() => {
    const meta = document.createElement('meta'); meta.name = 'robots'; meta.content = 'noindex, nofollow'; document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, []);
  useEffect(() => {
    let alive = true;
    api.get<{ valid: boolean; inviterName: string | null }>(`/invites/${encodeURIComponent(code)}`).then((r) => { if (!alive) return; setInfo(r); if (r.valid) storeInvite(code, 'LINK'); }, () => { if (alive) setInfo({ valid: false, inviterName: null }); });
    return () => { alive = false; };
  }, [code]);
  if (!info || status === 'loading') return <PageLoading />;
  return (
    <main className="container" style={{ maxWidth: 640, padding: '40px 16px' }}>
      <section className="card card-pad stack">
        {info.valid ? (
          <>
            <h1 style={{ fontSize: 26 }}>{info.inviterName ? `${info.inviterName} convidou você` : 'Você foi convidado'} para a Placa na Mão</h1>
            <p className="muted">Consulte a placa de qualquer veículo e veja o relatório completo, com histórico, débitos, restrições e leilão. Criar a conta é grátis.</p>
            {status === 'authed'
              ? <div><LinkButton to="/app" variant="primary" size="lg">Ir para minha área</LinkButton></div>
              : <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}><LinkButton to="/criar-conta" variant="primary" size="lg">Criar minha conta</LinkButton><LinkButton to="/entrar" size="lg">Já tenho conta</LinkButton></div>}
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 24 }}>Convite não encontrado</h1>
            <Alert tone="warn">Este link de convite não existe mais. Você pode criar sua conta normalmente.</Alert>
            <div><LinkButton to="/criar-conta" variant="primary">Criar minha conta</LinkButton></div>
          </>
        )}
      </section>
    </main>
  );
}

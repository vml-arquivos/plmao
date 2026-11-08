import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Alert, Button, PageLoading, usePageTitle } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { api } from '../api';
import { useSession } from '../session';
import { PixFields, emptyPix, pixProblem, type PixData } from '../components/CustomerFields';

interface Invite { valid: boolean; state: 'OK' | 'USED' | 'REVOKED' | 'EXPIRED'; name: string | null; emailHint: string | null }
const shell = (children: React.ReactNode) => <main className="container" style={{ maxWidth: 640, padding: '40px 16px' }}><section className="card card-pad stack">{children}</section></main>;

/** Convite de parceiro: quem recebe o link cria a conta (ou entra) e aceita. Não aparece em buscadores. */
export default function PartnerInvite() {
  usePageTitle('Convite de parceiro');
  const { token = '' } = useParams();
  const nav = useNavigate();
  const { status, refresh } = useSession();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pix, setPix] = useState<PixData>(emptyPix);
  const { me } = useSession();
  const hasPix = me?.profile.pixKeyMissing === false;

  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots'; meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, []);
  useEffect(() => {
    api.get<Invite>(`/partner-invites/${encodeURIComponent(token)}`).then((r) => { setInvite(r); setState('ready'); }, () => setState('missing'));
  }, [token]);

  if (state === 'loading' || status === 'loading') return <PageLoading />;
  if (state === 'missing' || !invite) return shell(<><h1 style={{ fontSize: 24 }}>Convite não encontrado</h1><Alert tone="warn">Este link não existe. Peça um novo convite à equipe da Placa na Mão.</Alert></>);
  if (!invite.valid) {
    const why = { USED: 'Este convite já foi utilizado.', REVOKED: 'Este convite foi cancelado.', EXPIRED: 'Este convite expirou.', OK: '' }[invite.state];
    return shell(<><h1 style={{ fontSize: 24 }}>Convite indisponível</h1><Alert tone="warn">{why} Peça um novo link à equipe da Placa na Mão.</Alert></>);
  }

  const back = `/parceiro/convite/${encodeURIComponent(token)}`;
  async function accept() {
    const typed = pix.key.trim();
    if (!hasPix && !typed) return setError('Informe a chave PIX em que você vai receber os repasses.');
    const problem = typed ? pixProblem(pix) : '';
    if (problem) return setError(problem);
    setBusy(true); setError('');
    try { await api.post('/affiliate/accept-invite', { token, ...(typed ? { pixKey: typed, pixKeyType: pix.type } : {}) }); await refresh(); nav('/app/parceiro', { replace: true }); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return shell(<>
    <h1 style={{ fontSize: 26 }}>{invite.name ? `${invite.name}, ` : ''}você foi convidado para ser parceiro da Placa na Mão</h1>
    <p className="muted">Como parceiro você ganha um link e um código próprios, acompanha em um painel as comissões, a receita, as vendas, as consultas e os clientes que trouxe, e recebe os repasses combinados com a equipe.</p>
    {invite.emailHint && <Alert tone="info">Este convite é pessoal e vale só para o e-mail {invite.emailHint}.</Alert>}
    {error && <Alert tone="danger">{error}</Alert>}
    {status === 'authed' ? (
      <div className="stack">
        {hasPix ? <p className="muted">Você já tem uma chave PIX cadastrada na conta. Ela será usada para os repasses (você pode trocar depois no painel).</p>
          : <><p>Para receber as comissões, informe a chave PIX. Ela é obrigatória para parceiros.</p><PixFields required value={pix} onChange={setPix} hint="A chave em que você vai receber os repasses." /></>}
        <div><Button variant="primary" size="lg" loading={busy} onClick={() => void accept()}>Aceitar convite</Button></div>
      </div>
    ) : (
      <div className="stack">
        <p>Para aceitar, crie sua conta gratuita ou entre na sua. Depois você volta para esta página e confirma.</p>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <Link className="btn btn-primary btn-lg" to={`/criar-conta?next=${encodeURIComponent(back)}`}>Criar minha conta</Link>
          <Link className="btn btn-lg" to={`/entrar?next=${encodeURIComponent(back)}`}>Já tenho conta</Link>
        </div>
      </div>
    )}
  </>);
}

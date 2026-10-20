import { useEffect, useState, type FormEvent } from 'react';
import Brand from './Brand';
import { trackFunnel } from './funnel';

const API = '/api';
type AuthMode = 'login' | 'register' | 'forgot' | 'reset';
type OAuthProviderStatus = { id: 'google' | 'microsoft' | 'apple'; label: string; enabled: boolean };
type ApiError = { error?: string; message?: string };
type AuthBody = ApiError & {
  token?: string;
  totpRequired?: 'VERIFY' | 'ENROLL';
  challenge?: string;
  setup?: { secret: string; otpauthUrl: string };
  recoveryCodes?: string[];
};
async function readJson<T>(response: Response): Promise<T | undefined> {
  if (response.status === 204 || response.status === 304) return undefined;
  const raw = await response.text();
  if (!raw.trim()) return undefined;
  try { return JSON.parse(raw) as T; } catch { return undefined; }
}

type Props = {
  onAuthenticated: (token: string) => void;
  onBack: () => void;
  externalError?: string;
  initialMode?: 'login' | 'register';
  resetToken?: string;
  affiliateCode?: string;
};

export default function AccountAuthScreen({ onAuthenticated, onBack, externalError = '', initialMode = 'register', resetToken = '', affiliateCode = '' }: Props) {
  const [mode, setMode] = useState<AuthMode>(resetToken ? 'reset' : initialMode);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [providers, setProviders] = useState<OAuthProviderStatus[]>([]);
  const [totpChallenge, setTotpChallenge] = useState('');
  const [totpStep, setTotpStep] = useState<'VERIFY' | 'ENROLL' | ''>('');
  const [totpSetup, setTotpSetup] = useState<AuthBody['setup']>();
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  useEffect(() => { setMode(resetToken ? 'reset' : initialMode); setError(''); setNotice(''); }, [initialMode, resetToken]);
  useEffect(() => { trackFunnel('AUTH_VIEWED', { mode }); }, [mode]);
  useEffect(() => { void fetch(`${API}/auth/providers`, { cache: 'no-store' }).then((response) => response.ok ? readJson<{ providers?: OAuthProviderStatus[] }>(response) : { providers: [] }).then((body) => setProviders(body?.providers ?? [])).catch(() => setProviders([])); }, []);

  function selectMode(next: AuthMode) { setMode(next); setError(''); setNotice(''); }
  function saveToken(token: string) { sessionStorage.setItem('carpivara_token', token); trackFunnel(mode === 'register' ? 'ACCOUNT_CREATED' : 'AUTH_SUCCEEDED', { mode }); onAuthenticated(token); }

  function processAuthBody(body: AuthBody): boolean {
    if (body.token) { saveToken(body.token); return true; }
    if (body.totpRequired && body.challenge) {
      setTotpStep(body.totpRequired);
      setTotpChallenge(body.challenge);
      setTotpSetup(body.setup);
      setRecoveryCodes([]);
      setNotice(body.totpRequired === 'ENROLL' ? 'A autenticação da equipe exige configuração do aplicativo autenticador.' : 'Informe o código de seis dígitos do seu aplicativo autenticador.');
      return true;
    }
    return false;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(''); setNotice(''); setPending(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '').trim();
    trackFunnel('AUTH_SUBMITTED', { mode });
    try {
      if (mode === 'forgot') {
        const response = await fetch(`${API}/auth/forgot-password`, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
        const body = await readJson<ApiError & { message?: string }>(response) ?? {};
        if (!response.ok) throw new Error(body.message ?? body.error ?? 'Não foi possível solicitar a recuperação agora.');
        setNotice(body.message ?? 'Se o e-mail estiver cadastrado, enviaremos as instruções para redefinir sua senha.');
        return;
      }
      if (mode === 'reset') {
        const password = String(form.get('password') ?? '');
        const confirmation = String(form.get('passwordConfirmation') ?? '');
        if (password.length < 10) throw new Error('Crie uma senha com pelo menos 10 caracteres.');
        if (password !== confirmation) throw new Error('As senhas precisam ser iguais.');
        const response = await fetch(`${API}/auth/reset-password`, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: resetToken, newPassword: password }) });
        const body = await readJson<AuthBody>(response) ?? {};
        if (!response.ok || (!body.token && !body.totpRequired)) throw new Error(body.message ?? body.error ?? 'O link de redefinição expirou ou já foi utilizado.');
        if (!processAuthBody(body)) throw new Error('Não foi possível concluir a autenticação.');
        return;
      }
      const password = String(form.get('password') ?? '');
      if (mode === 'register' && String(form.get('name') ?? '').trim().length < 2) throw new Error('Informe seu nome completo para criar a conta.');
      if (mode === 'register' && password.length < 10) throw new Error('Crie uma senha com pelo menos 10 caracteres.');
      if (mode === 'register' && password !== String(form.get('passwordConfirmation') ?? '')) throw new Error('As senhas precisam ser iguais.');
      if (mode === 'register' && (form.get('acceptTerms') !== 'on' || form.get('acceptPrivacy') !== 'on')) throw new Error('Para criar sua conta, aceite os Termos de Uso e a Política de Privacidade.');
      const payload = mode === 'login'
        ? { email, password }
        : { name: String(form.get('name') ?? ''), email, password, acceptTerms: form.get('acceptTerms') === 'on', acceptPrivacy: form.get('acceptPrivacy') === 'on', marketingOptIn: form.get('marketingOptIn') === 'on', ...(affiliateCode ? { affiliateCode } : {}) };
      const response = await fetch(`${API}/auth/${mode === 'login' ? 'login' : 'register'}`, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await readJson<AuthBody>(response) ?? {};
      if (!response.ok) throw new Error(body.message ?? body.error ?? 'Não foi possível acessar sua conta.');
      if (!processAuthBody(body)) throw new Error('Não foi possível concluir a autenticação.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível concluir a operação.');
    } finally { setPending(false); }
  }

  async function submitTotp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(''); setNotice(''); setPending(true);
    const form = new FormData(event.currentTarget);
    const code = String(form.get('totpCode') ?? '').trim();
    try {
      const endpoint = totpStep === 'ENROLL' ? '/auth/totp/enroll/confirm' : '/auth/totp/verify';
      const response = await fetch(`${API}${endpoint}`, { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challenge: totpChallenge, code }) });
      const body = await readJson<AuthBody>(response) ?? {};
      if (!response.ok || !body.token) throw new Error(body.message ?? body.error ?? 'Código inválido ou expirado.');
      if (body.recoveryCodes?.length) setRecoveryCodes(body.recoveryCodes);
      saveToken(body.token);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível validar o código.');
    } finally { setPending(false); }
  }

  function startSocialLogin(provider: OAuthProviderStatus) { if (provider.enabled) window.location.assign(`${API}/auth/oauth/${provider.id}/start`); }
  const providerLabel: Record<OAuthProviderStatus['id'], string> = { google: 'Continuar com Google', microsoft: 'Continuar com Microsoft', apple: 'Continuar com Apple' };
  const providerIcon: Record<OAuthProviderStatus['id'], string> = { google: 'G', microsoft: '⊞', apple: '●' };
  const enabledProviders = (['google', 'microsoft', 'apple'] as OAuthProviderStatus['id'][]).map((id) => providers.find((provider) => provider.id === id) ?? { id, label: id, enabled: false }).filter((provider) => provider.enabled);
  const isAccountMode = mode === 'login' || mode === 'register';
  const heading = mode === 'login' ? 'Entre no seu dashboard.' : mode === 'register' ? 'Seu dashboard começa aqui.' : mode === 'forgot' ? 'Recupere seu acesso.' : 'Crie uma nova senha.';
  const description = mode === 'login' ? 'Acesse carteira, consultas e relatórios salvos com seu e-mail e senha.' : mode === 'register' ? 'O cadastro não exige pagamento. Crie sua conta e entre na plataforma agora.' : mode === 'forgot' ? 'Informe o e-mail cadastrado e enviaremos um link seguro para você criar uma nova senha.' : 'Escolha uma senha forte com pelo menos 10 caracteres para voltar à sua conta.';

  return <div className="authShell"><div className="authVisual"><button className="backButton" onClick={onBack}>← Voltar ao início</button><Brand /><div className="authPitch"><p className="kicker">Acesso à plataforma</p><h1>Crie sua conta. Acesse seu dashboard.</h1><p>O cadastro é gratuito. Você só escolhe e paga pela consulta no momento em que decidir realizá-la.</p></div><div className="authDecor"><span>Dashboard pessoal</span><span>Saldo pré-pago em reais</span><span>Histórico protegido</span></div></div><div className="authPanel"><div className="authCard authCardPremium">
    {totpStep ? <><h2>{totpStep === 'ENROLL' ? 'Proteja o acesso da equipe.' : 'Confirme sua identidade.'}</h2><p className="muted">{totpStep === 'ENROLL' ? 'Abra Google Authenticator, Microsoft Authenticator ou outro aplicativo compatível e adicione a conta BUSCARR.' : 'Digite o código atual do aplicativo autenticador ou um código de recuperação.'}</p>{totpSetup && <div className="notice noticeSuccess"><b>Chave de configuração:</b><br /><code>{totpSetup.secret}</code><br /><small>URI para QR: {totpSetup.otpauthUrl}</small></div>}<form onSubmit={submitTotp}><label>Código de autenticação<input name="totpCode" inputMode="numeric" autoComplete="one-time-code" minLength={6} maxLength={16} required autoFocus placeholder={totpStep === 'ENROLL' ? '000000' : '000000 ou XXXXX-XXXXX'} /></label>{(error || externalError) && <div className="notice noticeError" role="alert">{error || externalError}</div>}<button className="primaryButton full" disabled={pending}>{pending ? 'Validando...' : totpStep === 'ENROLL' ? 'Ativar autenticação e entrar' : 'Validar e entrar'} <span>→</span></button></form>{recoveryCodes.length > 0 && <div className="notice noticeSuccess"><b>Guarde estes códigos de recuperação em local seguro:</b><br />{recoveryCodes.map((code) => <code key={code} style={{ display: 'block' }}>{code}</code>)}</div>}<button type="button" className="textButton authBackLink" onClick={onBack}>← Voltar ao início</button></> : <>
    {isAccountMode && <div className="authTabs"><button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => selectMode('login')}>Já tenho conta</button><button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => selectMode('register')}>Criar conta</button></div>}{!isAccountMode && <button type="button" className="textButton authBackLink" onClick={() => selectMode('login')}>← Voltar para o login</button>}<h2>{heading}</h2><p className="muted">{description}</p>{isAccountMode && enabledProviders.length > 0 && <><div className="socialAuth" aria-label="Acesso social">{enabledProviders.map((provider) => <button className="socialButton" type="button" key={provider.id} onClick={() => startSocialLogin(provider)}><span aria-hidden="true">{providerIcon[provider.id]}</span>{providerLabel[provider.id]}</button>)}</div><div className="authDivider"><span>ou continue com e-mail</span></div></>}<form onSubmit={submit}>{mode === 'register' && <label>Nome completo<input name="name" autoComplete="name" minLength={2} required placeholder="Como podemos chamar você?" /></label>}{mode !== 'reset' && <label>E-mail<input name="email" type="email" autoComplete="email" required placeholder="voce@empresa.com" /></label>}{mode === 'reset' && <input type="hidden" name="email" value="" />}{mode !== 'forgot' && <label>Senha<input name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' || mode === 'reset' ? 10 : 1} required placeholder={mode === 'register' || mode === 'reset' ? 'Crie uma senha com pelo menos 10 caracteres' : 'Sua senha'} /></label>}{(mode === 'register' || mode === 'reset') && <label>Confirmar senha<input name="passwordConfirmation" type="password" autoComplete="new-password" minLength={10} required placeholder="Repita sua senha" /></label>}{mode === 'register' && <div className="consentFields"><label className="checkField"><input name="acceptTerms" type="checkbox" required /> <span><b>Obrigatório:</b> li e aceito os Termos de Uso.</span></label><label className="checkField"><input name="acceptPrivacy" type="checkbox" required /> <span><b>Obrigatório:</b> li e aceito a Política de Privacidade.</span></label><label className="checkField"><input name="marketingOptIn" type="checkbox" /> <span>Quero receber conteúdos e novidades por e-mail.</span></label></div>}{(error || externalError) && <div className="notice noticeError" role="alert">{error || externalError}</div>}{notice && <div className="notice noticeSuccess" role="status">{notice}</div>}<button className="primaryButton full" disabled={pending}>{pending ? (mode === 'forgot' ? 'Enviando instruções...' : mode === 'reset' ? 'Salvando nova senha...' : 'Processando...') : mode === 'login' ? 'Entrar no dashboard' : mode === 'register' ? 'Criar conta e acessar' : mode === 'forgot' ? 'Enviar link de recuperação' : 'Criar nova senha'} <span>→</span></button></form>{mode === 'login' && <button type="button" className="forgotLink" onClick={() => selectMode('forgot')}>Esqueci minha senha</button>}<p className="authFine">Dados de autenticação são processados de forma segura. Nenhum valor é cobrado para criar ou acessar a sua conta.</p></>}</div></div></div>;
}

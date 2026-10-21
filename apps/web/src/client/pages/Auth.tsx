import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../../shared/icons';
import { Alert, Button, Check, Field, Input, Logo, Select, ThemeSwitch, usePageTitle } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { HeroArt } from '../art';
import { api } from '../api';
import { useSession } from '../session';
import { storedReferral, trackFunnel } from '../funnel';

type Mode = 'login' | 'register' | 'forgot' | 'reset';
type Provider = { id: 'google' | 'microsoft' | 'apple'; label: string; enabled: boolean };
const PROVIDER_ICON: Record<Provider['id'], string> = { google: 'G', microsoft: '⊞', apple: '' };

export const safeNext = (raw: string | null): string => (raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\') ? raw : '/app');

function strength(pw: string): number {
  let s = 0;
  if (pw.length >= 10) s++;
  if (pw.length >= 14) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}

function PasswordField({ label, name, value, onChange, autoComplete, minLength, meter, placeholder }: { label: string; name: string; value: string; onChange: (v: string) => void; autoComplete: string; minLength?: number; meter?: boolean; placeholder?: string }) {
  const [show, setShow] = useState(false);
  const s = strength(value);
  return (
    <Field label={label} hint={meter ? 'Mínimo de 8 caracteres.' : undefined}>
      <span className="pw-wrap">
        <input className="input" name={name} type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} autoComplete={autoComplete} minLength={minLength} required placeholder={placeholder} />
        <button type="button" className="icon-btn" aria-label={show ? 'Ocultar senha' : 'Mostrar senha'} onClick={() => setShow(!show)}><Icon name={show ? 'eye-off' : 'eye'} size={18} /></button>
      </span>
      {meter && value && <span className="pw-meter" aria-hidden="true">{[1, 2, 3, 4].map((n) => <i key={n} className={`${s >= n ? 'on' : ''} s${s}`} />)}</span>}
    </Field>
  );
}

export default function Auth({ initial }: { initial: Mode }) {
  const { login, status } = useSession();
  const nav = useNavigate();
  const loc = useLocation();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const resetToken = params.get('reset_token') ?? '';
  const [mode, setMode] = useState<Mode>(resetToken ? 'reset' : initial);
  const [error, setError] = useState(params.get('oauth_error') ? errorMessage(new Error('Não foi possível concluir o acesso social. Tente novamente ou use e-mail e senha.')) : '');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [f, setF] = useState({ name: '', email: '', password: '', confirm: '', terms: false, marketing: false, accountType: 'PARTICULAR' });
  const title = { login: 'Entrar', register: 'Criar conta', forgot: 'Recuperar senha', reset: 'Nova senha' }[mode];
  usePageTitle(title);

  useEffect(() => { setMode(resetToken ? 'reset' : initial); setError(''); setNotice(''); }, [initial, resetToken]);
  useEffect(() => { trackFunnel('AUTH_VIEWED', { mode }); }, [mode]);
  useEffect(() => { if (status === 'authed') nav(next, { replace: true }); }, [status, next, nav]);
  useEffect(() => { api.get<{ providers: Provider[] }>('/auth/providers').then((d) => setProviders((d.providers ?? []).filter((p) => p.enabled)), () => setProviders([])); }, []);

  const set = (k: keyof typeof f) => (v: string | boolean) => setF((s) => ({ ...s, [k]: v }));
  const pathFor = useMemo(() => (m: Mode) => ({ login: '/entrar', register: '/criar-conta', forgot: '/recuperar-senha', reset: '/entrar' }[m] + (next !== '/app' ? `?next=${encodeURIComponent(next)}` : '')), [next]);
  const switchTo = (m: Mode) => nav(pathFor(m));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(''); setNotice('');
    if (mode === 'register' || mode === 'reset') {
      if (f.password.length < 8) return setError('Crie uma senha com pelo menos 8 caracteres.');
      if (f.password !== f.confirm) return setError('As senhas não conferem.');
    }
    if (mode === 'register' && !f.terms) return setError('Para criar sua conta, aceite os Termos de Uso e a Política de Privacidade.');
    setBusy(true);
    trackFunnel('AUTH_SUBMITTED', { mode });
    try {
      if (mode === 'forgot') {
        const r = await api.post<{ message?: string }>('/auth/forgot-password', { email: f.email.trim() });
        setNotice(r.message ?? 'Se o e-mail estiver cadastrado, enviaremos as instruções para redefinir sua senha.');
      } else if (mode === 'reset') {
        await api.post('/auth/reset-password', { token: resetToken, newPassword: f.password });
        setNotice('Senha atualizada. Entre com a nova senha.');
        setF((s) => ({ ...s, password: '', confirm: '' }));
        nav('/entrar', { replace: true });
        setMode('login');
      } else if (mode === 'register') {
        const ref = storedReferral();
        const r = await api.post<{ token: string }>('/auth/register', { name: f.name.trim(), email: f.email.trim(), password: f.password, acceptTerms: true, acceptPrivacy: true, marketingOptIn: f.marketing, accountType: f.accountType, ...(ref ? { affiliateCode: ref } : {}) });
        trackFunnel('ACCOUNT_CREATED', {});
        await login(r.token);
      } else {
        const r = await api.post<{ token: string }>('/auth/login', { email: f.email.trim(), password: f.password });
        trackFunnel('AUTH_SUCCEEDED', {});
        await login(r.token);
      }
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }

  const heading = { login: 'Que bom ver você de volta.', register: 'Crie sua conta grátis.', forgot: 'Vamos recuperar seu acesso.', reset: 'Defina sua nova senha.' }[mode];
  const sub = { login: 'Entre para consultar placas e acessar seus relatórios salvos.', register: 'Sem mensalidade. Você só paga pela consulta que fizer.', forgot: 'Informe seu e-mail e enviaremos as instruções.', reset: 'Escolha uma nova senha com pelo menos 8 caracteres.' }[mode];

  return (
    <div className="auth-shell">
      <aside className="auth-visual" aria-hidden="true">
        <div className="art"><HeroArt /></div>
        <Link to="/"><Logo forceDark height={44} /></Link>
        <div>
          <h2>Mais segurança para o seu veículo.</h2>
          <p>Consulte débitos, restrições e gravame em segundos e guarde cada relatório no seu histórico.</p>
          <ul><li><Icon name="check-circle" size={18} /> Relatório completo em PDF</li><li><Icon name="check-circle" size={18} /> Histórico seguro na sua conta</li><li><Icon name="check-circle" size={18} /> Dados pessoais protegidos (LGPD)</li></ul>
        </div>
      </aside>
      <div className="auth-panel">
        <div className="auth-card">
          <div className="top"><Link to="/" className="muted" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Icon name="arrow-left" size={16} /> Voltar</Link><ThemeSwitch /></div>
          <div><h1>{heading}</h1><p className="sub">{sub}</p></div>
          {(mode === 'login' || mode === 'register') && providers.length > 0 && (
            <>
              <div className="social-row">{providers.map((p) => <a key={p.id} className="social-btn" href={`/api/auth/oauth/${p.id}/start`}><span aria-hidden="true">{PROVIDER_ICON[p.id]}</span> Continuar com {p.label}</a>)}</div>
              <div className="or-sep">ou use seu e-mail</div>
            </>
          )}
          <form className="stack" onSubmit={submit} noValidate={false}>
            {mode === 'register' && (
              <Field label="Como você vai usar?">
                <Select name="accountType" value={f.accountType} onChange={(e) => set('accountType')(e.target.value)}>
                  <option value="PARTICULAR">Uso pessoal (comprar ou vender um veículo)</option>
                  <option value="AUTONOMO">Sou vendedor autônomo ou despachante</option>
                  <option value="EMPRESA">Tenho uma loja, agência ou empresa</option>
                </Select>
              </Field>
            )}
            {mode === 'register' && <Field label="Nome completo"><Input name="name" value={f.name} onChange={(e) => set('name')(e.target.value)} autoComplete="name" minLength={2} required placeholder="Como devemos chamar você?" /></Field>}
            {mode !== 'reset' && <Field label="E-mail"><Input name="email" type="email" value={f.email} onChange={(e) => set('email')(e.target.value)} autoComplete="email" required placeholder="voce@exemplo.com" icon="mail" /></Field>}
            {mode !== 'forgot' && <PasswordField label={mode === 'reset' ? 'Nova senha' : 'Senha'} name="password" value={f.password} onChange={set('password') as (v: string) => void} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'login' ? 1 : 8} meter={mode !== 'login'} />}
            {(mode === 'register' || mode === 'reset') && <PasswordField label="Confirmar senha" name="confirm" value={f.confirm} onChange={set('confirm') as (v: string) => void} autoComplete="new-password" minLength={8} />}
            {mode === 'register' && (
              <div className="stack-sm">
                <Check checked={f.terms} onChange={(e) => set('terms')(e.target.checked)} required>Li e aceito os <Link to="/termos" target="_blank">Termos de Uso</Link> e a <Link to="/privacidade" target="_blank">Política de Privacidade</Link>.</Check>
                <Check checked={f.marketing} onChange={(e) => set('marketing')(e.target.checked)}>Quero receber novidades e ofertas por e-mail (opcional).</Check>
              </div>
            )}
            {error && <Alert tone="danger">{error}</Alert>}
            {notice && <Alert tone="ok">{notice}</Alert>}
            <Button type="submit" variant="primary" size="lg" block loading={busy}>{{ login: 'Entrar', register: 'Criar conta', forgot: 'Enviar instruções', reset: 'Salvar nova senha' }[mode]}</Button>
          </form>
          {mode === 'login' && <p className="auth-alt"><Link to={`/recuperar-senha`}>Esqueci minha senha</Link><br />Ainda não tem conta? <Link to={pathFor('register')} onClick={() => setMode('register')}>Criar conta grátis</Link></p>}
          {mode === 'register' && <p className="auth-alt">Já tem conta? <Link to={pathFor('login')} onClick={() => switchTo('login')}>Entrar</Link></p>}
          {(mode === 'forgot' || mode === 'reset') && <p className="auth-alt"><Link to="/entrar">Voltar para o login</Link></p>}
          {loc.pathname === '/criar-conta' && <p className="muted" style={{ fontSize: 12.5, textAlign: 'center' }}>Ao criar sua conta você concorda com o tratamento de dados descrito na Política de Privacidade.</p>}
        </div>
      </div>
    </div>
  );
}

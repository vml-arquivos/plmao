import { useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../api';
import { useAdminSession } from '../session';
import { Alert, Button, CopyField, Field, Input, Logo, ThemeSwitch, usePageTitle } from '../../shared/ui';
import { errorMessage } from '../../shared/api';

type Step =
  | { kind: 'password' }
  | { kind: 'verify'; challenge: string }
  | { kind: 'enroll'; challenge: string; secret: string; qr: string }
  | { kind: 'recovery'; token: string; codes: string[] };

interface LoginResponse { totpRequired: 'VERIFY' | 'ENROLL' | 'NONE'; challenge: string; token?: string; setup?: { secret: string; otpauthUrl: string } }

export default function Login() {
  usePageTitle('Entrar no painel');
  const { establish } = useAdminSession();
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  const submitPassword = (ev: React.FormEvent) => { ev.preventDefault(); void run(async () => {
    const r = await api.post<LoginResponse>('/admin/auth/login', { email: email.trim(), password });
    setPassword(''); setCode('');
    if (r.totpRequired === 'NONE' && r.token) { await establish(r.token); return; }
    if (r.totpRequired === 'ENROLL' && r.setup) setStep({ kind: 'enroll', challenge: r.challenge, secret: r.setup.secret, qr: await QRCode.toDataURL(r.setup.otpauthUrl, { margin: 1, width: 200 }) });
    else setStep({ kind: 'verify', challenge: r.challenge });
  }); };

  const submitVerify = (ev: React.FormEvent) => { ev.preventDefault(); if (step.kind !== 'verify') return; void run(async () => {
    const r = await api.post<{ token: string }>('/admin/auth/totp/verify', { challenge: step.challenge, code: code.trim() });
    await establish(r.token);
  }); };

  const submitEnroll = (ev: React.FormEvent) => { ev.preventDefault(); if (step.kind !== 'enroll') return; void run(async () => {
    const r = await api.post<{ token: string; recoveryCodes: string[] }>('/admin/auth/totp/enroll/confirm', { challenge: step.challenge, code: code.trim() });
    setStep({ kind: 'recovery', token: r.token, codes: r.recoveryCodes });
  }); };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="row-between"><Logo /><ThemeSwitch /></div>
        {step.kind === 'password' && (
          <form className="stack" onSubmit={submitPassword}>
            <div><h1 style={{ fontSize: 24 }}>Painel da equipe</h1><p className="muted">Acesso restrito. Todas as ações são registradas.</p></div>
            {error && <Alert tone="danger">{error}</Alert>}
            <Field label="E-mail"><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
            <Field label="Senha"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
            <Button type="submit" variant="primary" size="lg" block loading={busy}>Continuar</Button>
          </form>
        )}
        {step.kind === 'verify' && (
          <form className="stack" onSubmit={submitVerify}>
            <div><h1 style={{ fontSize: 24 }}>Verificação em duas etapas</h1><p className="muted">Digite o código de 6 dígitos do seu aplicativo autenticador ou um código de recuperação.</p></div>
            {error && <Alert tone="danger">{error}</Alert>}
            <Field label="Código"><Input inputMode="text" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus maxLength={16} /></Field>
            <Button type="submit" variant="primary" size="lg" block loading={busy}>Entrar</Button>
            <Button variant="ghost" block onClick={() => { setStep({ kind: 'password' }); setError(''); }}>Voltar</Button>
          </form>
        )}
        {step.kind === 'enroll' && (
          <form className="stack" onSubmit={submitEnroll}>
            <div><h1 style={{ fontSize: 24 }}>Ative a verificação em duas etapas</h1><p className="muted">Escaneie o QR code com um aplicativo autenticador (Google Authenticator, Authy, 1Password…) e digite o código gerado.</p></div>
            {error && <Alert tone="danger">{error}</Alert>}
            <div className="qr-box"><img src={step.qr} alt="QR code para o aplicativo autenticador" /></div>
            <CopyField label="Ou digite a chave manualmente" value={step.secret} />
            <Field label="Código de 6 dígitos"><Input inputMode="numeric" pattern="\d{6}" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} required autoFocus /></Field>
            <Button type="submit" variant="primary" size="lg" block loading={busy}>Ativar e entrar</Button>
          </form>
        )}
        {step.kind === 'recovery' && (
          <div className="stack">
            <div><h1 style={{ fontSize: 24 }}>Guarde seus códigos de recuperação</h1><p className="muted">Cada código funciona uma única vez, caso você perca o acesso ao autenticador. Eles não serão exibidos novamente.</p></div>
            <div className="rc-grid">{step.codes.map((c) => <code key={c}>{c}</code>)}</div>
            <Button icon="copy" onClick={() => void navigator.clipboard?.writeText(step.codes.join('\n'))}>Copiar códigos</Button>
            <Button variant="primary" size="lg" block loading={busy} onClick={() => void run(() => establish(step.token))}>Já guardei, entrar no painel</Button>
          </div>
        )}
      </div>
    </div>
  );
}

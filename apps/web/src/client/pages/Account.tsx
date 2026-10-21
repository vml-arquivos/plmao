import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Alert, Button, Check, Field, Input, Select, ThemeSwitch, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { api } from '../api';
import { useSession, type Profile } from '../session';

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

export default function Account() {
  usePageTitle('Minha conta');
  const toast = useToast();
  const nav = useNavigate();
  const { me, refresh, logout } = useSession();
  const [p, setP] = useState<Profile | null>(me?.profile ?? null);
  const [busy, setBusy] = useState(false);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErr, setPwErr] = useState('');
  useEffect(() => { if (me) setP(me.profile); }, [me]);
  if (!p || !me) return null;
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP((s) => (s ? { ...s, [k]: v } : s));

  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    try {
      await api.put('/profile', { name: p!.name.trim(), cpfCnpj: p!.cpfCnpj || undefined, phone: p!.phone || undefined, companyName: p!.companyName || undefined, city: p!.city || undefined, state: p!.state || undefined, marketingOptIn: p!.marketingOptIn });
      await refresh(); toast.ok('Dados atualizados.');
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  }
  async function changePw(e: FormEvent) {
    e.preventDefault(); setPwErr('');
    if (pw.next.length < 8) return setPwErr('A nova senha precisa ter pelo menos 8 caracteres.');
    if (pw.next !== pw.confirm) return setPwErr('As senhas não conferem.');
    setPwBusy(true);
    try { await api.post('/auth/change-password', { ...(me!.profile.passwordEnabled ? { currentPassword: pw.current } : {}), newPassword: pw.next }); setPw({ current: '', next: '', confirm: '' }); toast.ok('Senha alterada.'); }
    catch (err) { setPwErr(errorMessage(err)); } finally { setPwBusy(false); }
  }

  return (
    <div className="stack-lg">
      <div className="page-head"><div><h1>Minha conta</h1><p>{me.user.email}</p></div></div>
      <form className="card card-pad stack" onSubmit={save}>
        <h2 style={{ fontSize: 18 }}>Dados pessoais</h2>
        <div className="form-grid cols-2">
          <Field label="Nome completo"><Input value={p.name} onChange={(e) => set('name', e.target.value)} required minLength={2} autoComplete="name" /></Field>
          <Field label="Telefone"><Input value={p.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="tel" inputMode="tel" /></Field>
          <Field label="CPF ou CNPJ" hint="Necessário para emitir cobranças no checkout."><Input value={p.cpfCnpj} onChange={(e) => set('cpfCnpj', e.target.value)} inputMode="numeric" /></Field>
          <Field label="Empresa (opcional)"><Input value={p.companyName} onChange={(e) => set('companyName', e.target.value)} autoComplete="organization" /></Field>
          <Field label="Cidade"><Input value={p.city} onChange={(e) => set('city', e.target.value)} autoComplete="address-level2" /></Field>
          <Field label="Estado"><Select value={p.state} onChange={(e) => set('state', e.target.value)}><option value="">—</option>{UFS.map((u) => <option key={u}>{u}</option>)}</Select></Field>
        </div>
        <Check checked={p.marketingOptIn} onChange={(e) => set('marketingOptIn', e.target.checked)}>Quero receber novidades e ofertas por e-mail.</Check>
        <div><Button type="submit" variant="primary" loading={busy}>Salvar alterações</Button></div>
      </form>
      <form className="card card-pad stack" onSubmit={changePw}>
        <h2 style={{ fontSize: 18 }}>{p.passwordEnabled ? 'Alterar senha' : 'Criar uma senha'}</h2>
        {!p.passwordEnabled && <Alert tone="info">Você entra com uma conta social. Se quiser, crie também uma senha para entrar com e-mail.</Alert>}
        <div className="form-grid cols-3">
          {p.passwordEnabled && <Field label="Senha atual"><Input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" required /></Field>}
          <Field label="Nova senha" hint="Mínimo de 8 caracteres."><Input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" minLength={8} required /></Field>
          <Field label="Confirmar nova senha"><Input type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" minLength={8} required /></Field>
        </div>
        {pwErr && <Alert tone="danger">{pwErr}</Alert>}
        <div><Button type="submit" loading={pwBusy}>Atualizar senha</Button></div>
      </form>
      <section className="card card-pad stack">
        <h2 style={{ fontSize: 18 }}>Preferências e privacidade</h2>
        <div className="row-between"><span>Aparência do app</span><ThemeSwitch /></div>
        <p className="muted" style={{ fontSize: 14 }}>Seus dados são tratados conforme a <Link to="/privacidade">Política de Privacidade</Link>. Para acessar, corrigir ou excluir seus dados, <Link to="/contato?assunto=lgpd">fale com a gente</Link>.</p>
        <div><Button variant="danger" icon="log-out" onClick={async () => { await logout(); nav('/', { replace: true }); }}>Sair da conta</Button></div>
      </section>
    </div>
  );
}

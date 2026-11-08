import ProfileSwitch from '../components/ProfileSwitch';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Alert, Button, Check, Field, Input, Select, ThemeSwitch, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { api } from '../api';
import { useSession, type Profile } from '../session';
import TestimonialForm from '../components/TestimonialForm';
import { PixFields, ResponsibilityCheck, UFS, customerProblem, pixProblem, signupProblem, type CustomerData, type PixData, type PixType } from '../components/CustomerFields';

export default function Account() {
  usePageTitle('Minha conta');
  const toast = useToast();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { me, refresh, logout } = useSession();
  const [p, setP] = useState<Profile | null>(me?.profile ?? null);
  const [busy, setBusy] = useState(false);
  const [resp, setResp] = useState(false);
  const [pix, setPix] = useState<PixData>({ type: 'CPF', key: '' });
  useEffect(() => { if (me) setPix({ type: ((me.profile.pixKeyType || 'CPF') as PixType), key: me.profile.pixKey ?? '' }); }, [me]);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErr, setPwErr] = useState('');
  useEffect(() => { if (me) setP(me.profile); }, [me]);
  const [cnpjOn, setCnpjOn] = useState(false);
  const [cnpjBusy, setCnpjBusy] = useState(false);
  const [cnpjNote, setCnpjNote] = useState('');
  useEffect(() => { api.get<{ enabled: boolean }>('/account/cnpj/status').then((r) => setCnpjOn(r.enabled)).catch(() => setCnpjOn(false)); }, []);
  if (!p || !me) return null;
  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP((s) => (s ? { ...s, [k]: v } : s));

  async function searchCnpj() {
    setCnpjBusy(true); setCnpjNote('');
    try {
      const r = await api.get<{ data: { cnpj: string; legalName: string | null; address: { city: string | null; state: string | null } }; source: string; fetchedAt: string }>(`/account/cnpj/${p!.cpfCnpj.replace(/\D/g, '')}`);
      setP((s) => (s ? { ...s, companyName: r.data.legalName ?? s.companyName, city: r.data.address.city ?? s.city, state: r.data.address.state ?? s.state } : s));
      setCnpjNote(`Preenchido com dados públicos (${r.source}). Revise antes de salvar.`);
    } catch (err) { toast.error(errorMessage(err)); } finally { setCnpjBusy(false); }
  }

  const needsResponsibility = !p.responsibilityAccepted;
  async function save(e: FormEvent) {
    e.preventDefault();
    const back = params.get('voltar');
    if (p!.profileRequired) {
      // Só exige o cadastro de compra (CPF, cidade, estado e aceite) quando a pessoa veio de uma compra; no resto, salvar nome, telefone ou preferências não trava.
      const data: CustomerData = { phone: p!.phone, cpfCnpj: p!.cpfCnpj, companyName: p!.companyName, city: p!.city, state: p!.state, responsibility: resp };
      const problem = back ? customerProblem(data, p!.customerType, { needResponsibility: needsResponsibility }) : signupProblem(p!.phone);
      if (problem) return void toast.error(problem);
    }
    const pixErr = pixProblem(pix);
    if (pixErr) return void toast.error(pixErr);
    setBusy(true);
    try {
      await api.put('/profile', { name: p!.name.trim(), cpfCnpj: p!.cpfCnpj || undefined, phone: p!.phone || undefined, companyName: p!.companyName || undefined, city: p!.city || undefined, state: p!.state || undefined, ...(resp ? { acceptResponsibility: true } : {}), marketingOptIn: p!.marketingOptIn, ...(pix.key.trim() !== (p!.pixKey ?? '') || (pix.key.trim() && pix.type !== p!.pixKeyType) ? { pixKey: pix.key.trim(), ...(pix.key.trim() ? { pixKeyType: pix.type } : {}) } : {}) });
      await refresh(); setResp(false); toast.ok('Dados atualizados.');
      if (back && back.startsWith('/app')) nav(back, { replace: true });
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
      {(me.profiles?.length ?? 1) > 1 && <div className="card card-pad stack-sm"><h2 style={{ fontSize: 18 }}>Perfil de uso</h2><p className="muted" style={{ fontSize: 14 }}>Sua conta tem mais de um perfil. O perfil muda o menu e a página inicial; seus dados e seu saldo são os mesmos.</p><ProfileSwitch label /></div>}
      {p.profileRequired && !p.profileComplete && params.get('voltar') && <Alert tone="warn">Para comprar a consulta, complete estes dados (só na primeira compra). Falta: {p.profileMissing.join(', ')}.</Alert>}
      {p.profileRequired && !p.profileComplete && !params.get('voltar') && <Alert tone="info">Você já pode usar a FIPE grátis. CPF, cidade e estado só são pedidos na primeira compra de consulta.</Alert>}
      <form className="card card-pad stack" onSubmit={save}>
        <h2 style={{ fontSize: 18 }}>Dados pessoais</h2>
        <div className="form-grid cols-2">
          <Field label="Nome completo"><Input value={p.name} onChange={(e) => set('name', e.target.value)} required minLength={2} autoComplete="name" /></Field>
          <Field label="WhatsApp (com DDD)"><Input value={p.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="tel" inputMode="tel" /></Field>
          <Field label="CPF" hint="Só é pedido para comprar consultas e emitir a cobrança."><Input value={p.cpfCnpj} onChange={(e) => set('cpfCnpj', e.target.value)} inputMode="numeric" />
            {cnpjOn && p.cpfCnpj.replace(/\D/g, '').length === 14 && <Button type="button" variant="ghost" loading={cnpjBusy} onClick={() => void searchCnpj()}>Buscar dados do CNPJ</Button>}
            {cnpjNote && <small className="muted" role="status">{cnpjNote}</small>}
          </Field>
          <Field label="Empresa (opcional)"><Input value={p.companyName} onChange={(e) => set('companyName', e.target.value)} autoComplete="organization" /></Field>
        </div>
        <h2 style={{ fontSize: 18 }}>Onde você está</h2>
        <div className="form-grid cols-2">
          <Field label="Cidade"><Input value={p.city} onChange={(e) => set('city', e.target.value)} autoComplete="address-level2" /></Field>
          <Field label="Estado"><Select value={p.state} onChange={(e) => set('state', e.target.value)}><option value="">—</option>{UFS.map((u) => <option key={u}>{u}</option>)}</Select></Field>
        </div>
        {p.responsibilityAccepted
          ? <p className="muted" style={{ fontSize: 14 }}>Termos de Uso e responsabilidade pelas informações consultadas: aceitos.</p>
          : <ResponsibilityCheck checked={resp} onChange={setResp} />}
        <h2 style={{ fontSize: 18 }}>Chave PIX</h2>
        <p className="muted" style={{ fontSize: 14 }}>Usada só para devolver valores, pagar cashback e comissões do Indique e Ganhe. Não é cobrada nem usada para pagar nada.</p>
        {p.pixKeyMissing && <Alert tone="info">Você ainda não cadastrou uma chave PIX. Sem ela, reembolsos e comissões ficam parados até você informar.</Alert>}
        <PixFields value={pix} onChange={setPix} hint="Deixe em branco para remover a chave." />
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
      <TestimonialForm />
      <section className="card card-pad stack">
        <h2 style={{ fontSize: 18 }}>Preferências e privacidade</h2>
        <div className="row-between"><span>Aparência do app</span><ThemeSwitch /></div>
        <p className="muted" style={{ fontSize: 14 }}>Seus dados são tratados conforme a <Link to="/privacidade">Política de Privacidade</Link>. Para acessar, corrigir ou excluir seus dados, <Link to="/contato?assunto=lgpd">fale com a gente</Link>.</p>
        <div><Button variant="danger" icon="log-out" onClick={async () => { await logout(); nav('/', { replace: true }); }}>Sair da conta</Button></div>
      </section>
    </div>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../../shared/icons';
import { Alert, Button, Field, Input, LinkButton, Select, Textarea, usePageTitle } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateTime, isValidPlate, normalizePlate } from '../../shared/format';
import { api } from '../api';
import { BRAND } from '../config';
import { useSession } from '../session';
import { CompareMatrix, PackageCards, ProductCards, SmartPicker, useCatalog } from '../components/Catalog';
import Faq from '../components/Faq';
import { InstallButton, InstallGuide, useInstall, type InstallPlatform } from '../components/PwaBits';
import { money } from '../../shared/format';

/* ---------- /consultar (visitante) ---------- */
export function GuestQuery() {
  usePageTitle('Consultar placa');
  const { status } = useSession();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [plate, setPlate] = useState(normalizePlate(params.get('placa') ?? ''));
  const { data } = useCatalog();
  if (status === 'authed') return <Navigate to={`/app/consultar${window.location.search}`} replace />;
  const ok = isValidPlate(plate);
  const products = (data?.products ?? []).filter((p) => !p.isFree);
  const go = (productId?: string) => nav(`/criar-conta?next=${encodeURIComponent(`/app/consultar?placa=${plate}${productId ? `&produto=${productId}` : ''}`)}`);
  return (
    <section className="page-hero" style={{ minHeight: '60vh' }}>
      <div className="container" style={{ maxWidth: 820 }}>
        <span className="eyebrow">Consultar placa</span>
        <h1 style={{ maxWidth: 'none' }}>Quase lá. Escolha a consulta.</h1>
        <p className="lead">Confirme a placa, escolha o tipo de consulta e crie sua conta grátis para ver o relatório. Você só paga pela consulta.</p>
        <div className="card card-pad stack" style={{ marginTop: 26 }}>
          <div className="plate-input-wrap"><div className="plate-input"><input value={plate} onChange={(e) => setPlate(normalizePlate(e.target.value))} placeholder="ABC1D23" aria-label="Placa do veículo" maxLength={8} autoComplete="off" autoCapitalize="characters" /></div>{plate && !ok && <span style={{ color: 'var(--danger)', fontSize: 14 }}>Placa incompleta ou inválida.</span>}</div>
          <div className="prod-list">
            {products.map((p) => { const off = p.commercialStatus !== 'ACTIVE'; return (
              <button type="button" key={p.id} className={`prod ${off ? 'off' : ''}`} disabled={!ok || off} onClick={() => go(p.id)} style={{ textAlign: 'left', width: '100%' }}>
                <Icon name="search" size={20} /><span><b>{p.name}{off && <span className="badge">Em breve</span>}</b><p>{p.description}</p></span><span className="pr num">{money(p.priceCents)}</span>
              </button>); })}
          </div>
          <div className="row"><Button variant="primary" size="lg" disabled={!ok} onClick={() => go()}>Criar conta e continuar <Icon name="arrow-right" size={18} /></Button><Link className="btn btn-lg" to={`/fipe${ok ? `?placa=${plate}` : ''}`}>Ver valor FIPE grátis</Link></div>
          <p className="muted" style={{ fontSize: 13.5 }}>Já tem conta? <Link to={`/entrar?next=${encodeURIComponent(`/app/consultar?placa=${plate}`)}`}>Entrar</Link></p>
        </div>
      </div>
    </section>
  );
}

/* ---------- /planos ---------- */
export function PlansPage() {
  usePageTitle('Consultas e preços');
  return (
    <>
      <section className="page-hero"><div className="container"><span className="eyebrow">Consultas e preços</span><h1>Pague só pelo que consultar.</h1><p className="lead">Sem mensalidade obrigatória. Compare o que cada consulta entrega, descubra a combinação mais barata para o seu caso ou recarregue saldo em pacotes.</p></div></section>
      <section className="section" style={{ paddingTop: 12 }}><div className="container stack-lg">
        <ProductCards />
        <div className="stack"><h2 style={{ fontSize: 26 }}>Compare lado a lado</h2><CompareMatrix /></div>
        <SmartPicker />
        <div className="stack"><h2 style={{ fontSize: 26 }}>Pacotes de saldo</h2><PackageCards /></div>
        <p className="muted" style={{ fontSize: 13 }}>Preço final exibido antes do pagamento. Pix e cartão conforme a disponibilidade do checkout. <Link to="/termos">Termos de Uso</Link>.</p>
      </div></section>
      <section className="section alt"><div className="container"><div className="section-head center"><h2>Dúvidas frequentes</h2></div><Faq limit={6} /></div></section>
    </>
  );
}

/* ---------- /validar ---------- */
interface Validation { authentic: boolean; status: string; documentCode?: string; createdAt?: string; plate?: string | null; reportKind?: string; hash?: string }
export function ValidatePage() {
  usePageTitle('Validar relatório');
  const params = useParams();
  const nav = useNavigate();
  const [code, setCode] = useState((params.code ?? '').toUpperCase());
  const [res, setRes] = useState<Validation | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function check(c: string) {
    setBusy(true); setErr(''); setRes(null);
    try { setRes(await api.get<Validation>(`/validar-relatorio/${encodeURIComponent(c)}`)); }
    catch (e) { const m = e as { status?: number; data?: Validation }; if (m.status === 404) setRes({ authentic: false, status: 'NOT_FOUND' }); else setErr(errorMessage(e)); }
    finally { setBusy(false); }
  }
  useEffect(() => { if (params.code) void check(params.code); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [params.code]);
  function submit(e: FormEvent) { e.preventDefault(); const c = code.trim().toUpperCase(); if (c) nav(`/validar/${encodeURIComponent(c)}`); }
  return (
    <section className="section">
      <div className="container">
        <div className="section-head center"><span className="eyebrow">Autenticidade</span><h2>Validar relatório</h2><p>Digite o código de verificação impresso no PDF para confirmar que o relatório foi emitido pela Placa na Mão.</p></div>
        <form className="validate-card card" onSubmit={submit}>
          <Field label="Código de verificação" className="grow" ><Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Ex.: 9F1C2A7B" maxLength={20} className="mono" /></Field>
          <Button type="submit" variant="primary" loading={busy} disabled={!code.trim()}>Validar</Button>
          {err && <Alert tone="danger">{err}</Alert>}
          {res && (res.authentic ? (
            <>
              <span className="big ok"><Icon name="shield-check" size={36} /></span>
              <h3>Relatório autêntico</h3>
              <div className="kv"><div><span>Código</span><span className="mono">{res.documentCode}</span></div>{res.plate && <div><span>Placa</span><span className="mono">{res.plate}</span></div>}<div><span>Emitido em</span><span>{dateTime(res.createdAt)}</span></div><div><span>Situação</span><span>{res.status === 'VALID' ? 'Válido' : res.status === 'UPDATED' ? 'Substituído por versão mais recente' : res.status}</span></div>{res.hash && <div><span>Assinatura</span><span className="mono">{res.hash.slice(0, 16)}…</span></div>}</div>
            </>
          ) : (
            <>
              <span className="big bad"><Icon name="x-circle" size={36} /></span>
              <h3>Código não encontrado</h3>
              <p className="muted">Confira o código impresso no relatório. Se o problema persistir, <Link to="/contato">fale com a gente</Link>.</p>
            </>
          ))}
        </form>
      </div>
    </section>
  );
}

/* ---------- /sobre ---------- */
export function InstallApp() {
  usePageTitle('Instalar o app');
  const { standalone, platform } = useInstall();
  const [guide, setGuide] = useState<InstallPlatform | null>(null);
  return (
    <>
      <section className="page-hero"><div className="container"><span className="eyebrow">Aplicativo</span><h1>Instale o Placa na Mão na tela inicial.</h1><p className="lead">Abre em tela cheia, sem loja de aplicativos e sem ocupar espaço. Funciona no Android, no iPhone, no iPad e no computador.</p></div></section>
      <section className="section" style={{ paddingTop: 12 }}>
        <div className="container stack-lg">
          {standalone ? <Alert tone="ok" icon="check">O app já está instalado neste aparelho.</Alert> : <div><InstallButton variant="primary" label="Instalar agora" /></div>}
          <div className="grid-3 install-grid">
            {(['android', 'ios', 'desktop'] as const).map((p) => (
              <div key={p} className="card card-pad stack">
                <h2 style={{ fontSize: 20 }}>{p === 'android' ? 'Android' : p === 'ios' ? 'iPhone e iPad' : 'Computador'}</h2>
                <p className="muted">{p === 'android' ? 'No Chrome, toque em Instalar quando o aviso aparecer ou use o menu ⋮.' : p === 'ios' ? 'No iPhone e no iPad a instalação é feita pelo Safari, em Compartilhar.' : 'No Chrome ou no Edge, use o ícone de instalar na barra de endereço.'}</p>
                <div><Button size="sm" onClick={() => setGuide(p)}>Ver o passo a passo{platform === p ? ' (seu aparelho)' : ''}</Button></div>
              </div>
            ))}
          </div>
        </div>
      </section>
      {guide && <InstallGuide platform={guide} onClose={() => setGuide(null)} />}
    </>
  );
}

export function About() {
  usePageTitle('Sobre');
  return (
    <>
      <section className="page-hero"><div className="container"><span className="eyebrow">Sobre</span><h1>Informação clara para decidir com segurança.</h1><p className="lead">A Placa na Mão nasceu para tirar o veículo usado do campo do “achismo”: você digita a placa e recebe, em um relatório simples, o que a fonte contratada informa.</p></div></section>
      <section className="section" style={{ paddingTop: 12 }}>
        <div className="container prose">
          <h2>O que acreditamos</h2>
          <p><b>Transparência primeiro.</b> Se a fonte não retorna um dado, dizemos “não informado” — nunca “nada consta”. O preço aparece antes do pagamento e falhas técnicas geram estorno.</p>
          <p><b>Privacidade por padrão.</b> Nome e documentos do proprietário não são exibidos; identificadores aparecem mascarados e os dados brutos ficam criptografados.</p>
          <p><b>Simples de usar.</b> Do celular ao computador, o caminho é o mesmo: placa, consulta, relatório, PDF.</p>
          <div className="row" style={{ marginTop: 22 }}><LinkButton to="/consultar" variant="primary" iconRight="arrow-right">Consultar uma placa</LinkButton><LinkButton to="/contato">Falar com a gente</LinkButton></div>
        </div>
      </section>
    </>
  );
}

/* ---------- /contato ---------- */
export function Contact() {
  usePageTitle('Contato');
  const { me } = useSession();
  const [params] = useSearchParams();
  const topic = params.get('assunto');
  const [f, setF] = useState({ name: me?.user.name ?? '', email: me?.user.email ?? '', subject: topic === 'lgpd' ? 'Solicitação LGPD' : '', message: '', category: topic === 'lgpd' ? 'LGPD' : topic === 'comercial' ? 'COMMERCIAL' : 'SUPPORT' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [err, setErr] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await api.post<{ message: string; ticketId: string }>('/contact', f); setDone(`${r.message} Protocolo: ${r.ticketId.slice(0, 8).toUpperCase()}.`); }
    catch (er) { setErr(errorMessage(er)); } finally { setBusy(false); }
  }
  return (
    <section className="section">
      <div className="container" style={{ maxWidth: 720 }}>
        <div className="section-head"><span className="eyebrow">Contato</span><h2>Como podemos ajudar?</h2><p>Escreva sua dúvida e responderemos por e-mail. Você também pode escrever para <a href={`mailto:${BRAND.supportEmail}`}>{BRAND.supportEmail}</a>.</p></div>
        {done ? <Alert tone="ok" title="Mensagem enviada.">{done}</Alert> : (
          <form className="card card-pad stack" onSubmit={submit}>
            <div className="form-grid cols-2">
              <Field label="Seu nome"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} autoComplete="name" /></Field>
              <Field label="E-mail"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required autoComplete="email" /></Field>
              <Field label="Assunto"><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} required minLength={2} /></Field>
              <Field label="Tipo"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}><option value="SUPPORT">Suporte</option><option value="COMMERCIAL">Comercial</option><option value="PRIVACY">Privacidade</option><option value="LGPD">Direitos LGPD</option></Select></Field>
            </div>
            <Field label="Mensagem" hint="Mínimo de 10 caracteres."><Textarea value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} required minLength={10} maxLength={5000} /></Field>
            {err && <Alert tone="danger">{err}</Alert>}
            <div><Button type="submit" variant="primary" loading={busy} icon="mail">Enviar mensagem</Button></div>
          </form>
        )}
      </div>
    </section>
  );
}

/* ---------- Termos e privacidade ---------- */
const LEGAL = {
  terms: { title: 'Termos de Uso', kicker: 'Regras do serviço', sections: [
    ['1. Objeto', 'A Placa na Mão organiza consultas veiculares por placa e gera relatórios com os dados efetivamente retornados pelas fontes contratadas. O cadastro é gratuito; você paga apenas pelas consultas que escolher realizar.'],
    ['2. Limites da consulta', 'Cada consulta informa sua cobertura antes da confirmação. Informação não retornada pela fonte é exibida como “não informada” e não equivale a “nada consta”. O relatório apoia a decisão, mas não substitui vistoria, certidões ou consulta aos órgãos competentes.'],
    ['3. Preços, saldo e pagamentos', 'O preço de cada consulta é exibido em reais antes do pagamento. O saldo pré-pago e as consultas pagas diretamente são disponibilizados somente após a confirmação do pagamento pelo parceiro de pagamento. Em falha técnica da consulta, o valor debitado é estornado conforme as regras do serviço. Estornos, cancelamentos e contestações de pagamento podem gerar reversões de saldo e de comissões.'],
    ['4. Uso responsável', 'As informações devem ser usadas para finalidade legítima, respeitando a legislação aplicável. É proibido compartilhar credenciais, revender consultas sem autorização, usar automações abusivas ou tentar acessar dados fora das permissões da sua conta.'],
    ['5. Programa de parceiros', 'O programa de parceiros paga comissão apenas sobre pagamentos confirmados e não estornados, após o prazo de segurança informado na plataforma.'],
    ['6. Disponibilidade', 'Fontes externas podem sofrer indisponibilidade ou alteração de cobertura. Consultas sem fonte ativa permanecem marcadas como “em breve” e não são cobradas.'],
    ['7. Contato', `Dúvidas sobre estes termos: ${BRAND.supportEmail}.`]
  ] },
  privacy: { title: 'Política de Privacidade', kicker: 'LGPD', sections: [
    ['1. Dados que tratamos', 'Dados de conta (nome, e-mail, telefone, CPF/CNPJ quando necessário ao pagamento), autenticação, pagamentos, carteira, consultas realizadas, registros de segurança e informações técnicas do dispositivo necessárias ao funcionamento.'],
    ['2. Finalidades e bases legais', 'Executar o contrato (consultas, relatórios, pagamentos e suporte), cumprir obrigações legais e regulatórias, prevenir fraudes e proteger o serviço (legítimo interesse) e, mediante consentimento, enviar comunicações de marketing.'],
    ['3. Dados do veículo e de terceiros', 'Relatórios podem conter dados vinculados ao veículo. Nome, CPF/CNPJ e identificadores do proprietário não são exibidos em claro: aparecem mascarados ou ocultos, e a resposta bruta do provedor é armazenada criptografada, com acesso restrito e auditado.'],
    ['4. Compartilhamento', 'Compartilhamos somente o necessário com provedores de consulta, pagamento, infraestrutura, autenticação e e-mail contratados para operar o serviço.'],
    ['5. Segurança e retenção', 'Adotamos controles de acesso, sessões revogáveis, criptografia de dados sensíveis, trilha de auditoria e autenticação em dois fatores para a equipe. Os dados são retidos pelo tempo necessário à finalidade, ao contrato e às obrigações legais.'],
    ['6. Seus direitos', `Você pode solicitar confirmação, acesso, correção, anonimização, portabilidade, informação sobre compartilhamento e exclusão, quando aplicável, pela página de contato ou por ${BRAND.supportEmail}.`]
  ] }
} as const;

export function Legal({ kind }: { kind: 'terms' | 'privacy' }) {
  const d = LEGAL[kind];
  usePageTitle(d.title);
  return (
    <>
      <section className="page-hero"><div className="container"><span className="eyebrow">{d.kicker}</span><h1>{d.title}</h1><p className="lead">Versão vigente · atualizada em {new Date().getFullYear()}.</p></div></section>
      <section className="section" style={{ paddingTop: 8 }}><div className="container prose">
        <Alert tone="warn" title="Texto-base.">Este documento reúne as regras operacionais do serviço. Antes da publicação definitiva, ele deve ser revisado pelo jurídico da empresa e refletir os contratos reais com fornecedores.</Alert>
        {d.sections.map(([t, x]) => <div key={t}><h2>{t}</h2><p>{x}</p></div>)}
      </div></section>
    </>
  );
}

export function NotFound() {
  usePageTitle('Página não encontrada');
  return <section className="section"><div className="container" style={{ textAlign: 'center', display: 'grid', gap: 14, justifyItems: 'center' }}><span className="plate xl"><b>404</b></span><h1>Página não encontrada</h1><p className="muted">O endereço que você acessou não existe ou foi movido.</p><LinkButton to="/" variant="primary">Voltar ao início</LinkButton></div></section>;
}

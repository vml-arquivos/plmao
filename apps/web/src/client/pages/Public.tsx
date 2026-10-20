import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../../shared/icons';
import { Alert, Button, Field, Input, LinkButton, Select, Textarea, usePageTitle } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateTime, isValidPlate, normalizePlate } from '../../shared/format';
import { api } from '../api';
import { BRAND } from '../config';
import { useSession } from '../session';
import Pricing, { useCatalog } from '../components/Pricing';
import Faq from '../components/Faq';
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
  usePageTitle('Planos e preços');
  return (
    <>
      <section className="page-hero"><div className="container"><span className="eyebrow">Preços</span><h1>Pague só pelo que consultar.</h1><p className="lead">Sem mensalidade obrigatória. Escolha a consulta avulsa ou um pacote de saldo com bônus e economize em várias consultas.</p></div></section>
      <section className="section" style={{ paddingTop: 12 }}><div className="container"><Pricing /></div></section>
      <section className="section alt"><div className="container"><div className="section-head center"><h2>Dúvidas frequentes</h2></div><Faq /></div></section>
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

/* ---------- /desenvolvedores ---------- */
export function ApiDocs() {
  usePageTitle('API para desenvolvedores');
  const base = typeof window !== 'undefined' ? window.location.origin : 'https://placanamao.com.br';
  return (
    <>
      <section className="page-hero"><div className="container"><span className="eyebrow">API Placa na Mão</span><h1>Integre consultas veiculares ao seu sistema.</h1><p className="lead">Uma API REST simples: envie a placa, receba o relatório estruturado em JSON. Mesma cobrança e mesmos dados da plataforma.</p><div className="row" style={{ marginTop: 22 }}><LinkButton to="/app/api" variant="primary" iconRight="arrow-right">Gerar minha chave</LinkButton></div></div></section>
      <section className="section" style={{ paddingTop: 12 }}>
        <div className="container api-doc prose" style={{ maxWidth: 860 }}>
          <h2>Autenticação</h2>
          <p>Gere uma chave em <Link to="/app/api">Minha área → API</Link> e envie no cabeçalho <span className="kbd">Authorization: Bearer pnm_live_…</span> (ou <span className="kbd">X-API-Key</span>). Cada consulta é debitada do saldo da sua carteira.</p>
          <div className="endpoint"><span className="verb">GET</span> /api/v1/products</div>
          <p>Lista as consultas disponíveis e seus preços (em centavos).</p>
          <div className="endpoint"><span className="verb">GET</span> /api/v1/balance</div>
          <p>Retorna o saldo atual em centavos.</p>
          <div className="endpoint"><span className="verb post">POST</span> /api/v1/vehicles</div>
          <p>Executa uma consulta. Corpo: <span className="kbd">{`{ "plate": "ABC1D23", "product": "COMPLETE" }`}</span>. Use o cabeçalho <span className="kbd">Idempotency-Key</span> (12–128 caracteres) para evitar cobrança dupla em reenvios.</p>
          <pre className="code-box"><code>{`curl -X POST ${base}/api/v1/vehicles \\
  -H "Authorization: Bearer pnm_live_SUACHAVE" \\
  -H "Idempotency-Key: 6c1d0c9e-3e7a-4b7c-9f10-2a8e5d0b1f11" \\
  -H "Content-Type: application/json" \\
  -d '{"plate":"ABC1D23","product":"COMPLETE"}'`}</code></pre>
          <pre className="code-box"><code>{`{
  "object": "vehicle_query",
  "id": "9f1c2a7b-…",
  "plate": "ABC1D23",
  "status": "SUCCESS",
  "priceCents": 2490,
  "verificationCode": "9F1C2A7B",
  "result": {
    "v2": {
      "verdict": { "level": "CLEAR", "title": "Sem alertas relevantes" },
      "headline": { "brand": "…", "model": "…" },
      "debts": { "totalCents": 0, "hasDebt": false },
      "sections": [ … ]
    }
  }
}`}</code></pre>
          <div className="endpoint"><span className="verb">GET</span> /api/v1/vehicles/:id</div>
          <p>Recupera uma consulta feita por API.</p>
          <h2>Dados e privacidade</h2>
          <ul><li>Campos que a fonte não retornou vêm com <span className="kbd">state: "NOT_PROVIDED"</span>.</li><li>Nome e documentos do proprietário não são expostos; identificadores aparecem mascarados.</li><li><span className="kbd">verdict.level</span>: CLEAR, ATTENTION, HIGH_RISK ou INCONCLUSIVE.</li></ul>
          <h2>Erros e limites</h2>
          <ul><li><span className="kbd">401</span> chave inválida · <span className="kbd">402</span> saldo insuficiente · <span className="kbd">400</span> placa inválida · <span className="kbd">429</span> limite de requisições por minuto.</li><li>Se a fonte falhar, o valor é estornado automaticamente e a resposta traz <span className="kbd">refunded: true</span>.</li></ul>
        </div>
      </section>
    </>
  );
}

/* ---------- /sobre ---------- */
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
    ['5. API e parceiros', 'O acesso por API exige chave pessoal e sujeita-se a limites de uso. O programa de parceiros paga comissão apenas sobre pagamentos confirmados e não estornados, após o prazo de segurança informado na plataforma.'],
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

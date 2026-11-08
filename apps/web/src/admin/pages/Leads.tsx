import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, maskPhone } from '../api';
import { useAdminSession } from '../session';
import { Alert, Badge, Button, ConfirmDialog, CopyField, EmptyState, ErrorState, Field, Input, Modal, PageLoading, Select, Tabs, Textarea, useAsync, usePageTitle, useToast } from '../../shared/ui';
import { errorMessage } from '../../shared/api';
import { dateTime, money, relativeTime } from '../../shared/format';
import { Card, Kpi, PageHead } from '../parts';
import Invites from './Invites';

/* ------------------------------------------------------------------ tipos e rótulos */
const STAGES = ['NOVO', 'CONTATADO', 'INTERESSADO', 'CADASTRADO', 'CLIENTE', 'PERDIDO'] as const;
type Stage = (typeof STAGES)[number];
const STAGE: Record<Stage, { label: string; hint: string; tone: 'neutral' | 'info' | 'warn' | 'ok' | 'violet' | 'danger' }> = {
  NOVO: { label: 'Não qualificado', hint: 'Só simulou, olhou a FIPE ou deixou contato. Ainda sem conta.', tone: 'info' },
  CONTATADO: { label: 'Contatado', hint: 'Já recebeu mensagem ou ligação', tone: 'neutral' },
  INTERESSADO: { label: 'Interessado', hint: 'Abriu o link ou respondeu', tone: 'warn' },
  CADASTRADO: { label: 'Cadastrado', hint: 'Criou a conta, ainda não fez consulta paga', tone: 'violet' },
  CLIENTE: { label: 'Cliente', hint: 'Já fez consulta paga', tone: 'ok' },
  PERDIDO: { label: 'Perdido', hint: 'Sem interesse', tone: 'danger' }
};
const SOURCE: Record<string, string> = {
  SIMULADOR: 'Simulador', FIPE: 'Tabela FIPE', CONSULTA: 'Consulta', COMPARAR: 'Comparador', COMBUSTIVEL: 'Etanol ou gasolina', GUIA: 'Guia de veículos',
  CONTATO: 'Fale conosco', PLANOS: 'Planos', LOJISTA: 'Para lojistas', SITE: 'Site', CADASTRO: 'Cadastro', LINK_ADMIN: 'Link da equipe', MANUAL: 'Cadastro manual'
};
const EVENT: Record<string, string> = {
  CREATED: 'Entrou no CRM', VISIT: 'Voltou a deixar contato', STAGE: 'Mudou de etapa', NOTE: 'Anotação', FOLLOWUP: 'Retorno marcado', CONTACT: 'Contato feito', EMAIL: 'E-mail enviado',
  LINK_SENT: 'Link de consulta enviado', LINK_CLICK: 'Abriu o link', LINK_REGISTERED: 'Criou a conta pelo link', LINK_REVOKED: 'Link cancelado', UNSUBSCRIBED: 'Pediu para não receber mais', MERGED: 'Cadastros unidos'
};
const SITE: Record<string, string> = {
  HOME_PAGE_VIEW: 'Abriu a página inicial', SEO_PAGE_VIEW: 'Leu uma página do site', FIPE_PAGE_VIEW: 'Abriu a Tabela FIPE', CTA_CLICKED: 'Clicou em um botão', PLATE_CAPTURED: 'Digitou uma placa',
  FIPE_FORM_SUBMITTED: 'Consultou a FIPE', FIPE_RESULT_VIEWED: 'Viu o resultado da FIPE', FIPE_REPORT_ACTION: 'Baixou o relatório da FIPE', AUTH_VIEWED: 'Abriu entrar/criar conta', AUTH_SUBMITTED: 'Enviou o cadastro',
  ACCOUNT_CREATED: 'Criou a conta', AUTH_SUCCEEDED: 'Entrou na conta', CHECKOUT_QUOTE_VIEWED: 'Viu o valor da consulta', CHECKOUT_STARTED: 'Começou a pagar', PREMIUM_INTEREST: 'Pediu aviso do plano Premium', RISK_INTEREST: 'Pediu aviso do plano Risco'
};
const CHANNEL: Record<string, string> = {
  INSTAGRAM: 'Instagram', FACEBOOK: 'Facebook', GOOGLE: 'Google', TIKTOK: 'TikTok', YOUTUBE: 'YouTube', WHATSAPP: 'WhatsApp', EMAIL: 'E-mail', OUTRA_CAMPANHA: 'Outra campanha',
  INDICACAO: 'Indicação', EQUIPE: 'Link da equipe', SITE: 'Site (direto ou busca)'
};
const PROFILE: Record<string, { label: string; hint: string }> = { ESPORADICO: { label: 'Esporádico', hint: 'Fez 1 consulta ou poucas, espaçadas' }, RECORRENTE: { label: 'Recorrente', hint: 'Consulta sempre: 2+ nos últimos 90 dias ou 4+ no total' } };
const LEVEL: Record<string, { label: string; tone: 'neutral' | 'info' | 'warn' | 'ok' | 'violet' | 'danger'; hint: string }> = {
  BRONZE: { label: 'Bronze', tone: 'neutral', hint: 'Já pagou consulta' }, PRATA: { label: 'Prata', tone: 'info', hint: 'Gastou R$ 100 ou mais' }, OURO: { label: 'Ouro', tone: 'warn', hint: 'Gastou R$ 300 ou mais' }
};
const KIND_LABEL: Record<string, string> = { CLIENTE: 'Cliente', LOJISTA: 'Lojista' };

interface Lead {
  id: string; name: string | null; email: string | null; phone: string | null; kind: 'CLIENTE' | 'LOJISTA'; stage: Stage; source: string; interest: string | null; tags: string[];
  marketingConsent: boolean; unsubscribed: boolean; userId: string | null; ownerId: string | null; firstSeenAt: string; lastSeenAt: string; lastContactAt: string | null; nextContactAt: string | null; createdAt: string;
  queries?: number; spentCents?: number; lastQueryAt?: string | null; products?: string[]; profile?: 'ESPORADICO' | 'RECORRENTE' | null; level?: 'BRONZE' | 'PRATA' | 'OURO' | null;
  origin?: { channel: string; campaign: string | null };
}
interface Summary { stages: Record<Stage, number>; sources: Array<{ source: string; n: number }>; total: number; new7: number; consented: number; followups: number; stale: number; links: { total: number; clicks: number; registered: number }; channels?: Array<{ channel: string; n: number }>; profiles?: Record<string, number>; levels?: Record<string, number>; siteUrl?: string }
interface ListRes { total: number; leads: Lead[] }
interface LinkRow { id: string; code: string; url: string; kind: string; productId: string | null; plate: string | null; channel: string; expiresAt: string; revoked: boolean; expired: boolean; clicks: number; lastClickAt: string | null; registeredAt: string | null; createdAt: string; sender: string | null; lead: { id: string; name: string | null; email: string | null; phone: string | null } | null }
interface Detail {
  lead: Lead & { notes: string; utm: Record<string, string>; consentAt: string | null };
  account: { queries: number; spentCents: number; lastQueryAt: string | null; products: string[]; profile: 'ESPORADICO' | 'RECORRENTE' | null; level: 'BRONZE' | 'PRATA' | 'OURO' | null } | null;
  events: Array<{ id: number; kind: string; detail: Record<string, unknown>; actor: string | null; at: string }>;
  site: Array<{ type: string; path: string | null; at: string }>;
  links: Array<{ id: string; code: string; url: string; kind: string; productId: string | null; channel: string; expiresAt: string; revoked: boolean; clicks: number; lastClickAt: string | null; registeredAt: string | null; createdAt: string }>;
}

const who = (l: { name: string | null; email: string | null; phone: string | null }) => l.name || l.email || (l.phone ? maskPhone(l.phone) : 'Sem nome');
const waDigits = (phone: string) => `55${phone.replace(/\D/g, '')}`;
const waUrl = (phone: string, text: string) => `https://wa.me/${waDigits(phone)}?text=${encodeURIComponent(text)}`;
const StageBadge = ({ stage }: { stage: Stage }) => <Badge tone={STAGE[stage].tone} dot>{STAGE[stage].label}</Badge>;

type Tab = 'esteira' | 'lista' | 'links' | 'convites';

/** CRM: leads que vêm do site (simulador, FIPE, contato…), esteira por etapa, links de consulta enviados pela equipe e convites. */
export default function Leads() {
  usePageTitle('Leads e CRM');
  const { can } = useAdminSession();
  const [params, setParams] = useSearchParams();
  const tab = (['esteira', 'lista', 'links', 'convites'].includes(params.get('aba') ?? '') ? params.get('aba') : 'esteira') as Tab;
  const setTab = (t: Tab, extra: Record<string, string> = {}) => setParams({ aba: t, ...extra }, { replace: false });
  const [openId, setOpenId] = useState<string | null>(null);
  const [linkFor, setLinkFor] = useState<{ lead?: Lead } | null>(null);
  const [campaign, setCampaign] = useState(false);
  const [tracked, setTracked] = useState(false);
  const [creating, setCreating] = useState(false);
  const [tick, setTick] = useState(0);
  const reload = () => setTick((t) => t + 1);
  const toast = useToast();
  const manage = can('MANAGE_CUSTOMERS');
  const sum = useAsync(() => api.get<Summary>('/admin/crm/summary'), [tick]);

  async function exportAudience() {
    try { await api.download('/admin/crm/export/audience', 'publico-anuncios.csv'); toast.ok('Lista gerada. Só tem quem aceitou receber mensagens, com e-mail e telefone embaralhados.'); } catch (e) { toast.error(errorMessage(e)); }
  }
  async function exportAll() {
    try { await api.download('/admin/crm/export', 'leads.csv'); } catch (e) { toast.error(errorMessage(e)); }
  }

  const s = sum.data;
  return (
    <>
      <PageHead title="Leads e CRM" sub="Quem chega pelo site (simulador, FIPE, contato…) e quem recebe link da equipe fica aqui, por etapa, com tudo o que fez no site. Mensagens de marketing só para quem aceitou."
        actions={manage ? <>
          <Button icon="link" variant="primary" onClick={() => setLinkFor({})}>Enviar link de consulta</Button>
          <Button icon="mail" onClick={() => setCampaign(true)}>Enviar e-mail de conteúdo</Button>
          <Button icon="link" onClick={() => setTracked(true)}>Link rastreado (campanha)</Button>
          <Button icon="plus" onClick={() => setCreating(true)}>Novo contato</Button>
        </> : undefined} />
      {s && (
        <div className="adm-grid-4 tight">
          <Kpi label="Contatos" value={s.total} sub={`${s.new7} novos em 7 dias`} />
          <Kpi label="Aceitaram receber mensagens" value={s.consented} tone="ok" sub={s.total ? `${Math.round((s.consented / s.total) * 100)}% dos contatos` : undefined} />
          <Kpi label="Retornos para hoje" value={s.followups} tone={s.followups ? 'warn' : undefined} />
          <Kpi label="Parados há 7+ dias" value={s.stale} tone={s.stale ? 'warn' : undefined} sub="sem contato nenhum" />
          <Kpi label="Links enviados" value={s.links.total} sub={`${s.links.clicks} aberturas · ${s.links.registered} cadastros`} />
        </div>
      )}
      {s && ((s.channels?.length ?? 0) > 0 || s.profiles) && (
        <Card title="De onde vêm e como consomem">
          <div className="stack-sm">
            {(s.channels?.length ?? 0) > 0 && <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}><span className="muted">Origem:</span>{s.channels!.map((c) => <Badge key={c.channel}>{CHANNEL[c.channel] ?? c.channel} · {c.n}</Badge>)}</div>}
            {s.profiles && <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}><span className="muted">Clientes:</span><Badge tone="ok">{PROFILE.ESPORADICO!.label} · {s.profiles.ESPORADICO ?? 0}</Badge><Badge tone="ok">{PROFILE.RECORRENTE!.label} · {s.profiles.RECORRENTE ?? 0}</Badge>{(['BRONZE', 'PRATA', 'OURO'] as const).map((k) => <Badge key={k} tone={LEVEL[k]!.tone}>{LEVEL[k]!.label} · {s.levels?.[k] ?? 0}</Badge>)}</div>}
            <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>A origem vem das marcações do link (utm). Para saber quem veio do Instagram ou de um anúncio, use “Link rastreado (campanha)” nas suas postagens e anúncios. Tipo e nível mudam sozinhos pelo consumo: só conta consulta paga e concluída (estornada e consulta interna não contam).</p>
          </div>
        </Card>
      )}
      <Tabs<Tab> label="Seções do CRM" value={tab} onChange={(t) => setTab(t)} items={[{ id: 'esteira', label: 'Esteira' }, { id: 'lista', label: 'Todos os contatos' }, { id: 'links', label: 'Links enviados' }, { id: 'convites', label: 'Convites' }]} />
      {tab === 'esteira' && <Board tick={tick} manage={manage} onOpen={setOpenId} onAll={(col) => setTab('lista', { etapa: col.stage, ...(col.profile ? { perfil: col.profile } : {}) })} onMoved={reload} />}
      {tab === 'lista' && <List tick={tick} initialStage={(params.get('etapa') as Stage) || ''} initialProfile={params.get('perfil') ?? ''} sources={s?.sources ?? []} channels={s?.channels ?? []} manage={manage} onOpen={setOpenId} onChanged={reload} onExport={exportAll} onAudience={exportAudience} />}
      {tab === 'links' && <Links tick={tick} manage={manage} onOpen={setOpenId} onChanged={reload} />}
      {tab === 'convites' && <Invites embedded />}
      {openId && <LeadModal id={openId} manage={manage} onClose={() => setOpenId(null)} onChanged={reload} onLink={(lead) => { setOpenId(null); setLinkFor({ lead }); }} />}
      {linkFor && <LinkModal lead={linkFor.lead} onClose={() => setLinkFor(null)} onDone={reload} />}
      {tracked && <TrackedLinkModal siteUrl={s?.siteUrl} onClose={() => setTracked(false)} />}
      {campaign && <CampaignModal onClose={() => setCampaign(false)} onDone={reload} />}
      {creating && <NewLeadModal onClose={() => setCreating(false)} onDone={(id) => { reload(); setOpenId(id); }} />}
    </>
  );
}

/* ------------------------------------------------------------------ esteira */
interface Col { id: string; stage: Stage; profile?: 'ESPORADICO' | 'RECORRENTE'; label: string; hint: string; auto?: boolean }
/** Colunas do quadro. As de cliente são automáticas: a pessoa sobe sozinha quando faz consulta paga e o tipo vem do consumo. */
const COLS: Col[] = [
  { id: 'NOVO', stage: 'NOVO', label: STAGE.NOVO.label, hint: STAGE.NOVO.hint },
  { id: 'CONTATADO', stage: 'CONTATADO', label: STAGE.CONTATADO.label, hint: STAGE.CONTATADO.hint },
  { id: 'INTERESSADO', stage: 'INTERESSADO', label: STAGE.INTERESSADO.label, hint: STAGE.INTERESSADO.hint },
  { id: 'CADASTRADO', stage: 'CADASTRADO', label: STAGE.CADASTRADO.label, hint: STAGE.CADASTRADO.hint, auto: true },
  { id: 'CLIENTE_ESPORADICO', stage: 'CLIENTE', profile: 'ESPORADICO', label: 'Cliente esporádico', hint: 'Já consultou. ' + PROFILE.ESPORADICO!.hint, auto: true },
  { id: 'CLIENTE_RECORRENTE', stage: 'CLIENTE', profile: 'RECORRENTE', label: 'Cliente recorrente', hint: PROFILE.RECORRENTE!.hint, auto: true },
  { id: 'PERDIDO', stage: 'PERDIDO', label: STAGE.PERDIDO.label, hint: STAGE.PERDIDO.hint }
];

/** Quadro estilo Kanban: arraste o cartão para outra coluna (ou use “Mover para” no celular). Cliente e Cadastrado se movem sozinhos pelo que a pessoa faz. */
function Board({ tick, manage, onOpen, onAll, onMoved }: { tick: number; manage: boolean; onOpen: (id: string) => void; onAll: (c: Col) => void; onMoved: () => void }) {
  const toast = useToast();
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const cols = useAsync(async () => {
    const out = await Promise.all(COLS.map((c) => api.get<ListRes>('/admin/crm/leads', { query: { stage: c.stage, ...(c.profile === 'RECORRENTE' ? { profile: 'RECORRENTE' } : c.profile === 'ESPORADICO' ? { notprofile: 'RECORRENTE' } : {}), limit: 12 } })));
    return Object.fromEntries(COLS.map((c, i) => [c.id, out[i]!])) as Record<string, ListRes>;
  }, [tick]);
  if (cols.loading && !cols.data) return <PageLoading />;
  if (cols.error || !cols.data) return <ErrorState error={cols.error} onRetry={cols.reload} />;
  const all = Object.values(cols.data).flatMap((c) => c.leads);
  async function move(leadId: string, target: Col) {
    const lead = all.find((l) => l.id === leadId);
    if (!lead) return;
    if (lead.stage === target.stage && (!target.profile || lead.profile === target.profile || (target.profile === 'ESPORADICO' && lead.profile !== 'RECORRENTE'))) return;
    if (lead.stage === 'CLIENTE') return void toast.error('Quem já é cliente fica nas colunas de cliente. O tipo muda sozinho pelo consumo.');
    if (target.stage === 'CLIENTE') return void toast.error('Cliente é definido pelo consumo: a pessoa sobe sozinha quando faz a primeira consulta paga.');
    if (target.stage === 'CADASTRADO' && !lead.userId) return void toast.error('Cadastrado é quem criou a conta. A pessoa sobe sozinha quando criar.');
    try { await api.patch(`/admin/crm/leads/${leadId}`, { stage: target.stage }); toast.ok(`Movido para “${target.label}”.`); onMoved(); } catch (e) { toast.error(errorMessage(e)); }
  }
  const movable = (l: Lead) => manage && l.stage !== 'CLIENTE';
  return (
    <div className="crm-board" aria-label="Quadro de contatos por etapa">
      {COLS.map((c) => {
        const col = cols.data![c.id]!;
        return (
          <section key={c.id} className={`crm-col${over === c.id ? ' crm-over' : ''}`} aria-label={c.label}
            onDragOver={(e) => { if (drag) { e.preventDefault(); setOver(c.id); } }} onDragLeave={() => setOver((o) => (o === c.id ? null : o))}
            onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain') || drag; setOver(null); setDrag(null); if (id) void move(id, c); }}>
            <header><b>{c.label}</b><span className="num">{col.total}</span></header>
            <p className="muted" style={{ fontSize: 12 }}>{c.hint}</p>
            {col.leads.map((l) => (
              <div key={l.id} className={`crm-card${drag === l.id ? ' crm-dragging' : ''}`} draggable={movable(l)}
                onDragStart={(e) => { setDrag(l.id); e.dataTransfer.setData('text/plain', l.id); e.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { setDrag(null); setOver(null); }}>
                <button type="button" className="crm-card-body" onClick={() => onOpen(l.id)}>
                  <b>{who(l)}</b>
                  <span className="muted">{CHANNEL[l.origin?.channel ?? 'SITE'] ?? l.origin?.channel}{l.origin?.campaign ? ` · ${l.origin.campaign}` : ''}</span>
                  <span className="muted">{SOURCE[l.source] ?? l.source}{l.kind === 'LOJISTA' ? ' · Lojista' : ''}</span>
                  {l.stage === 'CLIENTE' && (
                    <>
                      <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>{l.level && <Badge tone={LEVEL[l.level]!.tone}>{LEVEL[l.level]!.label}</Badge>}{l.profile && <Badge tone="ok">{PROFILE[l.profile]!.label}</Badge>}</span>
                      <span className="muted">{l.queries ?? 0} consulta(s) · {money(l.spentCents ?? 0)}</span>
                      {(l.products?.length ?? 0) > 0 && <span className="muted">{l.products!.slice(0, 2).join(', ')}{l.products!.length > 2 ? ` +${l.products!.length - 2}` : ''}</span>}
                    </>
                  )}
                  <span className="muted">{relativeTime(l.lastSeenAt)}{l.nextContactAt && new Date(l.nextContactAt) <= new Date() ? ' · retornar' : ''}</span>
                </button>
                {movable(l) && (
                  <select className="crm-move" aria-label={`Mover ${who(l)} para`} value="" onChange={(e) => { const t = COLS.find((x) => x.id === e.target.value); if (t) void move(l.id, t); }}>
                    <option value="">Mover para…</option>{COLS.filter((x) => x.id !== c.id && !x.profile).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </select>
                )}
              </div>
            ))}
            {!col.leads.length && <span className="muted" style={{ fontSize: 13 }}>Ninguém aqui.</span>}
            {col.total > col.leads.length && <Button variant="ghost" size="sm" onClick={() => onAll(c)}>Ver todos ({col.total})</Button>}
          </section>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ lista */
function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
const PAGE = 50;
function List({ tick, initialStage, initialProfile, sources, channels, manage, onOpen, onChanged, onExport, onAudience }: { tick: number; initialStage: Stage | ''; initialProfile: string; sources: Array<{ source: string; n: number }>; channels: Array<{ channel: string; n: number }>; manage: boolean; onOpen: (id: string) => void; onChanged: () => void; onExport: () => void; onAudience: () => void }) {
  const [q, setQ] = useState(''); const [stage, setStage] = useState<Stage | ''>(initialStage); const [kind, setKind] = useState(''); const [source, setSource] = useState(''); const [channel, setChannel] = useState(''); const [profile, setProfile] = useState(initialProfile); const [level, setLevel] = useState('');
  const [flag, setFlag] = useState(''); const [offset, setOffset] = useState(0); const [sel, setSel] = useState<string[]>([]);
  const [bulkStage, setBulkStage] = useState<Stage | ''>(''); const [bulkTag, setBulkTag] = useState('');
  const toast = useToast();
  const dq = useDebounced(q);
  const query = { q: dq, stage, kind, source, channel, profile, level, consent: flag === 'consent' ? '1' : '', followup: flag === 'followup' ? '1' : '', stale: flag === 'stale' ? '1' : '', limit: PAGE, offset };
  const res = useAsync(() => api.get<ListRes>('/admin/crm/leads', { query }), [dq, stage, kind, source, channel, profile, level, flag, offset, tick]);
  useEffect(() => { setOffset(0); setSel([]); }, [dq, stage, kind, source, channel, profile, level, flag]);
  const rows = res.data?.leads ?? [];
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  async function bulk() {
    try {
      await api.post('/admin/crm/leads/bulk', { ids: sel, ...(bulkStage ? { stage: bulkStage } : {}), ...(bulkTag.trim() ? { addTag: bulkTag.trim().toLowerCase() } : {}) });
      toast.ok('Contatos atualizados.'); setSel([]); setBulkStage(''); setBulkTag(''); onChanged();
    } catch (e) { toast.error(errorMessage(e)); }
  }
  return (
    <>
      <div className="toolbar">
        <div className="grow"><Input icon="search" placeholder="Buscar por nome, e-mail ou telefone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar" /></div>
        <Select value={stage} onChange={(e) => setStage(e.target.value as Stage | '')} aria-label="Etapa"><option value="">Todas as etapas</option>{STAGES.map((s) => <option key={s} value={s}>{STAGE[s].label}</option>)}</Select>
        <Select value={channel} onChange={(e) => setChannel(e.target.value)} aria-label="Canal de origem"><option value="">Todos os canais</option>{channels.map((c) => <option key={c.channel} value={c.channel}>{CHANNEL[c.channel] ?? c.channel} ({c.n})</option>)}</Select>
        <Select value={profile} onChange={(e) => setProfile(e.target.value)} aria-label="Tipo de cliente"><option value="">Qualquer consumo</option><option value="ESPORADICO">Cliente esporádico</option><option value="RECORRENTE">Cliente recorrente</option></Select>
        <Select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Nível"><option value="">Qualquer nível</option>{Object.entries(LEVEL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select>
        <Select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Ferramenta do site"><option value="">Todas as ferramentas</option>{sources.map((s) => <option key={s.source} value={s.source}>{SOURCE[s.source] ?? s.source} ({s.n})</option>)}</Select>
        <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Tipo"><option value="">Cliente e lojista</option><option value="CLIENTE">Só clientes</option><option value="LOJISTA">Só lojistas</option></Select>
        <Select value={flag} onChange={(e) => setFlag(e.target.value)} aria-label="Situação"><option value="">Qualquer situação</option><option value="consent">Aceitaram mensagens</option><option value="followup">Retorno vencido</option><option value="stale">Parados há 7+ dias</option></Select>
        {manage && <Button icon="download" onClick={onExport}>Planilha</Button>}
      </div>
      {manage && sel.length > 0 && (
        <div className="toolbar" role="group" aria-label="Ação em vários contatos">
          <b>{sel.length} selecionado(s)</b>
          <Select value={bulkStage} onChange={(e) => setBulkStage(e.target.value as Stage | '')} aria-label="Nova etapa"><option value="">Mudar etapa…</option>{STAGES.map((s) => <option key={s} value={s}>{STAGE[s].label}</option>)}</Select>
          <Input placeholder="Adicionar etiqueta" value={bulkTag} onChange={(e) => setBulkTag(e.target.value)} aria-label="Etiqueta" style={{ maxWidth: 180 }} />
          <Button variant="primary" disabled={!bulkStage && !bulkTag.trim()} onClick={() => void bulk()}>Aplicar</Button>
          <Button variant="ghost" onClick={() => setSel([])}>Limpar</Button>
        </div>
      )}
      {res.loading && !res.data ? <PageLoading /> : res.error ? <ErrorState error={res.error} onRetry={res.reload} /> : !rows.length ? <EmptyState icon="users" title="Nenhum contato neste filtro">Quando alguém deixar o contato no simulador, na FIPE ou no fale conosco, aparece aqui.</EmptyState> : (
        <Card pad={false}>
          <div className="table-wrap"><table className="table">
            <thead><tr>{manage && <th style={{ width: 32 }}><span className="sr-only">Selecionar</span></th>}<th>Contato</th><th>Etapa</th><th>Origem</th><th>Mensagens</th><th>Último movimento</th><th>Consumo</th></tr></thead>
            <tbody>{rows.map((l) => (
              <tr key={l.id}>
                {manage && <td><input type="checkbox" checked={sel.includes(l.id)} onChange={() => toggle(l.id)} aria-label={`Selecionar ${who(l)}`} /></td>}
                <td><button type="button" className="linkbtn" onClick={() => onOpen(l.id)}>{who(l)}</button><div className="muted" style={{ fontSize: 12.5 }}>{l.email ?? ''}{l.email && l.phone ? ' · ' : ''}{l.phone ? maskPhone(l.phone) : ''}</div>{l.tags.length > 0 && <div>{l.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>}</td>
                <td><StageBadge stage={l.stage} />{l.kind === 'LOJISTA' && <> <Badge tone="info">Lojista</Badge></>}</td>
                <td>{CHANNEL[l.origin?.channel ?? 'SITE'] ?? l.origin?.channel}{l.origin?.campaign ? <span className="muted"> · {l.origin.campaign}</span> : null}<div className="muted" style={{ fontSize: 12.5 }}>{SOURCE[l.source] ?? l.source}{l.interest ? ` · ${l.interest}` : ''}</div></td>
                <td>{l.unsubscribed ? <Badge tone="danger">Pediu para sair</Badge> : l.marketingConsent ? <Badge tone="ok">Aceitou</Badge> : <Badge>Não aceitou</Badge>}</td>
                <td>{relativeTime(l.lastSeenAt)}{l.nextContactAt && <div className="muted" style={{ fontSize: 12.5 }}>retorno {dateTime(l.nextContactAt)}</div>}</td>
                <td>{l.userId ? <>{(l.queries ?? 0) > 0 ? <><span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>{l.level && <Badge tone={LEVEL[l.level]!.tone}>{LEVEL[l.level]!.label}</Badge>}{l.profile && <Badge tone="ok">{PROFILE[l.profile]!.label}</Badge>}</span><div className="muted" style={{ fontSize: 12.5 }}>{l.queries} consulta(s) · {money(l.spentCents ?? 0)}</div>{(l.products?.length ?? 0) > 0 && <div className="muted" style={{ fontSize: 12.5 }}>{l.products!.join(', ')}</div>}</> : <span className="muted">Sem consulta paga</span>}</> : '—'}</td>
              </tr>
            ))}</tbody>
          </table></div>
          <div className="row-between" style={{ padding: '10px 14px' }}>
            <span className="muted">{res.data!.total} contato(s)</span>
            <span className="row"><Button size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Anterior</Button><Button size="sm" disabled={offset + PAGE >= res.data!.total} onClick={() => setOffset(offset + PAGE)}>Próxima</Button></span>
          </div>
        </Card>
      )}
      {manage && (
        <Alert tone="info" icon="info" title="Anúncios e público semelhante">
          <span>Gera uma lista só com quem aceitou receber mensagens, com e-mail e telefone embaralhados (SHA-256), no formato que Meta e Google aceitam para público semelhante e remarketing. </span>
          <Button size="sm" icon="download" onClick={onAudience}>Baixar lista para anúncios</Button>
        </Alert>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ links enviados */
function Links({ tick, manage, onOpen, onChanged }: { tick: number; manage: boolean; onOpen: (id: string) => void; onChanged: () => void }) {
  const res = useAsync(() => api.get<{ links: LinkRow[] }>('/admin/crm/links'), [tick]);
  const [revoke, setRevoke] = useState<LinkRow | null>(null);
  const toast = useToast();
  if (res.loading && !res.data) return <PageLoading />;
  if (res.error || !res.data) return <ErrorState error={res.error} onRetry={res.reload} />;
  const rows = res.data.links;
  if (!rows.length) return <EmptyState icon="link" title="Nenhum link enviado ainda">Use “Enviar link de consulta” para mandar ao cliente ou lojista um link que leva à consulta e cadastra o acesso dele.</EmptyState>;
  return (
    <Card pad={false}>
      <div className="table-wrap"><table className="table">
        <thead><tr><th>Enviado</th><th>Para</th><th>Consulta</th><th>Situação</th><th className="r">Aberturas</th><th /></tr></thead>
        <tbody>{rows.map((k) => (
          <tr key={k.id}>
            <td>{dateTime(k.createdAt)}<div className="muted" style={{ fontSize: 12.5 }}>{k.sender ?? ''} · {k.channel === 'WHATSAPP' ? 'WhatsApp' : k.channel === 'EMAIL' ? 'E-mail' : 'Copiado'}</div></td>
            <td>{k.lead ? <button type="button" className="linkbtn" onClick={() => onOpen(k.lead!.id)}>{who(k.lead)}</button> : '—'}{k.kind === 'LOJISTA' && <> <Badge tone="info">Lojista</Badge></>}</td>
            <td>{k.productId ?? 'A escolher'}{k.plate ? <div className="muted" style={{ fontSize: 12.5 }}>placa {k.plate}</div> : null}</td>
            <td>{k.registeredAt ? <Badge tone="ok" dot>Criou a conta</Badge> : k.revoked ? <Badge tone="danger">Cancelado</Badge> : k.expired ? <Badge>Venceu</Badge> : k.clicks ? <Badge tone="warn" dot>Abriu</Badge> : <Badge tone="info" dot>Aguardando</Badge>}</td>
            <td className="r">{k.clicks}{k.lastClickAt ? <div className="muted" style={{ fontSize: 12.5 }}>{relativeTime(k.lastClickAt)}</div> : null}</td>
            <td className="r"><span className="row" style={{ justifyContent: 'flex-end' }}>
              <Button size="sm" icon="copy" onClick={async () => { try { await navigator.clipboard.writeText(k.url); toast.ok('Link copiado.'); } catch { toast.error('Não foi possível copiar.'); } }}>Copiar</Button>
              {manage && !k.revoked && !k.registeredAt && <Button size="sm" variant="ghost" onClick={() => setRevoke(k)}>Cancelar</Button>}
            </span></td>
          </tr>
        ))}</tbody>
      </table></div>
      {revoke && <ConfirmDialog title="Cancelar este link?" danger confirmLabel="Cancelar link" message={<p>Quem abrir o link não conseguirá mais usá-lo. Quem já criou conta por ele não é afetado.</p>} onClose={() => setRevoke(null)}
        onConfirm={async () => { try { await api.post(`/admin/crm/links/${revoke.id}/revoke`, {}); toast.ok('Link cancelado.'); onChanged(); } catch (e) { toast.error(errorMessage(e)); throw e; } }} />}
    </Card>
  );
}

/* ------------------------------------------------------------------ enviar link */
export function LinkModal({ lead, productId, onClose, onDone }: { lead?: Lead; productId?: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const products = useAsync(() => api.get<Array<{ id: string; name: string; isFree?: boolean; active: boolean }>>('/admin/products'));
  const [kind, setKind] = useState<'CLIENTE' | 'LOJISTA'>(lead?.kind ?? 'CLIENTE');
  const [name, setName] = useState(lead?.name ?? ''); const [phone, setPhone] = useState(lead?.phone ? maskPhone(lead.phone) : ''); const [email, setEmail] = useState(lead?.email ?? '');
  const [product, setProduct] = useState(productId ?? ''); const [plate, setPlate] = useState(''); const [days, setDays] = useState('14');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ url: string; text: string; whatsappUrl: string | null; emailSent: boolean } | null>(null);
  const hasContact = Boolean(lead) || email.includes('@') || phone.replace(/\D/g, '').length >= 10;
  async function make(channel: 'COPIA' | 'WHATSAPP' | 'EMAIL') {
    setBusy(true);
    try {
      const body = { ...(lead ? { leadId: lead.id } : { name: name.trim() || undefined, email: email.trim() || undefined, phone: phone.trim() || undefined }), kind, productId: product || undefined, plate: plate.trim() || undefined, days: Number(days) || 14, channel };
      const r = await api.post<{ url: string; text: string; whatsappUrl: string | null; emailSent: boolean }>('/admin/crm/links', body);
      setOut(r); onDone();
      if (channel === 'EMAIL') toast.ok('E-mail na fila de envio.');
      if (channel === 'WHATSAPP' && r.whatsappUrl) window.open(r.whatsappUrl, '_blank', 'noopener');
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title="Enviar link de consulta" wide onClose={onClose} footer={out ? <Button variant="primary" onClick={onClose}>Fechar</Button> : <Button variant="ghost" onClick={onClose}>Cancelar</Button>}>
      {out ? (
        <div className="stack">
          <Alert tone="ok" icon="check" title="Link criado">Quem abrir vai criar o acesso e fazer a consulta. Você acompanha as aberturas e o cadastro na aba “Links enviados”.</Alert>
          <CopyField value={out.url} label="Link" />
          <Field label="Mensagem pronta"><Textarea rows={4} readOnly value={out.text} onFocus={(e) => e.currentTarget.select()} /></Field>
          <div className="row">
            {out.whatsappUrl && <Button icon="message-circle" onClick={() => window.open(out.whatsappUrl!, '_blank', 'noopener')}>Abrir WhatsApp</Button>}
            {out.emailSent && <Badge tone="ok">E-mail enviado</Badge>}
          </div>
        </div>
      ) : (
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>O link leva a pessoa ao site, ela cria o acesso e faz a consulta. O cadastro fica ligado a você em Convites e ao contato no CRM.</p>
          <div className="seg" role="group" aria-label="Para quem"><Button variant={kind === 'CLIENTE' ? 'primary' : 'ghost'} onClick={() => setKind('CLIENTE')}>Cliente</Button><Button variant={kind === 'LOJISTA' ? 'primary' : 'ghost'} onClick={() => setKind('LOJISTA')}>Lojista</Button></div>
          {lead ? <Alert tone="info" icon="users" title={who(lead)}>{[lead.email, lead.phone ? maskPhone(lead.phone) : null].filter(Boolean).join(' · ')}</Alert> : (
            <div className="form-grid cols-2">
              <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
              <Field label="WhatsApp (com DDD)"><Input value={phone} onChange={(e) => setPhone(maskPhone(e.target.value))} inputMode="tel" placeholder="(61) 99999-9999" /></Field>
              <Field label="E-mail" className="span-all"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            </div>
          )}
          <div className="form-grid cols-2">
            <Field label="Consulta (opcional)" hint="Se escolher, já abre nesta consulta."><Select value={product} onChange={(e) => setProduct(e.target.value)}><option value="">A pessoa escolhe</option>{(products.data ?? []).filter((p) => p.active && !p.isFree).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
            <Field label="Placa (opcional)"><Input value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7))} placeholder="ABC1D23" /></Field>
            <Field label="Validade do link"><Select value={days} onChange={(e) => setDays(e.target.value)}><option value="3">3 dias</option><option value="7">7 dias</option><option value="14">14 dias</option><option value="30">30 dias</option><option value="90">90 dias</option></Select></Field>
          </div>
          <div className="row">
            <Button variant="primary" icon="message-circle" loading={busy} disabled={!hasContact || (!lead && phone.replace(/\D/g, '').length < 10)} onClick={() => void make('WHATSAPP')}>Gerar e abrir WhatsApp</Button>
            <Button icon="mail" loading={busy} disabled={!hasContact || (!lead && !email.includes('@')) || Boolean(lead && !lead.email) || Boolean(lead?.unsubscribed)} onClick={() => void make('EMAIL')}>Enviar por e-mail</Button>
            <Button icon="copy" loading={busy} disabled={!hasContact} onClick={() => void make('COPIA')}>Só gerar o link</Button>
          </div>
          {lead?.unsubscribed && <Alert tone="warn" icon="alert-triangle">Esta pessoa pediu para não receber mais e-mails. Use WhatsApp ou copie o link.</Alert>}
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ link rastreado */
const TRACK_PAGES = [{ path: '/', label: 'Página inicial' }, { path: '/fipe', label: 'Tabela FIPE grátis' }, { path: '/simulador', label: 'Simulador de financiamento' }, { path: '/consultar', label: 'Consultar uma placa' }, { path: '/planos', label: 'Consultas e preços' }, { path: '/veiculos', label: 'Guia de veículos' }, { path: '/lojistas', label: 'Para lojistas' }];
const TRACK_CHANNELS = [
  { id: 'ig_bio', label: 'Instagram — link da bio', source: 'instagram', medium: 'bio' }, { id: 'ig_story', label: 'Instagram — stories ou post', source: 'instagram', medium: 'social' },
  { id: 'ig_ads', label: 'Instagram — anúncio pago', source: 'instagram', medium: 'cpc' }, { id: 'fb_ads', label: 'Facebook — anúncio pago', source: 'facebook', medium: 'cpc' },
  { id: 'fb_post', label: 'Facebook — post ou grupo', source: 'facebook', medium: 'social' }, { id: 'google_ads', label: 'Google Ads', source: 'google', medium: 'cpc' },
  { id: 'wa', label: 'WhatsApp (lista, grupo ou status)', source: 'whatsapp', medium: 'message' }, { id: 'email', label: 'E-mail', source: 'email', medium: 'email' },
  { id: 'yt', label: 'YouTube', source: 'youtube', medium: 'video' }, { id: 'tt', label: 'TikTok', source: 'tiktok', medium: 'social' }
];
/** Gera o endereço do site com as marcações (utm) de onde a pessoa vem. Quem deixar contato ou criar conta por esse link entra no CRM já com a origem e a campanha. Não grava nada no servidor. */
function TrackedLinkModal({ siteUrl, onClose }: { siteUrl?: string; onClose: () => void }) {
  const [path, setPath] = useState('/'); const [ch, setCh] = useState('ig_bio'); const [campaign, setCampaign] = useState('');
  const c = TRACK_CHANNELS.find((x) => x.id === ch)!;
  const slug = campaign.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  let url = '';
  try { const u = new URL(path, siteUrl || window.location.origin); u.searchParams.set('utm_source', c.source); u.searchParams.set('utm_medium', c.medium); if (slug) u.searchParams.set('utm_campaign', slug); url = u.toString(); } catch { url = ''; }
  return (
    <Modal title="Link rastreado (campanha)" onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Fechar</Button>}>
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>Use este link na bio, nos stories, nos anúncios e nas mensagens. Quem deixar contato ou criar conta por ele aparece no CRM com a origem (Instagram, Google…) e o nome da campanha.</p>
        <div className="form-grid cols-2">
          <Field label="Para onde o link leva"><Select value={path} onChange={(e) => setPath(e.target.value)}>{TRACK_PAGES.map((p) => <option key={p.path} value={p.path}>{p.label}</option>)}</Select></Field>
          <Field label="Onde você vai colocar"><Select value={ch} onChange={(e) => setCh(e.target.value)}>{TRACK_CHANNELS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</Select></Field>
          <Field label="Nome da campanha (opcional)" hint="Ex.: black friday, simulador novembro." className="span-all"><Input value={campaign} onChange={(e) => setCampaign(e.target.value)} maxLength={60} /></Field>
        </div>
        {url && <CopyField value={url} label="Link para usar" />}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ e-mail de conteúdo */
const CTA = [{ path: '', label: 'Sem botão' }, { path: '/fipe', label: 'Tabela FIPE grátis' }, { path: '/simulador', label: 'Simulador de financiamento' }, { path: '/consultar', label: 'Consultar uma placa' }, { path: '/planos', label: 'Consultas e preços' }, { path: '/veiculos', label: 'Guia de veículos' }, { path: '/blog', label: 'Blog' }];
function CampaignModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [stage, setStage] = useState<Stage | ''>(''); const [kind, setKind] = useState(''); const [tag, setTag] = useState('');
  const [subject, setSubject] = useState(''); const [message, setMessage] = useState(''); const [cta, setCta] = useState('/fipe'); const [label, setLabel] = useState('Abrir');
  const [count, setCount] = useState<{ n: number; capped: boolean } | null>(null); const [busy, setBusy] = useState(false); const [confirm, setConfirm] = useState(false);
  const filters = { ...(stage ? { stage } : {}), ...(kind ? { kind } : {}), ...(tag.trim() ? { tag: tag.trim().toLowerCase() } : {}) };
  const body = { ...filters, subject: subject.trim(), message: message.trim(), ...(cta ? { ctaPath: cta, ctaLabel: label.trim() || 'Abrir' } : {}) };
  useEffect(() => {
    let alive = true; setCount(null);
    api.post<{ recipients: number; capped: boolean }>('/admin/crm/campaign', { ...body, subject: 'Prévia', message: 'Prévia da contagem de destinatários.', dryRun: true }).then((r) => { if (alive) setCount({ n: r.recipients, capped: r.capped }); }, () => undefined);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, kind, tag]);
  const valid = subject.trim().length >= 2 && message.trim().length >= 10 && (count?.n ?? 0) > 0;
  async function send() {
    setBusy(true);
    try { const r = await api.post<{ queued: number; recipients: number }>('/admin/crm/campaign', body); toast.ok(`${r.queued} e-mail(s) na fila de envio.`); onDone(); onClose(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title="Enviar e-mail de conteúdo" wide onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" icon="send" disabled={!valid} onClick={() => setConfirm(true)}>Enviar</Button></>}>
      <div className="stack">
        <Alert tone="info" icon="shield-check" title="Só quem aceitou">O envio vai apenas para quem marcou que aceita receber mensagens e não pediu para sair. Todo e-mail leva o link “Não quero mais receber”.</Alert>
        <div className="form-grid cols-3">
          <Field label="Etapa"><Select value={stage} onChange={(e) => setStage(e.target.value as Stage | '')}><option value="">Todas (menos perdidos)</option>{STAGES.filter((s) => s !== 'PERDIDO').map((s) => <option key={s} value={s}>{STAGE[s].label}</option>)}</Select></Field>
          <Field label="Tipo"><Select value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Cliente e lojista</option><option value="CLIENTE">Clientes</option><option value="LOJISTA">Lojistas</option></Select></Field>
          <Field label="Etiqueta (opcional)"><Input value={tag} onChange={(e) => setTag(e.target.value)} maxLength={30} /></Field>
        </div>
        <p style={{ margin: 0 }}>{count === null ? 'Contando…' : <><b>{count.n}</b> pessoa(s) vão receber{count.capped ? ' (limite de 500 por envio)' : ''}.</>}</p>
        <Field label="Assunto"><Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} placeholder="Quanto vale o seu carro hoje?" /></Field>
        <Field label="Mensagem" hint="O nome da pessoa entra na saudação automaticamente."><Textarea rows={6} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={3000} /></Field>
        <div className="form-grid cols-2">
          <Field label="Botão leva para"><Select value={cta} onChange={(e) => setCta(e.target.value)}>{CTA.map((c) => <option key={c.path} value={c.path}>{c.label}</option>)}</Select></Field>
          {cta && <Field label="Texto do botão"><Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} /></Field>}
        </div>
      </div>
      {confirm && <ConfirmDialog title="Enviar agora?" confirmLabel={`Enviar para ${count?.n ?? 0}`} message={<p>O e-mail “{subject.trim()}” vai para {count?.n ?? 0} pessoa(s). Não dá para desfazer.</p>} onClose={() => setConfirm(false)} onConfirm={async () => { await send(); }} />}
      {busy && <PageLoading />}
    </Modal>
  );
}

/* ------------------------------------------------------------------ novo contato */
function NewLeadModal({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: '', email: '', phone: '', kind: 'CLIENTE', interest: '' }); const [busy, setBusy] = useState(false);
  const ok = f.email.includes('@') || f.phone.replace(/\D/g, '').length >= 10;
  async function save() {
    setBusy(true);
    try { const r = await api.post<{ id: string }>('/admin/crm/leads', { name: f.name.trim() || undefined, email: f.email.trim() || undefined, phone: f.phone.trim() || undefined, kind: f.kind, interest: f.interest.trim() || undefined }); toast.ok('Contato salvo.'); onDone(r.id); onClose(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title="Novo contato" onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button variant="primary" loading={busy} disabled={!ok} onClick={() => void save()}>Salvar</Button></>}>
      <div className="stack">
        <div className="form-grid cols-2">
          <Field label="Nome"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} /></Field>
          <Field label="Tipo"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="CLIENTE">Cliente</option><option value="LOJISTA">Lojista</option></Select></Field>
          <Field label="WhatsApp"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: maskPhone(e.target.value) })} inputMode="tel" /></Field>
          <Field label="E-mail"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        </div>
        <Field label="Interesse (opcional)"><Input value={f.interest} onChange={(e) => setF({ ...f, interest: e.target.value })} maxLength={160} /></Field>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>O aceite de receber mensagens de marketing só pode ser dado pela própria pessoa (no site ou no cadastro). Contato criado aqui entra sem esse aceite.</p>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ detalhe do contato */
const WA_TEMPLATES = [
  { id: 'convite', label: 'Convite para consultar', text: (n: string) => `Olá${n ? `, ${n}` : ''}! Aqui é da Placa na Mão. Vi que você mexeu no nosso site. Posso te ajudar a consultar um veículo pela placa antes de fechar negócio?` },
  { id: 'fipe', label: 'Dica da Tabela FIPE', text: (n: string) => `Olá${n ? `, ${n}` : ''}! Aqui é da Placa na Mão. Antes de negociar, vale conferir o valor da Tabela FIPE e a situação do veículo (débitos, restrições e leilão). Se quiser, eu te mando o link.` },
  { id: 'retorno', label: 'Retorno', text: (n: string) => `Olá${n ? `, ${n}` : ''}! Aqui é da Placa na Mão, passando para saber se você conseguiu o que precisava. Qualquer dúvida, é só chamar.` }
];
function LeadModal({ id, manage, onClose, onChanged, onLink }: { id: string; manage: boolean; onClose: () => void; onChanged: () => void; onLink: (l: Lead) => void }) {
  const toast = useToast();
  const res = useAsync(() => api.get<Detail>(`/admin/crm/leads/${id}`), [id]);
  const [f, setF] = useState<{ stage: Stage; name: string; kind: string; tags: string; notes: string; next: string } | null>(null);
  const [busy, setBusy] = useState(false); const [tpl, setTpl] = useState('convite'); const [del, setDel] = useState(false); const [text, setText] = useState('');
  const d = res.data;
  useEffect(() => {
    if (d) setF({ stage: d.lead.stage, name: d.lead.name ?? '', kind: d.lead.kind, tags: d.lead.tags.join(', '), notes: d.lead.notes, next: d.lead.nextContactAt ? new Date(new Date(d.lead.nextContactAt).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '' });
  }, [d]);
  if (res.loading && !d) return <Modal title="Contato" onClose={onClose}><PageLoading /></Modal>;
  if (res.error || !d || !f) return <Modal title="Contato" onClose={onClose}><ErrorState error={res.error} onRetry={res.reload} /></Modal>;
  const l = d.lead;
  async function save() {
    setBusy(true);
    try {
      await api.patch(`/admin/crm/leads/${id}`, { stage: f!.stage, name: f!.name.trim() || null, kind: f!.kind, tags: f!.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean), notes: f!.notes, nextContactAt: f!.next ? new Date(f!.next).toISOString() : null });
      toast.ok('Salvo.'); onChanged(); res.reload();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  async function contacted(channel: 'WHATSAPP' | 'TELEFONE') {
    try { await api.post(`/admin/crm/leads/${id}/contact`, { channel }); onChanged(); res.reload(); } catch (e) { toast.error(errorMessage(e)); }
  }
  const first = (l.name ?? '').split(/\s+/)[0] ?? '';
  const msg = WA_TEMPLATES.find((t) => t.id === tpl)!.text(first);
  const shown = text || msg;
  return (
    <Modal title={who(l)} wide onClose={onClose} footer={<>
      {manage && !l.userId && <Button variant="ghost" onClick={() => setDel(true)}>Apagar contato</Button>}
      <Button variant="ghost" onClick={onClose}>Fechar</Button>
      {manage && <Button variant="primary" loading={busy} onClick={() => void save()}>Salvar</Button>}
    </>}>
      <div className="stack">
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <StageBadge stage={l.stage} /><Badge>{KIND_LABEL[l.kind]}</Badge><Badge>{SOURCE[l.source] ?? l.source}</Badge>
          {l.unsubscribed ? <Badge tone="danger">Pediu para não receber</Badge> : l.marketingConsent ? <Badge tone="ok" dot>Aceitou receber mensagens</Badge> : <Badge>Sem aceite de marketing</Badge>}
          {l.userId && <Link to={`/clientes/${l.userId}`}>Ver cliente</Link>}
        </div>
        <p className="muted" style={{ margin: 0 }}>{[l.email, l.phone ? maskPhone(l.phone) : null].filter(Boolean).join(' · ') || 'Sem contato'}{l.interest ? ` · ${l.interest}` : ''}</p>
        {d.account && (
          <div className="stack-sm">
            <p style={{ margin: 0 }}>Consumo: <b>{d.account.queries}</b> consulta(s) paga(s), <b>{money(d.account.spentCents)}</b> gastos{d.account.lastQueryAt ? ` · última ${relativeTime(d.account.lastQueryAt)}` : ''}.</p>
            {(d.account.level || d.account.profile) && <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{d.account.level && <Badge tone={LEVEL[d.account.level]!.tone}>Nível {LEVEL[d.account.level]!.label}</Badge>}{d.account.profile && <Badge tone="ok">Cliente {PROFILE[d.account.profile]!.label.toLowerCase()}</Badge>}</div>}
            {d.account.products.length > 0 && <p className="muted" style={{ margin: 0, fontSize: 13 }}>Consultas feitas: {d.account.products.join(', ')}</p>}
          </div>
        )}
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>Origem: <b>{CHANNEL[l.origin?.channel ?? 'SITE']}</b>{l.origin?.campaign ? ` · campanha ${l.origin.campaign}` : ''}{Object.keys(l.utm).length > 0 ? ` (${Object.entries(l.utm).map(([k, v]) => `${k.replace('utm_', '')}: ${v}`).join(' · ')})` : ''}</p>

        {manage && (
          <>
            <div className="form-grid cols-2">
              <Field label="Etapa"><Select value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value as Stage })}>{STAGES.map((s) => <option key={s} value={s}>{STAGE[s].label}</option>)}</Select></Field>
              <Field label="Próximo retorno"><Input type="datetime-local" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
              <Field label="Nome"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} /></Field>
              <Field label="Tipo"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="CLIENTE">Cliente</option><option value="LOJISTA">Lojista</option></Select></Field>
              <Field label="Etiquetas" hint="Separe por vírgula." className="span-all"><Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></Field>
              <Field label="Anotações" className="span-all"><Textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} maxLength={2000} /></Field>
            </div>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <Button icon="link" onClick={() => onLink(l)}>Enviar link de consulta</Button>
              {l.phone && <Button icon="message-circle" onClick={() => void contacted('TELEFONE')}>Registrei uma ligação</Button>}
            </div>
            {l.phone && (
              <Card title="Mensagem no WhatsApp">
                <div className="stack">
                  {!l.marketingConsent && <Alert tone="warn" icon="alert-triangle">Esta pessoa não aceitou receber ofertas. Use só para responder ao que ela pediu.</Alert>}
                  <Select value={tpl} onChange={(e) => { setTpl(e.target.value); setText(''); }} aria-label="Modelo">{WA_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</Select>
                  <Textarea rows={3} value={shown} onChange={(e) => setText(e.target.value)} aria-label="Mensagem" />
                  <div><Button icon="message-circle" onClick={() => { window.open(waUrl(l.phone!, shown), '_blank', 'noopener'); void contacted('WHATSAPP'); }}>Abrir no WhatsApp</Button></div>
                </div>
              </Card>
            )}
          </>
        )}

        {d.links.length > 0 && (
          <Card title="Links enviados" pad={false}><div className="table-wrap"><table className="table"><tbody>{d.links.map((k) => <tr key={k.id}><td>{dateTime(k.createdAt)}</td><td>{k.productId ?? 'Consulta a escolher'}</td><td>{k.registeredAt ? <Badge tone="ok" dot>Criou a conta</Badge> : k.revoked ? <Badge tone="danger">Cancelado</Badge> : k.clicks ? <Badge tone="warn" dot>Abriu {k.clicks}x</Badge> : <Badge tone="info" dot>Aguardando</Badge>}</td></tr>)}</tbody></table></div></Card>
        )}
        <div className="grid-2">
          <Card title="Histórico no CRM">
            {d.events.length ? <ul className="crm-timeline">{d.events.map((e) => <li key={e.id}><b>{EVENT[e.kind] ?? e.kind}</b>{e.kind === 'STAGE' && typeof e.detail.to === 'string' ? ` → ${STAGE[e.detail.to as Stage]?.label ?? e.detail.to}` : ''}{e.kind === 'CONTACT' && typeof e.detail.channel === 'string' ? ` (${e.detail.channel.toLowerCase()})` : ''}<span className="muted"> · {dateTime(e.at)}{e.actor ? ` · ${e.actor}` : ''}</span></li>)}</ul> : <p className="muted">Nada ainda.</p>}
          </Card>
          <Card title="O que fez no site">
            {d.site.length ? <ul className="crm-timeline">{d.site.map((s, i) => <li key={i}><b>{SITE[s.type] ?? s.type}</b>{s.path ? <span className="muted"> {s.path}</span> : null}<span className="muted"> · {dateTime(s.at)}</span></li>)}</ul> : <p className="muted">Sem visitas ligadas a este contato.</p>}
          </Card>
        </div>
      </div>
      {del && <ConfirmDialog title="Apagar este contato?" danger confirmLabel="Apagar" message={<p>O contato e todo o histórico dele saem do CRM. Não dá para desfazer.</p>} onClose={() => setDel(false)}
        onConfirm={async () => { try { await api.del(`/admin/crm/leads/${id}`); toast.ok('Contato apagado.'); onChanged(); onClose(); } catch (e) { toast.error(errorMessage(e)); throw e; } }} />}
    </Modal>
  );
}

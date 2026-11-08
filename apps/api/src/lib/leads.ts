import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { pool } from '../db.js';
import { env, publicAppUrl } from '../config.js';
import { attachInviter, ensureInviteCode, newInviteCode } from './invites.js';

/**
 * CRM de leads do site. Um lead é uma pessoa que deixou um contato (simulador, FIPE, contato, link enviado pela equipe)
 * ou criou conta. O rastreio anônimo do site (funnel_events) liga ao lead pela sessão. Marketing só com consentimento
 * dado pela própria pessoa; quem pediu para sair nunca mais recebe mensagem de marketing.
 */
type Db = { query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }> };

export const STAGES = ['NOVO', 'CONTATADO', 'INTERESSADO', 'CADASTRADO', 'CLIENTE', 'PERDIDO'] as const;
export type Stage = (typeof STAGES)[number];
/** Qualificação pelo consumo (só consulta paga e concluída conta; estornada, falha e consulta interna da equipe ficam de fora).
 *  Tipo: esporádico (1 consulta, ou poucas e espaçadas) ou recorrente (2+ nos últimos 90 dias, ou 4+ no total).
 *  Nível por gasto acumulado: bronze (qualquer valor pago), prata (a partir de R$ 100) e ouro (a partir de R$ 300). Ajuste aqui se a regra mudar. */
export const PROFILES = ['ESPORADICO', 'RECORRENTE'] as const;
export const LEVELS = ['BRONZE', 'PRATA', 'OURO'] as const;
export const LEVEL_SILVER_CENTS = 10_000;
export const LEVEL_GOLD_CENTS = 30_000;
export const RECURRENT_RECENT_MIN = 2;
export const RECURRENT_TOTAL_MIN = 4;
export function classifyConsumption(n: number, n90: number, spentCents: number): { profile: (typeof PROFILES)[number] | null; level: (typeof LEVELS)[number] | null } {
  const profile = n <= 0 ? null : n90 >= RECURRENT_RECENT_MIN || n >= RECURRENT_TOTAL_MIN ? 'RECORRENTE' : 'ESPORADICO';
  const level = spentCents >= LEVEL_GOLD_CENTS ? 'OURO' : spentCents >= LEVEL_SILVER_CENTS ? 'PRATA' : spentCents > 0 ? 'BRONZE' : null;
  return { profile, level };
}
/** Consumo por contato com conta (mesma regra do classifyConsumption), em SQL. Alias esperado: l = site_leads. */
export const CONSUMPTION_JOIN = `LEFT JOIN LATERAL (
    SELECT count(*)::int AS n, count(*) FILTER (WHERE q.created_at > now() - interval '90 days')::int AS n90,
           coalesce(sum(q.price_cents),0)::bigint AS spent, max(q.created_at) AS last_at,
           array_agg(DISTINCT p.name) AS products
      FROM vehicle_queries q JOIN query_products p ON p.id=q.product_id
     WHERE q.user_id=l.user_id AND q.status='SUCCESS' AND q.source IS DISTINCT FROM 'ADMIN' AND q.price_cents>0
  ) c ON l.user_id IS NOT NULL`;
export const PROFILE_SQL = `(CASE WHEN coalesce(c.n,0)=0 THEN NULL WHEN coalesce(c.n90,0)>=${RECURRENT_RECENT_MIN} OR c.n>=${RECURRENT_TOTAL_MIN} THEN 'RECORRENTE' ELSE 'ESPORADICO' END)`;
export const LEVEL_SQL = `(CASE WHEN coalesce(c.spent,0)>=${LEVEL_GOLD_CENTS} THEN 'OURO' WHEN coalesce(c.spent,0)>=${LEVEL_SILVER_CENTS} THEN 'PRATA' WHEN coalesce(c.spent,0)>0 THEN 'BRONZE' END)`;

/** De onde a pessoa veio, lido das marcações do link (utm_source, utm_medium, utm_campaign, ref). Sem marcação = site (direto ou busca). */
export const CHANNELS = ['INSTAGRAM', 'FACEBOOK', 'GOOGLE', 'TIKTOK', 'YOUTUBE', 'WHATSAPP', 'EMAIL', 'OUTRA_CAMPANHA', 'INDICACAO', 'EQUIPE', 'SITE'] as const;
export type Channel = (typeof CHANNELS)[number];
const CHANNEL_SOURCES: Record<string, string[]> = {
  INSTAGRAM: ['instagram', 'ig'], FACEBOOK: ['facebook', 'fb', 'meta'], GOOGLE: ['google', 'adwords', 'googleads', 'google_ads'], TIKTOK: ['tiktok'],
  YOUTUBE: ['youtube', 'yt'], WHATSAPP: ['whatsapp', 'wa', 'zap'], EMAIL: ['email', 'e-mail', 'newsletter']
};
export function channelOf(utm: Record<string, unknown> | null | undefined, source?: string | null): Channel {
  const u = (utm ?? {}) as Record<string, unknown>;
  const src = String(u.utm_source ?? '').trim().toLowerCase();
  if (!src && source === 'LINK_ADMIN') return 'EQUIPE';
  for (const [ch, names] of Object.entries(CHANNEL_SOURCES)) if (names.includes(src)) return ch as Channel;
  if (src) return 'OUTRA_CAMPANHA';
  if (String(u.ref ?? '').trim()) return 'INDICACAO';
  return 'SITE';
}
const sqlList = (names: string[]) => names.map((n) => `'${n}'`).join(',');
export const CHANNEL_SQL = `(CASE
    WHEN coalesce(l.utm->>'utm_source','')='' AND l.source='LINK_ADMIN' THEN 'EQUIPE'
    ${Object.entries(CHANNEL_SOURCES).map(([ch, names]) => `WHEN lower(coalesce(l.utm->>'utm_source','')) IN (${sqlList(names)}) THEN '${ch}'`).join('\n    ')}
    WHEN coalesce(l.utm->>'utm_source','')<>'' THEN 'OUTRA_CAMPANHA'
    WHEN coalesce(l.utm->>'ref','')<>'' THEN 'INDICACAO'
    ELSE 'SITE' END)`;

export const KINDS = ['CLIENTE', 'LOJISTA'] as const;
export type LeadKind = (typeof KINDS)[number];
export const CAPTURE_TOOLS = ['SIMULADOR', 'FIPE', 'CONSULTA', 'COMPARAR', 'COMBUSTIVEL', 'GUIA', 'CONTATO', 'PLANOS', 'LOJISTA', 'SITE'] as const;
export const CONSENT_TEXT = 'Aceito receber e-mails e mensagens da Placa na Mão com dicas, novidades e ofertas. Posso cancelar quando quiser.';
export const CONSENT_VERSION = '2026-11';

export const normEmail = (raw: unknown): string | null => {
  const v = String(raw ?? '').trim().toLowerCase();
  return v && v.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : null;
};
/** Só dígitos, com DDD (10 ou 11); aceita +55 na frente. */
export const normPhone = (raw: unknown): string | null => {
  let d = String(raw ?? '').replace(/\D/g, '');
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  return d.length === 10 || d.length === 11 ? d : null;
};
const cleanText = (raw: unknown, max: number): string | null => { const v = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, max); return v || null; };
const cleanUtm = (raw: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (raw && typeof raw === 'object') {
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref', 'referrer']) {
      const v = (raw as Record<string, unknown>)[key];
      if (typeof v === 'string' && v.trim()) out[key] = v.trim().slice(0, 120);
    }
  }
  return out;
};
export const sessionKeyFor = (sessionId: unknown): string | null => {
  const v = String(sessionId ?? '');
  return /^[a-zA-Z0-9-]{16,80}$/.test(v) ? createHash('sha256').update(`${env.JWT_SECRET}:${v}`).digest('hex') : null;
};

export async function addLeadEvent(leadId: string, kind: string, detail: Record<string, unknown> = {}, actorId: string | null = null, db: Db = pool): Promise<void> {
  await db.query('INSERT INTO site_lead_events(lead_id,kind,detail,actor_id) VALUES($1,$2,$3::jsonb,$4)', [leadId, kind, JSON.stringify(detail), actorId]);
}

export interface LeadInput {
  name?: unknown; email?: unknown; phone?: unknown; kind?: unknown; source: string; interest?: unknown; utm?: unknown;
  sessionKey?: string | null; userId?: string | null; stage?: Stage;
  consent?: { granted: boolean; ipHash?: string | null; text?: string } | null;
  actorId?: string | null;
}

async function findLead(db: Db, userId: string | null, email: string | null, phone: string | null): Promise<string | null> {
  if (userId) { const r = await db.query('SELECT id FROM site_leads WHERE user_id=$1', [userId]); if (r.rowCount) return String(r.rows[0]!.id); }
  if (email) { const r = await db.query('SELECT id FROM site_leads WHERE lower(email)=$1', [email]); if (r.rowCount) return String(r.rows[0]!.id); }
  if (phone) { const r = await db.query('SELECT id FROM site_leads WHERE phone=$1 ORDER BY created_at LIMIT 1', [phone]); if (r.rowCount) return String(r.rows[0]!.id); }
  return null;
}

/** Cria o lead ou atualiza o que já existe (por conta, e-mail ou telefone). Nunca apaga dado nem volta etapa. */
export async function upsertLead(input: LeadInput, db: Db = pool): Promise<{ id: string; created: boolean }> {
  const email = normEmail(input.email);
  const phone = normPhone(input.phone);
  const userId = input.userId ?? null;
  if (!email && !phone && !userId) throw Object.assign(new Error('LEAD_CONTACT_REQUIRED'), { code: 'LEAD_CONTACT_REQUIRED' });
  const name = cleanText(input.name, 120);
  const kind: LeadKind = input.kind === 'LOJISTA' ? 'LOJISTA' : 'CLIENTE';
  const source = /^[A-Z_]{2,30}$/.test(input.source) ? input.source : 'SITE';
  const interest = cleanText(input.interest, 160);
  const utm = cleanUtm(input.utm);
  const granted = input.consent?.granted === true;
  const ipHash = input.consent?.ipHash ?? null;
  const consentText = input.consent?.text ?? CONSENT_TEXT;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const existing = await findLead(db, userId, email, phone);
    if (existing) {
      await db.query(
        `UPDATE site_leads SET
           name=COALESCE(name,$2), email=COALESCE(email,$3), phone=COALESCE(phone,$4),
           kind=CASE WHEN $5='LOJISTA' THEN 'LOJISTA' ELSE kind END,
           interest=COALESCE($6,interest),
           utm=CASE WHEN utm='{}'::jsonb THEN $7::jsonb ELSE utm END,
           session_key=COALESCE($8,session_key),
           user_id=COALESCE(user_id,$9),
           stage=CASE WHEN $9::uuid IS NOT NULL AND stage IN ('NOVO','CONTATADO','INTERESSADO') THEN 'CADASTRADO' ELSE stage END,
           marketing_consent=CASE WHEN $10 THEN true ELSE marketing_consent END,
           consent_at=CASE WHEN $10 THEN now() ELSE consent_at END,
           consent_text=CASE WHEN $10 THEN $11 ELSE consent_text END,
           consent_ip_hash=CASE WHEN $10 THEN $12 ELSE consent_ip_hash END,
           unsubscribed_at=CASE WHEN $10 THEN NULL ELSE unsubscribed_at END,
           last_seen_at=now(), updated_at=now()
         WHERE id=$1`,
        [existing, name, email, phone, kind, interest, JSON.stringify(utm), input.sessionKey ?? null, userId, granted, consentText, ipHash]
      );
      await addLeadEvent(existing, 'VISIT', { source, ...(interest ? { interest } : {}), ...(granted ? { consent: true } : {}) }, input.actorId ?? null, db);
      return { id: existing, created: false };
    }
    try {
      const ins = await db.query(
        `INSERT INTO site_leads(name,email,phone,kind,stage,source,interest,utm,session_key,user_id,marketing_consent,consent_at,consent_text,consent_ip_hash)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,CASE WHEN $11 THEN now() END,CASE WHEN $11 THEN $12 END,CASE WHEN $11 THEN $13 END) RETURNING id`,
        [name, email, phone, kind, input.stage ?? (userId ? 'CADASTRADO' : 'NOVO'), source, interest, JSON.stringify(utm), input.sessionKey ?? null, userId, granted, consentText, ipHash]
      );
      const id = String(ins.rows[0]!.id);
      await addLeadEvent(id, 'CREATED', { source, ...(interest ? { interest } : {}), ...(granted ? { consent: true } : {}) }, input.actorId ?? null, db);
      return { id, created: true };
    } catch (e) {
      if (typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505' && attempt === 0) continue; // corrida: alguém criou no meio
      throw e;
    }
  }
  throw new Error('LEAD_UPSERT_FAILED');
}

/** Junta dois leads da mesma pessoa: o primeiro fica, o segundo é apagado depois de passar histórico, links e dados. */
export async function mergeLeads(keepId: string, dropId: string, db: Db = pool): Promise<void> {
  if (keepId === dropId) return;
  await db.query(
    `UPDATE site_leads k SET
       name=COALESCE(k.name,d.name), email=COALESCE(k.email,d.email), phone=COALESCE(k.phone,d.phone),
       kind=CASE WHEN d.kind='LOJISTA' THEN 'LOJISTA' ELSE k.kind END,
       tags=(SELECT coalesce(array_agg(DISTINCT t),'{}') FROM unnest(k.tags || d.tags) t),
       notes=CASE WHEN d.notes IS NULL THEN k.notes WHEN k.notes IS NULL THEN d.notes ELSE k.notes || E'\\n' || d.notes END,
       session_key=COALESCE(k.session_key,d.session_key),
       first_seen_at=LEAST(k.first_seen_at,d.first_seen_at),
       marketing_consent=(k.marketing_consent OR d.marketing_consent) AND k.unsubscribed_at IS NULL,
       consent_at=COALESCE(k.consent_at,d.consent_at), consent_text=COALESCE(k.consent_text,d.consent_text),
       last_contact_at=GREATEST(k.last_contact_at,d.last_contact_at), updated_at=now()
     FROM site_leads d WHERE k.id=$1 AND d.id=$2`, [keepId, dropId]);
  await db.query('UPDATE site_lead_events SET lead_id=$1 WHERE lead_id=$2', [keepId, dropId]);
  await db.query('UPDATE lead_links SET lead_id=$1 WHERE lead_id=$2', [keepId, dropId]);
  await db.query('DELETE FROM site_leads WHERE id=$1', [dropId]);
  await addLeadEvent(keepId, 'MERGED', {}, null, db);
}

/**
 * Mantém o CRM em dia sem depender de cada tela avisar: liga leads a contas pelo e-mail, traz para o CRM quem criou conta
 * por outro caminho, e promove a etapa (conta criada → CADASTRADO; compra paga → CLIENTE). Tudo em lote e repetível.
 */
/** Virou cliente: pagou um pedido ou tem consulta paga concluída (consulta interna da equipe não conta). */
const BOUGHT = `(EXISTS (SELECT 1 FROM payment_orders o WHERE o.user_id=l.user_id AND o.status='PAID')
  OR EXISTS (SELECT 1 FROM vehicle_queries q WHERE q.user_id=l.user_id AND q.status='SUCCESS' AND q.source IS DISTINCT FROM 'ADMIN' AND q.price_cents>0))`;

export async function refreshLeads(db: Db = pool): Promise<void> {
  await db.query(
    `UPDATE site_leads l SET user_id=u.id, updated_at=now()
       FROM users u
      WHERE l.user_id IS NULL AND u.role='CLIENTE' AND l.email IS NOT NULL AND lower(l.email)=lower(u.email)
        AND NOT EXISTS (SELECT 1 FROM site_leads x WHERE x.user_id=u.id)`);
  await db.query(
    `INSERT INTO site_leads(name,email,phone,kind,stage,source,user_id,marketing_consent,consent_at,consent_text,first_seen_at,last_seen_at)
     SELECT u.name,lower(u.email),
            CASE WHEN regexp_replace(coalesce(p.phone,''),'\\D','','g') ~ '^[0-9]{10,11}$' THEN regexp_replace(p.phone,'\\D','','g') END,
            CASE WHEN EXISTS (SELECT 1 FROM dealerships d WHERE d.owner_user_id=u.id) THEN 'LOJISTA' ELSE 'CLIENTE' END,
            'CADASTRADO','CADASTRO',u.id,coalesce(p.marketing_opt_in,false),CASE WHEN p.marketing_opt_in THEN u.created_at END,CASE WHEN p.marketing_opt_in THEN 'Aceite no cadastro' END,u.created_at,u.created_at
       FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id
      WHERE u.role='CLIENTE' AND u.active=true AND NOT EXISTS (SELECT 1 FROM site_leads l WHERE l.user_id=u.id OR lower(l.email)=lower(u.email))
     ON CONFLICT DO NOTHING`);
  // Quem tirou o aceite de marketing na conta deixa de receber marketing também aqui.
  await db.query(
    `UPDATE site_leads l SET marketing_consent=false, updated_at=now()
       FROM user_profiles p WHERE p.user_id=l.user_id AND p.marketing_opt_in=false AND l.marketing_consent=true AND l.consent_text='Aceite no cadastro'`);
  const up = await db.query(
    `WITH promoted AS (
       UPDATE site_leads l SET stage=CASE WHEN ${BOUGHT} THEN 'CLIENTE' ELSE 'CADASTRADO' END, updated_at=now()
        WHERE l.user_id IS NOT NULL AND l.stage IN ('NOVO','CONTATADO','INTERESSADO','CADASTRADO','PERDIDO')
          AND l.stage <> CASE WHEN ${BOUGHT} THEN 'CLIENTE' ELSE 'CADASTRADO' END
          AND NOT (l.stage='PERDIDO' AND NOT (${BOUGHT}))
        RETURNING id, stage)
     INSERT INTO site_lead_events(lead_id,kind,detail) SELECT id,'STAGE',jsonb_build_object('to',stage,'auto',true) FROM promoted RETURNING lead_id`);
  void up;
}

// ------------------------------------------------------------------ descadastro

const unsubSig = (leadId: string) => createHmac('sha256', env.JWT_SECRET).update(`lead-unsubscribe:${leadId}`).digest('base64url').slice(0, 32);
export const unsubscribeToken = (leadId: string) => `${leadId}.${unsubSig(leadId)}`;
export const unsubscribeUrl = (leadId: string) => `${publicAppUrl()}/descadastrar?t=${encodeURIComponent(unsubscribeToken(leadId))}`;

export async function unsubscribeByToken(token: unknown): Promise<boolean> {
  const m = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{32})$/.exec(String(token ?? ''));
  if (!m) return false;
  const a = Buffer.from(unsubSig(m[1]!)); const b = Buffer.from(m[2]!);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const r = await pool.query(`UPDATE site_leads SET marketing_consent=false, unsubscribed_at=COALESCE(unsubscribed_at,now()), updated_at=now() WHERE id=$1 RETURNING id,user_id`, [m[1]]);
  if (!r.rowCount) return false;
  if (r.rows[0]!.user_id) {
    await pool.query('UPDATE user_profiles SET marketing_opt_in=false WHERE user_id=$1', [r.rows[0]!.user_id]);
    await pool.query(`INSERT INTO user_consents(user_id,consent_type,granted,policy_version,source) VALUES($1,'MARKETING_EMAIL',false,$2,'unsubscribe_link')`, [r.rows[0]!.user_id, CONSENT_VERSION]);
  }
  await addLeadEvent(m[1]!, 'UNSUBSCRIBED', {});
  return true;
}

// ------------------------------------------------------------------ links de consulta enviados pela equipe

export interface LeadLinkInput {
  createdBy: string; leadId?: string | null; recipientName?: string | null; kind?: LeadKind;
  productId?: string | null; plate?: string | null; channel?: 'COPIA' | 'WHATSAPP' | 'EMAIL'; days?: number;
}
export const leadLinkUrl = (code: string) => new URL(`/c/${code}`, publicAppUrl()).toString();
export const cleanLinkCode = (raw: unknown): string | null => { const v = String(raw ?? '').trim().toUpperCase(); return /^[A-Z2-9]{8}$/.test(v) && !/[01IO]/.test(v) ? v : null; };

export async function createLeadLink(input: LeadLinkInput, db: Db = pool): Promise<{ id: string; code: string; url: string; expiresAt: string }> {
  const days = Math.min(90, Math.max(1, Math.round(input.days ?? 14)));
  for (let i = 0; i < 6; i += 1) {
    const code = newInviteCode();
    try {
      const r = await db.query(
        `INSERT INTO lead_links(code,lead_id,created_by,kind,recipient_name,product_id,plate,channel,expires_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,now() + make_interval(days => $9::int)) RETURNING id,expires_at`,
        [code, input.leadId ?? null, input.createdBy, input.kind === 'LOJISTA' ? 'LOJISTA' : 'CLIENTE', cleanText(input.recipientName, 120), input.productId ?? null, input.plate ?? null, input.channel ?? 'COPIA', days]);
      if (input.leadId) await addLeadEvent(input.leadId, 'LINK_SENT', { code, channel: input.channel ?? 'COPIA', productId: input.productId ?? null, plate: input.plate ? `${input.plate.slice(0, 3)}****` : null }, input.createdBy, db);
      return { id: String(r.rows[0]!.id), code, url: leadLinkUrl(code), expiresAt: new Date(String(r.rows[0]!.expires_at)).toISOString() };
    } catch (e) {
      if (typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505') continue;
      throw e;
    }
  }
  throw new Error('LEAD_LINK_CODE_FAILED');
}

export async function publicLeadLink(rawCode: unknown) {
  const code = cleanLinkCode(rawCode);
  if (!code) return null;
  const r = await pool.query(
    `SELECT l.id,l.code,l.kind,l.recipient_name,l.product_id,l.plate,l.expires_at,l.revoked_at,u.name AS sender_name,p.name AS product_name
       FROM lead_links l LEFT JOIN users u ON u.id=l.created_by LEFT JOIN query_products p ON p.id=l.product_id AND p.active=true AND p.is_free=false
      WHERE l.code=$1`, [code]);
  if (!r.rowCount) return null;
  const row = r.rows[0]!;
  const expired = new Date(String(row.expires_at)).getTime() < Date.now();
  return {
    valid: !row.revoked_at && !expired, expired, code,
    kind: String(row.kind), firstName: row.recipient_name ? String(row.recipient_name).split(/\s+/)[0] : null,
    productId: row.product_name ? String(row.product_id) : null, productName: row.product_name ? String(row.product_name) : null,
    plate: row.plate ? String(row.plate) : null
  };
}

/** Conta o clique (sem IP nem dado de quem abriu). Primeiro clique leva o lead para INTERESSADO. */
export async function recordLeadLinkClick(rawCode: unknown): Promise<boolean> {
  const code = cleanLinkCode(rawCode);
  if (!code) return false;
  const r = await pool.query(
    `UPDATE lead_links SET clicks=clicks+1, first_click_at=COALESCE(first_click_at,now()), last_click_at=now()
      WHERE code=$1 AND revoked_at IS NULL AND expires_at > now() RETURNING id,lead_id,clicks`, [code]);
  if (!r.rowCount) return false;
  const leadId = r.rows[0]!.lead_id ? String(r.rows[0]!.lead_id) : null;
  if (leadId) {
    await pool.query(`UPDATE site_leads SET stage=CASE WHEN stage IN ('NOVO','CONTATADO') THEN 'INTERESSADO' ELSE stage END, last_seen_at=now(), updated_at=now() WHERE id=$1`, [leadId]);
    if (Number(r.rows[0]!.clicks) <= 3) await addLeadEvent(leadId, 'LINK_CLICK', { code, n: Number(r.rows[0]!.clicks) });
  }
  return true;
}

/**
 * Chamado quando a pessoa cria a conta (ou entra pela primeira vez) depois de abrir o link: liga a conta ao link e ao lead,
 * e registra quem enviou como "quem convidou" (aparece em Convites). Link inválido ou já usado não derruba o cadastro.
 */
export async function claimLeadLink(userId: string, rawCode: unknown, opts: { sessionKey?: string | null; utm?: unknown } = {}, db: Db = pool): Promise<{ linked: boolean }> {
  const code = cleanLinkCode(rawCode);
  if (!code) return { linked: false };
  const link = await db.query('SELECT id,lead_id,created_by,kind,recipient_name FROM lead_links WHERE code=$1 AND revoked_at IS NULL AND registered_user_id IS NULL', [code]);
  if (!link.rowCount) return { linked: false };
  const l = link.rows[0]!;
  const user = await db.query('SELECT u.id,u.email,u.name,p.phone FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=$1', [userId]);
  if (!user.rowCount) return { linked: false };
  const u = user.rows[0]!;
  const mine = await upsertLead({ userId, email: u.email, name: u.name, phone: u.phone, kind: l.kind, source: 'LINK_ADMIN', sessionKey: opts.sessionKey ?? null, utm: opts.utm, stage: 'CADASTRADO' }, db);
  if (l.lead_id && String(l.lead_id) !== mine.id) {
    const still = await db.query('SELECT 1 FROM site_leads WHERE id=$1', [l.lead_id]);
    if (still.rowCount) await mergeLeads(mine.id, String(l.lead_id), db);
  }
  await db.query('UPDATE lead_links SET registered_user_id=$2, registered_at=now(), lead_id=$3 WHERE id=$1', [l.id, userId, mine.id]);
  await db.query(`UPDATE site_leads SET kind=CASE WHEN $2='LOJISTA' THEN 'LOJISTA' ELSE kind END, stage=CASE WHEN stage='CLIENTE' THEN stage ELSE 'CADASTRADO' END, updated_at=now() WHERE id=$1`, [mine.id, l.kind]);
  await addLeadEvent(mine.id, 'LINK_REGISTERED', { code }, null, db);
  if (l.created_by) {
    try { const creatorCode = await ensureInviteCode(String(l.created_by), db); await attachInviter(userId, creatorCode, 'LINK', db); } catch { /* o vínculo com quem convidou é um extra */ }
  }
  return { linked: true };
}

// ------------------------------------------------------------------ audiência para anúncios (lookalike)

/** Hash SHA-256 do valor normalizado: é o formato aceito por Meta e Google para listas de clientes. */
export const sha256Hex = (v: string) => createHash('sha256').update(v).digest('hex');
export const phoneForAds = (digits: string) => sha256Hex(`55${digits}`);

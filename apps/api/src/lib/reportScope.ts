import { z } from 'zod';
import { pool } from '../db.js';
import { CATALOG_BY_KEY, SECTIONS, type SectionKey } from '../report/catalog.js';

/**
 * Escopo de relatório por produto: quais seções e campos do catálogo o cliente recebe.
 * É versionado (report_templates, model CATALOG_V1), vale para JSON, API pública, HTML e PDF,
 * e cada consulta usa a versão que estava publicada quando foi feita (snapshot).
 */
export const SCOPE_MODEL = 'CATALOG_V1';

export interface ScopeField { key: string; label?: string; visible?: boolean }
export interface ScopeSection { key: SectionKey; label?: string; order?: number; visible?: boolean; fields: ScopeField[] }
export interface ScopeConfig { model: typeof SCOPE_MODEL; title?: string; sections: ScopeSection[] }
export interface ScopeTemplate { id: string; version: number; config: ScopeConfig }
export interface ProductScope { sections: string[] | null; template: ScopeTemplate | null }

/** Seções que nunca podem ser vendidas ao cliente (dados de pessoas e controle interno). */
export const NON_SELLABLE_SECTIONS: ReadonlySet<string> = new Set(['PROPRIETARIO', 'INTERNO']);

const fieldSchema = z.object({ key: z.string().min(1).max(80), label: z.string().trim().min(1).max(120).optional(), visible: z.boolean().optional() }).strict();
const sectionSchema = z.object({
  key: z.string().min(1).max(40), label: z.string().trim().min(1).max(120).optional(), order: z.number().int().min(-1000).max(1000).optional(),
  visible: z.boolean().optional(), fields: z.array(fieldSchema).max(120)
}).strict();
export const scopeConfigSchema = z.object({
  model: z.literal(SCOPE_MODEL), title: z.string().trim().min(1).max(160).optional(), sections: z.array(sectionSchema).min(1).max(12)
}).strict();

export type ScopeValidation = { ok: true; config: ScopeConfig } | { ok: false; errors: string[] };

export function validateScopeConfig(input: unknown): ScopeValidation {
  const parsed = scopeConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'config'}: ${i.message}`) };
  const errors: string[] = [];
  const sectionKeys = new Set<string>(SECTIONS.map((s) => s.key));
  const seenSections = new Set<string>();
  const seenFields = new Set<string>();
  let visibleFields = 0;
  for (const section of parsed.data.sections) {
    if (!sectionKeys.has(section.key)) errors.push(`Seção desconhecida: ${section.key}`);
    else if (NON_SELLABLE_SECTIONS.has(section.key)) errors.push(`A seção ${section.key} não pode ser entregue ao cliente.`);
    if (seenSections.has(section.key)) errors.push(`Seção repetida: ${section.key}`);
    seenSections.add(section.key);
    for (const field of section.fields) {
      const def = CATALOG_BY_KEY.get(field.key);
      if (!def) { errors.push(`Campo fora do catálogo do provedor: ${field.key}`); continue; }
      if (def.section !== section.key) errors.push(`O campo ${field.key} pertence à seção ${def.section}, não a ${section.key}.`);
      if (def.sensitivity === 'OWNER' || def.sensitivity === 'INTERNAL') errors.push(`O campo ${field.key} é protegido (dados de pessoas/controle interno) e não pode ser entregue.`);
      if (seenFields.has(field.key)) errors.push(`Campo repetido: ${field.key}`);
      seenFields.add(field.key);
      if (field.visible !== false && section.visible !== false) visibleFields += 1;
    }
  }
  if (!errors.length && visibleFields === 0) errors.push('Selecione ao menos um campo visível.');
  return errors.length ? { ok: false, errors } : { ok: true, config: parsed.data as ScopeConfig };
}

/** Catálogo editável: seções vendáveis com seus campos permitidos (nunca expõe proprietário/interno). */
export function scopeCatalog() {
  return SECTIONS.filter((s) => !NON_SELLABLE_SECTIONS.has(s.key)).map((s) => ({
    key: s.key, label: s.label, description: s.description, order: s.order,
    fields: [...CATALOG_BY_KEY.values()].filter((f) => f.section === s.key && f.sensitivity !== 'OWNER' && f.sensitivity !== 'INTERNAL')
      .map((f) => ({ key: f.key, label: f.label, kind: f.kind, tier: f.tier, sensitivity: f.sensitivity }))
  }));
}

/** Modelo inicial: todos os campos permitidos de um nível (1 = básico … 3 = completo). */
export function defaultScopeForTier(tier: 1 | 2 | 3): ScopeConfig {
  return {
    model: SCOPE_MODEL,
    sections: scopeCatalog().map((s) => ({ key: s.key as SectionKey, order: s.order, visible: true, fields: s.fields.filter((f) => f.tier <= tier).map((f) => ({ key: f.key, visible: true })) })).filter((s) => s.fields.length)
  };
}

type Entry = { id: string; version: number; publishedAt: Date; supersededAt: Date | null; config: ScopeConfig };
let templates = new Map<string, Entry[]>();
let legacySections = new Map<string, string[] | null>();

export async function refreshScopes(): Promise<void> {
  const [products, rows] = await Promise.all([
    pool.query('SELECT id, report_sections FROM query_products'),
    pool.query(`SELECT t.id, t.version, t.config, p.product_id, p.published_at, p.superseded_at
      FROM report_template_publications p JOIN report_templates t ON t.id=p.template_id
      WHERE t.config->>'model'=$1 ORDER BY p.product_id, p.published_at`, [SCOPE_MODEL])
  ]);
  const nextSections = new Map<string, string[] | null>();
  for (const r of products.rows) nextSections.set(String(r.id), Array.isArray(r.report_sections) && r.report_sections.length ? (r.report_sections as string[]) : null);
  const nextTemplates = new Map<string, Entry[]>();
  for (const r of rows.rows) {
    const list = nextTemplates.get(String(r.product_id)) ?? [];
    list.push({ id: String(r.id), version: Number(r.version), publishedAt: new Date(r.published_at), supersededAt: r.superseded_at ? new Date(r.superseded_at) : null, config: r.config as ScopeConfig });
    nextTemplates.set(String(r.product_id), list);
  }
  legacySections = nextSections;
  templates = nextTemplates;
}

/**
 * Escopo do produto. Com `at`, devolve o modelo que estava publicado naquele instante (consultas antigas
 * não mudam quando o painel publica uma nova versão); sem `at`, o modelo atual.
 */
export function scopeForProduct(productId: string | null | undefined, at?: Date | string | null): ProductScope {
  const id = String(productId ?? '');
  const list = templates.get(id) ?? [];
  const when = at ? new Date(at).getTime() : null;
  const hit = [...list].reverse().find((t) => (when == null ? t.supersededAt == null : t.publishedAt.getTime() <= when && (t.supersededAt == null || t.supersededAt.getTime() > when)));
  return { sections: legacySections.get(id) ?? null, template: hit ? { id: hit.id, version: hit.version, config: hit.config } : null };
}

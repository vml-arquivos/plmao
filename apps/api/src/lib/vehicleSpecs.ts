/**
 * Catálogo de campos da ficha técnica do Guia de veículos.
 * É a fonte única: o painel monta o formulário a partir dele, a importação CSV usa as chaves como
 * cabeçalho e o comparador decide quem "ganha" em cada linha pelo campo `better`.
 */
export type SpecKind = 'number' | 'text' | 'bool';
export interface SpecField {
  key: string;
  group: string;
  label: string;
  kind: SpecKind;
  unit?: string;
  /** Para o comparador: 'high' = maior é melhor, 'low' = menor é melhor, undefined = sem vencedor. */
  better?: 'high' | 'low';
  /** Aparece no resumo do card/ficha rápida. */
  highlight?: boolean;
  max?: number;
}

const n = (key: string, group: string, label: string, unit: string | undefined, better?: 'high' | 'low', extra: Partial<SpecField> = {}): SpecField => ({ key, group, label, kind: 'number', unit, better, ...extra });
const t = (key: string, group: string, label: string, extra: Partial<SpecField> = {}): SpecField => ({ key, group, label, kind: 'text', ...extra });
const b = (key: string, group: string, label: string): SpecField => ({ key, group, label, kind: 'bool', better: 'high' });

export const SPEC_GROUPS = ['Motor e desempenho', 'Consumo', 'Dimensões e capacidades', 'Segurança', 'Conforto e tecnologia'] as const;

export const SPEC_FIELDS: SpecField[] = [
  t('engine', 'Motor e desempenho', 'Motor', { highlight: true }),
  n('displacement_cc', 'Motor e desempenho', 'Cilindrada', 'cm³', undefined, { max: 20000 }),
  n('power_hp', 'Motor e desempenho', 'Potência', 'cv', 'high', { highlight: true, max: 2000 }),
  n('torque_kgfm', 'Motor e desempenho', 'Torque', 'kgfm', 'high', { max: 500 }),
  t('transmission', 'Motor e desempenho', 'Câmbio', { highlight: true }),
  n('gears', 'Motor e desempenho', 'Marchas', undefined, undefined, { max: 20 }),
  t('drive', 'Motor e desempenho', 'Tração'),
  n('accel_0_100_s', 'Motor e desempenho', 'Aceleração 0–100 km/h', 's', 'low', { max: 60 }),
  n('top_speed_kmh', 'Motor e desempenho', 'Velocidade máxima', 'km/h', 'high', { max: 500 }),

  n('cons_city_gas_kml', 'Consumo', 'Cidade (gasolina)', 'km/l', 'high', { highlight: true, max: 60 }),
  n('cons_road_gas_kml', 'Consumo', 'Estrada (gasolina)', 'km/l', 'high', { max: 60 }),
  n('cons_city_eth_kml', 'Consumo', 'Cidade (etanol)', 'km/l', 'high', { max: 60 }),
  n('cons_road_eth_kml', 'Consumo', 'Estrada (etanol)', 'km/l', 'high', { max: 60 }),
  n('cons_city_diesel_kml', 'Consumo', 'Cidade (diesel)', 'km/l', 'high', { max: 60 }),
  n('cons_road_diesel_kml', 'Consumo', 'Estrada (diesel)', 'km/l', 'high', { max: 60 }),
  n('tank_l', 'Consumo', 'Tanque', 'L', 'high', { max: 1000 }),

  n('length_mm', 'Dimensões e capacidades', 'Comprimento', 'mm', undefined, { max: 30000 }),
  n('width_mm', 'Dimensões e capacidades', 'Largura', 'mm', undefined, { max: 5000 }),
  n('height_mm', 'Dimensões e capacidades', 'Altura', 'mm', undefined, { max: 5000 }),
  n('wheelbase_mm', 'Dimensões e capacidades', 'Entre-eixos', 'mm', 'high', { max: 10000 }),
  n('ground_clearance_mm', 'Dimensões e capacidades', 'Altura livre do solo', 'mm', 'high', { max: 1000 }),
  n('weight_kg', 'Dimensões e capacidades', 'Peso', 'kg', 'low', { max: 60000 }),
  n('trunk_l', 'Dimensões e capacidades', 'Porta-malas', 'L', 'high', { highlight: true, max: 5000 }),
  n('seats', 'Dimensões e capacidades', 'Lugares', undefined, undefined, { max: 60 }),
  n('doors', 'Dimensões e capacidades', 'Portas', undefined, undefined, { max: 8 }),

  n('airbags', 'Segurança', 'Airbags', undefined, 'high', { max: 20 }),
  b('abs', 'Segurança', 'Freios ABS'),
  b('esc', 'Segurança', 'Controle de estabilidade'),
  b('isofix', 'Segurança', 'ISOFIX'),
  n('ncap_stars', 'Segurança', 'Estrelas Latin NCAP', undefined, 'high', { max: 5 }),

  b('air_conditioning', 'Conforto e tecnologia', 'Ar-condicionado'),
  b('cruise_control', 'Conforto e tecnologia', 'Piloto automático'),
  b('rear_camera', 'Conforto e tecnologia', 'Câmera de ré'),
  b('parking_sensors', 'Conforto e tecnologia', 'Sensor de estacionamento'),
  t('multimedia', 'Conforto e tecnologia', 'Central multimídia'),
  t('wheels', 'Conforto e tecnologia', 'Rodas')
];

export const SPEC_BY_KEY = new Map(SPEC_FIELDS.map((f) => [f.key, f]));

/**
 * Valida e normaliza specs recebidas (painel ou CSV): descarta chaves desconhecidas e valores vazios,
 * converte números (aceita vírgula decimal) e booleanos (sim/não/true/false).
 */
export function cleanSpecs(input: unknown): { specs: Record<string, string | number | boolean>; errors: string[] } {
  const specs: Record<string, string | number | boolean> = {};
  const errors: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { specs, errors };
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    const field = SPEC_BY_KEY.get(key);
    if (!field) continue;
    if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) continue;
    if (field.kind === 'number') {
      const text = String(raw).trim();
      const value = typeof raw === 'number' ? raw : Number(text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text);
      if (!Number.isFinite(value) || value < 0 || value > (field.max ?? 1_000_000)) { errors.push(`${field.label}: valor inválido`); continue; }
      specs[key] = Math.round(value * 100) / 100;
    } else if (field.kind === 'bool') {
      if (typeof raw === 'boolean') specs[key] = raw;
      else {
        const s = String(raw).trim().toLowerCase();
        if (['sim', 's', 'true', '1', 'yes', 'x'].includes(s)) specs[key] = true;
        else if (['nao', 'não', 'n', 'false', '0', 'no'].includes(s)) specs[key] = false;
        else errors.push(`${field.label}: use sim ou não`);
      }
    } else {
      const s = String(raw).trim();
      if (s.length > 160) { errors.push(`${field.label}: texto longo demais`); continue; }
      specs[key] = s;
    }
  }
  return { specs, errors };
}

/**
 * Para cada campo com critério de "melhor", devolve os índices vencedores (empates incluídos).
 * Só há vencedor quando pelo menos dois veículos têm o valor e os valores diferem.
 */
export function bestIndexes(values: Array<number | boolean | null | undefined>, better: 'high' | 'low'): number[] {
  const nums = values
    .map((v, i) => ({ i, v: typeof v === 'boolean' ? (v ? 1 : 0) : v }))
    .filter((x): x is { i: number; v: number } => typeof x.v === 'number' && Number.isFinite(x.v));
  if (nums.length < 2) return [];
  const best = better === 'high' ? Math.max(...nums.map((x) => x.v)) : Math.min(...nums.map((x) => x.v));
  if (nums.every((x) => x.v === best)) return [];
  return nums.filter((x) => x.v === best).map((x) => x.i);
}

export function computeWinners(rows: Array<Record<string, unknown>>): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const field of SPEC_FIELDS) {
    if (!field.better) continue;
    const idx = bestIndexes(rows.map((r) => r[field.key] as number | boolean | undefined), field.better);
    if (idx.length) out[field.key] = idx;
  }
  return out;
}

export const RATING_CATEGORIES = [
  { key: 'comfort', label: 'Conforto' },
  { key: 'performance', label: 'Desempenho' },
  { key: 'economy', label: 'Consumo' },
  { key: 'reliability', label: 'Confiabilidade' },
  { key: 'maintenance', label: 'Custo de manutenção' },
  { key: 'finish', label: 'Acabamento' }
] as const;

export const BODY_TYPES = ['Hatch', 'Sedã', 'SUV', 'Picape', 'Perua', 'Minivan', 'Cupê', 'Esportivo', 'Utilitário', 'Van', 'Scooter', 'Street', 'Trail', 'Custom', 'Esportiva', 'Caminhão', 'Outro'] as const;
export const TIP_CATEGORIES = [
  { key: 'CUIDADOS', label: 'Cuidados no dia a dia' },
  { key: 'MANUTENCAO', label: 'Manutenção' },
  { key: 'COMPRA', label: 'Na hora de comprar' },
  { key: 'ECONOMIA', label: 'Economia' },
  { key: 'SEGURANCA', label: 'Segurança' }
] as const;

/** Texto sem acento, minúsculo, só letras/números: base da busca e do casamento placa → modelo. */
export function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function slugify(value: string): string {
  return normalizeText(value).replace(/\s+/g, '-').slice(0, 90).replace(/^-+|-+$/g, '');
}

/**
 * Pontua o quanto um modelo do guia combina com o veículo identificado pela placa (marca + modelo livre).
 * 0 = nada a ver; quanto maior, melhor. A marca precisa bater; o nome do modelo precisa estar contido.
 */
export function scoreModelMatch(target: { brand: string; model: string }, candidate: { brand: string; name: string }): number {
  const tb = normalizeText(target.brand);
  const cb = normalizeText(candidate.brand);
  if (!tb || !cb || !(tb.includes(cb) || cb.includes(tb))) return 0;
  const tm = normalizeText(target.model).split(' ').filter(Boolean);
  const cm = normalizeText(candidate.name).split(' ').filter(Boolean);
  if (!cm.length || !tm.length) return 0;
  const contained = cm.every((w) => tm.includes(w));
  if (!contained) return 0;
  return 10 + cm.length * 5 - Math.max(tm.length - cm.length, 0) * 0.1;
}

/**
 * Decodificador básico de chassi (VIN, ISO 3779): fabricante, país e ano do modelo calculados a partir do próprio número.
 * Só afirma o que o número permite; o que não conhece fica em branco (nunca inventa).
 */
export interface ChassisInfo { valid: boolean; format: 'PADRAO_17' | 'FORA_DO_PADRAO'; manufacturer?: string; country?: string; modelYear?: number; wmi?: string }

/** Prefixos (3 primeiros caracteres) de fabricantes com presença no Brasil. Conferidos; os demais caem só no país. */
const WMI: Record<string, string> = {
  '9BW': 'Volkswagen', '9BG': 'Chevrolet (GM)', '9BD': 'Fiat', '9BF': 'Ford', '93Y': 'Renault', '93H': 'Honda', '9C2': 'Honda (motos)',
  '9BR': 'Toyota', '9BH': 'Hyundai', '9BM': 'Mercedes-Benz', '9BS': 'Scania',
  WDD: 'Mercedes-Benz', WDB: 'Mercedes-Benz', WDC: 'Mercedes-Benz', WDF: 'Mercedes-Benz', WBA: 'BMW', WBS: 'BMW M', WBY: 'BMW i', WVW: 'Volkswagen', WVG: 'Volkswagen',
  WV1: 'Volkswagen (utilitários)', WV2: 'Volkswagen (utilitários)', WAU: 'Audi', WUA: 'Audi Sport', WP0: 'Porsche', JHM: 'Honda', JTD: 'Toyota', JTE: 'Toyota', JN1: 'Nissan',
  JMZ: 'Mazda', JS3: 'Suzuki', KMH: 'Hyundai', KNA: 'Kia', KND: 'Kia', VF1: 'Renault', VF3: 'Peugeot', VF7: 'Citroën', ZFA: 'Fiat', ZFF: 'Ferrari', SAJ: 'Jaguar',
  SAL: 'Land Rover', YV1: 'Volvo', '1FA': 'Ford', '1FT': 'Ford', '1G1': 'Chevrolet', '1GC': 'Chevrolet', '5YJ': 'Tesla', '7SA': 'Tesla'
};

const COUNTRY_BY_FIRST: Array<[RegExp, string]> = [
  [/^[9]/, 'Brasil'], [/^8[A-E]/, 'Argentina'], [/^W/, 'Alemanha'], [/^J/, 'Japão'], [/^K[L-R]/, 'Coreia do Sul'], [/^L/, 'China'], [/^S[A-M]/, 'Reino Unido'],
  [/^V[F-R]/, 'França'], [/^V[S-W]/, 'Espanha'], [/^Z[A-R]/, 'Itália'], [/^[145]/, 'Estados Unidos'], [/^2/, 'Canadá'], [/^3[A-W]/, 'México'], [/^Y[A-E]/, 'Bélgica'],
  [/^Y[F-K]/, 'Finlândia'], [/^Y[S-W]/, 'Suécia'], [/^M[A-E]/, 'Índia'], [/^T[R-V]/, 'República Tcheca'], [/^7[A-E]/, 'Nova Zelândia'], [/^6/, 'Austrália']
];

const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789';

/** O 10º caractere repete a cada 30 anos; escolhe o ano mais próximo dos anos informados no registro. */
export function modelYearFromChar(ch: string, hints: number[]): number | undefined {
  const idx = YEAR_CODES.indexOf(ch);
  if (idx < 0) return undefined;
  const base = 1980 + idx;
  const candidates = [base, base + 30, base + 60].filter((y) => y >= 1980 && y <= new Date().getFullYear() + 2);
  if (!candidates.length) return undefined;
  const ref = hints.filter((n) => n > 1900);
  if (!ref.length) return candidates[candidates.length - 1];
  return candidates.sort((a, b) => Math.min(...ref.map((r) => Math.abs(a - r))) - Math.min(...ref.map((r) => Math.abs(b - r))))[0];
}

export function decodeChassis(chassis: string, yearHints: number[] = []): ChassisInfo {
  const vin = chassis.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return { valid: false, format: 'FORA_DO_PADRAO' };
  const wmi = vin.slice(0, 3);
  const country = COUNTRY_BY_FIRST.find(([re]) => re.test(wmi))?.[1];
  return { valid: true, format: 'PADRAO_17', wmi, manufacturer: WMI[wmi], country, modelYear: modelYearFromChar(vin[9]!, yearHints) };
}

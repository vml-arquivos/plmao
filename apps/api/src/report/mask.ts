/**
 * Mascaramento LGPD. Dados de pessoas (CPF/CNPJ/nome) nunca saem em claro por padrão.
 */

const digits = (value: string) => value.replace(/\D/g, '');

export function maskDocument(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = String(raw).trim();
  if (!value) return null;
  const d = digits(value);
  if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  if (d.length === 14) return `**.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-**`;
  // valores já anonimizados pelo provedor (XXXX) ou formatos inesperados: mostra só o final.
  const clean = value.replace(/\s/g, '');
  if (clean.length <= 2) return '•'.repeat(clean.length);
  return `${'•'.repeat(Math.min(clean.length - 2, 10))}${clean.slice(-2)}`;
}

/** "JOAO DA SILVA SANTOS" → "JOAO D* S*****". Mantém o primeiro nome e reduz o resto. */
export function maskName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const parts = String(raw).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  const [first, ...rest] = parts;
  return [first, ...rest.map((p) => (p.length <= 2 ? p : `${p[0]}${'*'.repeat(Math.min(p.length - 1, 6))}`))].join(' ');
}

/** Identificadores do veículo: mostra o início (WMI) e o final. */
export function maskVehicleId(raw: string | null | undefined, head = 3, tail = 4): string | null {
  if (!raw) return null;
  const value = String(raw).trim();
  if (!value) return null;
  if (value.length <= head + tail) return `${value.slice(0, 1)}${'*'.repeat(Math.max(value.length - 1, 0))}`;
  return `${value.slice(0, head)}${'*'.repeat(value.length - head - tail)}${value.slice(-tail)}`;
}

/** Consulta grátis por placa: chassi com 3 primeiros e 4 últimos; motor com 3 primeiros e 5 últimos (mesmo estilo das consultas gratuitas do mercado). */
export function maskFreeChassis(raw: string | null | undefined): string | undefined {
  return maskVehicleId(raw, 3, 4) ?? undefined;
}
export function maskFreeEngine(raw: string | null | undefined): string | undefined {
  return maskVehicleId(raw, 3, 5) ?? undefined;
}

/** CPF ou CNPJ com pontuação (11 ou 14 dígitos); outros formatos voltam como vieram. */
export function formatDocument(raw: string | null | undefined): string {
  const value = String(raw ?? '').trim();
  const d = digits(value);
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return value;
}

/**
 * Regra do produto: o relatório serve a crédito, avaliação de veículo e comércio. Dados do veículo e do proprietário
 * (nome, CPF/CNPJ, placa, chassi, RENAVAM, motor) aparecem sempre completos, para qualquer cliente. Não há opção de máscara.
 */
export function ownerIdentityEnabled(): boolean { return true; }

export function maskPlate(plate: string): string {
  const p = plate.toUpperCase();
  return p.length === 7 ? `${p.slice(0, 3)}***${p.slice(-1)}` : '***';
}

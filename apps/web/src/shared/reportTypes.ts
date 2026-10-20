// Espelha o contrato `placanamao.vehicle.report.v2` (apps/api/src/report/normalizeV2.ts), já filtrado por audiência/plano.
export type ItemState = 'NOT_PROVIDED' | 'CLEAR' | 'ALERT' | 'INFO';
export type Verdict = 'CLEAR' | 'ATTENTION' | 'HIGH_RISK' | 'INCONCLUSIVE';
export interface ReportItem { key: string; label: string; kind: string; state: ItemState; value: string | null; display?: string | null; amountCents?: number; masked?: boolean; sensitivity: string; tier: number; component?: boolean; high?: boolean }
export interface ReportSection { key: string; label: string; description: string; status: ItemState; items: ReportItem[]; providedCount: number; notProvidedCount: number }
export interface ReportV2 {
  schema: string; normalizerVersion: number; plate: string;
  headline: { brand?: string; model?: string; fullModel?: string; manufactureYear?: string; modelYear?: string; color?: string; fuel?: string; city?: string; state?: string; status?: string };
  verdict: { level: Verdict; title: string; reason: string; alerts: Array<{ key: string; label: string; value: string; high: boolean }> };
  debts: { totalCents: number; hasDebt: boolean; items: Array<{ key: string; label: string; amountCents: number }>; fineBreakdown: Array<{ key: string; label: string; amountCents: number }>; note: string };
  sections: ReportSection[];
  coverage: { provided: number; total: number; notProvidedKeys: string[]; restrictionsProvided: boolean; debtsProvided: boolean };
  unknownFieldCount: number;
  lockedAlertCount?: number;
  debtsHidden?: boolean;
}
export interface ReportEnvelope { report: ReportV2; verificationCode: string; verificationUrl: string; consultedAt: string; productName: string }

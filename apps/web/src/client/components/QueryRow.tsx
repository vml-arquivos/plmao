import { Link } from 'react-router-dom';
import { Badge, PlateBadge } from '../../shared/ui';
import { dateTime, money } from '../../shared/format';

export interface QuerySummary {
  id: string; plate: string; searchType?: string; searchValue?: string; productId: string; productName: string; status: 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'REFUNDED' | string;
  priceCents: number; createdAt: string; completedAt?: string | null; verificationCode?: string;
  result?: { v2?: { verdict?: { level?: string; title?: string }; headline?: { brand?: string; model?: string; manufactureYear?: string; modelYear?: string } }; fipe?: { brand?: { name: string }; model?: { name: string } } } | null;
}

export const STATUS: Record<string, { tone: 'ok' | 'warn' | 'danger' | 'info'; label: string }> = {
  SUCCESS: { tone: 'ok', label: 'Concluída' }, PROCESSING: { tone: 'info', label: 'Processando' }, FAILED: { tone: 'danger', label: 'Falhou' }, REFUNDED: { tone: 'warn', label: 'Estornada' }
};
export const VERDICT_BADGE: Record<string, { tone: 'ok' | 'warn' | 'danger' | 'info'; label: string }> = {
  CLEAR: { tone: 'ok', label: 'Sem alertas' }, ATTENTION: { tone: 'warn', label: 'Atenção' }, HIGH_RISK: { tone: 'danger', label: 'Risco alto' }, INCONCLUSIVE: { tone: 'info', label: 'Parcial' }
};

export default function QueryRow({ q }: { q: QuerySummary }) {
  const st = STATUS[q.status] ?? { tone: 'info' as const, label: q.status };
  const h = q.result?.v2?.headline;
  const title = h ? [h.brand, h.model].filter(Boolean).join(' ') : q.result?.fipe?.brand && q.result.fipe.model ? `${q.result.fipe.brand.name} ${q.result.fipe.model.name}` : q.productName;
  const verdict = q.result?.v2?.verdict?.level ? VERDICT_BADGE[q.result.v2.verdict.level] : null;
  return (
    <Link to={`/app/consulta/${q.id}`} className="q-row">
      {q.plate ? <PlateBadge plate={q.plate} size="sm" /> : <span className="mono" style={{ fontSize: 13 }}>{q.searchValue}</span>}
      <span className="info"><b className="truncate">{title || q.productName}</b><small>{q.productName} · {q.searchType && q.searchType !== 'PLATE' ? `${{ CHASSIS: 'Chassi', RENAVAM: 'Renavam', OWNER_DOC: 'Documento' }[q.searchType] ?? ''} ${q.searchValue ?? ''} · ` : ''}{dateTime(q.createdAt)}</small></span>
      <span className="end">{q.status === 'SUCCESS' && verdict ? <Badge tone={verdict.tone} dot>{verdict.label}</Badge> : <Badge tone={st.tone} dot>{st.label}</Badge>}<span className="num">{q.priceCents > 0 ? money(q.priceCents) : 'Grátis'}</span></span>
    </Link>
  );
}

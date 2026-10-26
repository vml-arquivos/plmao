import { useEffect, useState } from 'react';
import { api } from '../api';

export interface SupportInfo { phone: string | null; whatsapp: string | null; whatsappUrl: string | null; hours: string | null }
let cached: SupportInfo | null | undefined;

/** Telefone e WhatsApp de suporte, definidos no servidor. Não aparece nada se nenhum estiver configurado. */
export function useSupportInfo(): SupportInfo | null {
  const [info, setInfo] = useState<SupportInfo | null>(cached ?? null);
  useEffect(() => {
    if (cached !== undefined) return;
    api.get<SupportInfo>('/support-info').then((r) => { cached = r; setInfo(r); }, () => { cached = null; });
  }, []);
  return info;
}

export default function SupportChannels({ inline }: { inline?: boolean }) {
  const info = useSupportInfo();
  if (!info || (!info.phone && !info.whatsapp)) return null;
  const phoneHref = info.phone ? `tel:+${(info.phone.replace(/\D/g, '').length <= 11 ? '55' : '') + info.phone.replace(/\D/g, '')}` : '';
  const items = [
    info.phone ? <a key="p" href={phoneHref}>Telefone {info.phone}</a> : null,
    info.whatsapp ? (info.whatsappUrl ? <a key="w" href={info.whatsappUrl} target="_blank" rel="noopener noreferrer">WhatsApp {info.whatsapp}</a> : <span key="w">WhatsApp {info.whatsapp}</span>) : null
  ].filter(Boolean);
  return (
    <span style={{ display: inline ? 'inline' : 'grid', gap: 4 }}>
      {items.map((x, i) => <span key={i}>{inline && i > 0 ? ' · ' : ''}{x}</span>)}
      {info.hours && <small className="muted" style={{ display: 'block' }}>{info.hours}</small>}
    </span>
  );
}

type BrandProps = { compact?: boolean; inverse?: boolean };

export const BRAND = {
  name: 'BUSCARR',
  descriptor: 'consulta e inteligência veicular',
  slogan: 'Busque os fatos. Decida com segurança.',
  // O fallback preserva o canal já operacional até DNS/e-mail BUSCARR serem homologados.
  supportEmail: String(import.meta.env.VITE_SUPPORT_EMAIL || 'contato@carpivara.casadf.com.br').trim()
} as const;

export default function Brand({ compact = false, inverse = false }: BrandProps) {
  return <div className={`brand ${compact ? 'brandCompact' : ''} ${inverse ? 'brandInverse' : ''}`} aria-label={`${BRAND.name}, ${BRAND.descriptor}`}>
    <span className="brandWord"><strong><span className="brandInitial">B</span><span className="brandLetters">USCAR</span><span className="brandSearchR">R<i aria-hidden="true" /></span></strong><small>{BRAND.descriptor}</small></span>
  </div>;
}

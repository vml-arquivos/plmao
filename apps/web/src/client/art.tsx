/** Imagem de capa: cena noturna com carro de frente e luzes da cidade (ilustração própria, arquivo em /brand/hero-night.svg). */
export function HeroArt({ className = '' }: { className?: string }) {
  return <img className={className} src="/brand/hero-night.svg" alt="" aria-hidden="true" decoding="async" fetchPriority="high" />;
}

export function PhoneFrame({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`phone ${className}`}><div className="phone-notch" /><div className="phone-screen">{children}</div></div>;
}

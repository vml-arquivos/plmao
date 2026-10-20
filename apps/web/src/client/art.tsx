import { useId } from 'react';

/** Ilustração original (vetorial): carro sedã em perfil numa avenida à noite. Sem fotos nem personagens de terceiros. */
export function HeroArt({ className = '' }: { className?: string }) {
  const id = useId().replace(/:/g, '');
  const g = (n: string) => `${n}-${id}`;
  const windows: Array<[number, number]> = [];
  for (let i = 0; i < 46; i++) windows.push([(i * 83) % 640, 150 + ((i * 37) % 120)]);
  return (
    <svg className={className} viewBox="0 0 640 480" role="img" aria-label="Ilustração de um carro em uma avenida à noite" preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={g('sky')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0b0b14" /><stop offset=".55" stopColor="#1a1245" /><stop offset="1" stopColor="#4c2a9a" /></linearGradient>
        <linearGradient id={g('road')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#15122b" /><stop offset="1" stopColor="#07070d" /></linearGradient>
        <linearGradient id={g('body')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2b3a8f" /><stop offset=".5" stopColor="#151c4d" /><stop offset="1" stopColor="#0a0d28" /></linearGradient>
        <linearGradient id={g('rim')} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#C084FC" /><stop offset="1" stopColor="#60A5FA" /></linearGradient>
        <linearGradient id={g('glass')} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#3b4aa8" stopOpacity=".9" /><stop offset=".5" stopColor="#0c1034" /><stop offset="1" stopColor="#1a1e55" /></linearGradient>
        <linearGradient id={g('beam')} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#E0E7FF" stopOpacity=".55" /><stop offset="1" stopColor="#8B5CF6" stopOpacity="0" /></linearGradient>
        <radialGradient id={g('glow')} cx=".5" cy=".5" r=".5"><stop offset="0" stopColor="#C084FC" stopOpacity=".55" /><stop offset="1" stopColor="#C084FC" stopOpacity="0" /></radialGradient>
        <linearGradient id={g('refl')} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8B5CF6" stopOpacity=".28" /><stop offset="1" stopColor="#8B5CF6" stopOpacity="0" /></linearGradient>
        <filter id={g('blur')} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" /></filter>
        <filter id={g('blur2')} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2" /></filter>
      </defs>
      <rect width="640" height="480" fill={`url(#${g('sky')})`} />
      <ellipse cx="470" cy="300" rx="330" ry="120" fill={`url(#${g('glow')})`} />
      {/* skyline */}
      <g fill="#0d0b22" opacity=".95">
        {[0, 52, 96, 150, 205, 246, 300, 352, 398, 452, 500, 556, 598].map((x, i) => <rect key={x} x={x} y={190 + ((i * 29) % 70)} width={34 + ((i * 17) % 30)} height={170} />)}
      </g>
      <g fill="#FDE68A" opacity=".55">{windows.map(([x, y], i) => <rect key={i} x={x} y={y + 40} width="2.4" height="3.2" opacity={(i % 3 === 0) ? 1 : .55} />)}</g>
      {/* bokeh */}
      <g filter={`url(#${g('blur')})`}>
        {[[80, 250, 18, '#8B5CF6'], [140, 280, 12, '#3B82F6'], [250, 236, 14, '#F472B6'], [330, 270, 22, '#8B5CF6'], [420, 244, 12, '#60A5FA'], [530, 262, 20, '#C084FC'], [600, 238, 14, '#3B82F6']].map(([x, y, r, c]) => <circle key={String(x)} cx={x as number} cy={y as number} r={r as number} fill={c as string} opacity=".55" />)}
      </g>
      {/* avenida */}
      <path d="M0 330 L640 330 L640 480 L0 480 Z" fill={`url(#${g('road')})`} />
      <path d="M0 330 H640" stroke="#5b3fd6" strokeOpacity=".55" strokeWidth="1.4" />
      <g stroke="#E9D5FF" strokeOpacity=".5">
        <path d="M-40 398 L680 398" strokeWidth="1" strokeDasharray="46 36" />
        <path d="M0 440 L640 440" strokeWidth="1.6" strokeDasharray="70 54" />
      </g>
      <g filter={`url(#${g('blur2')})`} opacity=".8">
        <path d="M0 356 L640 346" stroke="#F472B6" strokeWidth="2" opacity=".5" />
        <path d="M0 372 L640 364" stroke="#60A5FA" strokeWidth="2.4" opacity=".5" />
      </g>
      {/* reflexo */}
      <path d="M90 392 L500 392 L486 450 L110 450 Z" fill={`url(#${g('refl')})`} />
      {/* carro */}
      <g transform="translate(150 244)">
        <ellipse cx="210" cy="152" rx="236" ry="12" fill="#000" opacity=".55" />
        <polygon points="416,86 640,28 640,150 416,100" fill={`url(#${g('beam')})`} transform="translate(0 4)" />
        <path d="M12 100 C8 84 14 70 30 64 L96 54 C120 30 150 14 196 12 L262 12 C292 14 312 40 332 56 L388 66 C408 70 418 84 416 100 L412 112 L18 112 Z" fill={`url(#${g('body')})`} />
        <path d="M30 64 L96 54 C120 30 150 14 196 12 L262 12 C292 14 312 40 332 56 L388 66" fill="none" stroke={`url(#${g('rim')})`} strokeWidth="2.4" strokeLinecap="round" />
        <path d="M104 56 C126 34 152 24 190 22 L224 22 L224 56 Z" fill={`url(#${g('glass')})`} />
        <path d="M234 22 L262 22 C284 26 302 42 316 56 L234 56 Z" fill={`url(#${g('glass')})`} />
        <path d="M30 80 C120 72 300 72 404 82" fill="none" stroke="#7C83FF" strokeOpacity=".5" strokeWidth="1.4" />
        <path d="M122 54 L132 100" stroke="#0a0d28" strokeWidth="1.4" opacity=".7" /><path d="M300 56 L292 100" stroke="#0a0d28" strokeWidth="1.4" opacity=".7" />
        <rect x="246" y="76" width="22" height="4" rx="2" fill="#C084FC" opacity=".7" />
        {[96, 330].map((cx) => (
          <g key={cx}>
            <circle cx={cx} cy="112" r="33" fill="#05060f" />
            <circle cx={cx} cy="112" r="25" fill="#10132e" stroke={`url(#${g('rim')})`} strokeWidth="2" />
            <circle cx={cx} cy="112" r="9" fill="#1d2150" stroke="#8B5CF6" strokeWidth="1.5" />
            {[0, 60, 120, 180, 240, 300].map((a) => <path key={a} d="M0 -9 L0 -23" stroke="#7C83FF" strokeOpacity=".55" strokeWidth="2" transform={`translate(${cx} 112) rotate(${a})`} />)}
          </g>
        ))}
        <ellipse cx="408" cy="88" rx="22" ry="12" fill="#C7D2FE" opacity=".5" filter={`url(#${g('blur2')})`} />
        <path d="M392 80 L414 84 L408 92 L394 90 Z" fill="#F5F3FF" />
        <ellipse cx="18" cy="84" rx="16" ry="8" fill="#F43F5E" opacity=".5" filter={`url(#${g('blur2')})`} />
        <rect x="10" y="80" width="12" height="5" rx="2.5" fill="#FB7185" />
      </g>
    </svg>
  );
}

export function PhoneFrame({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`phone ${className}`}><div className="phone-notch" /><div className="phone-screen">{children}</div></div>;
}

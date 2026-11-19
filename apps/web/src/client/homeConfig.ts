import { useEffect, useState } from 'react';
import { api } from './api';
import { EMPTY_HOME_CONFIG, type HomePayload } from '../shared/homeDefaults';

const FALLBACK: HomePayload = { config: EMPTY_HOME_CONFIG, images: {} };
let cached: HomePayload | null = null;
let inflight: Promise<HomePayload> | null = null;

function load(): Promise<HomePayload> {
  if (cached) return Promise.resolve(cached);
  inflight ??= api.get<HomePayload>('/public/home')
    .then((r) => { cached = { config: { ...EMPTY_HOME_CONFIG, ...r.config }, images: r.images ?? {} }; return cached; })
    .catch(() => { cached = FALLBACK; return cached; })
    .finally(() => { inflight = null; });
  return inflight;
}

/** Configuração da página inicial feita no painel. Se falhar, vale o padrão do site. `ready` só vira true depois da resposta. */
export function useHomeConfig(): HomePayload & { ready: boolean } {
  const [state, setState] = useState<HomePayload | null>(cached);
  useEffect(() => {
    let alive = true;
    void load().then((v) => { if (alive) setState(v); });
    return () => { alive = false; };
  }, []);
  return { ...(state ?? FALLBACK), ready: state !== null };
}

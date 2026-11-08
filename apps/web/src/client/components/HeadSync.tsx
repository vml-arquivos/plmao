import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api';

// Telas que não entram no Google (mesma regra do servidor em seo.ts).
const NOINDEX = /^\/(entrar|criar-conta|recuperar-senha|app|painel|contrato|documento-fiscal|validar|validar-relatorio|r|c|convite|descadastrar|parceiro|consultar|veiculos\/frota|desenvolvedores)(\/|$)/;
const INDEXABLE = 'index,follow,max-image-preview:large';
const descriptions = new Map<string, string | null>();

function meta(selector: string): HTMLMetaElement | null { return document.head.querySelector<HTMLMetaElement>(selector); }
function setContent(selector: string, value: string): void { const el = meta(selector); if (el && el.content !== value) el.content = value; }

/**
 * Mantém o cabeçalho da página certo quando o app troca de tela sem recarregar, ou quando o navegador
 * abre a cópia guardada do index.html (que traz os valores da home): canonical própria, endereço
 * social, descrição e a regra de indexação. O servidor já escreve tudo isso no HTML inicial; aqui só
 * se corrige o que o navegador mostra depois. Nada disso muda o que o Google recebe do servidor.
 */
export default function HeadSync() {
  const { pathname } = useLocation();
  const first = useRef(true);
  const touchedRobots = useRef(false);
  useEffect(() => {
    const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
    const canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    // Primeira tela: se o servidor escreveu o cabeçalho desta página, a canonical já bate com o endereço e nada além dela precisa mudar.
    // Se bate com outro endereço, o navegador abriu a cópia guardada do index.html (valores da home) e tudo precisa ser corrigido.
    let servedHere = false;
    try { servedHere = !!canonical?.href && new URL(canonical.href).pathname.replace(/(.)\/$/, '$1') === path; } catch { /* trata como não servida */ }
    const isFirst = first.current && servedHere; first.current = false;
    let origin = window.location.origin;
    try { if (canonical?.href) origin = new URL(canonical.href).origin; } catch { /* mantém a origem da janela */ }
    const url = `${origin}${path}`;
    if (canonical && canonical.getAttribute('href') !== url) canonical.setAttribute('href', url);
    setContent('meta[property="og:url"]', url);

    const robots = meta('meta[name="robots"]');
    const prelaunch = !!robots && /noarchive/.test(robots.content);
    if (robots && !prelaunch && !isFirst) {
      if (NOINDEX.test(path)) { robots.content = 'noindex,nofollow'; touchedRobots.current = true; }
      else if (touchedRobots.current) { robots.content = INDEXABLE; touchedRobots.current = false; }
    }
    // Dados estruturados da tela anterior não valem para a nova (o servidor escreve os da tela aberta direto).
    if (!isFirst) document.head.querySelectorAll('script[type="application/ld+json"]').forEach((el) => el.remove());

    if (NOINDEX.test(path)) return;
    let live = true;
    const apply = (d: string | null) => { if (!live || !d) return; setContent('meta[name="description"]', d); setContent('meta[property="og:description"]', d); setContent('meta[name="twitter:description"]', d); };
    if (descriptions.has(path)) apply(descriptions.get(path) ?? null);
    else api.get<{ description?: string | null }>('/seo/page', { query: { path } }).then((r) => { descriptions.set(path, r.description ?? null); apply(r.description ?? null); }).catch(() => undefined);
    return () => { live = false; };
  }, [pathname]);
  return null;
}

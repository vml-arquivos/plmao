import { api } from './api';

/**
 * Envia ao suporte os erros de tela do navegador (sem dados pessoais: o servidor limpa e agrupa os repetidos).
 * Limita a poucos envios por visita para nunca virar ruído nem carga.
 */
const sent = new Set<string>();
let count = 0;
export function reportClientError(kind: 'error' | 'promise' | 'boundary', raw: unknown): void {
  try {
    if (count >= 5) return;
    const e = raw instanceof Error ? raw : new Error(typeof raw === 'string' ? raw : 'Erro desconhecido');
    const message = (e.message || 'Erro desconhecido').slice(0, 400);
    if (/ResizeObserver loop|Script error\.?$|Load failed$|NetworkError|Failed to fetch$/i.test(message)) return; // ruído do navegador ou de rede
    const key = `${kind}|${message}`;
    if (sent.has(key)) return;
    sent.add(key); count += 1;
    void api.post('/support/client-error', { message, stack: e.stack?.slice(0, 1500), route: window.location.pathname, kind }).catch(() => undefined);
  } catch { /* nunca quebra a página */ }
}
export function initErrorReporting(): void {
  window.addEventListener('error', (ev) => reportClientError('error', ev.error ?? ev.message));
  window.addEventListener('unhandledrejection', (ev) => reportClientError('promise', ev.reason));
}

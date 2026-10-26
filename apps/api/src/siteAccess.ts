import { env } from './config.js';

/**
 * Modo pré-lançamento (SITE_MODE=prelaunch): o site abre normalmente para quem tem o endereço, mas não é
 * indexado, não entra no sitemap e só e-mails da lista (PRELAUNCH_ALLOWED_EMAILS) criam conta, pagam ou consultam.
 */
export const isPrelaunch = (): boolean => env.SITE_MODE === 'prelaunch';

/** A lista aceita e-mails completos e domínios (@empresa.com), separados por vírgula. */
export function emailAllowed(email: string, list: string = env.PRELAUNCH_ALLOWED_EMAILS): boolean {
  const target = String(email ?? '').trim().toLowerCase();
  if (!target) return false;
  return list.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
    .some((item) => (item.startsWith('@') ? target.endsWith(item) : target === item));
}

export const siteOpenFor = (email: string): boolean => !isPrelaunch() || emailAllowed(email);

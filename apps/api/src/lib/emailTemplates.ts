import { env, publicAppUrl } from '../config.js';

/**
 * Modelos aprovados de e-mail transacional. Regras: nenhum CPF/CNPJ, relatório ou documento anexado no corpo;
 * documentos sensíveis só por link seguro expirável.
 */
export type EmailTemplateName = 'CONTRACT_SIGN_REQUEST' | 'CONTRACT_SIGNED' | 'FISCAL_DOCUMENT_READY' | 'PURCHASE_OTP' | 'GENERIC_NOTICE';
export interface RenderedEmail { subject: string; text: string; html: string }
export type TemplateData = { name?: string; documentTitle?: string; documentNumber?: string; linkPath?: string; token?: string; expiresAt?: string; message?: string };

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');

function shell(title: string, bodyHtml: string, cta?: { href: string; label: string }): string {
  const app = esc(env.APP_NAME || 'Placa na Mão');
  return `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#17201d;max-width:600px;margin:auto"><h1 style="color:#166534;font-size:20px">${esc(title)}</h1>${bodyHtml}${cta ? `<p><a href="${esc(cta.href)}" style="display:inline-block;background:#166534;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px">${esc(cta.label)}</a></p>` : ''}<p style="color:#6b7280;font-size:12px">${app}. Se você não esperava esta mensagem, ignore-a: o link só funciona para quem o recebeu e expira.</p></div>`;
}

export function renderEmail(template: EmailTemplateName, d: TemplateData): RenderedEmail {
  const app = env.APP_NAME || 'Placa na Mão';
  const link = d.linkPath && d.token ? `${publicAppUrl()}${d.linkPath.replace('{token}', encodeURIComponent(d.token))}` : null;
  const greeting = d.name ? `Olá, ${d.name}.` : 'Olá.';
  const exp = d.expiresAt ? `O link é válido até ${when(d.expiresAt)}.` : '';
  switch (template) {
    case 'CONTRACT_SIGN_REQUEST': {
      if (!link) throw new Error('EMAIL_TEMPLATE_LINK_REQUIRED');
      return {
        subject: `Contrato para sua revisão e assinatura | ${app}`,
        text: `${greeting}\n\nHá um contrato${d.documentNumber ? ` (${d.documentNumber})` : ''} aguardando sua revisão e assinatura eletrônica.\n\nAcesse: ${link}\n\n${exp}`,
        html: shell('Contrato para assinatura', `<p>${esc(greeting)}</p><p>Há um contrato${d.documentNumber ? ` <b>${esc(d.documentNumber)}</b>` : ''} aguardando sua revisão e assinatura eletrônica.</p><p>${esc(exp)}</p>`, { href: link, label: 'Revisar e assinar' })
      };
    }
    case 'CONTRACT_SIGNED': {
      if (!link) throw new Error('EMAIL_TEMPLATE_LINK_REQUIRED');
      return {
        subject: `Contrato assinado | ${app}`,
        text: `${greeting}\n\nO contrato${d.documentNumber ? ` ${d.documentNumber}` : ''} foi assinado. Baixe sua cópia: ${link}\n\n${exp}`,
        html: shell('Contrato assinado', `<p>${esc(greeting)}</p><p>O contrato${d.documentNumber ? ` <b>${esc(d.documentNumber)}</b>` : ''} foi assinado. Sua cópia está disponível pelo link abaixo.</p><p>${esc(exp)}</p>`, { href: link, label: 'Baixar cópia' })
      };
    }
    case 'FISCAL_DOCUMENT_READY': {
      if (!link) throw new Error('EMAIL_TEMPLATE_LINK_REQUIRED');
      return {
        subject: `Seu documento fiscal está disponível | ${app}`,
        text: `${greeting}\n\nSeu documento fiscal${d.documentNumber ? ` nº ${d.documentNumber}` : ''} foi emitido. Acesse: ${link}\n\n${exp}`,
        html: shell('Documento fiscal disponível', `<p>${esc(greeting)}</p><p>Seu documento fiscal${d.documentNumber ? ` nº <b>${esc(d.documentNumber)}</b>` : ''} foi emitido.</p><p>${esc(exp)}</p>`, { href: link, label: 'Acessar documento' })
      };
    }
    case 'PURCHASE_OTP': {
      const code = d.token ?? '';
      return {
        subject: `Código para confirmar seu contrato | ${app}`,
        text: `${greeting}\n\nSeu código para aceitar o contrato${d.documentNumber ? ` ${d.documentNumber}` : ''}: ${code}\n\n${d.expiresAt ? `O código vale até ${when(d.expiresAt)}. ` : ''}Não passe este código a ninguém. Se você não pediu, ignore esta mensagem.`,
        html: shell('Confirme seu contrato', `<p>${esc(greeting)}</p><p>Seu código para aceitar o contrato${d.documentNumber ? ` <b>${esc(d.documentNumber)}</b>` : ''}:</p><p style="font-size:30px;letter-spacing:6px;font-weight:bold;color:#166534">${esc(code)}</p><p>${d.expiresAt ? `O código vale até ${esc(when(d.expiresAt))}. ` : ''}Não passe este código a ninguém.</p>`)
      };
    }
    default:
      return { subject: `${d.documentTitle ?? 'Aviso'} | ${app}`, text: `${greeting}\n\n${d.message ?? ''}`, html: shell(d.documentTitle ?? 'Aviso', `<p>${esc(greeting)}</p><p>${esc(d.message ?? '').replace(/\n/g, '<br>')}</p>`) };
  }
}

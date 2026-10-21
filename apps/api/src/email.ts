import nodemailer, { type Transporter } from 'nodemailer';
import { env, publicAppUrl } from './config.js';
import { isEmailConfigurationComplete } from './emailConfig.js';

let transporter: Transporter | undefined;

export function isEmailConfigured(): boolean {
  return isEmailConfigurationComplete({ provider: env.EMAIL_PROVIDER, host: env.SMTP_HOST, user: env.SMTP_USER, password: env.SMTP_PASSWORD });
}

function getTransporter(): Transporter {
  if (!isEmailConfigured()) throw new Error('EMAIL_NOT_CONFIGURED');
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
    });
  }
  return transporter;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'\"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '\"': '&quot;' })[character] ?? character);
}

export async function sendContactMessageEmail(input: { to: string; requesterName: string; requesterEmail: string; subject: string; message: string; category: string; ticketId: string }): Promise<void> {
  const appName = env.APP_NAME || 'Placa na Mão';
  const safeAppName = escapeHtml(appName);
  const safeName = escapeHtml(input.requesterName);
  const safeEmail = escapeHtml(input.requesterEmail);
  const safeSubject = escapeHtml(input.subject);
  const safeMessage = escapeHtml(input.message).replace(/\n/g, '<br>');
  await getTransporter().sendMail({
    from: env.EMAIL_FROM,
    to: input.to,
    replyTo: input.requesterEmail,
    subject: `[${input.category}] ${input.subject} | ${appName}`,
    text: `Novo contato ${input.ticketId}\n\nNome: ${input.requesterName}\nE-mail: ${input.requesterEmail}\nCategoria: ${input.category}\nAssunto: ${input.subject}\n\n${input.message}`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#17201d;max-width:680px;margin:auto"><h1 style="color:#166534">Novo contato | ${safeAppName}</h1><p><b>Ticket:</b> ${escapeHtml(input.ticketId)}</p><p><b>Nome:</b> ${safeName}<br><b>E-mail:</b> ${safeEmail}<br><b>Categoria:</b> ${escapeHtml(input.category)}<br><b>Assunto:</b> ${safeSubject}</p><p>${safeMessage}</p></div>`
  });
}

export async function sendContactConfirmationEmail(input: { to: string; requesterName: string; subject: string; ticketId: string }): Promise<void> {
  const appName = env.APP_NAME || 'Placa na Mão';
  await getTransporter().sendMail({
    from: env.EMAIL_FROM,
    to: input.to,
    subject: `Recebemos sua solicitação ${input.ticketId} | ${appName}`,
    text: `Olá, ${input.requesterName}. Recebemos sua solicitação sobre "${input.subject}". O protocolo é ${input.ticketId}. Nossa equipe retornará pelo e-mail informado quando o canal estiver disponível.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#17201d;max-width:680px;margin:auto"><h1 style="color:#166534">Solicitação recebida</h1><p>Olá, ${escapeHtml(input.requesterName)}.</p><p>Recebemos sua solicitação sobre <b>${escapeHtml(input.subject)}</b>.</p><p>Protocolo: <b>${escapeHtml(input.ticketId)}</b></p><p>Responderemos pelo e-mail informado.</p></div>`
  });
}

export async function sendPasswordResetEmail(input: { to: string; name: string; token: string }): Promise<void> {
  const resetUrl = `${publicAppUrl()}/?reset_token=${encodeURIComponent(input.token)}`;
  const appName = env.APP_NAME || 'Placa na Mão';
  const safeName = escapeHtml(input.name);
  const safeAppName = escapeHtml(appName);
  await getTransporter().sendMail({
    from: env.EMAIL_FROM,
    to: input.to,
    subject: `Redefinição de senha | ${appName}`,
    text: `Olá, ${input.name}.\n\nRecebemos uma solicitação para redefinir sua senha no ${appName}. Acesse este link em até ${env.PASSWORD_RESET_TTL_MINUTES} minutos:\n\n${resetUrl}\n\nSe você não solicitou a alteração, ignore esta mensagem.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#17201d;max-width:600px;margin:auto"><h1 style="color:#166534">Redefinição de senha | ${safeAppName}</h1><p>Olá, ${safeName}.</p><p>Recebemos uma solicitação para redefinir sua senha no ${safeAppName}.</p><p><a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:#166534;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px">Criar nova senha</a></p><p>O link é válido por ${env.PASSWORD_RESET_TTL_MINUTES} minutos e só pode ser usado uma vez.</p><p>Se você não solicitou a alteração, ignore esta mensagem.</p></div>`
  });
}

export type OutgoingMail = { to: string; subject: string; text: string; html: string; messageId?: string; headers?: Record<string, string> };

/** Envio genérico usado pela fila. Devolve o Message-ID aceito pelo servidor SMTP. */
export async function sendMailRaw(mail: OutgoingMail): Promise<{ messageId: string }> {
  const info = await getTransporter().sendMail({ from: env.EMAIL_FROM, to: mail.to, subject: mail.subject, text: mail.text, html: mail.html, messageId: mail.messageId, headers: mail.headers });
  return { messageId: String(info.messageId ?? mail.messageId ?? '') };
}

export { escapeHtml };

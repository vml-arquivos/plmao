import nodemailer, { type Transport, type Transporter } from 'nodemailer';
import { env, publicAppUrl } from './config.js';
import { isEmailConfigurationComplete } from './emailConfig.js';

let transporter: Transporter | undefined;

export function isEmailConfigured(): boolean {
  return isEmailConfigurationComplete({ provider: env.EMAIL_PROVIDER, host: env.SMTP_HOST, user: env.SMTP_USER, password: env.SMTP_PASSWORD, apiKey: env.BREVO_API_KEY });
}

/** Remetente com nome ("Placa na Mão <no-reply@...>"): o endereço continua sendo o EMAIL_FROM verificado no Brevo. */
function fromHeader(): { name: string; address: string } {
  return { name: (env.APP_NAME || 'Placa na Mão').replace(/["\r\n]/g, ''), address: env.EMAIL_FROM };
}

function replyToHeader(): string | undefined {
  return env.EMAIL_REPLY_TO || undefined;
}

type Addr = { name?: string; address?: string } | string | undefined;
function parseAddr(value: unknown): { email: string; name?: string } | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const m = /^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/.exec(value);
    return m ? { email: m[2]!.trim(), ...(m[1]?.trim() ? { name: m[1].trim() } : {}) } : { email: value.trim() };
  }
  const a = value as { name?: string; address?: string };
  return a.address ? { email: a.address, ...(a.name ? { name: a.name } : {}) } : null;
}

type ApiError = Error & { code?: string; responseCode?: number };
function apiError(message: string, code: string, status?: number): ApiError {
  return Object.assign(new Error(message), { code, ...(status ? { responseCode: status } : {}) });
}

async function brevoApi(path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<{ status: number; json: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetch(`${env.BREVO_API_BASE_URL.replace(/\/+$/, '')}${path}`, {
      method: init.method,
      headers: { 'api-key': env.BREVO_API_KEY ?? '', accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(20_000)
    });
  } catch {
    throw apiError('BREVO_API_UNREACHABLE', 'ECONNECTION');
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

/** Envio pela API HTTPS do Brevo (porta 443). Usa o mesmo `sendMail` do nodemailer, então o resto do sistema não muda. */
function brevoApiTransport(): Transport {
  return {
    name: 'brevo-api',
    version: '1',
    send(mail: { data: Record<string, unknown> }, done: (err: Error | null, info?: unknown) => void): void {
      void (async () => {
        const d = mail.data;
        const from = parseAddr(d.from as Addr);
        const toList = (Array.isArray(d.to) ? d.to : [d.to]).map(parseAddr).filter((x): x is { email: string; name?: string } => Boolean(x));
        if (!from || !toList.length) throw apiError('EMAIL_ADDRESS_INVALID', 'EENVELOPE');
        const replyTo = parseAddr(d.replyTo as Addr);
        const headers = Object.fromEntries(Object.entries((d.headers ?? {}) as Record<string, unknown>).filter(([, v]) => typeof v === 'string'));
        const r = await brevoApi('/smtp/email', { method: 'POST', body: {
          sender: { email: from.email, ...(from.name ? { name: from.name } : {}) },
          to: toList.map((t) => ({ email: t.email, ...(t.name ? { name: t.name } : {}) })),
          ...(replyTo ? { replyTo: { email: replyTo.email, ...(replyTo.name ? { name: replyTo.name } : {}) } } : {}),
          subject: String(d.subject ?? ''),
          htmlContent: String(d.html ?? d.text ?? ''),
          ...(d.text ? { textContent: String(d.text) } : {}),
          ...(Object.keys(headers).length ? { headers } : {})
        } });
        if (r.status === 401 || r.status === 403) throw apiError('BREVO_API_AUTH', 'EAUTH', r.status);
        if (r.status < 200 || r.status >= 300) throw apiError(`Brevo API ${r.status}: ${String(r.json.message ?? 'erro')}`.slice(0, 280), 'EMAIL_API_REJECTED', r.status);
        const messageId = String(r.json.messageId ?? '');
        done(null, { messageId, envelope: { from: from.email, to: toList.map((t) => t.email) }, accepted: toList.map((t) => t.email), rejected: [], response: `${r.status} ok` });
      })().catch((e: unknown) => done(e instanceof Error ? e : new Error(String(e))));
    },
    /** O nodemailer repassa `verify()` como veio: com callback ou sem (devolvendo promessa). */
    verify(done?: (err: Error | null, ok?: boolean) => void): Promise<boolean> | undefined {
      const check = async (): Promise<boolean> => {
        const r = await brevoApi('/account', { method: 'GET' });
        if (r.status === 401 || r.status === 403) throw apiError('BREVO_API_AUTH', 'EAUTH', r.status);
        if (r.status !== 200) throw apiError(`Brevo API ${r.status}`, 'ECONNECTION');
        return true;
      };
      if (typeof done === 'function') { check().then(() => done(null, true), (e: unknown) => done(e instanceof Error ? e : new Error(String(e)))); return undefined; }
      return check();
    }
  } as unknown as Transport;
}

function getTransporter(): Transporter {
  if (!isEmailConfigured()) throw new Error('EMAIL_NOT_CONFIGURED');
  if (!transporter && env.EMAIL_PROVIDER === 'brevo_api') transporter = nodemailer.createTransport(brevoApiTransport());
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000
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
    from: fromHeader(),
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
    from: fromHeader(),
    replyTo: replyToHeader(),
    to: input.to,
    subject: `Recebemos sua solicitação ${input.ticketId} | ${appName}`,
    text: `Olá, ${input.requesterName}. Recebemos sua solicitação sobre "${input.subject}". O protocolo é ${input.ticketId}. Nossa equipe retornará pelo e-mail informado quando o canal estiver disponível.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#17201d;max-width:680px;margin:auto"><h1 style="color:#166534">Solicitação recebida</h1><p>Olá, ${escapeHtml(input.requesterName)}.</p><p>Recebemos sua solicitação sobre <b>${escapeHtml(input.subject)}</b>.</p><p>Protocolo: <b>${escapeHtml(input.ticketId)}</b></p><p>Responderemos pelo e-mail informado.</p></div>`
  });
}

export async function sendPasswordResetEmail(input: { to: string; name: string; token: string; ttlMinutes?: number }): Promise<void> {
  const resetUrl = `${publicAppUrl()}/?reset_token=${encodeURIComponent(input.token)}`;
  const ttl = input.ttlMinutes ?? env.PASSWORD_RESET_TTL_MINUTES;
  const ttlLabel = ttl >= 120 ? `${Math.round(ttl / 60)} horas` : `${ttl} minutos`;
  const appName = env.APP_NAME || 'Placa na Mão';
  const safeName = escapeHtml(input.name);
  const safeAppName = escapeHtml(appName);
  await getTransporter().sendMail({
    from: fromHeader(),
    replyTo: replyToHeader(),
    to: input.to,
    subject: `Redefinição de senha | ${appName}`,
    text: `Olá, ${input.name}.\n\nRecebemos uma solicitação para redefinir sua senha no ${appName}. Acesse este link em até ${ttlLabel}:\n\n${resetUrl}\n\nSe você não solicitou a alteração, ignore esta mensagem.`,
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#17201d;max-width:600px;margin:auto"><h1 style="color:#166534">Redefinição de senha | ${safeAppName}</h1><p>Olá, ${safeName}.</p><p>Recebemos uma solicitação para redefinir sua senha no ${safeAppName}.</p><p><a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:#166534;color:#fff;padding:12px 18px;text-decoration:none;border-radius:6px">Criar nova senha</a></p><p>O link é válido por ${ttlLabel} e só pode ser usado uma vez.</p><p>Se você não solicitou a alteração, ignore esta mensagem.</p></div>`
  });
}

export type OutgoingMail = { to: string; subject: string; text: string; html: string; messageId?: string; headers?: Record<string, string> };

/** Envio genérico usado pela fila. Devolve o Message-ID aceito pelo servidor SMTP. */
export async function sendMailRaw(mail: OutgoingMail): Promise<{ messageId: string }> {
  const info = await getTransporter().sendMail({ from: fromHeader(), replyTo: replyToHeader(), to: mail.to, subject: mail.subject, text: mail.text, html: mail.html, messageId: mail.messageId, headers: mail.headers });
  return { messageId: String(info.messageId ?? mail.messageId ?? '') };
}

export { escapeHtml };

/** Confere host, porta e credenciais SMTP sem enviar nada. */
export async function verifyEmailTransport(): Promise<void> {
  await getTransporter().verify();
}

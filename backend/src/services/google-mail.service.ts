import { createHash } from 'node:crypto';

export interface MailMessage { to: string; subject: string; message: string }
export class MailDeliveryError extends Error {
  constructor(public readonly code: string, public readonly diagnostic?: string) { super(code); }
}
// Coalesce simultaneous calls. Durable duplicate protection lives in Apps Script,
// since Render Free's local filesystem/process may disappear on restart.
const pending = new Map<string, Promise<'sent' | 'duplicate'>>();
export async function sendGoogleMail(mail: MailMessage, send: typeof fetch = fetch): Promise<'sent' | 'duplicate'> {
  if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(mail.to) ||
      !mail.subject.trim() || /[\r\n]/.test(mail.subject) || mail.subject.length > 200 ||
      !mail.message.trim() || mail.message.length > 20000) throw new MailDeliveryError('MAIL_INVALID_INPUT');
  const secret = process.env.GOOGLE_MAIL_SECRET;
  let url: URL;
  try { url = new URL(process.env.GOOGLE_SCRIPT_URL || ''); }
  catch { throw new MailDeliveryError('MAIL_NOT_CONFIGURED'); }
  if (!secret?.trim() || url.protocol !== 'https:' || url.hostname !== 'script.google.com' ||
      !/^\/macros\/s\/[\w-]+\/exec$/.test(url.pathname) || url.search || url.hash || url.username || url.password) {
    throw new MailDeliveryError('MAIL_NOT_CONFIGURED');
  }
  const key = createHash('sha256').update(JSON.stringify([url.href, mail.to, mail.subject, mail.message])).digest('hex');
  const existing = pending.get(key);
  if (existing) return existing;
  if (pending.size >= 100) throw new MailDeliveryError('MAIL_BUSY');
  const task = (async (): Promise<'sent' | 'duplicate'> => {
    try {
      const response = await send(url.href, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, to: mail.to, subject: mail.subject, message: mail.message }),
        signal: AbortSignal.timeout(15000), redirect: 'follow',
      });
      if (!response.ok) throw new MailDeliveryError('MAIL_HTTP_ERROR');
      const raw = await response.text();
      let body: { success?: boolean; status?: string; diagnostic?: string };
      try { body = JSON.parse(raw); }
      catch {
        throw new MailDeliveryError(/^\s*</.test(raw) ? 'MAIL_HTML_RESPONSE' : 'MAIL_INVALID_JSON');
      }
      if (body?.success === false) {
        const failures: Record<string, string> = {
          unauthorized: 'MAIL_UNAUTHORIZED',
          invalid_input: 'MAIL_PROVIDER_INVALID_INPUT',
          busy: 'MAIL_PROVIDER_BUSY',
          capacity: 'MAIL_PROVIDER_CAPACITY',
          delivery_unknown: 'MAIL_PROVIDER_DELIVERY_UNKNOWN',
        };
        const stages = ['PARSE','AUTH','DIAGNOSE_QUOTA','VALIDATE','LOCK','LEDGER_READ','QUOTA','RESERVE','SEND','CONFIRM','PENDING_PREVIOUS_ATTEMPT'];
        throw new MailDeliveryError(failures[body.status || ''] || 'MAIL_NOT_CONFIRMED',
          stages.includes(body.diagnostic || '') ? body.diagnostic : undefined);
      }
      if (body?.success !== true || !['sent', 'duplicate'].includes(body.status || '')) {
        throw new MailDeliveryError('MAIL_NOT_CONFIRMED');
      }
      return body.status as 'sent' | 'duplicate';
    } catch (error) {
      if (error instanceof MailDeliveryError) throw error;
      // Never log provider response, recipient, secret or fetch error details.
      throw new MailDeliveryError(error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)
        ? 'MAIL_TIMEOUT_RESULT_UNKNOWN' : 'MAIL_NETWORK_RESULT_UNKNOWN');
    }
  })();
  pending.set(key, task);
  try { return await task; } finally { pending.delete(key); }
}

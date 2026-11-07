import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../config/supabase.js';
import { effectivePeriodStatus } from '../registrations/period-status.js';
import { MailDeliveryError, sendGoogleMail, type MailMessage } from './google-mail.service.js';

type Notice = { id: string; recipient_id: string; title: string; content: string; idempotency_key: string };
type Period = { id: string; branch_id: string; work_start_date: string; work_end_date: string; open_at: string; close_at: string };
type Config = { timezone: string; reminder_minutes: number };
type Options = { db?: SupabaseClient; now?: () => number; send?: (mail: MailMessage) => Promise<'sent' | 'duplicate'>; dryRun?: boolean };
const remembered = new Map<string, number>();
let running = false;
const workerState: { started: boolean; last_checked_at: string | null; last_run_ok: boolean | null } = {
  started: false, last_checked_at: null, last_run_ok: null,
};
export function registrationMailStatus() {
  return { enabled: process.env.EMAIL_NOTIFICATIONS_ENABLED === 'true', ...workerState };
}

export function reminderWindow(period: Period, config: Config, now: number): boolean {
  if (config.timezone !== 'Asia/Ho_Chi_Minh' || !Number.isInteger(config.reminder_minutes) || config.reminder_minutes < 1 || config.reminder_minutes > 1440) return false;
  try {
    if (effectivePeriodStatus(period, now) !== 'OPEN') return false;
    const close = Date.parse(period.close_at);
    // The reminder belongs to the next Monday–Sunday work week. Opening early
    // for development is allowed; it does not change the reminder deadline.
    const localClose = new Date(close + 7 * 3600000);
    if (localClose.getUTCDay() !== 0 || localClose.toISOString().slice(11, 23) !== '12:00:00.000') return false;
    const monday = new Date(Date.UTC(localClose.getUTCFullYear(), localClose.getUTCMonth(), localClose.getUTCDate() + 1));
    const sunday = new Date(monday.getTime() + 6 * 86400000);
    return period.work_start_date === monday.toISOString().slice(0, 10) && period.work_end_date === sunday.toISOString().slice(0, 10) &&
      now >= close - config.reminder_minutes * 60000 && now < close;
  } catch { return false; }
}

export function registrationReminderMessage(notice: Pick<Notice, 'id' | 'title' | 'content'>, to: string): MailMessage {
  return { to, subject: notice.title, message: notice.content + '\n\nMã thông báo: ' + notice.id };
}

function checked<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw new Error('REGISTRATION_MAIL_READ_FAILED');
  return result.data;
}

export async function deliverRegistrationReminders(options: Options = {}) {
  const result = { enabled: process.env.EMAIL_NOTIFICATIONS_ENABLED === 'true', dry_run: options.dryRun === true, eligible: 0, sent: 0, duplicate: 0, skipped: 0, failed: 0, already_running: false };
  if (!result.enabled && !result.dry_run) return result;
  if (running) return { ...result, already_running: true };
  running = true;
  const db = options.db ?? supabaseAdmin, now = options.now ?? Date.now, send = options.send ?? sendGoogleMail;
  try {
    for (const [key, expires] of remembered) if (expires <= now()) remembered.delete(key);
    const config = checked(await db.from('registration_schedule_config').select('timezone,reminder_minutes').eq('singleton', true).single()) as Config;
    if (!config || config.timezone !== 'Asia/Ho_Chi_Minh' || !Number.isInteger(config.reminder_minutes) || config.reminder_minutes < 1 || config.reminder_minutes > 1440) throw new Error('REGISTRATION_MAIL_CONFIG_INVALID');
    const at = now();
    for (let offset = 0; ; offset += 500) {
      const periods = checked(await db.from('registration_periods').select('id,branch_id,work_start_date,work_end_date,open_at,close_at')
        .lte('open_at', new Date(at).toISOString()).gt('close_at', new Date(at).toISOString())
        .lte('close_at', new Date(at + config.reminder_minutes * 60000).toISOString()).order('id').range(offset, offset + 499)) as Period[];
      for (const period of periods ?? []) {
        if (!reminderWindow(period, config, now())) continue;
        for (let from = 0; ; from += 500) {
          const notices = checked(await db.from('notifications').select('id,recipient_id,title,content,idempotency_key')
            .eq('type', 'REGISTRATION_REMINDER').like('idempotency_key', `reg-reminder:${period.id}:%`).order('id').range(from, from + 499)) as Notice[];
          for (const notice of notices ?? []) {
            if (!result.dry_run && remembered.has(notice.id)) { result.skipped++; continue; }
            try {
              const prefix = `reg-reminder:${period.id}:`, employeeId = notice.idempotency_key.slice(prefix.length);
              if (!notice.idempotency_key.startsWith(prefix) || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(employeeId)) { result.skipped++; continue; }
              const employee = checked(await db.from('employees').select('id,user_id,branch_id,status,skill_level').eq('id', employeeId).maybeSingle());
              if (!employee || employee.user_id !== notice.recipient_id || employee.branch_id !== period.branch_id || employee.status !== 'ACTIVE' || !['NEW','REGULAR','CREW_TRAINING'].includes(employee.skill_level)) { result.skipped++; continue; }
              const user = checked(await db.from('users').select('id,role,is_active,branch_id').eq('id', notice.recipient_id).maybeSingle());
              const branch = checked(await db.from('branches').select('status').eq('id', period.branch_id).maybeSingle());
              if (!user || user.role !== 'NV' || user.is_active !== true || user.branch_id !== period.branch_id || branch?.status !== 'ACTIVE') { result.skipped++; continue; }
              const auth = await db.auth.admin.getUserById(user.id);
              if (auth.error) throw new Error('REGISTRATION_MAIL_AUTH_READ_FAILED');
              const email = auth.data.user?.email;
              if (!email) { result.skipped++; continue; }
              // Re-read after Auth/network latency. No stale queue entry may
              // authorize mail after a VALID submission or changed deadline.
              const latest = checked(await db.from('registration_periods').select('id,branch_id,work_start_date,work_end_date,open_at,close_at').eq('id', period.id).maybeSingle()) as Period | null;
              const header = checked(await db.from('registration_submissions').select('status,submitted_at').eq('period_id', period.id).eq('employee_id', employee.id).maybeSingle());
              if (!latest || latest.branch_id !== period.branch_id || !reminderWindow(latest, config, now()) || (header?.status === 'VALID' && header.submitted_at)) { result.skipped++; continue; }
              result.eligible++;
              if (result.dry_run) continue;
              if (process.env.EMAIL_NOTIFICATIONS_ENABLED !== 'true') { result.skipped++; continue; }
              const status = await send(registrationReminderMessage(notice, email));
              remembered.set(notice.id, Date.parse(latest.close_at));
              result[status]++;
            } catch (error) {
              result.failed++;
              // Ambiguous attempts must not be retried by this process. Apps
              // Script's durable reservation also blocks them after restart.
              if (error instanceof MailDeliveryError && ['MAIL_PROVIDER_DELIVERY_UNKNOWN','MAIL_TIMEOUT_RESULT_UNKNOWN','MAIL_NETWORK_RESULT_UNKNOWN','MAIL_HTML_RESPONSE','MAIL_INVALID_JSON','MAIL_NOT_CONFIRMED'].includes(error.code)) remembered.set(notice.id, Date.parse(period.close_at));
              console.warn('[registration-mail]', error instanceof MailDeliveryError ? error.code : 'REGISTRATION_MAIL_READ_FAILED');
            }
          }
          if (!notices || notices.length < 500) break;
        }
      }
      if (!periods || periods.length < 500) break;
    }
    return result;
  } finally { running = false; }
}

export async function runRegistrationMailCycle(options: Options = {}) {
  // Keep the legacy period automation disabled. This RPC only enqueues due
  // reminders using DB time; it cannot create/close periods or change deadlines.
  if (!options.dryRun && process.env.EMAIL_NOTIFICATIONS_ENABLED === 'true') {
    const { error } = await (options.db ?? supabaseAdmin).rpc('enqueue_registration_mail_reminders');
    if (error) throw new Error('REGISTRATION_MAIL_QUEUE_UNAVAILABLE');
  }
  return deliverRegistrationReminders(options);
}

export function startRegistrationMailWorker(run: typeof deliverRegistrationReminders = runRegistrationMailCycle): () => void {
  if (process.env.EMAIL_NOTIFICATIONS_ENABLED !== 'true' || workerState.started) return () => {};
  workerState.started = true;
  console.log('[registration-mail] worker started; interval_ms=60000');
  let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
  const tick = async () => {
    if (stopped) return;
    workerState.last_checked_at = new Date().toISOString();
    try {
      const result = await run();
      workerState.last_run_ok = result.failed === 0;
      if (result.enabled) console.log('[registration-mail]', JSON.stringify(result));
    } catch { workerState.last_run_ok = false; console.warn('[registration-mail] REGISTRATION_MAIL_UNAVAILABLE'); }
    if (!stopped) { timer = setTimeout(() => void tick(), 60000); timer.unref(); }
  };
  void tick();
  return () => { stopped = true; workerState.started = false; if (timer) clearTimeout(timer); };
}

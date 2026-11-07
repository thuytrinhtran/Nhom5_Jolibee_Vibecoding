// Explicit operator command only. No scheduler, listener or database writes.
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { sendGoogleMail, MailDeliveryError } = require('../dist/services/google-mail.service.js');
(async () => {
  const [mode, value, ...extra] = process.argv.slice(2);
  if (!value || extra.length || !['--to', '--notification'].includes(mode)) {
    throw new MailDeliveryError('Usage: npm run mail:send -- --to you@example.com OR --notification UUID');
  }
  let mail;
  if (mode === '--to') {
    mail = { to: value, subject: '[JolliShift] Email kiểm tra', message: 'Đây là email kiểm tra kết nối JolliShift qua Google Apps Script. Không có dữ liệu lịch làm việc nào bị thay đổi.' };
  } else {
    if (!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value)) throw new MailDeliveryError('INVALID_NOTIFICATION_ID');
    const { supabaseAdmin: db } = require('../dist/config/supabase.js');
    const { data: notice, error } = await db.from('notifications').select('id,recipient_id,type,title,content').eq('id', value).maybeSingle();
    if (error || !notice || notice.type !== 'REGISTRATION_REMINDER') throw new MailDeliveryError('REGISTRATION_REMINDER_NOT_FOUND');
    const user = await db.auth.admin.getUserById(notice.recipient_id);
    if (user.error || !user.data.user?.email) throw new MailDeliveryError('RECIPIENT_EMAIL_NOT_FOUND');
    mail = require('../dist/services/registration-mail.service.js').registrationReminderMessage(notice, user.data.user.email);
  }
  console.log('Mail result:', await sendGoogleMail(mail));
})().catch(error => {
  console.error(error instanceof MailDeliveryError ? error.code + (error.diagnostic ? ' stage=' + error.diagnostic : '') : 'MAIL_COMMAND_FAILED');
  process.exitCode = 1;
});

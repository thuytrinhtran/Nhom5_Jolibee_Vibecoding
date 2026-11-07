// No recipient: diagnose configuration and transport without requesting a send.
const fs = require('node:fs'), path = require('node:path'), dotenv = require('dotenv');
const file = path.resolve(__dirname, '../.env');
const parsed = dotenv.parse(fs.readFileSync(file));
dotenv.config({ path: file });
const keys = ['GOOGLE_SCRIPT_URL', 'GOOGLE_MAIL_SECRET'];
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
console.log(JSON.stringify({ configuration: Object.fromEntries(keys.map(key => [key, {
  present: Boolean(process.env[key]?.trim()),
  matchesEnvFile: process.env[key] === parsed[key],
  definitions: lines.filter(line => line.trim().startsWith(key + '=')).length,
}])) }));
(async () => {
  const url = new URL(process.env.GOOGLE_SCRIPT_URL || '');
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || !/^\/macros\/s\/[\w-]+\/exec$/.test(url.pathname) || !process.env.GOOGLE_MAIL_SECRET) throw Error();
  const signal = AbortSignal.timeout(15000);
  let response = await fetch(url, { method: 'POST', redirect: 'manual', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: process.env.GOOGLE_MAIL_SECRET, action: 'diagnose', to: '', subject: '', message: '' }),
  });
  const initialStatus = response.status;
  const location = response.headers.get('location');
  let googleContentRedirect = false;
  if ([301,302,303].includes(response.status) && location) {
    const target = new URL(location, url);
    googleContentRedirect = target.protocol === 'https:' && target.hostname === 'script.googleusercontent.com';
    if (!googleContentRedirect) {
      console.log(JSON.stringify({ initialStatus, unexpectedRedirect: true })); return;
    }
    await response.body?.cancel();
    // Google content redirect is GET; never forward the POST body or secret.
    response = await fetch(target, { method: 'GET', redirect: 'error', signal });
  }
  const raw = await response.text();
  let body;
  try { body = JSON.parse(raw); } catch {}
  const known = ['sent','duplicate','unauthorized','invalid_input','busy','capacity','delivery_unknown','success','error','diagnostic'];
  const text = [body?.message, body?.error].filter(v => typeof v === 'string').join(' ');
  console.log(JSON.stringify({ initialStatus, googleContentRedirect, finalStatus: response.status,
    json: Boolean(body && typeof body === 'object'),
    html: /^\s*</.test(raw),
    contentType: response.headers.get('content-type')?.split(';')[0],
    success: typeof body?.success === 'boolean' ? body.success : 'absent',
    status: known.includes(body?.status) ? body.status : 'absent_or_unrecognized',
    currentContract: body?.contract_version === 'jollishift-mail.v2',
    diagnostic: ['PARSE','AUTH','DIAGNOSE_QUOTA','VALIDATE','LOCK','LEDGER_READ','QUOTA','RESERVE','SEND','CONFIRM','PENDING_PREVIOUS_ATTEMPT'].includes(body?.diagnostic) ? body.diagnostic : 'absent',
    remainingQuota: Number.isSafeInteger(body?.remainingQuota) ? body.remainingQuota : null,
    pendingRecords: Number.isSafeInteger(body?.pendingRecords) ? body.pendingRecords : null,
    errorCategory: /secret|unauthor|forbidden|token|bí mật|không hợp lệ/i.test(text) ? 'authentication_or_invalid_input' :
      /recipient|email|người nhận|missing|required|thiếu/i.test(text) ? 'missing_or_invalid_recipient' : 'unclassified',
    recipientProvided: false,
  }));
})().catch(() => { console.error('MAIL_DIAGNOSTIC_FAILED (details hidden)'); process.exitCode = 1; });

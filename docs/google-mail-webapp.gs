// Reference Web App contract for backend/src/services/google-mail.service.ts.
// Configure GOOGLE_MAIL_SECRET in Script Properties, never in source code.
// Run this ONCE in the Apps Script editor to authorize MailApp; sends no email.
function authorizeMail() {
  return MailApp.getRemainingDailyQuota();
}

function doPost(e) {
  const json = value => ContentService.createTextOutput(JSON.stringify(Object.assign({contract_version:'jollishift-mail.v2'}, value))).setMimeType(ContentService.MimeType.JSON);
  let lock, phase = 'PARSE';
  try {
    const data = JSON.parse(e.postData.contents);
    phase = 'AUTH';
    const properties = PropertiesService.getScriptProperties();
    const expected = properties.getProperty('GOOGLE_MAIL_SECRET');
    if (!expected || data.secret !== expected) return json({success:false,status:'unauthorized'});
    // Read-only probe. No sendEmail, reservation, cleanup or recipient required.
    if (data.action === 'diagnose') {
      phase = 'DIAGNOSE_QUOTA';
      const remainingQuota = MailApp.getRemainingDailyQuota();
      const records = properties.getProperties();
      const pendingRecords = Object.keys(records).filter(k => k.indexOf('mail:') === 0 && JSON.parse(records[k]).state === 'pending').length;
      return json({success:true,status:'diagnostic',remainingQuota:remainingQuota,pendingRecords:pendingRecords});
    }
    phase = 'VALIDATE';
    if (typeof data.to !== 'string' || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(data.to) ||
        typeof data.subject !== 'string' || !data.subject.trim() || /[\r\n]/.test(data.subject) || data.subject.length > 200 ||
        typeof data.message !== 'string' || !data.message.trim() || data.message.length > 20000) {
      return json({success:false,status:'invalid_input'});
    }
    phase = 'LOCK';
    lock = LockService.getScriptLock();
    if (!lock.tryLock(3000)) return json({success:false,status:'busy'});
    phase = 'LEDGER_READ';
    const now = Date.now(), ttl = 7 * 24 * 60 * 60 * 1000;
    const all = properties.getProperties();
    let count = 0;
    Object.keys(all).filter(k => k.indexOf('mail:') === 0).forEach(k => {
      const record = JSON.parse(all[k]);
      if (now - record.at >= ttl) properties.deleteProperty(k); else count++;
    });
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify([data.to,data.subject,data.message]), Utilities.Charset.UTF_8);
    const key = 'mail:' + Utilities.base64EncodeWebSafe(digest);
    const previous = properties.getProperty(key);
    if (previous) {
      const sent = JSON.parse(previous).state === 'sent';
      return json(sent ? {success:true,status:'duplicate'} : {success:false,status:'delivery_unknown',diagnostic:'PENDING_PREVIOUS_ATTEMPT'});
    }
    phase = 'QUOTA';
    if (count >= 1000 || MailApp.getRemainingDailyQuota() < 1) return json({success:false,status:'capacity'});
    // Reserve BEFORE sending: a crash/timeout must not cause an automatic resend.
    // A pending record requires operator investigation, not deletion/retry by code.
    phase = 'RESERVE';
    properties.setProperty(key, JSON.stringify({at:now,state:'pending'}));
    phase = 'SEND';
    MailApp.sendEmail(data.to, data.subject, data.message);
    phase = 'CONFIRM';
    properties.setProperty(key, JSON.stringify({at:now,state:'sent'}));
    return json({success:true,status:'sent'});
  } catch (_) {
    return json({success:false,status:'delivery_unknown',diagnostic:phase});
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}

// Trusted operator only. No network client or environment is loaded on import.
const crypto = require('node:crypto');
const check = (ok, message) => { if (!ok) throw new Error(message); };
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function digest(plan) { const { approval_sha256, ...body } = plan; return sha(JSON.stringify(body)); }
function selectNames(csv) {
  const names = csv?.split(',').map(x => x.trim()).filter(Boolean) || [];
  check(names.length >= 1 && names.length <= 4 && new Set(names).size === names.length && names.every(x => x.length <= 100 && !/[\s\x00-\x1f\x7f]/.test(x)), 'Choose 1-4 explicit unique employee usernames; no --all mode');
  return names;
}
const markerOf = identity => identity.app_metadata?.jollishift_password_reset;
const markerDigest = identity => sha(JSON.stringify(markerOf(identity) ?? null));
function ready(marker, id) {
  return !!id && marker?.id === id && typeof marker.hash === 'string' && /^[a-f0-9]{64}$/i.test(marker.hash)
    && typeof marker.salt === 'string' && marker.salt.length >= 8 && marker.salt.length <= 128 && Number.isInteger(marker.issued_at);
}
async function inspect(client, names) {
  const { data, error } = await client.from('users').select('id,username,role,branch_id,is_active,must_change_password,password_reset_id').in('username', names);
  check(!error && data?.length === names.length, 'Cannot resolve all selected employee profiles');
  const rows = [];
  for (const username of names) {
    const profile = data.find(x => x.username === username);
    check(profile?.role === 'NV' && profile.is_active === true && profile.branch_id && typeof profile.must_change_password === 'boolean', 'Only active NV employees with an assigned branch are supported');
    const { data: auth, error: authError } = await client.auth.admin.getUserById(profile.id);
    check(!authError && auth?.user?.id === profile.id && auth.user.email && !auth.user.deleted_at && (!auth.user.banned_until || Date.parse(auth.user.banned_until) <= Date.now()), 'Auth identity missing or unavailable');
    const employee = await client.from('employees').select('id,user_id,branch_id,status,skill_level').eq('user_id', profile.id).single();
    check(!employee.error && employee.data?.user_id === profile.id && employee.data.branch_id === profile.branch_id && employee.data.status === 'ACTIVE'
      && ['NEW','REGULAR','CREW_TRAINING','CREW_LEADER'].includes(employee.data.skill_level), 'Employee relationship, status or skill is invalid');
    rows.push({ profile, identity: auth.user, employee: employee.data });
  }
  return rows;
}
function snapshot(row) {
  return { ...row.profile, employee_id: row.employee.id, skill_level: row.employee.skill_level,
    identity_digest: sha(row.identity.email), marker_digest: markerDigest(row.identity) };
}
function createPlan(url, rows, recovery = false) {
  for (const row of rows) {
    if (recovery) check(row.profile.must_change_password === true && !ready(markerOf(row.identity), row.profile.password_reset_id), 'Recovery is only for an incomplete pending reset; use the original handoff for a valid reset');
    else check(row.profile.must_change_password === false, 'Pending reset requires its original handoff or explicit incomplete-state recovery');
  }
  const plan = { version: 2, purpose: 'employee-temporary-passwords', project: sha(url), recovery, users: rows.map(snapshot) };
  plan.approval_sha256 = digest(plan);
  return plan;
}
function validatePlan(plan, url, approval) {
  check(plan?.version === 2 && plan.purpose === 'employee-temporary-passwords' && typeof plan.recovery === 'boolean'
    && plan.approval_sha256 === digest(plan) && approval === plan.approval_sha256 && plan.project === sha(url), 'Reviewed v2 plan checksum and matching project required');
  selectNames(plan.users.map(x => x.username).join(','));
  check(new Set(plan.users.map(x => x.id)).size === plan.users.length, 'Duplicate plan identities');
}
function unchanged(row, previous) { return JSON.stringify(snapshot(row)) === JSON.stringify(previous); }
function prepareHandoff(plan, rows, minimum = 12) {
  check(Number.isInteger(minimum) && minimum >= 6 && minimum <= 128, 'Invalid password policy');
  check(rows.length === plan.users.length && rows.every(row => unchanged(row, plan.users.find(p => p.id === row.profile.id))), 'State changed; regenerate and review plan');
  return { plan: plan.approval_sha256, accounts: rows.map(row => ({ id: row.profile.id, username: row.profile.username,
    email: row.identity.email, password: 'Aa1!' + crypto.randomBytes(128).toString('base64url').slice(0, Math.max(32, minimum) - 4),
    reset_id: crypto.randomUUID(), salt: crypto.randomBytes(16).toString('hex'), issued_at: Math.ceil(Date.now()/1000) })) };
}
async function applyAccount(client, plan, account, persist) {
  const previous = plan.users.find(p => p.id === account.id && p.username === account.username);
  check(previous, 'Unexpected handoff account');
  let [row] = await inspect(client, [account.username]);
  check(row.profile.id === previous.id && row.employee.id === previous.employee_id && row.employee.skill_level === previous.skill_level
    && row.profile.branch_id === previous.branch_id && sha(row.identity.email) === previous.identity_digest && row.identity.email === account.email, 'Identity or employee scope changed');
  const hash = crypto.scryptSync(account.password, account.salt, 32).toString('hex');
  const matches = marker => ready(marker, account.reset_id) && marker.hash === hash && marker.salt === account.salt && marker.issued_at === account.issued_at;
  if (row.profile.password_reset_id === account.reset_id) {
    if (!row.profile.must_change_password) { check(matches(markerOf(row.identity)), 'Completed state does not match handoff'); return 'already-completed'; }
    if (matches(markerOf(row.identity))) return 'already-issued';
    check(markerDigest(row.identity) === previous.marker_digest, 'Conflicting Auth reset; do not overwrite');
  } else {
    check(unchanged(row, previous), 'Account has changed or another reset is in progress');
    let query = client.from('users').update({ must_change_password: true, password_reset_id: account.reset_id })
      .eq('id', account.id).eq('role', 'NV').eq('is_active', true).eq('branch_id', previous.branch_id)
      .eq('must_change_password', previous.must_change_password);
    query = previous.password_reset_id ? query.eq('password_reset_id', previous.password_reset_id) : query.is('password_reset_id', null);
    const locked = await query.select('id').maybeSingle();
    check(!locked.error && locked.data, 'Could not reserve reset state; no Auth password issued');
  }
  // Recheck both systems after reserving state. Never clear the business gate on failure.
  [row] = await inspect(client, [account.username]);
  check(row.profile.id === account.id && row.profile.password_reset_id === account.reset_id && row.profile.must_change_password
    && row.profile.branch_id === previous.branch_id && row.employee.id === previous.employee_id
    && row.employee.skill_level === previous.skill_level && sha(row.identity.email) === previous.identity_digest
    && markerDigest(row.identity) === previous.marker_digest, 'Reset reservation changed; stop and inspect');
  account.issued_at = Math.ceil(Date.now()/1000);
  await persist(); // encrypted durable checkpoint BEFORE issuing Auth password
  const result = await client.auth.admin.updateUserById(account.id, { password: account.password,
    app_metadata: { ...row.identity.app_metadata, jollishift_password_reset: { id: account.reset_id, salt: account.salt, hash, issued_at: account.issued_at } } });
  check(!result.error, 'Auth update failed; account stays blocked. Resume SAME plan and encrypted handoff');
  const [verified] = await inspect(client, [account.username]);
  check(verified.profile.password_reset_id === account.reset_id && verified.profile.must_change_password && matches(markerOf(verified.identity)), 'Issuance not verified; resume SAME plan and handoff');
  return 'issued';
}
module.exports = { selectNames, digest, inspect, createPlan, validatePlan, prepareHandoff, applyAccount, ready };

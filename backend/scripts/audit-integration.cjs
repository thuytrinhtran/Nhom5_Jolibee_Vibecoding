// Read-only audit. Does not sign users in or issue any database/Auth write.
const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const env = dotenv.parse(fs.readFileSync(path.resolve(__dirname, '../.env')));
const url = (env.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY || env.SUPABASE_ANON_KEY;
const headers = { apikey: key, Authorization: `Bearer ${key}` };
async function read(endpoint) {
  const response = await fetch(url + endpoint, { headers, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Read failed: HTTP ${response.status}`);
  return response.json();
}
async function all(table) {
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const page = await read(`/rest/v1/${table}?select=*&order=id&limit=500&offset=${offset}`);
    rows.push(...page);
    if (page.length < 500) return rows;
  }
}
(async () => {
  await read('/auth/v1/health');
  const schema = await read('/rest/v1/');
  const tables = ['users','employees','branches','departments','registration_periods','shift_registrations','shifts'];
  const db = {};
  for (const table of tables) db[table] = await all(table);
  const issues = [];
  const by = (table,id) => db[table].find(row => row.id === id);
  const issue = (table,row,reason) => issues.push({ table, id: row.id, reason });
  for (const [table, fields] of [['users',['id','username']],['employees',['id','user_id']],['branches',['id','name']],['departments',['id','name']],['shift_registrations',['id']]]) {
    for (const field of fields) {
      const seen = new Set();
      for (const row of db[table]) { if (seen.has(row[field])) issue(table,row,`duplicate ${field}`); seen.add(row[field]); }
    }
  }
  for (const user of db.users) {
    if (!['NV','QL','GS'].includes(user.role) || typeof user.is_active !== 'boolean' || typeof user.must_change_password !== 'boolean' || (user.branch_id && !by('branches',user.branch_id))) issue('users',user,'invalid role/status/branch');
    if (user.role === 'NV' && !db.employees.some(e=>e.user_id===user.id)) issue('users',user,'NV without employee');
  }
  for (const employee of db.employees) {
    const user = by('users',employee.user_id);
    if (!user || user.role !== 'NV' || user.branch_id !== employee.branch_id || !by('branches',employee.branch_id) || !by('departments',employee.department_id)) issue('employees',employee,'profile role/branch/FK mismatch');
    if (!['NEW','REGULAR','CREW_TRAINING','CREW_LEADER'].includes(employee.skill_level) || !['ACTIVE','INACTIVE'].includes(employee.status)) issue('employees',employee,'invalid skill/status');
  }
  for (const branch of db.branches) {
    if (!['ACTIVE','INACTIVE'].includes(branch.status) || (branch.supervisor_id && by('users',branch.supervisor_id)?.role !== 'GS')) issue('branches',branch,'invalid status/supervisor');
  }
  for (const period of db.registration_periods) {
    const start = Date.parse(period.work_start_date);
    if (!by('branches',period.branch_id) || !['PLANNED','OPEN','CLOSED'].includes(period.status) || new Date(start).getUTCDay() !== 1 || Date.parse(period.work_end_date)-start !== 6*86400000 || !(Date.parse(period.open_at)<Date.parse(period.close_at))) issue('registration_periods',period,'invalid branch/week/window/status');
  }
  const tuples = new Set();
  for (const row of db.shift_registrations) {
    const tuple = [row.period_id,row.employee_id,row.work_date,row.shift_id].join('|');
    if (tuples.has(tuple)) issue('shift_registrations',row,'duplicate tuple'); tuples.add(tuple);
    const period=by('registration_periods',row.period_id), employee=by('employees',row.employee_id), shift=by('shifts',row.shift_id);
    if (!period || !employee || !shift || period.branch_id !== employee.branch_id || (shift.branch_id && shift.branch_id !== employee.branch_id) || row.work_date < period.work_start_date || row.work_date > period.work_end_date || !['DRAFT','VALID','INVALID'].includes(row.status) || employee.skill_level === 'CREW_LEADER') issue('shift_registrations',row,'FK/branch/date/status/leader mismatch');
  }
  console.log(JSON.stringify({ authHealth:'reachable', counts:Object.fromEntries(tables.map(t=>[t,db[t].length])), branches:db.branches.map(b=>({name:b.name,employees:db.employees.filter(e=>e.branch_id===b.id).length,supervisorAssigned:!!b.supervisor_id})),schema:Object.fromEntries(tables.map(t=>[t,{required:schema.definitions?.[t]?.required,columns:Object.keys(schema.definitions?.[t]?.properties||{})}])),issues,limits:'Admin reads do not validate deployed RLS, CHECK constraints, triggers or user write permissions.' },null,2));
})().catch(error => { console.error(error instanceof Error && /^Read failed/.test(error.message) ? error.message : 'Read-only audit failed: configuration or transport error.'); process.exitCode=1; });

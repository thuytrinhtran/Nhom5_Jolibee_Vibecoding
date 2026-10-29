/** Foundation-only provisioning. Default/plan modes are READ ONLY against Supabase. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const TABLES = ['branches', 'departments', 'users', 'employees'];
const BATCH = 'jollishift-foundation-70-v1';
const TARGETS = [
  { key: 'LD', name: 'Jollibee Lê Duẩn', total: 60, departments: { 'Bếp': 25, 'Phục vụ': 20, 'Thu ngân': 15 }, skills: { NEW: 8, REGULAR: 36, CREW_TRAINING: 10, CREW_LEADER: 6 } },
  { key: 'HC', name: 'Chi nhánh mô phỏng Hải Châu', total: 10, departments: { 'Bếp': 4, 'Phục vụ': 3, 'Thu ngân': 3 }, skills: { NEW: 2, REGULAR: 6, CREW_TRAINING: 1, CREW_LEADER: 1 } },
];
const NAMES = [
  'Trần Minh Anh', 'Nguyễn Hoàng Nam', 'Lê Ngọc Hà', 'Phạm Gia Huy', 'Hoàng Thùy Linh',
  'Huỳnh Đức Anh', 'Phan Bảo Ngọc', 'Vũ Tuấn Kiệt', 'Võ Thanh Trúc', 'Đặng Minh Khang',
  'Bùi Khánh Chi', 'Đỗ Quang Huy', 'Hồ Phương Thảo', 'Ngô Nhật Minh', 'Dương Yến Nhi',
  'Lý Thành Đạt', 'Trịnh Diệu Anh', 'Đinh Hải Đăng', 'Mai Ngọc Hân', 'Cao Bảo Long',
  'Nguyễn Thảo Nguyên', 'Trần Quốc Bảo', 'Lê Kim Ngân', 'Phạm Anh Dũng', 'Hoàng Ngọc Mai',
  'Huỳnh Quang Vinh', 'Phan Minh Châu', 'Vũ Hoài Nam', 'Võ Hà My', 'Đặng Gia Bảo',
  'Bùi Thanh Tâm', 'Đỗ Đức Huy', 'Hồ Khánh Linh', 'Ngô Trung Hiếu', 'Dương Bích Ngọc',
  'Lý Minh Quân', 'Trịnh Phương Anh', 'Đinh Tuấn Anh', 'Mai Thu Hà', 'Cao Nhật Hào',
  'Nguyễn Hải Yến', 'Trần Đăng Khoa', 'Lê Hoàng Oanh', 'Phạm Quốc Hưng', 'Hoàng Thanh Vy',
  'Huỳnh Công Thành', 'Phan Tú Anh', 'Vũ Minh Trí', 'Võ Ngọc Diệp', 'Đặng Thanh Phong',
  'Bùi Bảo Trân', 'Đỗ Văn Khải', 'Hồ Hồng Nhung', 'Ngô Gia Phúc', 'Dương Cẩm Tú',
  'Lý Đức Minh', 'Trịnh Khánh Hòa', 'Đinh Ngọc Quỳnh', 'Mai Hoàng Phúc', 'Cao Thùy Dương',
  'Nguyễn Anh Thư', 'Trần Minh Đức', 'Lê Bảo Hân', 'Phạm Tuấn Tú', 'Hoàng Gia Linh',
  'Huỳnh Nhật Tân', 'Phan Thanh Hằng', 'Vũ Quốc Anh', 'Võ Minh Nguyệt', 'Đặng Ngọc Sơn',
];
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function uuid(label) {
  const b = crypto.createHash('sha1').update(`${BATCH}:${label}`).digest().subarray(0, 16);
  b[6] = (b[6] & 15) | 80; b[8] = (b[8] & 63) | 128;
  const h = b.toString('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
function fail(message) { throw new Error(message); }
function check(condition, message) { if (!condition) fail(message); }
function digest(plan) { const { approval_sha256, ...body } = plan; return hash(JSON.stringify(body)); }
function schemaCheck(api) {
  for (const [table, fields] of Object.entries({ branches: ['id','name','status'], departments: ['id','name'], users: ['id','username','role','branch_id','is_active'], employees: ['id','user_id','full_name','branch_id','department_id','skill_level','status'] })) {
    for (const field of fields) check(api.definitions?.[table]?.properties?.[field], `Schema missing ${table}.${field}`);
    for (const field of api.definitions[table].required || []) check(fields.includes(field) || api.definitions[table].properties[field]?.default !== undefined, `Unsupported required column ${table}.${field}`);
  }
  check(api.definitions.employees.properties.user_id.description?.includes("table='users'"), 'Employee/profile FK metadata changed');
}
function buildPlan(snapshot, api, projectFingerprint) {
  schemaCheck(api);
  const additions = Object.fromEntries(TABLES.map(t => [t, []]));
  const roster = []; const usedNames = new Set(snapshot.employees.map(e => e.full_name.normalize('NFC')));
  const name = () => { const n = NAMES.find(n => !usedNames.has(n)); check(n, 'Name pool exhausted'); usedNames.add(n); return n; };
  for (const target of TARGETS) {
    let branch = snapshot.branches.find(b => b.name === target.name);
    if (!branch) { branch = { id: uuid(`branch:${target.key}`), name: target.name, status: 'ACTIVE' }; additions.branches.push(branch); }
    check(branch.status === 'ACTIVE', `Branch ${target.key} is inactive; existing rows will not be changed`);
    const departments = {};
    for (const label of Object.keys(target.departments)) {
      let department = [...snapshot.departments, ...additions.departments].find(d => d.name === label);
      if (!department) { department = { id: uuid(`department:${label}`), name: label }; additions.departments.push(department); }
      departments[label] = department;
    }
    const remainingDepartments = { ...target.departments }, remainingSkills = { ...target.skills };
    const consume = employee => {
      const label = Object.keys(departments).find(k => departments[k].id === employee.department_id);
      check(label && remainingDepartments[label] > 0, `Existing department count is incompatible in ${target.key}`);
      check(remainingSkills[employee.skill_level] > 0, `Existing skill count is incompatible in ${target.key}`);
      check(['ACTIVE','INACTIVE'].includes(employee.status), 'Invalid employee status');
      remainingDepartments[label]--; remainingSkills[employee.skill_level]--;
      const profile = snapshot.users.find(u => u.id === employee.user_id) || additions.users.find(u => u.id === employee.user_id);
      check(profile && profile.role === 'NV' && profile.branch_id === branch.id, 'Existing employee/profile role or branch mismatch; no automatic updates');
      roster.push({ employee_code: profile.username, username: profile.username, ...employee, branch_name: branch.name, department_name: label, source: snapshot.employees.some(e => e.id === employee.id) ? 'preserve' : snapshot.users.some(u => u.id === employee.user_id) ? 'existing-profile' : 'new-auth' });
    };
    const existing = snapshot.employees.filter(e => e.branch_id === branch.id);
    check(existing.length <= target.total, `Too many existing employees in ${target.key}`);
    existing.forEach(consume);
    let skillIndex = 0;
    const allocate = (userId, employeeId, fullName) => {
      const departmentName = Object.keys(remainingDepartments).sort((a,b) => remainingDepartments[b] - remainingDepartments[a]).find(k => remainingDepartments[k] > 0);
      const cycle = ['REGULAR','NEW','REGULAR','CREW_TRAINING','REGULAR','CREW_LEADER','REGULAR'];
      let skill;
      for (let n = 0; n < cycle.length; n++) { const candidate = cycle[skillIndex++ % cycle.length]; if (remainingSkills[candidate] > 0) { skill = candidate; break; } }
      skill ||= Object.keys(remainingSkills).find(k => remainingSkills[k] > 0);
      check(departmentName && skill, 'No capacity left for an existing NV profile');
      const employee = { id: employeeId, user_id: userId, full_name: fullName, branch_id: branch.id, department_id: departments[departmentName].id, skill_level: skill, status: 'ACTIVE' };
      additions.employees.push(employee); consume(employee);
    };
    const unlinked = snapshot.users.filter(u => u.role === 'NV' && u.branch_id === branch.id && !snapshot.employees.some(e => e.user_id === u.id));
    for (const profile of unlinked) {
      check(profile.is_active === true, 'Inactive unlinked NV profile requires manual scope review');
      allocate(profile.id, uuid(`employee:existing:${profile.id}`), name());
    }
    while (roster.filter(e => e.branch_id === branch.id).length < target.total) {
      const ordinal = roster.filter(e => e.branch_id === branch.id).length + 1;
      const username = `js_${target.key.toLowerCase()}_${String(ordinal).padStart(3,'0')}`;
      check(!snapshot.users.some(u => u.username === username), 'Generated username already belongs to an existing profile');
      const userId = uuid(`user:${username}`);
      additions.users.push({ id: userId, username, role: 'NV', branch_id: branch.id, is_active: true });
      allocate(userId, uuid(`employee:${username}`), name());
    }
    check(Object.values(remainingDepartments).every(n => n === 0) && Object.values(remainingSkills).every(n => n === 0), 'Quota allocation failed');
  }
  for (const table of TABLES) {
    const ids = [...snapshot[table], ...additions[table]].map(r => r.id);
    check(new Set(ids).size === ids.length, `ID collision in ${table}`);
  }
  check(new Set(roster.map(r => r.username)).size === 70, 'Employee code collision');
  const plan = { version: 1, batch: BATCH, project_fingerprint: projectFingerprint, schema: Object.fromEntries(TABLES.map(t => [t, api.definitions[t]])), targets: TARGETS, baseline: snapshot, additions, roster };
  plan.approval_sha256 = digest(plan); return plan;
}
function literal(value) { return "'" + JSON.stringify(value).replace(/'/g, "''") + "'::jsonb"; }
function publicSql(plan) {
  return `-- GENERATED REVIEW ARTIFACT. Does not create Auth accounts. Run only AFTER approval and Auth provisioning.\nBEGIN;\nSET LOCAL TIME ZONE 'UTC';\nSELECT pg_advisory_xact_lock(hashtext('${BATCH}'));\nLOCK TABLE public.branches, public.departments, public.users, public.employees IN SHARE ROW EXCLUSIVE MODE;\nDO $seed$\nDECLARE\n p jsonb := ${literal(plan)};\n t text; r jsonb; actual jsonb; n integer;\nBEGIN\n -- Preserve every original row; reject unrelated new rows and conflicting planned IDs.\n FOREACH t IN ARRAY ARRAY['branches','departments','users','employees'] LOOP\n  FOR r IN SELECT value FROM jsonb_array_elements(p->'baseline'->t) LOOP\n   EXECUTE format('SELECT to_jsonb(x) FROM public.%I x WHERE id = $1::uuid', t) INTO actual USING r->>'id';\n   IF actual IS DISTINCT FROM r THEN RAISE EXCEPTION 'Baseline drift in %; regenerate and review plan', t; END IF;\n  END LOOP;\n  EXECUTE format('SELECT count(*) FROM public.%I x WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements($1) b WHERE b->>''id'' = x.id::text) AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements($2) a WHERE a->>''id'' = x.id::text)', t)\n   INTO n USING p->'baseline'->t, p->'additions'->t;\n  IF n > 0 THEN RAISE EXCEPTION 'Unexpected rows in %; regenerate and review plan', t; END IF;\n  FOR r IN SELECT value FROM jsonb_array_elements(p->'additions'->t) LOOP\n   EXECUTE format('SELECT to_jsonb(x) FROM public.%I x WHERE id = $1::uuid', t) INTO actual USING r->>'id';\n   IF actual IS NOT NULL AND NOT actual @> r THEN RAISE EXCEPTION 'Conflicting planned row in %; no overwrite', t; END IF;\n  END LOOP;\n END LOOP;\n FOR r IN SELECT value FROM jsonb_array_elements(p->'additions'->'users') LOOP\n  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = (r->>'id')::uuid AND u.email = ((r->>'username') || '@example.invalid') AND u.raw_app_meta_data->>'seed_batch' = '${BATCH}') THEN\n   RAISE EXCEPTION 'Missing/mismatched Auth identity; run approved Admin API step first';\n  END IF;\n END LOOP;\n -- INSERT only missing rows, never UPDATE/DELETE/upsert. Defaults are left to PostgreSQL.\n INSERT INTO public.branches(id,name,status) SELECT x.id,x.name,x.status FROM jsonb_to_recordset(p->'additions'->'branches') AS x(id uuid,name text,status text) WHERE NOT EXISTS(SELECT 1 FROM public.branches b WHERE b.id=x.id);\n INSERT INTO public.departments(id,name) SELECT x.id,x.name FROM jsonb_to_recordset(p->'additions'->'departments') AS x(id uuid,name text) WHERE NOT EXISTS(SELECT 1 FROM public.departments d WHERE d.id=x.id);\n INSERT INTO public.users(id,username,role,branch_id,is_active) SELECT x.id,x.username,x.role,x.branch_id,x.is_active FROM jsonb_to_recordset(p->'additions'->'users') AS x(id uuid,username text,role text,branch_id uuid,is_active boolean) WHERE NOT EXISTS(SELECT 1 FROM public.users u WHERE u.id=x.id);\n INSERT INTO public.employees(id,user_id,full_name,branch_id,department_id,skill_level,status) SELECT x.id,x.user_id,x.full_name,x.branch_id,x.department_id,x.skill_level,x.status FROM jsonb_to_recordset(p->'additions'->'employees') AS x(id uuid,user_id uuid,full_name text,branch_id uuid,department_id uuid,skill_level text,status text) WHERE NOT EXISTS(SELECT 1 FROM public.employees e WHERE e.id=x.id);\n -- Detect unexpected effects of public-table triggers before committing.\n FOREACH t IN ARRAY ARRAY['branches','departments','users','employees'] LOOP\n  FOR r IN SELECT value FROM jsonb_array_elements(p->'baseline'->t) LOOP\n   EXECUTE format('SELECT to_jsonb(x) FROM public.%I x WHERE id = $1::uuid', t) INTO actual USING r->>'id';\n   IF actual IS DISTINCT FROM r THEN RAISE EXCEPTION 'Trigger changed original row in %; rolling back', t; END IF;\n  END LOOP;\n  FOR r IN SELECT value FROM jsonb_array_elements(p->'additions'->t) LOOP\n   EXECUTE format('SELECT to_jsonb(x) FROM public.%I x WHERE id = $1::uuid', t) INTO actual USING r->>'id';\n   IF actual IS NULL OR NOT actual @> r THEN RAISE EXCEPTION 'Inserted row mismatch in %; rolling back', t; END IF;\n  END LOOP;\n END LOOP;\n -- All 70 approved roster rows must match, including preserved identities.\n FOR r IN SELECT value FROM jsonb_array_elements(p->'roster') LOOP\n  SELECT to_jsonb(e) INTO actual FROM public.employees e WHERE e.id=(r->>'id')::uuid;\n  IF actual IS NULL OR NOT actual @> (r - ARRAY['employee_code','username','branch_name','department_name','source']) THEN RAISE EXCEPTION 'Roster verification failed'; END IF;\n END LOOP;\n FOR r IN SELECT value FROM jsonb_array_elements(p->'targets') LOOP\n  SELECT count(*) INTO n FROM public.employees e JOIN public.branches b ON b.id=e.branch_id WHERE b.name=r->>'name';\n  IF n <> (r->>'total')::integer THEN RAISE EXCEPTION 'Branch total failed'; END IF;\n END LOOP;\nEND $seed$;\nCOMMIT;\n`;
}
async function connect() {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
  const url = (process.env.SUPABASE_URL || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  check(url && key, 'Set server-only SUPABASE_URL and SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY');
  const { createClient } = require('@supabase/supabase-js');
  return { url, key, client: createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}) };
}
async function listAuth(client) {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await client.auth.admin.listUsers({page,perPage:1000});
    check(!error, 'Cannot read Auth users; check server credentials'); users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}
async function snapshotOf(client) {
  const snapshot = {};
  for (const table of TABLES) {
    const rows = [];
    for (let offset=0; ; offset+=1000) {
      const {data,error}=await client.from(table).select('*').order('id').range(offset,offset+999);
      check(!error, `Cannot inspect ${table}`); rows.push(...data); if(data.length<1000)break;
    }
    snapshot[table]=rows;
  }
  return snapshot;
}
function subset(actual, expected) { return Object.keys(expected).every(k => JSON.stringify(actual[k]) === JSON.stringify(expected[k])); }
function verifyDrift(plan, snapshot) {
  for(const table of TABLES) {
    for(const row of plan.baseline[table]) check(snapshot[table].some(x=>x.id===row.id && subset(x,row)),`Baseline drift in ${table}; no writes performed`);
    for(const row of snapshot[table]) {
      const original=plan.baseline[table].find(x=>x.id===row.id), planned=plan.additions[table].find(x=>x.id===row.id);
      check(original || (planned && subset(row,planned)), `Unexpected/conflicting row in ${table}`);
    }
  }
}
async function main() {
  const [mode='help', ...args] = process.argv.slice(2);
  if(mode==='help') { console.log('plan <output-directory> | auth <plan.json> --approve <sha256>'); return; }
  check(['plan','auth'].includes(mode),'Unknown mode');
  if(mode==='auth') {
    const file=args[0]; check(file,'Plan file required');
    const plan=JSON.parse(fs.readFileSync(file,'utf8'));
    check(plan.batch===BATCH && plan.approval_sha256===digest(plan),'Invalid/tampered plan');
    const i=args.indexOf('--approve'); check(i>=0 && args[i+1]===plan.approval_sha256,'Explicit reviewed plan SHA256 required; no writes performed');
    const {client,url}=await connect(); check(hash(url)===plan.project_fingerprint,'Wrong Supabase project');
    verifyDrift(plan,await snapshotOf(client));
    const authUsers=await listAuth(client);
    for(const profile of plan.baseline.users) check(authUsers.some(u=>u.id===profile.id),'Existing profile missing Auth identity');
    for(const profile of plan.additions.users) {
      const expectedEmail=profile.username+'@example.invalid';
      const byId=authUsers.find(u=>u.id===profile.id), byEmail=authUsers.find(u=>u.email?.toLowerCase()===expectedEmail);
      check(!byId || (byId.email===expectedEmail && byId.app_metadata?.seed_batch===BATCH && byId.app_metadata?.seed_username===profile.username),'Auth ID collision; no overwrite');
      check(!byEmail || byEmail.id===profile.id,'Auth email collision; no overwrite');
    }
    let created=0, reused=0;
    for(const profile of plan.additions.users) {
      if(authUsers.some(u=>u.id===profile.id)){reused++;continue;}
      const {data,error}=await client.auth.admin.createUser({id:profile.id,email:profile.username+'@example.invalid',password:crypto.randomBytes(36).toString('base64url'),email_confirm:true,app_metadata:{seed_batch:BATCH,seed_username:profile.username}});
      check(!error && data.user?.id===profile.id,'Auth provisioning stopped; rerun SAME approved plan after inspection. No credentials logged.');
      created++; console.log(`Auth progress: ${created + reused}/${plan.additions.users.length}`);
    }
    console.log(JSON.stringify({created,reused,next:'Review/run apply-public.sql in Supabase SQL Editor. No public-table writes were issued by this script.'}));
    return;
  }
  const out=path.resolve(args[0] || path.resolve(__dirname,'../../docs/seed-foundation'));
  check(!fs.existsSync(path.join(out,'plan.json')), 'Output already has a plan; use a new directory rather than overwrite a reviewed plan');
  const {client,url,key}=await connect();
  const response=await fetch(url+'/rest/v1/',{headers:{apikey:key,Authorization:`Bearer ${key}`,Accept:'application/openapi+json'}});
  check(response.ok,'Cannot read live PostgREST schema');
  const api=await response.json(); const snapshot=await snapshotOf(client); const auth=await listAuth(client);
  for(const profile of snapshot.users) check(auth.some(u=>u.id===profile.id),'Existing profile has no Auth identity; manual review required');
  const plan=buildPlan(snapshot,api,hash(url));
  fs.mkdirSync(out,{recursive:true});
  fs.writeFileSync(path.join(out,'plan.json'),JSON.stringify(plan,null,2)+'\n');
  fs.writeFileSync(path.join(out,'apply-public.sql'),publicSql(plan));
  fs.writeFileSync(path.join(out,'roster.csv'),'\ufeff'+['employee_code,full_name,branch,department,skill_level,status,source',...plan.roster.map(r=>[r.username,r.full_name,r.branch_name,r.department_name,r.skill_level,r.status,r.source].map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(','))].join('\n')+'\n');
  console.log(JSON.stringify({mode:'READ_ONLY_PLAN',roster:plan.roster.length,preserved:plan.roster.filter(r=>r.source==='preserve').length,existingProfilesToComplete:plan.roster.filter(r=>r.source==='existing-profile').length,newAuthAccounts:plan.additions.users.length,approval_sha256:plan.approval_sha256}));
}
module.exports={buildPlan,publicSql,digest,schemaCheck,verifyDrift,TARGETS,BATCH};
if(require.main===module)main().catch(error=>{console.error(error.message);process.exitCode=1;});

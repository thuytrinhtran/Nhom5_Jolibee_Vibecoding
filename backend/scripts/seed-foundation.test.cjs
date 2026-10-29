const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {buildPlan, publicSql, digest, verifyDrift} = require('./seed-foundation.cjs');
const planPath=path.resolve(__dirname,'../../docs/seed-foundation/plan.json');
const approved=JSON.parse(fs.readFileSync(planPath,'utf8'));
const api={definitions:approved.schema};
const clone=value=>JSON.parse(JSON.stringify(value));

test('70 unique named employees, exact branch/department/skill quotas',()=>{
 assert.equal(approved.roster.length,70);
 assert.equal(new Set(approved.roster.map(r=>r.username)).size,70);
 assert.equal(new Set(approved.roster.map(r=>r.id)).size,70);
 assert.equal(new Set(approved.roster.map(r=>r.user_id)).size,70);
 assert.equal(new Set(approved.roster.map(r=>r.full_name)).size,70);
 for(const target of approved.targets){
  const rows=approved.roster.filter(r=>r.branch_name===target.name);
  assert.equal(rows.length,target.total);
  for(const [name,n] of Object.entries(target.departments))assert.equal(rows.filter(r=>r.department_name===name).length,n);
  for(const [name,n] of Object.entries(target.skills))assert.equal(rows.filter(r=>r.skill_level===name).length,n);
 }
 assert.ok(approved.roster.every(r=>r.full_name.trim() && r.username.trim() && ['ACTIVE','INACTIVE'].includes(r.status)));
 assert.equal(approved.approval_sha256,digest(approved));
});

test('original employee fields and account records are preserved',()=>{
 for(const employee of approved.baseline.employees.filter(e=>approved.roster.some(r=>r.id===e.id))){
  const row=approved.roster.find(r=>r.id===employee.id);
  for(const [key,value] of Object.entries(employee))assert.deepEqual(row[key],value);
 }
 assert.equal(approved.additions.users.length,68);
 assert.equal(approved.additions.employees.length,69);
 assert.equal(approved.roster.filter(r=>r.source==='existing-profile').length,1);
 assert.ok(approved.additions.users.every(u=>!approved.baseline.users.some(old=>old.id===u.id||old.username===u.username)));
});

test('replanning after completion creates no extra records',()=>{
 const completed={};for(const table of ['branches','departments','users','employees'])completed[table]=[...approved.baseline[table],...approved.additions[table]];
 const next=buildPlan(completed,api,approved.project_fingerprint);
 assert.equal(next.roster.length,70);
 for(const records of Object.values(next.additions))assert.equal(records.length,0);
 verifyDrift(approved,completed);
});

test('unexpected writes, invalid quotas and inactive branch are rejected',()=>{
 const changed=clone(approved.baseline);changed.users[0].username+='-changed';
 assert.throws(()=>verifyDrift(approved,changed),/Baseline drift/);
 const oversize=clone(approved.baseline);
 for(let n=0;n<26;n++)oversize.employees.push({...oversize.employees[0],id:'fixture-'+n});
 assert.throws(()=>buildPlan(oversize,api,approved.project_fingerprint));
 const inactive=clone(approved.baseline);inactive.branches[0].status='INACTIVE';
 assert.throws(()=>buildPlan(inactive,api,approved.project_fingerprint),/inactive/);
});

test('SQL is transactional, insert-only, and never inserts auth or workflow data',()=>{
 const sql=publicSql(approved);
 assert.ok(sql.includes('BEGIN;')&&sql.includes('COMMIT;'));
 const tables=[...sql.matchAll(/INSERT INTO ([\w.]+)/g)].map(m=>m[1]);
 assert.deepEqual(tables,['public.branches','public.departments','public.users','public.employees']);
 assert.ok(!/INSERT INTO auth\.|UPDATE public\.|DELETE FROM/i.test(sql));
 assert.ok(sql.includes('Baseline drift'));
});

test('Auth mode rejects absent approval before any connection or account creation',()=>{
 const result=spawnSync(process.execPath,[path.join(__dirname,'seed-foundation.cjs'),'auth',planPath],{encoding:'utf8'});
 assert.equal(result.status,1);
 assert.match(result.stderr,/Explicit reviewed plan SHA256 required/);
});

const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {existingFixture,shortageFixture}=require('../scripts/prepare-existing-employee-fixtures.cjs');
const {generateSchedule,reviewAssignments}=require('../dist/services/scheduling.engine.js');
const dir=path.resolve(__dirname,'../../docs/demo-datasets/1793634151022');
test('existing staff fixture preserves real rows and demand, adds no account, and is deterministic',()=>{
 const input=JSON.parse(fs.readFileSync(path.join(dir,'real-source-input.json'))),before=structuredClone(input),headers=input.registration_provenance.map(h=>h.employee_id);
 const a=existingFixture(input,headers),b=existingFixture(input,headers);
 assert.deepEqual(a.seed,b.seed);assert.deepEqual(a.result,b.result);assert.deepEqual(input,before);
 assert.deepEqual(a.input.registrations.slice(0,input.registrations.length),input.registrations);assert.deepEqual(a.input.requirements,input.requirements);
 assert.equal(a.seed.auth_profiles_to_provision.length,0);assert.equal(a.seed.employees_to_insert.length,0);
 assert.ok(a.seed.submission_headers_to_insert.every(h=>!headers.includes(h.employee_id)));
 assert.equal(a.result.assigned_count,a.result.required_count);assert.equal(a.result.shortages.length,0);assert.equal(a.result.composition_shortages.length,0);
 assert.ok(a.result.assignments.every(assignment=>a.input.registrations.some(r=>r.status==='VALID'&&r.employee_id===assignment.employee_id&&r.work_date===assignment.work_date&&r.shift_id===assignment.shift_id)));
 reviewAssignments(a.input,a.result.assignments);
});
test('independent small fixture exposes shortages; changing teacher demand changes computed totals',()=>{
 const {input,result}=shortageFixture();assert.equal(input.employees.length,9);assert.equal(result.required_count,36);assert.equal(result.assigned_count,21);assert.equal(result.required_count-result.assigned_count,15);
 reviewAssignments(input,result.assignments);
 const changed=structuredClone(input);changed.requirements.forEach(r=>r.required_count=2);const smaller=generateSchedule(changed);assert.equal(smaller.required_count,24);assert.ok(smaller.assigned_count<=24);assert.ok(smaller.shortages.length>0);
 assert.deepEqual(generateSchedule(input),result);
});
test('existing-only import policy rejects account creation and unknown policies; legacy payload still validates',()=>{
 const {validatePayload}=require('../scripts/dev-import-executor.cjs');const seed=JSON.parse(fs.readFileSync(path.join(dir,'existing-employees-seed.json')));
 const p={fixture_policy:seed.fixture_policy,profiles:[],employees:[],headers:seed.submission_headers_to_insert,registrations:seed.shift_registrations_to_insert};
 validatePayload(p);assert.throws(()=>validatePayload({...p,profiles:[{id:'new'}]}),/EXISTING_EMPLOYEES_ONLY/);assert.throws(()=>validatePayload({...p,fixture_policy:'anything'}),/UNKNOWN_FIXTURE_POLICY/);
 const old=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../docs/ld-integration-prepared/1793514872833/seed-plan.json')));
 validatePayload({profiles:old.auth_profiles_to_provision,employees:old.employees_to_insert,headers:old.submission_headers_to_insert,registrations:[...old.shift_registrations_to_insert,...old.optional_positive_scenario.additional_shift_registrations]});
});

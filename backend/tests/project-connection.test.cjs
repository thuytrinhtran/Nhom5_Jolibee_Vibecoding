const {test}=require('node:test'),assert=require('node:assert/strict');
const {projectConnectionKind,PROJECT}=require('../scripts/project-connection.cjs');
const {parseService,parsePass}=require('../scripts/prepare-private-pg-connection.cjs');
const base={host:`db.${PROJECT}.supabase.co`,port:5432,database:'postgres',user:'postgres',ssl:{rejectUnauthorized:true}};
test('operator tools accept only verified direct or project-scoped session pooler',()=>{
 assert.equal(projectConnectionKind(base),'DIRECT');
 const pool={...base,host:'aws-0-ap-southeast-1.pooler.supabase.com',user:`postgres.${PROJECT}`};assert.equal(projectConnectionKind(pool),'SESSION_POOLER');
 for(const bad of [{user:'postgres.other'},{user:'postgres'},{port:6543},{ssl:{rejectUnauthorized:false}},{connectionString:'not-allowed'},{options:'not-allowed'},{host:'untrusted.example'}])assert.throws(()=>projectConnectionKind({...pool,...bad}));
 assert.throws(()=>projectConnectionKind({...base,host:'db.other.supabase.co'}));
});
test('local converter reads selected service and escaped password without output or network',()=>{
 assert.deepEqual(parseService('[other]\nhost=ignored\n[jollishift_source]\nhost=chosen\nport=5432\n[next]\nhost=ignored'),{host:'chosen',port:'5432'});
 const config={host:'chosen',port:5432,database:'postgres',user:'user'};
 assert.equal(parsePass('elsewhere:5432:postgres:user:ignored\nchosen:5432:postgres:user:fake\\:part\\\\end',config),'fake:part\\end');
 assert.throws(()=>parsePass('elsewhere:5432:postgres:user:fake',config),/EXACT_PGPASS_ENTRY_REQUIRED/);
});

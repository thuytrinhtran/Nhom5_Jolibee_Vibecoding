/** Isolated TEST launcher; never falls back to shared database credentials. */
const fs=require('node:fs'),path=require('node:path'),dotenv=require('dotenv');
const SHARED_REF='wlbpprpiieonjrqglicv';
function validateTestEnvironment(env){
 if(env.TV2_DATABASE_ENV!=='isolated-test')throw Error('TV2_DATABASE_ENV must be isolated-test.');
 const url=new URL(env.SUPABASE_URL||'');
 if(url.username||url.password||url.search||url.hash)throw Error('Invalid Supabase URL.');
 const local=['127.0.0.1','localhost','[::1]'].includes(url.hostname);
 if(url.hostname.includes(SHARED_REF)||env.TV2_TEST_PROJECT_REF===SHARED_REF)throw Error('Shared Supabase project is forbidden.');
 if(!local && (url.protocol!=='https:'||!env.TV2_TEST_PROJECT_REF||url.hostname!==`${env.TV2_TEST_PROJECT_REF}.supabase.co`))throw Error('Explicit isolated project reference must match URL.');
 if(!env.SUPABASE_SECRET_KEY&&!env.SUPABASE_SERVICE_ROLE_KEY)throw Error('Server-only key for TEST project required.');
 return {origin:url.origin,port:env.PORT||'5001'};
}
if(require.main===module){try{
 const file=path.resolve(__dirname,'../.env.tv2-test');
 if(!fs.existsSync(file))throw Error('Create backend/.env.tv2-test from docs/tv2-test/backend-env.example.txt. Existing .env is not used.');
 const env=dotenv.parse(fs.readFileSync(file));const target=validateTestEnvironment(env);
 for(const k of Object.keys(process.env))if(k.startsWith('SUPABASE_')||k==='REGISTRATION_AUTOMATION_TOKEN')delete process.env[k];
 Object.assign(process.env,env,{NODE_ENV:'development',PORT:target.port,REGISTRATION_AUTOMATION_TOKEN:''});
 // dotenv in existing config does not override these explicitly set values.
 for(const k of ['SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_KEY','SUPABASE_ANON_KEY'])process.env[k]=env[k]||'';
 console.log(`TV2 isolated API: ${target.origin}; port ${target.port}; automation disabled.`);
 require('../dist/server.js');
}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={validateTestEnvironment};

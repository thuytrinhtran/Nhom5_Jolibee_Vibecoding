import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { devImportHeaders,DEV_IMPORT_PROJECT } from '../registrations/dev-import-policy.js';

type Client={query:(sql:string,args?:unknown[])=>Promise<{rows:any[]}>};
export async function executeTv5LocalRpc(c:Client,name:string,args:Record<string,unknown>,headers:Record<string,string>){
 const specs:Record<string,{sql:string;keys:string[]}>= {
  tv5_read:{sql:'SELECT public.tv5_read($1) result',keys:['p_actor_id']},
  tv5_candidates_for_actor:{sql:'SELECT public.tv5_candidates_for_actor($1,$2) result',keys:['p_actor_id','p_assignment_id']},
  tv5_mutate:{sql:'SELECT public.tv5_mutate($1,$2,$3,$4::jsonb) result',keys:['p_actor_id','p_action','p_request_id','p_data']},
 };
 if(!Object.hasOwn(specs,name))throw Error('TV5_RPC_NOT_ALLOWED');const spec=specs[name];
 if(Object.keys(args).some(k=>!spec.keys.includes(k))||spec.keys.some(k=>!Object.hasOwn(args,k)))throw Error('TV5_RPC_ARGUMENTS_INVALID');
 await c.query(name==='tv5_mutate'?'BEGIN':'BEGIN READ ONLY');
 try{
  // Same SQL validators/locks/audit and the same 8s statement limit. Only the
  // transaction-local planner changes; no persistent role/function/DB settings.
  await c.query("SET LOCAL jit=off; SET LOCAL enable_nestloop=off; SET LOCAL plan_cache_mode=force_custom_plan; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='8s'; SET LOCAL timezone='UTC'");
  await c.query("SELECT set_config('request.headers',$1,true)",[JSON.stringify(headers)]);
  const result=await c.query(spec.sql,spec.keys.map(k=>k==='p_data'?JSON.stringify(args[k]):args[k]));
  await c.query('COMMIT');return result.rows[0]?.result;
 }catch(e){await c.query('ROLLBACK');throw e;}
}
function localProjectSettings(){
 if(process.env.NODE_ENV!=='development'||process.env.TV3_WRITE_SCOPE_ENABLED!=='true'||process.env.SUPABASE_URL?.replace(/\/rest\/v1\/?$/,'').replace(/\/$/,'')!==`https://${DEV_IMPORT_PROJECT}.supabase.co`)throw Error('TV5_LOCAL_CONFIGURATION_INVALID');
 const file=process.env.TV5_PG_CONNECTION_FILE,lib=process.env.TV5_PG_CLIENT;
 if(!file||!lib||!path.isAbsolute(file)||!path.isAbsolute(lib))throw Error('TV5_PRIVATE_CONNECTION_REQUIRED');
 const config=JSON.parse(fs.readFileSync(file,'utf8'));
 const direct=config.host===`db.${DEV_IMPORT_PROJECT}.supabase.co`&&config.user==='postgres';
 const pooler=/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(config.host??'')&&config.user===`postgres.${DEV_IMPORT_PROJECT}`;
 if(config.connectionString||config.options||config.database!=='postgres'||Number(config.port??5432)!==5432||config.ssl?.rejectUnauthorized!==true||(!direct&&!pooler))throw Error('TV5_PROJECT_OR_TLS_INVALID');
 return {file,lib,config};
}
export function localProjectClient(){const {lib,config}=localProjectSettings();const {Client}=createRequire(__filename)(lib);return new Client(config);}
let sharedPool:{key:string;pool:any}|null=null;
export async function acquireLocalProjectClient(){
 const {file,lib,config}=localProjectSettings(),key=[file,fs.statSync(file).mtimeMs,lib].join(':');
 if(sharedPool?.key!==key){if(sharedPool)void sharedPool.pool.end().catch(()=>{});const {Pool}=createRequire(__filename)(lib),pool=new Pool({...config,max:3,idleTimeoutMillis:30000,allowExitOnIdle:true});pool.on('error',()=>{});sharedPool={key,pool};}
 const lease=await sharedPool.pool.connect();let broken=false;
 return{query:async(sql:string,args?:unknown[])=>{try{return await lease.query(sql,args);}catch(e){if(sql==='ROLLBACK')broken=true;throw e;}},end:async()=>lease.release(broken)};
}
export async function localTv5Rpc(name:string,args:Record<string,unknown>){
 const c=await acquireLocalProjectClient();
 try{return{data:await executeTv5LocalRpc(c,name,args,devImportHeaders()),error:null};}
 catch(e){const error=e as {code?:string;message?:string};return{data:null,error:{code:error.code??'TV5_DATABASE_UNAVAILABLE',message:error.code?error.message:'TV5_DATABASE_UNAVAILABLE'}};}
 finally{await c.end();}
}

// Local file conversion only. Never connects, logs a credential or changes .env.
const fs=require('node:fs'),path=require('node:path');
const {projectConnectionKind}=require('./project-connection.cjs');
function parseService(text){
 let selected=false;const result={};
 for(const line of text.replace(/^\uFEFF/,'').split(/\r?\n/)){const s=line.trim();if(!s||s.startsWith('#'))continue;if(s.startsWith('[')){selected=s==='[jollishift_source]';continue;}if(selected){const at=s.indexOf('=');if(at>0)result[s.slice(0,at).trim()]=s.slice(at+1).trim();}}
 return result;
}
function parsePass(text,config){
 for(const line of text.replace(/^\uFEFF/,'').split(/\r?\n/)){if(!line||line.startsWith('#'))continue;const fields=[''];let escaped=false;for(const ch of line){if(escaped){fields[fields.length-1]+=ch;escaped=false;}else if(ch==='\\')escaped=true;else if(ch===':')fields.push('');else fields[fields.length-1]+=ch;}
 if(fields.length===5&&fields.slice(0,4).every((v,i)=>v===[config.host,String(config.port),config.database,config.user][i]))return fields[4];}
 throw Error('EXACT_PGPASS_ENTRY_REQUIRED');
}
function privatePath(file){const root=fs.realpathSync(path.resolve(__dirname,'../..'));const absolute=path.resolve(file);const parent=fs.realpathSync(fs.existsSync(absolute)?absolute:path.dirname(absolute));const relative=path.relative(root,parent);if(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))throw Error('PRIVATE_PATH_REQUIRED');return absolute;}
function main(){
 const [serviceArg,passArg,outArg]=process.argv.slice(2);if(!serviceArg||!passArg||!outArg)throw Error('PRIVATE_SERVICE_PASS_OUTPUT_REQUIRED');
 const service=privatePath(serviceArg),pass=privatePath(passArg),out=privatePath(outArg);if(fs.existsSync(out))throw Error('OUTPUT_ALREADY_EXISTS');
 const cfg=parseService(fs.readFileSync(service,'utf8'));if(cfg.password||cfg.sslmode!=='verify-full'||!cfg.sslrootcert)throw Error('VERIFIED_TLS_AND_SEPARATE_PASSWORD_REQUIRED');
 const config={host:cfg.host,port:Number(cfg.port??5432),database:cfg.dbname,user:cfg.user,ssl:{rejectUnauthorized:true,ca:fs.readFileSync(privatePath(cfg.sslrootcert),'utf8')},connectionTimeoutMillis:15000};
 const kind=projectConnectionKind(config);config.password=parsePass(fs.readFileSync(pass,'utf8'),config);
 fs.writeFileSync(out,JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({prepared:true,connection_kind:kind,project_scoped:true,connected:false}));
}
if(require.main===module)try{main();}catch(e){console.error(/^[A-Z_]+$/.test(e.message??'')?e.message:'PRIVATE_CONFIG_PREPARATION_FAILED');process.exitCode=1;}
module.exports={parseService,parsePass};

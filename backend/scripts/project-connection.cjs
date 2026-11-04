// Operator tooling only; no connections, dotenv, writes or secret logging here.
const PROJECT='wlbpprpiieonjrqglicv';
function projectConnectionKind(config){
 if(config.connectionString||config.options||config.database!=='postgres'||Number(config.port??5432)!==5432||config.ssl?.rejectUnauthorized!==true)throw Error('PROJECT_OR_TLS_CONFIGURATION_MISMATCH');
 if(config.host===`db.${PROJECT}.supabase.co`&&config.user==='postgres')return 'DIRECT';
 if(/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(config.host??'')&&config.user===`postgres.${PROJECT}`)return 'SESSION_POOLER';
 throw Error('PROJECT_CONNECTION_NOT_APPROVED');
}
module.exports={projectConnectionKind,PROJECT};

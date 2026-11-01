// Backend-only opt-in. No HTTP payload controls this context.
export const DEV_IMPORT_PROJECT='wimikwyuzhltpjciafod';
export const DEV_IMPORT_BATCH='6e1d2026-1102-4000-8000-000000000017';
export const DEV_IMPORT_BRANCH='11111111-1111-1111-1111-111111111111';
export const DEV_IMPORT_PERIOD='79a979cc-8347-48b5-a411-f03bd8aceb92';
export function devImportContext(env:NodeJS.ProcessEnv=process.env){
 if(env.DEV_IMPORT_ENABLED!=='true')return null;
 if(!['development','test'].includes(env.NODE_ENV??'')||env.DEV_IMPORT_PROJECT_REF!==DEV_IMPORT_PROJECT
  ||env.DEV_IMPORT_BATCH_ID!==DEV_IMPORT_BATCH||env.SUPABASE_URL?.replace(/\/rest\/v1\/?$/,'').replace(/\/$/,'')!==`https://${DEV_IMPORT_PROJECT}.supabase.co`)
  throw Error('INVALID_DEV_IMPORT_CONFIGURATION');
 return `${env.NODE_ENV}/${DEV_IMPORT_PROJECT}/${DEV_IMPORT_BATCH}`;
}
export const devImportHeaders=(env:NodeJS.ProcessEnv=process.env):Record<string,string>=>{const context=devImportContext(env);return context?{'x-jollishift-dev-import':context}:{};};

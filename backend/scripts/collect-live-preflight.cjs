// Explicit read-only collector. No dotenv, SDK, Auth sign-in, RPC execution or writer.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '../..');
const PROJECT = 'wlbpprpiieonjrqglicv';
const BRANCH = '11111111-1111-1111-1111-111111111111';
const PERIOD = '79a979cc-8347-48b5-a411-f03bd8aceb92';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function queries(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/--[^\n]*/g, '')
    .split(';').map(s => s.trim()).filter(Boolean).filter(s => !/^(BEGIN|COMMIT)\b/i.test(s))
    .map(sql => { if (!/^(SELECT|WITH)\b/i.test(sql)) throw Error('NON_READ_QUERY'); return sql; });
}
function external(file) {
  const absolute = path.resolve(file);
  const real = fs.realpathSync(fs.existsSync(absolute) ? absolute : path.dirname(absolute));
  const relative = path.relative(fs.realpathSync(ROOT), real);
  if (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)) throw Error('PRIVATE_PATH_REQUIRED');
  return absolute;
}
async function main() {
  const [configArg, outputArg] = process.argv.slice(2);
  if (!configArg || !outputArg) throw Error('USAGE_CONNECTION_JSON_AND_NEW_PRIVATE_OUTPUT_DIRECTORY');
  const configFile = external(configArg), output = external(outputArg);
  if (fs.existsSync(output)) throw Error('OUTPUT_ALREADY_EXISTS');
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  require('./project-connection.cjs').projectConnectionKind(config);
  const modulePath = process.env.DEV_IMPORT_PG_CLIENT;
  if (!modulePath || !path.isAbsolute(modulePath)) throw Error('PRIVATE_PG_CLIENT_REQUIRED');
  const { Client } = require(modulePath);
  const client = new Client({ ...config, connectionTimeoutMillis: 15000 });
  const evidence = { format: 'jollishift-live-preflight.v1', project_ref: PROJECT, branch_id: BRANCH,
    period_id: PERIOD, captured_at: new Date().toISOString(), complete: false, files: [], skipped: [] };
  let connected = false;
  function save(label, rows) {
    const bytes = JSON.stringify(rows, null, 2) + '\n';
    const file = `${String(evidence.files.length + 1).padStart(3, '0')}-${label}.json`;
    fs.writeFileSync(path.join(output, file), bytes, { flag: 'wx', mode: 0o600 });
    evidence.files.push({ file, row_count: rows.length, sha256: hash(bytes) });
  }
  try {
    await client.connect(); connected = true;
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL timezone='UTC'; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='3s'");
    const identity = (await client.query(`SELECT id,name,status,supervisor_id FROM public.branches WHERE id=$1`, [BRANCH])).rows;
    const name = identity[0]?.name?.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd');
    if (identity.length !== 1 || !/le\s+duan/i.test(name || '')) throw Error('TARGET_BRANCH_NOT_CONFIRMED');
    fs.mkdirSync(output, { mode: 0o700 });
    save('branch-identity', identity);
    const existence = (await client.query(`SELECT to_regclass('public.dev_import_batches') IS NOT NULL registry,
      EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.registration_submissions_sourced') AND attname='dev_import_allowed' AND NOT attisdropped) source_gate,
      to_regclass('supabase_migrations.schema_migrations') IS NOT NULL migration_history`)).rows[0];
    save('capabilities', [existence]);
    for (const file of ['docs/deployment-6.1/01-catalog-preflight.sql', 'docs/deployment-6.1/02-data-preflight.sql', 'docs/deployment-6.2/preflight.sql']) {
      const sqls = queries(file);
      for (let i = 0; i < sqls.length; i++) {
        const sql = sqls[i];
        if ((!existence.registry && /(?:FROM\s+public\.dev_import_batches|has_table_privilege\(r\.oid,'public\.dev_import_batches')/i.test(sql)) ||
            (!existence.source_gate && /AND dev_import_allowed/i.test(sql))) {
          evidence.skipped.push({ source: file, query: i + 1, reason: 'POST_MIGRATION_OBJECT_ABSENT' }); continue;
        }
        save(`${path.basename(path.dirname(file))}-${path.basename(file, '.sql')}-${i + 1}`, (await client.query(sql)).rows);
      }
    }
    // Expand beyond the original audit's selected columns/indexes/functions.
    const extra = {
      'all-public-columns': `SELECT c.relname,a.attnum,a.attname,format_type(a.atttypid,a.atttypmod) data_type,a.attnotnull,pg_get_expr(d.adbin,d.adrelid) default_expression FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m') AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`,
      'all-public-indexes': `SELECT i.indrelid::regclass::text table_name,i.indexrelid::regclass::text index_name,i.indisunique,i.indisvalid,i.indisready,pg_get_indexdef(i.indexrelid) definition FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY 1,2`,
      'all-public-functions': `SELECT p.oid::regprocedure::text signature,pg_get_userbyid(p.proowner) owner,p.prosecdef,p.proconfig,p.proacl,md5(regexp_replace(replace(p.prosrc,chr(13),''),'\\s+',' ','g')) normalized_body_md5,pg_get_functiondef(p.oid) definition FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.prokind IN ('f','p') ORDER BY 1`,
      'all-public-constraints': `SELECT c.conrelid::regclass::text table_name,c.conname,c.contype,c.convalidated,c.confrelid::regclass::text referenced_table,pg_get_constraintdef(c.oid) definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' ORDER BY 1,2`,
      'all-public-table-acl': `SELECT c.oid::regclass::text relation,c.relkind,c.relacl,pg_get_userbyid(c.relowner) owner FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relkind IN ('r','p','v','m','S') ORDER BY 1`,
      'all-public-function-execute': `SELECT p.oid::regprocedure::text signature,r.rolname,has_function_privilege(r.oid,p.oid,'EXECUTE') can_execute FROM pg_proc p CROSS JOIN pg_roles r WHERE p.pronamespace='public'::regnamespace AND p.prokind IN ('f','p') AND r.rolname IN ('anon','authenticated','service_role') ORDER BY 1,2`,
    };
    for (const [label, sql] of Object.entries(extra)) save(label, (await client.query(sql)).rows);
    const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/ld-integration-prepared/1793514872833/seed-plan.json'), 'utf8'));
    const profiles = seed.auth_profiles_to_provision;
    save('planned-profile-collisions', (await client.query(`SELECT p->>'id' planned_id,p->>'username' planned_username,
      u.id profile_id,u.username,u.role,u.branch_id,u.is_active,u.must_change_password,
      EXISTS(SELECT 1 FROM auth.users a WHERE a.id=(p->>'id')::uuid) planned_auth_id_exists,
      (SELECT count(*) FROM public.employees e WHERE e.user_id=u.id) employee_bindings
      FROM jsonb_array_elements($1::jsonb) p LEFT JOIN public.users u ON u.id=(p->>'id')::uuid OR lower(u.username)=lower(p->>'username') ORDER BY p->>'id',u.id`, [JSON.stringify(profiles)])).rows);
    save('existing-auth-bindings', (await client.query(`SELECT e.id employee_id,e.user_id,e.department_id,e.skill_level,e.status,u.username,u.role,u.branch_id,u.is_active,u.must_change_password,a.id auth_id FROM public.employees e LEFT JOIN public.users u ON u.id=e.user_id LEFT JOIN auth.users a ON a.id=u.id WHERE e.branch_id=$1 ORDER BY e.id`, [BRANCH])).rows);
    for (const [table, where, params] of [
      ['employees', 'branch_id=$1', [BRANCH]], ['employee_skills', 'employee_id IN(SELECT id FROM public.employees WHERE branch_id=$1)', [BRANCH]],
      ['shifts', 'true', []], ['registration_periods', 'id=$1', [PERIOD]],
      ['registration_submissions', 'period_id=$1', [PERIOD]], ['shift_registrations', 'period_id=$1', [PERIOD]],
      ['staffing_requirements', "branch_id=$1 AND work_date BETWEEN '2026-11-02' AND '2026-11-08'", [BRANCH]],
      ['schedules', 'period_id=$1', [PERIOD]], ['warning_configs', 'branch_id=$1', [BRANCH]],
    ]) save(`baseline-${table}`, (await client.query(`SELECT to_jsonb(t) row FROM public.${table} t WHERE ${where} ORDER BY to_jsonb(t)::text`, params)).rows);
    if (existence.migration_history) save('migration-history', (await client.query('SELECT to_jsonb(m) row FROM supabase_migrations.schema_migrations m ORDER BY version')).rows);
    else evidence.skipped.push({ source: 'migration-history', reason: 'HISTORY_TABLE_ABSENT_INSPECT_DEFINITIONS_INSTEAD' });
    await client.query('COMMIT');
    evidence.complete = true;
  } finally {
    if (connected) { if (!evidence.complete) await client.query('ROLLBACK').catch(() => {}); await client.end(); }
    if (fs.existsSync(output)) fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  console.log(JSON.stringify({ complete: true, files: evidence.files.length, skipped: evidence.skipped.length }));
}
if (require.main === module) main().catch(e => {
  console.error(/^[A-Z_]+$/.test(e.message || '') ? e.message : 'READ_ONLY_PREFLIGHT_FAILED_NO_SECRETS_LOGGED');
  process.exitCode = 1;
});
module.exports = { queries, external };

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { queries, external } = require('../scripts/collect-live-preflight.cjs');
test('preflight collector loads only SELECT/WITH, without transaction wrappers or pagination limits', () => {
  for (const file of ['docs/deployment-6.1/01-catalog-preflight.sql', 'docs/deployment-6.1/02-data-preflight.sql', 'docs/deployment-6.2/preflight.sql']) {
    const sql = queries(file);
    assert.ok(sql.length >= 5);
    for (const query of sql) {
      assert.match(query, /^(SELECT|WITH)\b/i);
      assert.doesNotMatch(query, /\b(?:INSERT INTO|DELETE FROM|UPDATE public\.|CREATE TABLE|ALTER TABLE|CALL|LIMIT\s+100)\b/i);
    }
  }
});
test('private output/config paths reject repository and symlink-resolved repository paths', () => {
  assert.throws(() => external(path.resolve(__dirname, '../../docs')), /PRIVATE_PATH_REQUIRED/);
  assert.throws(() => external(path.resolve(__dirname, '../../docs/not-created.json')), /PRIVATE_PATH_REQUIRED/);
});
test('collector requires fixed project and verified TLS before connection; no environment loading or writer RPC', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../scripts/collect-live-preflight.cjs'), 'utf8');
  assert.match(source, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(source, /projectConnectionKind\(config\)/);
  assert.doesNotMatch(source, /require\(['"]dotenv|\.rpc\(|persist_schedule_draft\(/);
});
test('target REST audit uses GET only and checks confirmed project before sending credentials', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../scripts/read-target-preflight.cjs'), 'utf8');
  assert.match(source, /TARGET='wlbpprpiieonjrqglicv'/);
  assert.match(source, /method:'GET'/);
  assert.match(source, /redirect:'error'/);
  assert.ok(source.indexOf("throw Error('TARGET_PROJECT_MISMATCH')") < source.indexOf('await fetch('));
  assert.doesNotMatch(source, /method:\s*['"](?:POST|PUT|PATCH|DELETE)|\.rpc\(/);
  assert.match(source, /users\.map\(u=>u\.id\)/);
});
test('SQL Editor supplements contain only read queries', () => {
  for (const file of ['docs/deployment-6.3.1/sql-editor-complete-catalog.sql', 'docs/deployment-6.3.1/sql-editor-auth-check.sql']) {
    for (const query of queries(file)) assert.match(query, /^(SELECT|WITH)\b/i);
  }
});
test('backend policy, executor, SQL gate and collector agree on confirmed target', () => {
  const target = 'wlbpprpiieonjrqglicv';
  for (const file of ['src/registrations/dev-import-policy.ts','scripts/dev-import-executor.cjs','scripts/collect-live-preflight.cjs','migrations/20261105_scoped_dev_import.sql']) {
    const source = fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');
    assert.ok(source.includes(target), file);
    assert.ok(!source.includes('wimikwyuzhltpjciafod'), file);
  }
});

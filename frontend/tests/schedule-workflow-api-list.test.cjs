const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const schedulesDir = path.join(__dirname, '../src/pages/schedules');

function loadTypes() {
  const source = fs.readFileSync(path.join(schedulesDir, 'scheduleWorkflow.types.ts'), 'utf8');
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(javascript, { exports: loaded.exports, module: loaded, require }, { filename: 'scheduleWorkflow.types.ts' });
  return loaded.exports;
}

function loadApiService(authService = { getStoredToken: () => 'test-session', getMe: async () => ({}) }) {
  const source = fs.readFileSync(path.join(schedulesDir, 'scheduleWorkflow.api.service.ts'), 'utf8')
    .replaceAll('import.meta.env', 'globalThis.__TV4_TEST_ENV__');
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const loaded = { exports: {} };
  const dependencies = {
    '../../services/auth.service': { authService },
    './scheduleWorkflow.types': types,
  };
  vm.runInNewContext(javascript, {
    exports: loaded.exports,
    module: loaded,
    AbortSignal,
    fetch: global.fetch,
    __TV4_TEST_ENV__: {},
    require: id => {
      if (dependencies[id]) return dependencies[id];
      throw new Error(`Unexpected module import in isolated TV4 API test: ${id}`);
    },
  }, { filename: 'scheduleWorkflow.api.service.ts' });
  return loaded.exports;
}

const types = loadTypes();
const gs = { id: 'gs-id', username: 'GS', role: 'GS', branch_id: null };
const ql = { id: 'ql-id', username: 'QL', role: 'QL', branch_id: 'branch-id' };

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) };
}

function row(id, status = 'APPROVED') {
  return {
    id,
    schedule_group_id: `group-${id}`,
    branch_id: 'branch-id',
    period_id: 'period-id',
    version: 2,
    status,
    created_by: 'ql-id',
    created_at: '2026-10-30T08:00:00.000Z',
    published_at: status === 'PUBLISHED' ? '2026-10-30T10:00:00.000Z' : null,
    feedback_deadline_at: null,
    branches: { id: 'branch-id', name: 'Jollibee Demo' },
    registration_periods: { work_start_date: '2026-10-26', work_end_date: '2026-11-01' },
    shift_assignments: [],
    approvals: [],
    is_latest: true,
  };
}

test('API list views use the backend endpoint, return empty lists as empty, and normalize real response rows', async () => {
  const api = loadApiService();
  const calls = [];
  const service = api.createScheduleWorkflowApiService({
    getToken: () => 'test-session',
    fetcher: async (url, init) => {
      calls.push({ url, init });
      const rows = url.endsWith('?view=pending') ? []
        : url.endsWith('?view=history') ? [row('history-1', 'NEEDS_REVISION')]
          : [row('approved-1'), row('published-1', 'PUBLISHED'), row('revision-1', 'NEEDS_REVISION')];
      return response(200, { schedules: rows });
    },
  });

  assert.equal(service.mode, 'api');
  assert.deepEqual(Array.from(await service.listSchedules(gs, 'pending')), []);
  const decisions = await service.listSchedules(gs, 'history');
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].status, 'NEEDS_REVISION');
  const managerRows = await service.listSchedules(ql, 'manager');
  assert.equal(managerRows.length, 3);
  assert.equal(managerRows[0].branches.name, 'Jollibee Demo');
  assert.equal(managerRows[0].version, 2);
  const publicationHistory = await service.listSchedules(ql, 'publicationHistory');
  assert.deepEqual(Array.from(publicationHistory, schedule => schedule.status), ['PUBLISHED']);
  assert.deepEqual(calls.map(call => call.url), [
    '/api/schedules/workflow?view=pending',
    '/api/schedules/workflow?view=history',
    '/api/schedules/workflow?view=publishable',
    '/api/schedules/workflow?view=publishable',
  ]);
  assert.ok(calls.every(call => call.init.headers.Authorization === 'Bearer test-session'));
});

test('API list distinguishes 401 refresh/retry, 403, 500, and network failures without mock fallback', async () => {
  const api = loadApiService();
  let refreshCalls = 0;
  let fetchCalls = 0;
  const refreshService = api.createScheduleWorkflowApiService({
    getToken: () => 'test-session',
    refreshSession: async () => { refreshCalls += 1; },
    fetcher: async () => {
      fetchCalls += 1;
      return fetchCalls === 1 ? response(401, { message: 'expired' }) : response(200, { schedules: [] });
    },
  });
  assert.deepEqual(Array.from(await refreshService.listSchedules(gs, 'pending')), []);
  assert.equal(refreshCalls, 1);
  assert.equal(fetchCalls, 2);

  for (const [status, expectedCode] of [[403, 'HTTP_403'], [500, 'HTTP_500']]) {
    const service = api.createScheduleWorkflowApiService({
      getToken: () => 'test-session',
      fetcher: async () => response(status, { message: `HTTP ${status} failure` }),
    });
    await assert.rejects(service.listSchedules(ql, 'manager'), error => error.status === status && error.code === expectedCode);
  }

  let networkCalls = 0;
  const disconnected = api.createScheduleWorkflowApiService({
    getToken: () => 'test-session',
    fetcher: async () => { networkCalls += 1; throw new Error('offline'); },
  });
  await assert.rejects(disconnected.listSchedules(ql, 'manager'), error => error.code === 'NETWORK_ERROR');
  assert.equal(networkCalls, 1);
});

test('API list enforces the actor role before making a request', async () => {
  const api = loadApiService();
  let fetchCalls = 0;
  const service = api.createScheduleWorkflowApiService({
    getToken: () => 'test-session',
    fetcher: async () => { fetchCalls += 1; return response(200, { schedules: [] }); },
  });
  await assert.rejects(service.listSchedules(ql, 'pending'), error => error.status === 403);
  await assert.rejects(service.listSchedules(gs, 'manager'), error => error.status === 403);
  assert.equal(fetchCalls, 0);
});

test('API mode UI shows exact loading, empty, error and retry states', async () => {
  const source = fs.readFileSync(path.join(schedulesDir, 'ScheduleWorkflow.tsx'), 'utf8');
  assert.match(source, /'Đang tải lịch làm việc\.\.\.'/);
  assert.match(source, /'Chưa có lịch làm việc phù hợp\.'/);
  assert.match(source, /Khi có lịch được duyệt thuộc chi nhánh của bạn, lịch sẽ xuất hiện tại đây\. Nhấn “Làm mới” để kiểm tra dữ liệu mới\./);
  assert.match(source, />Làm mới<\/button>/);
  assert.match(source, />Thử lại<\/button>/);
  assert.match(source, /: error \? null/);
  assert.match(source, /catch \(err\) \{\s*setSchedules\(\[\]\);\s*setError\(errorText\(err\)\);/);
  assert.doesNotMatch(source, /catch[\s\S]{0,100}tv4MockWorkflowService/);
});

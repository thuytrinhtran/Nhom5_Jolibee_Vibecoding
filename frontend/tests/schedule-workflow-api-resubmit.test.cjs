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

const types = loadTypes();

function loadApiService(authService = { getStoredToken: () => 'unit-test-session', getMe: async () => ({}) }) {
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
      throw new Error(`Unexpected module import in isolated API test: ${id}`);
    },
  }, { filename: 'scheduleWorkflow.api.service.ts' });
  return loaded.exports;
}

const actor = { id: 'manager-id', username: 'QL', role: 'QL', branch_id: 'branch-id' };
const assignment = { id: 'old-assignment-id', shifts: { id: 'new-shift-id' } };

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body) };
}

function newSchedule(version, note) {
  return {
    id: 'new-schedule-id',
    schedule_group_id: 'schedule-group-id',
    branch_id: 'branch-id',
    period_id: 'period-id',
    version,
    status: 'PENDING_APPROVAL',
    created_by: actor.id,
    created_at: '2026-10-30T10:00:00.000Z',
    published_at: null,
    published_by: null,
    feedback_deadline_at: null,
    resubmission_note: note,
    branches: { id: 'branch-id', name: 'Branch' },
    registration_periods: { work_start_date: '2026-10-26', work_end_date: '2026-11-01' },
    shift_assignments: [],
    approvals: [],
    is_latest: true,
  };
}

test('resubmit request builder sends only expected version, trimmed note, source assignment IDs, and shift IDs', () => {
  const api = loadApiService();
  assert.deepEqual(JSON.parse(JSON.stringify(api.createResubmitScheduleRequest(4, '  Đã điều chỉnh  ', [assignment]))), {
    expected_version: 4,
    adjustment_note: 'Đã điều chỉnh',
    assignments: [{ source_assignment_id: 'old-assignment-id', shift_id: 'new-shift-id' }],
  });
});

test('API mode does not call a resubmit endpoint until one is explicitly configured', async () => {
  const api = loadApiService();
  let fetchCalls = 0;
  const service = api.createScheduleWorkflowApiService({
    getToken: () => 'unit-test-session',
    fetcher: async () => { fetchCalls += 1; return response(500, {}); },
  });

  await assert.rejects(
    service.resubmitSchedule(actor, 'source-schedule-id', 'Đã điều chỉnh', [assignment], 4, 'schedule-group-id'),
    error => error.code === 'RESUBMIT_NOT_CONFIGURED' && error.status === 501,
  );
  assert.equal(fetchCalls, 0);
});

test('configured resubmit endpoint receives the contract payload and accepts only the confirmed pending version', async () => {
  const api = loadApiService();
  let requestSeen;
  const service = api.createScheduleWorkflowApiService({
    getToken: () => 'unit-test-session',
    resubmitEndpoint: id => `/${encodeURIComponent(id)}/resubmit`,
    fetcher: async (url, init) => {
      requestSeen = { url, init, body: JSON.parse(init.body) };
      return response(201, { schedule: newSchedule(5, 'Đã điều chỉnh') });
    },
  });

  const result = await service.resubmitSchedule(actor, 'source/id', ' Đã điều chỉnh ', [assignment], 4, 'schedule-group-id');
  assert.equal(requestSeen.url, '/api/schedules/workflow/source%2Fid/resubmit');
  assert.equal(requestSeen.init.method, 'POST');
  assert.deepEqual(requestSeen.body, {
    expected_version: 4,
    adjustment_note: 'Đã điều chỉnh',
    assignments: [{ source_assignment_id: 'old-assignment-id', shift_id: 'new-shift-id' }],
  });
  assert.equal(result.version, 5);
  assert.equal(result.status, 'PENDING_APPROVAL');
  assert.equal(result.resubmission_note, 'Đã điều chỉnh');
});

test('resubmit service maps workflow conflicts and validation errors without reporting success', async () => {
  const api = loadApiService();
  const cases = [
    ['STALE_VERSION', 409],
    ['SCHEDULE_STATUS_CONFLICT', 409],
    ['INVALID_ASSIGNMENTS', 422],
    ['ADJUSTMENT_NOTE_REQUIRED', 422],
  ];

  for (const [code, status] of cases) {
    const service = api.createScheduleWorkflowApiService({
      getToken: () => 'unit-test-session',
      resubmitEndpoint: () => '/:id/resubmit',
      fetcher: async () => response(status, { status: 'error', code, message: 'backend-detail' }),
    });
    await assert.rejects(
      service.resubmitSchedule(actor, 'source-schedule-id', 'Đã điều chỉnh', [assignment], 4, 'schedule-group-id'),
      error => error.code === code && error.status === status && error.message !== 'backend-detail',
    );
  }

  const unconfigured = api.createScheduleWorkflowApiService({ getToken: () => 'unit-test-session' });
  await assert.rejects(
    unconfigured.resubmitSchedule(actor, 'source-schedule-id', 'Đã điều chỉnh', [assignment], 4, 'schedule-group-id'),
    error => error.code === 'RESUBMIT_NOT_CONFIGURED' && error.status === 501,
  );
});

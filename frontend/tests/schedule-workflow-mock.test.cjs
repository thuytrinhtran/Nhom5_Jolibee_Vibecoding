const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const ReactDOMServer = require('react-dom/server');

const srcRoot = path.join(__dirname, '../src/pages/schedules');

function loadTypeScript(relativePath, dependencies = {}) {
  const source = fs.readFileSync(path.join(srcRoot, relativePath), 'utf8');
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const loaded = { exports: {} };
  const localRequire = id => {
    if (dependencies[id]) return dependencies[id];
    throw new Error(`Unexpected module import in isolated TV4 test: ${id}`);
  };
  vm.runInNewContext(javascript, {
    exports: loaded.exports,
    module: loaded,
    require: localRequire,
    console,
  }, { filename: relativePath });
  return loaded.exports;
}

const types = loadTypeScript('scheduleWorkflow.types.ts');
const serviceModule = loadTypeScript('tv4MockWorkflow.service.ts', {
  './scheduleWorkflow.types': types,
});

function renderWorkflowWithProfile(profile) {
  const source = fs.readFileSync(path.join(srcRoot, 'ScheduleWorkflow.tsx'), 'utf8');
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const loaded = { exports: {} };
  const dependencies = {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    '../../context/AuthContext': { useAuth: () => ({ user: profile }) },
    'lucide-react': { CalendarDays: 'svg' },
    './scheduleWorkflow.types': types,
    './tv4MockWorkflow.service': { tv4MockWorkflowService: { listSchedules: async () => [] } },
    './scheduleWorkflow.api.service': { scheduleWorkflowApiService: serviceModule.tv4MockWorkflowService },
    './ScheduleWorkflow.css': {},
  };
  vm.runInNewContext(javascript, {
    exports: loaded.exports,
    module: loaded,
    Error: Object.getPrototypeOf(types.ScheduleWorkflowError.prototype).constructor,
    require: id => {
      if (dependencies[id]) return dependencies[id];
      throw new Error(`Unexpected UI module import in isolated TV4 render: ${id}`);
    },
  }, { filename: 'ScheduleWorkflow.tsx' });
  return ReactDOMServer.renderToStaticMarkup(React.createElement(loaded.exports.ScheduleWorkflow, { mode: 'publish' }));
}

function createInteractiveWorkflowHarness(profile, service, initialSchedules, mode = 'publish') {
  const source = fs.readFileSync(path.join(srcRoot, 'ScheduleWorkflow.tsx'), 'utf8');
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const loaded = { exports: {} };
  const state = [initialSchedules, null, null, '', '', {}, '', false, false, '', '', null];
  let stateIndex = 0;
  const effects = [];
  const jsx = (type, props, key) => ({ type, props: props || {}, key });
  const runtime = { jsx, jsxs: jsx, Fragment: Symbol('Fragment') };
  const fakeReact = {
    useState(initialValue) {
      const index = stateIndex++;
      if (!(index in state)) state[index] = initialValue;
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
    },
    useMemo(factory) { return factory(); },
    useCallback(callback) { return callback; },
    useEffect(effect) { effects.push(effect); },
  };
  const dependencies = {
    react: fakeReact,
    'react/jsx-runtime': runtime,
    '../../context/AuthContext': { useAuth: () => ({ user: profile }) },
    'lucide-react': { CalendarDays: 'svg' },
    './scheduleWorkflow.types': types,
    './tv4MockWorkflow.service': { tv4MockWorkflowService: service },
    './scheduleWorkflow.api.service': { scheduleWorkflowApiService: service },
    './ScheduleWorkflow.css': {},
  };
  vm.runInNewContext(javascript, {
    exports: loaded.exports,
    module: loaded,
    Error: Object.getPrototypeOf(types.ScheduleWorkflowError.prototype).constructor,
    require: id => {
      if (dependencies[id]) return dependencies[id];
      throw new Error('Unexpected module import in isolated TV4 interaction test: ' + id);
    },
  }, { filename: 'ScheduleWorkflow.tsx' });

  const render = () => {
    stateIndex = 0;
    return loaded.exports.ScheduleWorkflow({ mode, service });
  };
  const allNodes = root => {
    if (Array.isArray(root)) return root.flatMap(allNodes);
    if (!root || typeof root !== 'object' || !root.props) return [];
    return [root, ...allNodes(root.props.children)];
  };
  const textOf = node => {
    if (Array.isArray(node)) return node.map(textOf).join('');
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    return node?.props ? textOf(node.props.children) : '';
  };
  const clickButton = (root, label) => {
    const buttons = allNodes(root).filter(node => node.type === 'button');
    const button = buttons.find(node => textOf(node).trim().includes(label));
    assert.ok(button, 'Expected button "' + label + '" to render; found: ' + buttons.map(textOf).join(' | '));
    button.props.onClick();
  };
  const runEffects = () => {
    const pending = effects.splice(0);
    pending.forEach(effect => effect());
  };
  return { render, allNodes, textOf, clickButton, runEffects, state };
}

const flushPromises = () => new Promise(resolve => setImmediate(resolve));

const instant = '2026-10-29T12:00:00.000Z';
const gs = { id: 'tv4-demo-supervisor', username: 'Giám sát Test', role: 'GS', branch_id: null };
const ql = { id: 'tv4-demo-manager-central', username: 'Quản lý Test', role: 'QL', branch_id: 'tv4-branch-central' };
const nv = { id: 'tv4-demo-employee', username: 'Nhân viên Test', role: 'NV', branch_id: 'tv4-branch-central' };
const outsiderGs = { id: 'tv4-demo-supervisor-east', username: 'Giám sát Ngoài phạm vi', role: 'GS', branch_id: null };
const outsiderQl = { id: 'tv4-demo-manager-east', username: 'Quản lý Ngoài phạm vi', role: 'QL', branch_id: 'tv4-branch-east' };
const makeService = () => new serviceModule.Tv4MockWorkflowService(() => new Date(instant));
const get = async (service, actor, view, id) => (await service.listSchedules(actor, view)).find(row => row.id === id);
function swapShiftAssignments(assignments, leftIndex = 0, rightIndex = 1) {
  const updated = assignments.map(assignment => ({ ...assignment, shifts: { ...assignment.shifts } }));
  const leftShift = updated[leftIndex].shifts;
  updated[leftIndex].shifts = updated[rightIndex].shifts;
  updated[rightIndex].shifts = leftShift;
  return updated;
}

test('mock GS approves a pending latest version and persists the approval history in session memory', async () => {
  const service = makeService();
  const before = await get(service, gs, 'pending', 'tv4-seed-pending-group-v2');
  const result = await service.decideSchedule(gs, 'tv4-seed-pending-group-v2', 'APPROVED');
  assert.equal(result.status, 'APPROVED');
  assert.equal(result.approvals[0].decision, 'APPROVED');
  assert.equal(result.approvals[0].supervisor_id, gs.id);
  assert.equal(result.approvals[0].users.username, gs.username);
  assert.equal(result.approvals[0].decided_at, instant);
  assert.equal(before.approvals.length, 0);
  assert.equal((await get(service, gs, 'pending', 'tv4-seed-pending-group-v2')), undefined);
  assert.equal((await get(service, ql, 'manager', 'tv4-seed-pending-group-v2')).status, 'APPROVED');
});

test('mock workflow service instances start from independent clean data', async () => {
  const changed = makeService();
  const fresh = makeService();
  await changed.decideSchedule(gs, 'tv4-seed-pending-group-v2', 'APPROVED');
  assert.equal((await get(changed, ql, 'manager', 'tv4-seed-pending-group-v2')).status, 'APPROVED');
  const untouched = await get(fresh, gs, 'pending', 'tv4-seed-pending-group-v2');
  assert.equal(untouched.status, 'PENDING_APPROVAL');
  assert.equal(untouched.approvals.length, 0);
});

test('reloading the TV4 service module restores the deterministic seed after workflow mutations', async () => {
  const changed = makeService();
  await changed.decideSchedule(gs, 'tv4-seed-pending-group-v2', 'APPROVED');
  await changed.decideSchedule(gs, 'tv4-seed-north-pending', 'NEEDS_REVISION', 'Lý do thử nghiệm cần bị reset.');
  // Use the north QL only for the north schedule and send a new version before simulating reload.
  const northManager = { id: 'tv4-demo-manager-north', username: 'QL Thanh Khê', role: 'QL', branch_id: 'tv4-branch-north' };
  const northRejected = await get(changed, northManager, 'manager', 'tv4-seed-north-pending');
  const northAssignments = swapShiftAssignments(northRejected.shift_assignments);
  await changed.resubmitSchedule(northManager, northRejected.id, 'Trình lại trước khi reset.', northAssignments);
  await changed.publishSchedule(ql, 'tv4-seed-approved-01', '2026-11-01T12:00:00.000Z');

  const reloadedModule = loadTypeScript('tv4MockWorkflow.service.ts', {
    './scheduleWorkflow.types': types,
  });
  const reloadedAgain = loadTypeScript('tv4MockWorkflow.service.ts', {
    './scheduleWorkflow.types': types,
  });
  const views = [
    [gs, 'pending'], [gs, 'history'], [ql, 'manager'], [ql, 'publicationHistory'],
    [northManager, 'manager'],
  ];
  for (const [actor, view] of views) {
    const firstSeedState = await reloadedModule.tv4MockWorkflowService.listSchedules(actor, view);
    const secondSeedState = await reloadedAgain.tv4MockWorkflowService.listSchedules(actor, view);
    assert.equal(JSON.stringify(firstSeedState), JSON.stringify(secondSeedState));
    assert.equal(new Set(firstSeedState.map(schedule => schedule.id)).size, firstSeedState.length);
  }
  const initialPending = await get(reloadedModule.tv4MockWorkflowService, gs, 'pending', 'tv4-seed-pending-group-v2');
  assert.equal(initialPending.status, 'PENDING_APPROVAL');
  assert.equal(initialPending.approvals.length, 0);
  const initialNorthPending = await get(reloadedModule.tv4MockWorkflowService, gs, 'pending', 'tv4-seed-north-pending');
  assert.equal(initialNorthPending.status, 'PENDING_APPROVAL');
  assert.equal(initialNorthPending.approvals.length, 0);
  assert.equal((await get(reloadedModule.tv4MockWorkflowService, ql, 'manager', 'tv4-seed-approved-01')).status, 'APPROVED');
});

test('shared TV4 store keeps Thanh Khê rejection visible across GS and QL profile changes', async () => {
  const service = makeService();
  const supervisor = types.mockActorForProfile({
    username: 'Giám sát Thanh Khê', role: 'GS', branch_id: 'real-branch-thanh-khe', branch_name: 'Thanh Khê 1',
  });
  const manager = types.mockActorForProfile({
    username: 'Quản lý Thanh Khê', role: 'QL', branch_id: 'real-branch-thanh-khe', branch_name: 'Thanh Khê 1',
  });
  const pending = await get(service, supervisor, 'pending', 'tv4-seed-north-pending');
  assert.equal(pending.branches.name, 'JolliShift Demo · Thanh Khê 1');

  await service.decideSchedule(supervisor, pending.id, 'NEEDS_REVISION', 'Cần cân đối nhân sự ca tối.');
  const qlRevision = await get(service, manager, 'manager', pending.id);
  assert.equal(qlRevision.status, 'NEEDS_REVISION');
  assert.equal(qlRevision.approvals[0].reason, 'Cần cân đối nhân sự ca tối.');
  assert.equal(qlRevision.version, pending.version);
  assert.equal(qlRevision.is_latest, true);

  const adjustedAssignments = swapShiftAssignments(qlRevision.shift_assignments);
  const resubmitted = await service.resubmitSchedule(manager, qlRevision.id, 'Đã cân đối lại ca tối.', adjustedAssignments);
  assert.equal(resubmitted.status, 'PENDING_APPROVAL');
  assert.equal(resubmitted.version, qlRevision.version + 1);
  assert.equal((await get(service, supervisor, 'pending', resubmitted.id)).status, 'PENDING_APPROVAL');

  await service.decideSchedule(supervisor, resubmitted.id, 'NEEDS_REVISION', 'Cần điều chỉnh thêm nhân sự ca sáng.');
  const secondRevision = await get(service, manager, 'manager', resubmitted.id);
  assert.equal(secondRevision.status, 'NEEDS_REVISION');
  assert.equal(secondRevision.version, resubmitted.version);
  assert.equal(secondRevision.approvals[0].reason, 'Cần điều chỉnh thêm nhân sự ca sáng.');
  assert.equal((await get(service, manager, 'manager', qlRevision.id)).approvals[0].reason, 'Cần cân đối nhân sự ca tối.');
});

test('QL branch mapping is exact and reports missing or unsupported profile branches', () => {
  const thanhKhe = types.resolveTv4MockBranch({ branch_id: 'real-branch-thanh-khe', branch_name: 'Thanh Khê 1' });
  assert.equal(thanhKhe.fixtureBranchId, 'tv4-branch-north');
  assert.equal(thanhKhe.fixtureBranchName, 'JolliShift Demo · Thanh Khê 1');
  assert.match(thanhKhe.diagnostic, /real-branch-thanh-khe/);

  const differentBranch = types.resolveTv4MockBranch({ branch_id: 'real-branch-thanh-khe-10', branch_name: 'Thanh Khê 10' });
  assert.equal(differentBranch.fixtureBranchId, null);
  assert.match(differentBranch.diagnostic, /Không ánh xạ được chi nhánh demo/);
  const missingBranch = types.resolveTv4MockBranch({ branch_id: null, branch_name: null });
  assert.equal(missingBranch.fixtureBranchId, null);
  assert.match(missingBranch.diagnostic, /branch_name="\(trống\)"/);
});

test('verified foundation branch label maps to the Hải Châu demo fixture without widening QL scope', () => {
  const haiChau = types.resolveTv4MockBranch({ branch_id: 'real-hai-chau-uuid', branch_name: 'Chi nhánh mô phỏng Hải Châu' });
  assert.equal(haiChau.fixtureBranchId, 'tv4-branch-central');
  assert.equal(haiChau.fixtureBranchName, 'JolliShift Demo · Hải Châu');
  const thanhKhe = types.resolveTv4MockBranch({ branch_id: 'real-thanh-khe-uuid', branch_name: 'Thanh Khê 1' });
  assert.equal(thanhKhe.fixtureBranchId, 'tv4-branch-north');
  assert.notEqual(haiChau.fixtureBranchId, thanhKhe.fixtureBranchId);
});

test('confirmed Lê Duẩn profile ID maps to its own populated TV4 fixture', async () => {
  const profile = {
    username: 'QL Lê Duẩn', role: 'QL', branch_id: '11111111-1111-1111-1111-111111111111',
    branch_name: 'Jollibee Lê Duẩn',
  };
  const resolution = types.resolveTv4MockBranch(profile);
  assert.equal(resolution.fixtureBranchId, profile.branch_id);
  assert.equal(resolution.fixtureBranchName, 'JolliShift Demo · Jollibee Lê Duẩn');

  const actor = types.mockActorForProfile(profile);
  const service = makeService();
  const seed = serviceModule.createTv4MockSeed();
  const leDuanSeed = seed.schedules.filter(schedule => schedule.branch_id === profile.branch_id);
  assert.deepEqual([...new Set(leDuanSeed.map(schedule => schedule.status))].sort(),
    ['APPROVED', 'DRAFT', 'NEEDS_REVISION', 'PENDING_APPROVAL', 'PUBLISHED'].sort());
  const managerList = await service.listSchedules(actor, 'manager');
  assert.ok(managerList.length > 0);
  assert.ok(managerList.every(schedule => schedule.branch_id === profile.branch_id));
  assert.equal(managerList.some(schedule => schedule.id === 'tv4-seed-le-duan-pending-01'), false,
    'PENDING_APPROVAL stays in the GS queue');
  assert.equal(managerList.find(schedule => schedule.id === 'tv4-seed-le-duan-revision-01').approvals[0].reason,
    'Cần cân đối lại nhân sự trong ca tối tại Lê Duẩn.');
  assert.equal(managerList.find(schedule => schedule.id === 'tv4-seed-le-duan-published-01').published_by,
    actor.id);
  assert.ok(managerList.find(schedule => schedule.id === 'tv4-seed-le-duan-published-01').published_at);
});

test('Lê Duẩn schedules stay invisible and immutable to QLs from other branches', async () => {
  const service = makeService();
  const haiChauManager = types.mockActorForProfile({
    username: 'QL Hải Châu', role: 'QL', branch_id: 'real-hai-chau-uuid', branch_name: 'Chi nhánh mô phỏng Hải Châu',
  });
  const leDuanScheduleId = 'tv4-seed-le-duan-revision-01';
  assert.equal(await get(service, haiChauManager, 'manager', leDuanScheduleId), undefined);
  const leDuanRecord = serviceModule.createTv4MockSeed().schedules.find(schedule => schedule.id === leDuanScheduleId);
  await assert.rejects(service.resubmitSchedule(haiChauManager, leDuanScheduleId, 'Sửa ngoài phạm vi.', leDuanRecord.shift_assignments), { code: 'OUT_OF_SCOPE' });
  await assert.rejects(service.publishSchedule(haiChauManager, 'tv4-seed-le-duan-approved-01', '2026-11-01T12:00:00.000Z'), { code: 'OUT_OF_SCOPE' });
});

test('Lê Duẩn QL can publish only its seeded approved schedule without testing GS scope', async () => {
  const service = makeService();
  const manager = types.mockActorForProfile({
    username: 'QL Lê Duẩn', role: 'QL', branch_id: '11111111-1111-1111-1111-111111111111', branch_name: 'Jollibee Lê Duẩn',
  });
  await assert.rejects(service.publishSchedule(manager, 'tv4-seed-le-duan-pending-01', '2026-11-01T12:00:00.000Z'), { code: 'INVALID_STATUS' });
  await assert.rejects(service.publishSchedule(manager, 'tv4-seed-le-duan-revision-01', '2026-11-01T12:00:00.000Z'), { code: 'INVALID_STATUS' });
  const published = await service.publishSchedule(manager, 'tv4-seed-le-duan-approved-01', '2026-11-01T12:00:00.000Z');
  assert.equal(published.status, 'PUBLISHED');
  assert.equal(published.published_by, manager.id);
  assert.equal(published.branch_id, manager.branch_id);
  await assert.rejects(service.publishSchedule(manager, 'tv4-seed-le-duan-draft-01', '2026-11-01T12:00:00.000Z'), { code: 'INVALID_STATUS' });
});

test('GS sees pending schedules from both Hải Châu and Thanh Khê, while QLs see only their own branch', async () => {
  const service = makeService();
  const haiChauManager = types.mockActorForProfile({
    username: 'QL Hải Châu', role: 'QL', branch_id: 'real-hai-chau-uuid', branch_name: 'Chi nhánh mô phỏng Hải Châu',
  });
  const thanhKheManager = types.mockActorForProfile({
    username: 'QL Thanh Khê', role: 'QL', branch_id: 'real-thanh-khe-uuid', branch_name: 'Thanh Khê 1',
  });

  const gsPending = await service.listSchedules(gs, 'pending');
  assert.ok(gsPending.some(row => row.id === 'tv4-seed-pending-group-v2' && row.branch_id === 'tv4-branch-central'));
  assert.ok(gsPending.some(row => row.id === 'tv4-seed-north-pending' && row.branch_id === 'tv4-branch-north'));
  const configuredCentralAndNorthPending = gsPending.filter(row => ['tv4-branch-central', 'tv4-branch-north'].includes(row.branch_id));
  assert.ok(configuredCentralAndNorthPending.some(row => row.id === 'tv4-seed-pending-group-v2'));
  assert.ok(configuredCentralAndNorthPending.some(row => row.id === 'tv4-seed-north-pending'));

  const haiChauList = await service.listSchedules(haiChauManager, 'manager');
  const thanhKheList = await service.listSchedules(thanhKheManager, 'manager');
  assert.ok(haiChauList.length > 0 && haiChauList.every(row => row.branch_id === 'tv4-branch-central'));
  assert.ok(thanhKheList.length > 0 && thanhKheList.every(row => row.branch_id === 'tv4-branch-north'));
  assert.equal(haiChauList.some(row => row.id === 'tv4-seed-north-pending'), false);
  assert.equal(thanhKheList.some(row => row.id === 'tv4-seed-pending-group-v2'), false);
});

test('GS rejection on Thanh Khê 1 is visible with its reason only to the matching QL', async () => {
  const service = makeService();
  const thanhKheManager = types.mockActorForProfile({
    username: 'QL Thanh Khê', role: 'QL', branch_id: 'real-thanh-khe-uuid', branch_name: 'Thanh Khê 1',
  });
  const haiChauManager = types.mockActorForProfile({
    username: 'QL Hải Châu', role: 'QL', branch_id: 'real-hai-chau-uuid', branch_name: 'Chi nhánh mô phỏng Hải Châu',
  });

  const rejected = await service.decideSchedule(gs, 'tv4-seed-north-pending', 'NEEDS_REVISION', 'Thanh Khê cần cân đối lại ca tối.');
  assert.equal(rejected.status, 'NEEDS_REVISION');
  assert.equal(rejected.branch_id, 'tv4-branch-north');
  assert.equal(rejected.approvals[0].reason, 'Thanh Khê cần cân đối lại ca tối.');
  const qlVisible = await get(service, thanhKheManager, 'manager', rejected.id);
  assert.equal(qlVisible.status, 'NEEDS_REVISION');
  assert.equal(qlVisible.approvals[0].reason, 'Thanh Khê cần cân đối lại ca tối.');
  assert.equal(await get(service, haiChauManager, 'manager', rejected.id), undefined);
  await assert.rejects(service.resubmitSchedule(haiChauManager, rejected.id, 'Sửa lịch trái chi nhánh.', rejected.shift_assignments), { code: 'OUT_OF_SCOPE' });
  await assert.rejects(service.publishSchedule(haiChauManager, rejected.id, '2026-11-01T12:00:00.000Z'), { code: 'OUT_OF_SCOPE' });
});

test('Thanh Khê QL can resubmit after repeated rejection and GS can review both supervised branches', async () => {
  const service = makeService();
  const thanhKheManager = types.mockActorForProfile({
    username: 'QL Thanh Khê', role: 'QL', branch_id: 'real-thanh-khe-uuid', branch_name: 'Thanh Khê 1',
  });
  const centralPending = 'tv4-seed-pending-group-v2';
  let current = await service.decideSchedule(gs, 'tv4-seed-north-pending', 'NEEDS_REVISION', 'Cần sửa lần một.');
  for (let round = 1; round <= 2; round += 1) {
    const visible = await get(service, thanhKheManager, 'manager', current.id);
    assert.equal(visible.status, 'NEEDS_REVISION');
    assert.equal(visible.approvals[0].reason, round === 1 ? 'Cần sửa lần một.' : 'Cần sửa lần hai.');
    const changed = swapShiftAssignments(visible.shift_assignments);
    current = await service.resubmitSchedule(thanhKheManager, visible.id, `Đã sửa lần ${round}.`, changed);
    assert.equal(current.status, 'PENDING_APPROVAL');
    assert.equal((await get(service, gs, 'pending', current.id)).status, 'PENDING_APPROVAL');
    if (round === 1) current = await service.decideSchedule(gs, current.id, 'NEEDS_REVISION', 'Cần sửa lần hai.');
  }
  assert.equal(current.status, 'PENDING_APPROVAL');
  const northApproved = await service.decideSchedule(gs, current.id, 'APPROVED');
  const centralApproved = await service.decideSchedule(gs, centralPending, 'APPROVED');
  assert.equal(northApproved.branch_id, 'tv4-branch-north');
  assert.equal(centralApproved.branch_id, 'tv4-branch-central');
  assert.equal((await service.publishSchedule(thanhKheManager, northApproved.id, '2026-11-01T12:00:00.000Z')).status, 'PUBLISHED');
  await assert.rejects(service.publishSchedule(thanhKheManager, centralApproved.id, '2026-11-01T12:00:00.000Z'), { code: 'OUT_OF_SCOPE' });
});

test('QL TV4 screen hides branch IDs and shows a friendly warning for an unmapped demo profile', () => {
  const matchedMarkup = renderWorkflowWithProfile({
    id: 'real-manager', username: 'Quản lý Thanh Khê', role: 'QL', branch_id: 'real-branch-thanh-khe',
    branch_name: 'Thanh Khê 1', is_active: true, must_change_password: false,
  });
  assert.doesNotMatch(matchedMarkup, /Chẩn đoán phạm vi QL/);
  assert.doesNotMatch(matchedMarkup, /Profile branch_name=/);
  assert.doesNotMatch(matchedMarkup, /real-branch-thanh-khe/);

  const unmappedMarkup = renderWorkflowWithProfile({
    id: 'real-manager', username: 'Quản lý chưa ánh xạ', role: 'QL', branch_id: 'unknown-branch-id',
    branch_name: 'Chi nhánh chưa có fixture', is_active: true, must_change_password: false,
  });
  assert.match(unmappedMarkup, /Không thể xác định chi nhánh dữ liệu thử nghiệm cho tài khoản này/);
  assert.doesNotMatch(unmappedMarkup, /unknown-branch-id|branch_name=|fixture TV4/);
});

test('TV4 publish empty API response shows the friendly message and refresh action without branch diagnostics', async () => {
  const branchUuid = '11111111-1111-4111-8111-111111111111';
  const profile = {
    id: 'manager-id', username: 'Quản lý', role: 'QL', branch_id: branchUuid,
    branch_name: 'Jollibee Demo', is_active: true, must_change_password: false,
  };
  let apiCalls = 0;
  const apiService = {
    mode: 'api',
    listSchedules: async () => { apiCalls += 1; return []; },
  };
  const harness = createInteractiveWorkflowHarness(profile, apiService, [], 'publish');
  harness.render();
  harness.runEffects();
  await flushPromises();

  const nodes = harness.allNodes(harness.render());
  const emptyState = nodes.find(node => node.props.className === 'workflow-empty' && node.props.role === 'status');
  assert.ok(emptyState);
  assert.match(harness.textOf(emptyState), /Chưa có lịch làm việc phù hợp\./);
  assert.match(harness.textOf(emptyState), /Khi có lịch được duyệt thuộc chi nhánh của bạn, lịch sẽ xuất hiện tại đây\. Nhấn “Làm mới” để kiểm tra dữ liệu mới\./);
  assert.doesNotMatch(harness.textOf(emptyState), new RegExp(branchUuid));
  assert.equal(nodes.some(node => node.props.role === 'alert'), false);
  assert.equal(apiCalls, 1);

  harness.clickButton(harness.render(), 'Làm mới');
  await flushPromises();
  assert.equal(apiCalls, 2);
});

test('TV4 API load failure shows an error without a false empty state or mock fallback', async () => {
  const profile = {
    id: 'manager-hai-chau', username: 'QL Hải Châu', role: 'QL',
    branch_id: 'real-hai-chau-id', branch_name: 'Hải Châu', is_active: true, must_change_password: false,
  };
  const staleSchedule = serviceModule.createTv4MockSeed().schedules.find(schedule => schedule.status === 'APPROVED');
  let apiCalls = 0;
  const service = {
    mode: 'api',
    listSchedules: async () => {
      apiCalls += 1;
      throw new types.ScheduleWorkflowError('Backend lỗi HTTP 500.', 'HTTP_500', 500);
    },
  };
  const harness = createInteractiveWorkflowHarness(profile, service, [staleSchedule]);
  harness.render();
  harness.runEffects();
  await flushPromises();
  const tree = harness.render();
  const nodes = harness.allNodes(tree);
  const errorAlert = nodes.find(node => node.props.role === 'alert' && node.props.className === 'workflow-alert error');

  assert.equal(apiCalls, 1);
  assert.ok(errorAlert);
  assert.match(harness.textOf(errorAlert), /Backend lỗi HTTP 500/);
  assert.equal(nodes.some(node => node.props.className === 'workflow-empty' && /Chưa có lịch/.test(harness.textOf(node))), false);
  assert.equal(nodes.some(node => node.props.className === 'workflow-list'), false);
});

test('TV4 shows a success modal only after an action succeeds and keeps failures in the error alert', async () => {
  const seededSchedule = serviceModule.createTv4MockSeed().schedules
    .find(schedule => schedule.id === 'tv4-seed-approved-01');
  const profile = {
    id: 'manager-hai-chau', email: 'manager@example.invalid', username: 'QL Hải Châu', role: 'QL',
    branch_id: 'tv4-branch-central', branch_name: 'Hải Châu', is_active: true, must_change_password: false,
  };

  async function runPublishScenario(shouldFail) {
    let currentSchedule = JSON.parse(JSON.stringify(seededSchedule));
    let publishCalls = 0;
    const service = {
      listSchedules: async () => [currentSchedule],
      publishSchedule: async () => {
        publishCalls += 1;
        if (shouldFail) throw new types.ScheduleWorkflowError('Không thể công bố lịch lúc này.', 'PUBLISH_FAILED');
        currentSchedule = { ...currentSchedule, status: 'PUBLISHED', published_at: instant, published_by: 'manager-hai-chau' };
        return currentSchedule;
      },
    };
    const harness = createInteractiveWorkflowHarness(profile, service, [currentSchedule]);
    let tree = harness.render();
    harness.clickButton(tree, 'JolliShift Demo · Hải Châu · Phiên bản 1');
    tree = harness.render();
    const deadlineInput = harness.allNodes(tree).find(node => node.type === 'input' && node.props.type === 'datetime-local');
    assert.ok(deadlineInput);
    deadlineInput.props.onChange({ target: { value: '2099-11-01T12:00' } });
    tree = harness.render();
    harness.clickButton(tree, 'Công bố lịch');
    tree = harness.render();
    assert.equal(harness.allNodes(tree).some(node => node.props.role === 'dialog'), true,
      'custom confirmation appears before the service operation');
    assert.equal(harness.allNodes(tree).some(node => node.props['aria-labelledby'] === 'workflow-success-title'), false);
    harness.clickButton(tree, 'Xác nhận');
    await flushPromises();
    tree = harness.render();
    return { tree, harness, publishCalls };
  }

  const successful = await runPublishScenario(false);
  const successDialog = successful.harness.allNodes(successful.tree)
    .find(node => node.props['aria-labelledby'] === 'workflow-success-title');
  assert.ok(successDialog);
  assert.match(successful.harness.textOf(successDialog), /Thao tác thành công/);
  assert.match(successful.harness.textOf(successDialog), /Lịch làm việc đã được công bố/);
  assert.equal(successful.publishCalls, 1);

  const failed = await runPublishScenario(true);
  const nodes = failed.harness.allNodes(failed.tree);
  assert.equal(nodes.some(node => node.props['aria-labelledby'] === 'workflow-success-title'), false);
  const errorAlert = nodes.find(node => node.props.role === 'alert' && node.props.className === 'workflow-alert error');
  assert.ok(errorAlert);
  assert.match(failed.harness.textOf(errorAlert), /Không thể công bố lịch lúc này/);
  assert.equal(failed.publishCalls, 1);
});

test('QL confirms adjustment, sends the edited shifts to the service, and keeps the old revision intact', async () => {
  const original = JSON.parse(JSON.stringify(serviceModule.createTv4MockSeed().schedules
    .find(schedule => schedule.id === 'tv4-seed-needs-revision-01')));
  let nextVersion = null;
  let submitted = null;
  let listCalls = 0;
  const qlProfile = {
    id: 'manager-hai-chau', email: 'manager@example.invalid', username: 'QL Hải Châu', role: 'QL',
    branch_id: 'tv4-branch-central', branch_name: 'Hải Châu', is_active: true, must_change_password: false,
  };
  const service = {
    listSchedules: async () => {
      listCalls += 1;
      return [{ ...original, is_latest: !nextVersion }];
    },
    resubmitSchedule: async (actor, scheduleId, note, assignments) => {
      submitted = { actor, scheduleId, note, assignments };
      original.is_latest = false;
      nextVersion = {
        ...original, id: 'tv4-resubmitted-test-v2', version: 2, status: 'PENDING_APPROVAL', is_latest: true,
        resubmission_note: note, approvals: [], shift_assignments: assignments,
      };
      return nextVersion;
    },
  };
  const harness = createInteractiveWorkflowHarness(qlProfile, service, [original]);
  let tree = harness.render();
  harness.clickButton(tree, 'JolliShift Demo · Hải Châu · Phiên bản 1');
  tree = harness.render();
  harness.clickButton(tree, 'Điều chỉnh lịch');
  tree = harness.render();

  const selects = harness.allNodes(tree).filter(node => node.type === 'select');
  assert.equal(selects.length, original.shift_assignments.length);
  selects[0].props.onChange({ target: { value: 'tv4-shift-evening' } });
  tree = harness.render();
  const changedSelects = harness.allNodes(tree).filter(node => node.type === 'select');
  assert.equal(changedSelects[0].props.value, 'tv4-shift-evening');
  assert.equal(changedSelects[2].props.value, 'tv4-shift-morning', 'the existing evening slot is swapped to preserve all three shifts');

  const note = harness.allNodes(tree).find(node => node.type === 'textarea');
  note.props.onChange({ target: { value: 'Cân đối lại nhân sự giữa ca sáng và ca tối.' } });
  tree = harness.render();
  const adjustButton = harness.allNodes(tree).find(node => node.type === 'button' && harness.textOf(node).trim() === 'Điều chỉnh');
  assert.ok(adjustButton);
  assert.equal(adjustButton.props.disabled, false);
  adjustButton.props.onClick();
  tree = harness.render();
  assert.ok(harness.allNodes(tree).some(node => node.props['aria-labelledby'] === 'workflow-confirm-title'));
  harness.clickButton(tree, 'Xác nhận');
  await flushPromises();
  tree = harness.render();

  assert.ok(submitted);
  assert.equal(submitted.actor.id, 'tv4-demo-manager-central');
  assert.equal(submitted.scheduleId, original.id);
  assert.equal(submitted.note, 'Cân đối lại nhân sự giữa ca sáng và ca tối.');
  assert.equal(submitted.assignments[0].shifts.id, 'tv4-shift-evening');
  assert.equal(submitted.assignments[2].shifts.id, 'tv4-shift-morning');
  assert.equal(nextVersion.status, 'PENDING_APPROVAL');
  assert.equal(original.status, 'NEEDS_REVISION');
  assert.equal(original.approvals[0].reason, 'Thiếu nhân sự ở ca tối; vui lòng cân đối lại phân công.');
  assert.equal(original.is_latest, false);
  assert.equal(listCalls, 1, 'the QL list refreshes after the version is created');
  assert.equal(harness.allNodes(tree).some(node => node.props['aria-labelledby'] === 'workflow-confirm-title'), false);
  const successDialog = harness.allNodes(tree).find(node => node.props['aria-labelledby'] === 'workflow-success-title');
  assert.ok(successDialog);
  assert.match(harness.textOf(successDialog), /đã được điều chỉnh và gửi đến GS/);
  assert.match(harness.textOf(successDialog), /Phiên bản 2 đang chờ phê duyệt/);
});

test('failed QL adjustment shows an error and retains the edited fields', async () => {
  const schedule = JSON.parse(JSON.stringify(serviceModule.createTv4MockSeed().schedules
    .find(item => item.id === 'tv4-seed-needs-revision-01')));
  const profile = {
    id: 'manager-hai-chau', email: 'manager@example.invalid', username: 'QL Hải Châu', role: 'QL',
    branch_id: 'tv4-branch-central', branch_name: 'Hải Châu', is_active: true, must_change_password: false,
  };
  const service = {
    listSchedules: async () => [schedule],
    resubmitSchedule: async () => { throw new types.ScheduleWorkflowError('Lịch phải có đủ ba ca hợp lệ mỗi ngày.', 'INVALID_ASSIGNMENTS'); },
  };
  const harness = createInteractiveWorkflowHarness(profile, service, [schedule]);
  let tree = harness.render();
  harness.clickButton(tree, 'JolliShift Demo · Hải Châu · Phiên bản 1');
  tree = harness.render();
  harness.clickButton(tree, 'Điều chỉnh lịch');
  tree = harness.render();
  const selects = harness.allNodes(tree).filter(node => node.type === 'select');
  selects[0].props.onChange({ target: { value: 'tv4-shift-evening' } });
  tree = harness.render();
  const note = harness.allNodes(tree).find(node => node.type === 'textarea');
  note.props.onChange({ target: { value: 'Điều chỉnh nhưng service từ chối.' } });
  tree = harness.render();
  harness.clickButton(tree, 'Điều chỉnh');
  tree = harness.render();
  harness.clickButton(tree, 'Xác nhận');
  await flushPromises();
  tree = harness.render();

  const nodes = harness.allNodes(tree);
  assert.equal(nodes.some(node => node.props['aria-labelledby'] === 'workflow-success-title'), false);
  assert.equal(nodes.some(node => node.props['aria-labelledby'] === 'workflow-confirm-title'), false);
  const errorAlert = nodes.find(node => node.props.role === 'alert' && node.props.className === 'workflow-alert error');
  assert.ok(errorAlert);
  assert.match(harness.textOf(errorAlert), /Lịch phải có đủ ba ca hợp lệ mỗi ngày/);
  assert.equal(harness.state[2], schedule.id, 'editor remains open after validation failure');
  assert.equal(harness.state[4], 'Điều chỉnh nhưng service từ chối.');
  assert.equal(harness.state[5][schedule.shift_assignments[0].id], 'tv4-shift-evening');
});

test('API mode opens the NEEDS_REVISION editor but preserves edits and shows an error when resubmit is not configured', async () => {
  const schedule = JSON.parse(JSON.stringify(serviceModule.createTv4MockSeed().schedules
    .find(row => row.id === 'tv4-seed-needs-revision-01')));
  const profile = {
    id: 'manager-hai-chau', email: 'manager@example.invalid', username: 'QL Hải Châu', role: 'QL',
    branch_id: 'tv4-branch-central', branch_name: 'Hải Châu', is_active: true, must_change_password: false,
  };
  let submitted;
  const service = {
    mode: 'api',
    listSchedules: async () => [schedule],
    resubmitSchedule: async (...args) => {
      submitted = args;
      throw new types.ScheduleWorkflowError('API điều chỉnh và trình lại lịch chưa được cấu hình trên backend.', 'RESUBMIT_NOT_CONFIGURED', 501);
    },
  };
  const harness = createInteractiveWorkflowHarness(profile, service, [schedule]);
  harness.render();
  harness.runEffects();
  await flushPromises();

  let tree = harness.render();
  harness.clickButton(tree, 'JolliShift Demo · Hải Châu · Phiên bản 1');
  tree = harness.render();
  harness.clickButton(tree, 'Điều chỉnh lịch');
  tree = harness.render();

  const note = harness.allNodes(tree).find(node => node.type === 'textarea');
  const shiftSelect = harness.allNodes(tree).find(node => node.type === 'select');
  assert.ok(note);
  assert.ok(shiftSelect);
  note.props.onChange({ target: { value: 'Điều chỉnh ca sau khi GS phản hồi.' } });
  const nextShift = shiftSelect.props.children.find(option => option.props.value !== shiftSelect.props.value);
  assert.ok(nextShift);
  shiftSelect.props.onChange({ target: { value: nextShift.props.value } });

  tree = harness.render();
  harness.clickButton(tree, 'Điều chỉnh');
  tree = harness.render();
  harness.clickButton(tree, 'Xác nhận');
  await flushPromises();
  tree = harness.render();

  assert.equal(submitted[1], schedule.id);
  assert.equal(submitted[2], 'Điều chỉnh ca sau khi GS phản hồi.');
  assert.equal(submitted[4], schedule.version);
  assert.equal(submitted[5], schedule.schedule_group_id);
  assert.equal(harness.state[2], schedule.id, 'editor remains open after the unconfigured API error');
  assert.equal(harness.state[4], 'Điều chỉnh ca sau khi GS phản hồi.', 'note remains available for retry');
  assert.equal(harness.allNodes(tree).some(node => node.props['aria-labelledby'] === 'workflow-success-title'), false);
  const errorAlert = harness.allNodes(tree).find(node => node.props.role === 'alert' && node.props.className === 'workflow-alert error');
  assert.ok(errorAlert);
  assert.match(harness.textOf(errorAlert), /chưa được cấu hình trên backend/);
});

test('QL initial list returns schedules in its exact fixture scope and keeps pending approval with GS', async () => {
  const service = makeService();
  const manager = types.mockActorForProfile({
    username: 'Quản lý Thanh Khê', role: 'QL', branch_id: 'real-branch-thanh-khe', branch_name: 'JolliShift Demo · Thanh Khê 1',
  });
  const managerList = await service.listSchedules(manager, 'manager');
  assert.equal(managerList.some(schedule => schedule.id === 'tv4-seed-draft-north'), true);
  assert.equal(managerList.find(schedule => schedule.id === 'tv4-seed-draft-north').branch_id, 'tv4-branch-north');
  assert.equal(managerList.some(schedule => schedule.id === 'tv4-seed-north-pending'), false);
});

test('demo seed includes every workflow status and manager queue exposes draft, revision, approved and published records', async () => {
  const service = makeService();
  const seed = serviceModule.createTv4MockSeed();
  const allStatuses = new Set(seed.schedules.map(schedule => schedule.status));
  assert.deepEqual([...allStatuses].sort(), ['APPROVED', 'DRAFT', 'NEEDS_REVISION', 'PENDING_APPROVAL', 'PUBLISHED'].sort());
  assert.ok(seed.schedules.every(schedule => schedule.id.startsWith('tv4-seed-')));
  assert.equal(seed.schedules.some(schedule => /schedule-(?:group-|needs-revision|approved|draft-demo|published-demo)/.test(schedule.id)), false);
  const revision = seed.schedules.find(schedule => schedule.id === 'tv4-seed-needs-revision-01');
  assert.equal(revision.approvals[0].schedule_id, revision.id);
  assert.equal(revision.approvals[0].decision, 'NEEDS_REVISION');
  assert.ok(revision.approvals[0].reason);
  const approved = seed.schedules.find(schedule => schedule.id === 'tv4-seed-approved-01');
  assert.equal(approved.approvals[0].decision, 'APPROVED');
  assert.equal(approved.published_at, null);
  const published = seed.schedules.find(schedule => schedule.id === 'tv4-seed-published-01');
  assert.equal(published.approvals[0].decision, 'APPROVED');
  assert.ok(published.published_by);
  assert.ok(published.published_at);
  const managerSchedules = await service.listSchedules(ql, 'manager');
  assert.equal(managerSchedules.find(schedule => schedule.id === 'tv4-seed-draft-01').status, 'DRAFT');
  assert.equal(managerSchedules.find(schedule => schedule.id === 'tv4-seed-needs-revision-01').status, 'NEEDS_REVISION');
  assert.equal(managerSchedules.find(schedule => schedule.id === 'tv4-seed-approved-01').status, 'APPROVED');
  assert.equal(managerSchedules.find(schedule => schedule.id === 'tv4-seed-published-01').status, 'PUBLISHED');
});

test('TV4 seed assigns exactly three configured shifts to every date in each schedule period', () => {
  const seed = serviceModule.createTv4MockSeed();
  const expected = [
    { id: 'tv4-shift-morning', name: 'Ca sáng', start_time: '08:00:00', end_time: '12:00:00' },
    { id: 'tv4-shift-afternoon', name: 'Ca chiều', start_time: '12:00:00', end_time: '17:00:00' },
    { id: 'tv4-shift-evening', name: 'Ca tối', start_time: '17:00:00', end_time: '22:00:00' },
  ];
  assert.equal(JSON.stringify(types.TV4_SHIFT_DEFINITIONS), JSON.stringify(expected));

  for (const schedule of seed.schedules) {
    const expectedDates = [];
    for (let day = 2; day <= 8; day += 1) expectedDates.push(`2026-11-${String(day).padStart(2, '0')}`);
    const grouped = new Map();
    for (const assignment of schedule.shift_assignments) {
      const rows = grouped.get(assignment.work_date) || [];
      rows.push(assignment);
      grouped.set(assignment.work_date, rows);
    }
    assert.deepEqual([...grouped.keys()].sort(), expectedDates);
    assert.equal(schedule.shift_assignments.length, expectedDates.length * 3);
    for (const date of expectedDates) {
      const rows = grouped.get(date);
      assert.equal(rows.length, 3, `${schedule.id} on ${date}`);
      assert.deepEqual(rows.map(row => row.shifts.id).sort(), expected.map(shift => shift.id).sort());
      for (let index = 0; index < expected.length; index += 1) {
        assert.equal(rows.find(row => row.shifts.id === expected[index].id).shifts.name, expected[index].name);
        assert.equal(rows.find(row => row.shifts.id === expected[index].id).shifts.start_time, expected[index].start_time);
        assert.equal(rows.find(row => row.shifts.id === expected[index].id).shifts.end_time, expected[index].end_time);
      }
      const byEmployee = new Map();
      for (const row of rows) {
        const name = row.employees.full_name;
        const employeeRows = byEmployee.get(name) || [];
        employeeRows.push(row);
        byEmployee.set(name, employeeRows);
      }
      for (const employeeRows of byEmployee.values()) {
        const ordered = employeeRows.slice().sort((left, right) => left.shifts.start_time.localeCompare(right.shifts.start_time));
        for (let index = 1; index < ordered.length; index += 1) {
          assert.ok(ordered[index - 1].shifts.end_time <= ordered[index].shifts.start_time,
            `overlapping fixture shifts for ${ordered[index].employees.full_name} on ${date}`);
        }
      }
    }
    assert.equal(new Set(schedule.shift_assignments.map(row => row.employees.full_name)).size, 2,
      'use only the two existing mock employees');
    assert.doesNotMatch(JSON.stringify(schedule.shift_assignments.map(row => row.shifts)), /07:00:00|15:00:00|23:00:00/);
  }
});

test('TV4 adjustment choices show all three configured shifts in the schedule detail UI', () => {
  const schedule = JSON.parse(JSON.stringify(serviceModule.createTv4MockSeed().schedules
    .find(item => item.id === 'tv4-seed-needs-revision-01')));
  const profile = {
    id: 'manager-hai-chau', email: 'manager@example.invalid', username: 'QL Hải Châu', role: 'QL',
    branch_id: 'tv4-branch-central', branch_name: 'Hải Châu', is_active: true, must_change_password: false,
  };
  const harness = createInteractiveWorkflowHarness(profile, { listSchedules: async () => [schedule] }, [schedule]);
  harness.state[1] = schedule.id;
  harness.state[2] = schedule.id;
  const tree = harness.render();
  const firstSelect = harness.allNodes(tree).find(node => node.type === 'select');
  assert.ok(firstSelect);
  const optionRows = harness.allNodes(firstSelect).filter(node => node.type === 'option');
  assert.deepEqual(optionRows.map(option => option.props.value), [
    'tv4-shift-morning', 'tv4-shift-afternoon', 'tv4-shift-evening',
  ]);
  assert.match(harness.textOf(firstSelect), /Ca sáng \(08:00–12:00\)/);
  assert.match(harness.textOf(firstSelect), /Ca chiều \(12:00–17:00\)/);
  assert.match(harness.textOf(firstSelect), /Ca tối \(17:00–22:00\)/);
});

test('TV4 resubmission rejects invalid shift times and duplicate shift slots', async () => {
  const service = makeService();
  const rejected = await get(service, ql, 'manager', 'tv4-seed-needs-revision-01');
  const wrongTime = rejected.shift_assignments.map((assignment, index) => index === 0 ? {
    ...assignment,
    shifts: { ...assignment.shifts, end_time: '12:30:00' },
  } : assignment);
  await assert.rejects(service.resubmitSchedule(ql, rejected.id, 'Giờ ca không hợp lệ.', wrongTime), { code: 'INVALID_ASSIGNMENTS' });

  const duplicateShift = rejected.shift_assignments.map((assignment, index) => index === 1 ? {
    ...assignment,
    shifts: { ...rejected.shift_assignments[0].shifts },
  } : assignment);
  await assert.rejects(service.resubmitSchedule(ql, rejected.id, 'Trùng ca trong ngày.', duplicateShift), { code: 'INVALID_ASSIGNMENTS' });
  assert.equal((await get(service, ql, 'manager', rejected.id)).status, 'NEEDS_REVISION');
});

test('schedule table shows only the whole schedule status and omits assignment status', () => {
  const component = fs.readFileSync(path.join(srcRoot, 'ScheduleWorkflow.tsx'), 'utf8');
  assert.match(component, /<th>Trạng thái lịch<\/th>/);
  assert.doesNotMatch(component, /<th>Trạng thái phân công<\/th>/);
  assert.match(component, /statusLabel\[schedule\.status\] \|\| schedule\.status/);
  assert.doesNotMatch(component, /entry\.status === 'DRAFT'/);
  assert.match(component, /editingScheduleId !== schedule\.id[\s\S]*?setEditingScheduleId\(schedule\.id\)/);
  assert.match(component, /editingScheduleId === schedule\.id[\s\S]*?setConfirmation\(\{ schedule, action: 'resubmit' \}\)/);
  assert.match(component, /function canManagerResubmit\(/);
  assert.match(component, /schedule\.status === 'NEEDS_REVISION' && schedule\.is_latest/);
});

test('reject without a reason is blocked without changing status or history', async () => {
  const service = makeService();
  await assert.rejects(service.decideSchedule(gs, 'tv4-seed-pending-group-v2', 'NEEDS_REVISION', '  '), { code: 'REASON_REQUIRED' });
  const unchanged = await get(service, gs, 'pending', 'tv4-seed-pending-group-v2');
  assert.equal(unchanged.status, 'PENDING_APPROVAL');
  assert.equal(unchanged.approvals.length, 0);
});

test('reject with a reason stores NEEDS_REVISION, actor, reason and timestamp', async () => {
  const service = makeService();
  const result = await service.decideSchedule(gs, 'tv4-seed-pending-group-v2', 'NEEDS_REVISION', '  Cần bổ sung nhân sự ca tối.  ');
  assert.equal(result.status, 'NEEDS_REVISION');
  assert.equal(result.approvals[0].decision, 'NEEDS_REVISION');
  assert.equal(result.approvals[0].reason, 'Cần bổ sung nhân sự ca tối.');
  assert.equal(result.approvals[0].supervisor_id, gs.id);
  assert.equal(result.approvals[0].decided_at, instant);
  assert.equal((await get(service, ql, 'manager', 'tv4-seed-pending-group-v2')).status, 'NEEDS_REVISION');
  assert.match((await get(service, ql, 'manager', 'tv4-seed-pending-group-v2')).approvals[0].reason, /Cần bổ sung/);
});

test('a second decision on an already decided version is rejected without duplicating history', async () => {
  const service = makeService();
  await service.decideSchedule(gs, 'tv4-seed-pending-group-v2', 'NEEDS_REVISION', 'C?n b? sung nh?n s?.');
  await assert.rejects(service.decideSchedule(gs, 'tv4-seed-pending-group-v2', 'APPROVED'), { code: 'INVALID_STATUS' });
  const decided = await get(service, gs, 'history', 'tv4-seed-pending-group-v2');
  assert.equal(decided.status, 'NEEDS_REVISION');
  assert.equal(decided.approvals.length, 1);
  assert.equal(decided.approvals[0].reason, 'C?n b? sung nh?n s?.');
});

test('manager cannot publish a schedule that has not been approved', async () => {
  const service = makeService();
  await assert.rejects(service.publishSchedule(ql, 'tv4-seed-pending-group-v2', '2026-11-01T12:00:00.000Z'), { code: 'INVALID_STATUS' });
  const stillPending = await get(service, gs, 'pending', 'tv4-seed-pending-group-v2');
  assert.equal(stillPending.status, 'PENDING_APPROVAL');
  assert.equal(stillPending.published_at, null);
});

test('manager cannot publish DRAFT or NEEDS_REVISION schedules', async () => {
  const service = makeService();
  await assert.rejects(service.publishSchedule(ql, 'tv4-seed-draft-01', '2026-11-01T12:00:00.000Z'), { code: 'INVALID_STATUS' });
  await assert.rejects(service.publishSchedule(ql, 'tv4-seed-needs-revision-01', '2026-11-01T12:00:00.000Z'), { code: 'INVALID_STATUS' });
  assert.equal((await get(service, ql, 'manager', 'tv4-seed-draft-01')).published_at, null);
  assert.equal((await get(service, ql, 'manager', 'tv4-seed-needs-revision-01')).published_at, null);
});

test('employees cannot approve or publish schedules', async () => {
  const service = makeService();
  await assert.rejects(service.decideSchedule(nv, 'tv4-seed-pending-group-v2', 'APPROVED'), { code: 'FORBIDDEN' });
  await assert.rejects(service.publishSchedule(nv, 'tv4-seed-approved-01', '2026-11-01T12:00:00.000Z'), { code: 'FORBIDDEN' });
});

test('supervisors and managers cannot read or mutate schedules outside their branch scope', async () => {
  const service = makeService();
  assert.equal(await get(service, gs, 'pending', 'tv4-seed-out-of-scope-pending'), undefined);
  await assert.rejects(service.decideSchedule(outsiderGs, 'tv4-seed-pending-group-v2', 'APPROVED'), { code: 'OUT_OF_SCOPE' });
  await assert.rejects(service.publishSchedule(outsiderQl, 'tv4-seed-approved-01', '2026-11-01T12:00:00.000Z'), { code: 'OUT_OF_SCOPE' });
});

test('an older pending or approved version cannot be approved or published', async () => {
  const service = makeService();
  await assert.rejects(service.decideSchedule(gs, 'tv4-seed-pending-group-v1', 'APPROVED'), { code: 'STALE_VERSION' });
  await assert.rejects(service.publishSchedule(ql, 'tv4-seed-approved-stale-01', '2026-11-01T12:00:00.000Z'), { code: 'STALE_VERSION' });
});

test('manager sees a rejection reason and resubmits it as a new pending version without losing old history', async () => {
  const service = makeService();
  const rejected = await get(service, ql, 'manager', 'tv4-seed-needs-revision-01');
  assert.equal(rejected.approvals[0].decision, 'NEEDS_REVISION');
  assert.match(rejected.approvals[0].reason, /Thiếu nhân sự/);
  await assert.rejects(service.resubmitSchedule(ql, rejected.id, '   ', rejected.shift_assignments), { code: 'ADJUSTMENT_REQUIRED' });
  await assert.rejects(service.resubmitSchedule(ql, rejected.id, 'Đã điều chỉnh.', rejected.shift_assignments), { code: 'NO_ASSIGNMENT_CHANGES' });
  const afterInvalidAttempts = (await service.listSchedules(ql, 'manager'))
    .filter(schedule => schedule.schedule_group_id === rejected.schedule_group_id);
  assert.equal(afterInvalidAttempts.length, 1);
  assert.equal(afterInvalidAttempts[0].status, 'NEEDS_REVISION');
  assert.equal(afterInvalidAttempts[0].approvals.length, 1);
  const pendingAfterInvalidAttempts = await service.listSchedules(gs, 'pending');
  assert.equal(pendingAfterInvalidAttempts.some(schedule =>
    schedule.schedule_group_id === rejected.schedule_group_id && schedule.version > rejected.version), false);
  const adjustedAssignments = swapShiftAssignments(rejected.shift_assignments);
  const next = await service.resubmitSchedule(ql, rejected.id, 'Đã cân đối thêm nhân sự cho ca tối.', adjustedAssignments);
  assert.equal(next.version, 2);
  assert.equal(next.status, 'PENDING_APPROVAL');
  assert.equal(next.schedule_group_id, rejected.schedule_group_id);
  assert.equal(next.resubmission_note, 'Đã cân đối thêm nhân sự cho ca tối.');
  assert.equal(next.shift_assignments[0].shifts.id, rejected.shift_assignments[1].shifts.id);
  assert.notEqual(rejected.shift_assignments[0].shifts.id, next.shift_assignments[0].shifts.id);
  assert.equal((await get(service, ql, 'manager', rejected.id)).approvals.length, 1);
});

test('full GS rejection to QL adjustment and resubmission keeps edits local until explicit submit', async () => {
  const service = makeService();
  const old = await service.decideSchedule(gs, 'tv4-seed-pending-group-v2', 'NEEDS_REVISION', 'Cần điều chỉnh phân công ca tối.');
  const managerList = await service.listSchedules(ql, 'manager');
  const rejected = managerList.find(schedule => schedule.id === old.id);
  assert.equal(rejected.status, 'NEEDS_REVISION');
  assert.equal(rejected.approvals[0].decision, 'NEEDS_REVISION');
  assert.equal(rejected.approvals[0].reason, 'Cần điều chỉnh phân công ca tối.');
  await assert.rejects(service.publishSchedule(ql, rejected.id, '2026-11-01T12:00:00.000Z'), { code: 'INVALID_STATUS' });

  const editedButUnsubmitted = swapShiftAssignments(rejected.shift_assignments);
  const unchangedBeforeSubmit = await get(service, ql, 'manager', rejected.id);
  assert.equal(unchangedBeforeSubmit.status, 'NEEDS_REVISION');
  assert.equal(unchangedBeforeSubmit.shift_assignments[0].shifts.id, rejected.shift_assignments[0].shifts.id);
  assert.equal((await service.listSchedules(gs, 'pending'))
    .filter(schedule => schedule.schedule_group_id === rejected.schedule_group_id)
    .some(schedule => schedule.version > rejected.version), false);

  const next = await service.resubmitSchedule(ql, rejected.id, 'Đã điều chỉnh ca tối.', editedButUnsubmitted);
  assert.equal(next.version, rejected.version + 1);
  assert.equal(next.status, 'PENDING_APPROVAL');
  assert.equal(next.shift_assignments[0].shifts.id, rejected.shift_assignments[1].shifts.id);
  assert.equal((await get(service, ql, 'manager', rejected.id)).status, 'NEEDS_REVISION');
  assert.equal((await get(service, ql, 'manager', rejected.id)).approvals[0].reason, 'Cần điều chỉnh phân công ca tối.');
  const pendingForSupervisor = await get(service, gs, 'pending', next.id);
  assert.equal(pendingForSupervisor.status, 'PENDING_APPROVAL');
  assert.equal(pendingForSupervisor.is_latest, true);
});

test('latest rejected version can be adjusted and resubmitted repeatedly without losing prior decisions', async () => {
  const service = makeService();
  let current = await get(service, gs, 'pending', 'tv4-seed-pending-group-v2');
  const rejectedVersions = [];

  for (let round = 1; round <= 3; round += 1) {
    const reason = `Lý do từ chối vòng ${round}.`;
    const rejected = await service.decideSchedule(gs, current.id, 'NEEDS_REVISION', reason);
    rejectedVersions.push(rejected);

    const managerQueue = await service.listSchedules(ql, 'manager');
    const visibleRejected = managerQueue.find(schedule => schedule.id === rejected.id);
    assert.equal(visibleRejected.status, 'NEEDS_REVISION');
    assert.equal(visibleRejected.is_latest, true);
    assert.equal(visibleRejected.approvals[0].reason, reason);
    assert.equal(visibleRejected.approvals.length, 1);
    await assert.rejects(service.publishSchedule(ql, rejected.id, '2026-11-01T12:00:00.000Z'), { code: 'INVALID_STATUS' });

    const assignments = swapShiftAssignments(rejected.shift_assignments);
    current = await service.resubmitSchedule(ql, rejected.id, `Đã điều chỉnh vòng ${round}.`, assignments);
    assert.equal(current.version, rejected.version + 1);
    assert.equal(current.status, 'PENDING_APPROVAL');
    assert.equal(current.schedule_group_id, rejected.schedule_group_id);
    assert.equal(current.is_latest, true);
    assert.equal(current.approvals.length, 0);
    assert.equal((await get(service, gs, 'pending', current.id)).status, 'PENDING_APPROVAL');

    for (const prior of rejectedVersions) {
      const preserved = await get(service, ql, 'manager', prior.id);
      assert.equal(preserved.status, 'NEEDS_REVISION');
      assert.equal(preserved.approvals.length, 1);
      assert.equal(preserved.approvals[0].reason, `Lý do từ chối vòng ${rejectedVersions.indexOf(prior) + 1}.`);
    }
  }

  await assert.rejects(service.publishSchedule(ql, current.id, '2026-11-01T12:00:00.000Z'), { code: 'INVALID_STATUS' });
  const approved = await service.decideSchedule(gs, current.id, 'APPROVED');
  const published = await service.publishSchedule(ql, approved.id, '2026-11-01T12:00:00.000Z');
  assert.equal(published.status, 'PUBLISHED');
  assert.equal(published.approvals[0].decision, 'APPROVED');
  const groupHistory = (await service.listSchedules(ql, 'manager'))
    .filter(schedule => schedule.schedule_group_id === current.schedule_group_id);
  assert.equal(groupHistory.filter(schedule => schedule.status === 'NEEDS_REVISION').length, 3);
  assert.equal(groupHistory.filter(schedule => schedule.status === 'PUBLISHED').length, 1);
});

test('publication stores actor/time/deadline and activates assignments together', async () => {
  const service = makeService();
  const result = await service.publishSchedule(ql, 'tv4-seed-approved-01', '2026-11-01T12:00:00.000Z');
  assert.equal(result.status, 'PUBLISHED');
  assert.equal(result.published_by, ql.id);
  assert.equal(result.published_by_username, ql.username);
  assert.equal(result.published_at, instant);
  assert.equal(result.feedback_deadline_at, '2026-11-01T12:00:00.000Z');
  assert.ok(result.shift_assignments.every(assignment => assignment.status === 'ACTIVE'));
  assert.equal(result.approvals[0].decision, 'APPROVED');
  await assert.rejects(service.publishSchedule(ql, 'tv4-seed-approved-01', '2026-11-01T12:00:00.000Z'), { code: 'INVALID_STATUS' });
});

test('manager publication history contains published records and excludes unpublished schedules', async () => {
  const service = makeService();
  await service.publishSchedule(ql, 'tv4-seed-approved-01', '2026-11-01T12:00:00.000Z');
  const history = await service.listSchedules(ql, 'publicationHistory');
  const published = history.find(row => row.id === 'tv4-seed-approved-01');
  assert.ok(published);
  assert.equal(published.status, 'PUBLISHED');
  assert.equal(published.published_by_username, ql.username);
  assert.equal(published.published_at, instant);
  assert.ok(history.some(row => row.id === 'tv4-seed-published-01'));
  assert.equal(history.some(row => row.id === 'tv4-seed-draft-01'), false);
});

test('simultaneous decisions on one schedule produce one decision history entry', async () => {
  const service = makeService();
  const attempts = await Promise.allSettled([
    service.decideSchedule(gs, 'tv4-seed-pending-group-v2', 'APPROVED'),
    service.decideSchedule(gs, 'tv4-seed-pending-group-v2', 'NEEDS_REVISION', 'Điều chỉnh lại ca.'),
  ]);
  assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1);
  const changed = await get(service, gs, 'history', 'tv4-seed-pending-group-v2');
  assert.equal(changed.approvals.length, 1);
});

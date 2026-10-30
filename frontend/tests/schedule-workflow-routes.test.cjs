const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = path.join(__dirname, '../src');
const app = fs.readFileSync(path.join(source, 'App.tsx'), 'utf8');
const menu = fs.readFileSync(path.join(source, 'dashboard.config.ts'), 'utf8');

test('TV4 routes stay inside the existing authenticated AppLayout and role guards', () => {
  assert.match(app, /path="\/supervisor\/approvals"[\s\S]*?allowedRoles=\{\['GS'\]\}[\s\S]*?<AppLayout><ScheduleWorkflow mode="approvals" \/><\/AppLayout>/);
  assert.match(app, /path="\/supervisor\/reports"[\s\S]*?allowedRoles=\{\['GS'\]\}[\s\S]*?<AppLayout><ScheduleWorkflow mode="history" \/><\/AppLayout>/);
  assert.match(app, /path="\/manager\/publish"[\s\S]*?allowedRoles=\{\['QL'\]\}[\s\S]*?<AppLayout><ScheduleWorkflow mode="publish" \/><\/AppLayout>/);
  assert.match(app, /path="\/manager\/publish-history"[\s\S]*?allowedRoles=\{\['QL'\]\}[\s\S]*?<AppLayout><ScheduleWorkflow mode="publication-history" \/><\/AppLayout>/);
  assert.doesNotMatch(app, /path="\/employee\/[^\"]*(?:approval|publish)/);
});

test('Supervisor and manager menus link to their TV4 work queues and histories', () => {
  assert.match(menu, /label: 'Phê duyệt lịch', path: '\/supervisor\/approvals'/);
  assert.match(menu, /label: 'Lịch sử phê duyệt', path: '\/supervisor\/reports'/);
  assert.match(menu, /label: 'Công bố lịch', path: '\/manager\/publish'/);
  assert.match(menu, /label: 'Lịch sử công bố', path: '\/manager\/publish-history'/);
});

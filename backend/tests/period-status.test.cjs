const {test}=require('node:test'),assert=require('node:assert/strict');
const {effectivePeriodStatus}=require('../dist/registrations/period-status.js');
const period={open_at:'2026-10-30T15:00:00+07:00',close_at:'2026-11-01T12:00:00+07:00',status:'PLANNED'};
for(const [at,status] of [['2026-10-30T14:59:00+07:00','PLANNED'],['2026-10-30T15:00:00+07:00','OPEN'],['2026-11-01T11:59:00+07:00','OPEN'],['2026-11-01T12:00:00+07:00','CLOSED']])
 test(`Vietnam boundary ${at} => ${status}, ignoring stored status`,()=>{
  for(const stored of ['PLANNED','OPEN','CLOSED'])assert.equal(effectivePeriodStatus({...period,status:stored},Date.parse(at)),status);
 });
test('malformed windows fail closed rather than accepting writes',()=>{assert.throws(()=>effectivePeriodStatus({open_at:'invalid',close_at:period.close_at}));assert.throws(()=>effectivePeriodStatus({open_at:period.close_at,close_at:period.open_at}));});

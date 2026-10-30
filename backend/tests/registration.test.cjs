const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePreferences, validatePreferences } = require('../dist/registrations/validation.js');
const id='10000000-0000-0000-0000-000000000001';
const night='10000000-0000-0000-0000-000000000002';
const morning='10000000-0000-0000-0000-000000000003';
const shifts=[{id,start_time:'08:00:00',end_time:'12:00:00'},{id:night,start_time:'22:00:00',end_time:'09:00:00'},{id:morning,start_time:'12:00:00',end_time:'16:00:00'}];
const pref=(work_date='2026-11-02',shift_id=id)=>({work_date,shift_id});
test('valid preferences; adjacent shifts are allowed',()=>{
 assert.deepEqual(parsePreferences({mode:'submit',preferences:[pref()]}),{mode:'submit',preferences:[pref()]});
 assert.deepEqual(validatePreferences([pref(),pref('2026-11-02',morning)],shifts,'2026-11-02','2026-11-08'),[]);
});
test('missing fields, impossible date, excessive input and ownership injection rejected',()=>{
 for(const body of [{},{mode:['submit'],preferences:[]},{mode:'submit',preferences:[{}]},{mode:'submit',preferences:[pref('2026-02-30')]},{mode:'draft',preferences:[],employee_id:'someone-else'},{mode:'draft',preferences:Array(501).fill(pref())}]) assert.throws(()=>parsePreferences(body));
 assert.deepEqual(parsePreferences({mode:'draft',preferences:[]}).preferences,[]);
});
test('duplicate, out-of-week, unavailable and overnight overlap rejected',()=>{
 for (const p of [[pref(),pref()],[pref('2026-11-01')],[pref('2026-11-02','missing')],[pref('2026-11-02',night),pref('2026-11-03')]]) assert.ok(validatePreferences(p,shifts,'2026-11-02','2026-11-08').length);
});

test('explicit OFF payload is rejected; only shifts and mode are accepted',()=>{assert.throws(()=>parsePreferences({mode:'draft',preferences:[],off_dates:['2026-11-02']}));});

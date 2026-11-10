/* Explicit browser regression; ALL API calls are intercepted, including decisions. */
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(path.join(process.env.LOCALAPPDATA,'JolliShift/browser-tools/node_modules/playwright-core'));
function fixture(){
 const shifts=[['morning','Sáng','08:00:00','12:00:00'],['afternoon','Chiều','12:00:00','17:00:00'],['evening','Tối','17:00:00','22:00:00']].map(([id,name,start_time,end_time])=>({id,name,start_time,end_time}));
 const departments=[['kitchen','Bếp'],['cash','Thu ngân'],['service','Phục vụ']];
 const coverage=[],shift_assignments=[];
 for(let day=9;day<=15;day++)for(const shift of shifts)for(const [department_id,name]of departments){
  const work_date=`2026-11-${String(day).padStart(2,'0')}`,short=shift.id==='evening'&&department_id==='kitchen';
  coverage.push({id:`need-${day}-${shift.id}-${department_id}`,work_date,shift_id:shift.id,department_id,required_count:3,assigned_count:short?2:3,missing_count:short?1:0,existing_count:short?1:0,experienced_count:short?1:2,experienced_target:2,missing_experienced_count:short?1:0,warning:short?'EXPERIENCE_SHORTAGE':null,warnings:short?['STAFFING_SHORTAGE','EXPERIENCE_SHORTAGE']:[]});
  for(let p=0;p<(short?1:3);p++)shift_assignments.push({id:`a-${day}-${shift.id}-${department_id}-${p}`,work_date,shift_id:shift.id,employee_id:`person-${department_id}-${p}`,department_id,status:'DRAFT',assignment_source:'REGULAR',employees:{id:`person-${department_id}-${p}`,full_name:`Nhân viên mock ${name} ${p+1}`,department_id:'home',departments:{name:'Bộ phận nhà'}},shifts:shift,departments:{id:department_id,name}});
 }
 shift_assignments.push({...shift_assignments[0],id:'replaced',status:'REPLACED',employees:{...shift_assignments[0].employees,full_name:'Tên đã thay thế'}},{...shift_assignments[0],id:'missing-id',department_id:null,departments:null,employees:{...shift_assignments[0].employees,full_name:'Tên thiếu ID'}});
 return {row:{id:'11111111-1111-4111-8111-111111111111',schedule_group_id:'group',branch_id:'branch',version:2,status:'PENDING_APPROVAL',workflow_enabled:true,is_latest:true,branches:{id:'branch',name:'Chi nhánh fixture'},registration_periods:{work_start_date:'2026-11-09',work_end_date:'2026-11-15'},shift_assignments,approvals:[]},review:{validation:{schedule_id:'11111111-1111-4111-8111-111111111111',version:2,coverage,hard_constraints:'PASS',source_state:'CURRENT',issues:[],warnings:[]},ready:true,workflow_enabled:true,labels:{shifts:Object.fromEntries(shifts.map(s=>[s.id,s.name])),departments:Object.fromEntries(departments)}}};
}
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1536,height:1100}}),errors=[],writes=[];let role='GS',scenario='normal',pending=true;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());
  if(u.pathname.startsWith('/api/')){
   const {row,review}=fixture();if(scenario==='missing')review.validation.coverage=[];
   if(scenario==='experience')for(const c of review.validation.coverage){delete c.experienced_count;delete c.experienced_target;delete c.missing_experienced_count;}
   if(scenario==='changed'){review.validation.source_state='CHANGED';review.ready=false;}
   if(scenario==='locked'){row.workflow_enabled=false;review.workflow_enabled=false;}
   const fulfill=(body,status=200)=>route.fulfill({status,json:body,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*'}});
   if(req.method()==='OPTIONS')return fulfill({});
   if(u.pathname==='/api/auth/me')return fulfill({status:'ok',user:{id:'fixture-gs',username:'Giám sát mock',role,branch_id:role==='QL'?'branch':null,is_active:true,must_change_password:false}});
   if(u.pathname.includes('notifications'))return fulfill({status:'ok',notifications:[],unread_count:0});
   if(u.pathname.endsWith('/review'))return fulfill(review);
   if(u.pathname.endsWith('/decision')){writes.push(JSON.parse(req.postData()));pending=false;return fulfill({schedule:{...row,status:writes.at(-1).decision}});}
   if(u.pathname==='/api/schedules/workflow'&&page.url().includes('publish-history'))row.status='PUBLISHED';
   if(u.pathname==='/api/schedules/workflow')return fulfill({workflow_enabled:true,schedules:pending?[row]:[]});
   return fulfill({message:'Blocked test endpoint'},501);
  }
  if(u.origin!=='http://localhost:5173')return route.abort();
  return route.continue();
 });
 await page.addInitScript(()=>{localStorage.setItem('jollishift_access_token','TEST_INTERCEPT_ONLY');localStorage.setItem('jollishift_refresh_token','TEST');localStorage.setItem('jollishift_expires_at',String(Date.now()/1000+86400));});
 async function open(){await page.goto('http://localhost:5173/supervisor/approvals');await page.locator('.workflow-card-toggle').click();await page.locator('.approval-matrix-cell').first().waitFor();await page.getByText('Đang tải dữ liệu định biên…',{exact:true}).waitFor({state:'hidden'});}
 await open();assert.equal(await page.locator('.approval-matrix-cell').count(),63);
 const matrix=page.locator('.approval-assignment-matrix');await matrix.getByLabel('Ngày',{exact:true}).selectOption('2026-11-09');await matrix.getByLabel('Bộ phận',{exact:true}).selectOption('kitchen');await matrix.getByLabel('Hiển thị',{exact:true}).selectOption('attention');assert.equal(await page.locator('.approval-matrix-cell').count(),1);
 await page.locator('.approval-matrix-cell').click();await page.getByRole('region',{name:'Chi tiết ô phân công',exact:true}).waitFor();assert.match(await page.locator('.approval-matrix-detail').innerText(),/2\/3/);assert.match(await page.locator('.approval-matrix-detail').innerText(),/\(1 lượt\)/);
 await page.locator('.approval-matrix-person summary').first().click();await page.getByRole('button',{name:'Đóng chi tiết',exact:true}).click();assert.equal(await page.locator('.approval-matrix-detail').count(),0);
 await page.locator('.approval-matrix-ungrouped>summary').click();assert.match(await page.locator('.approval-matrix-ungrouped').innerText(),/Tên thiếu ID/);assert.equal(await matrix.getByText('Tên đã thay thế',{exact:true}).count(),0);
 await page.screenshot({path:path.join(process.env.TEMP,'jollishift-approval-matrix.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+2),false);await page.setViewportSize({width:1536,height:1100});
 const reject=page.locator('.workflow-actions .danger');assert.equal(await reject.isDisabled(),true);
 await page.locator('.workflow-actions .primary').click();await page.locator('.workflow-modal-actions button').last().waitFor();await page.waitForFunction(()=>!document.querySelector('.workflow-modal-actions button:last-child').disabled);await page.locator('.workflow-modal-actions button').last().click();await page.locator('.workflow-card-toggle').waitFor({state:'hidden'});assert.equal(writes[0].decision,'APPROVED');assert.equal(writes[0].expected_version,2);assert.ok(writes[0].request_id);
 pending=true;await open();await page.locator('.workflow-actions textarea').fill('Lý do fixture');await reject.click();await page.locator('.workflow-modal-actions button').last().click();await page.locator('.workflow-card-toggle').waitFor({state:'hidden'});assert.equal(writes[1].decision,'NEEDS_REVISION');assert.equal(writes[1].reason,'Lý do fixture');
 for(const s of ['missing','experience','changed','locked']){
  scenario=s;pending=true;await open();
  if(s==='missing')assert.match(await matrix.innerText(),/Chưa có dữ liệu định biên/);
  if(s==='experience')assert.match(await matrix.innerText(),/Chưa có dữ liệu kinh nghiệm/);
  if(s==='locked')assert.equal(await page.locator('.workflow-actions .primary').isDisabled(),true);
  if(s==='changed'){await page.locator('.workflow-actions .primary').click();await page.locator('.workflow-modal-detail').first().waitFor();assert.equal(await page.locator('.workflow-modal-actions button').last().isDisabled(),true);}
 }
 scenario='normal';pending=true;
 for(const [target,targetRole]of [['/supervisor/reports','GS'],['/manager/publish','QL'],['/manager/publish-history','QL']]){
  role=targetRole;await page.goto('http://localhost:5173'+target);await page.locator('.workflow-card-toggle').click();await page.locator('.workflow-details').waitFor();assert.equal(await matrix.count(),0);assert.ok(await page.locator('.workflow-details>.workflow-table-wrap').count());
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,browserErrors:errors,interceptedMockDecisions:writes.length,realWrites:0,screenshot:path.join(process.env.TEMP,'jollishift-approval-matrix.png')}));await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});


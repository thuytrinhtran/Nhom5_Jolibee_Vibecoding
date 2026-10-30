const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
function load(file,overrides={}){const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,ctx={exports:{},Intl,Date,Map,Set,require(id){if(id in overrides)return overrides[id];if(id.endsWith('.css'))return{};return require(id)}};vm.runInNewContext(code,ctx);return ctx.exports;}
const view=load('src/services/staffing-demand.view.ts'),grid=load('src/services/staffing-demand.grid.ts',{'./staffing-demand.view':view}),status=load('src/services/staffing-status.view.ts'),dates=load('src/services/scheduling.view.ts');
function fixture(){const departments=[{id:'k',name:'Bếp'},{id:'t',name:'Thu ngân'},{id:'p',name:'Phục vụ'}],shifts=[['s1','08:00','12:00'],['s2','12:00','17:00'],['s3','17:00','22:00']].map(([id,start_time,end_time],i)=>({id,name:'Ca '+(i+1),start_time,end_time,is_active:true})),global={code:'NEW_THRESHOLD_NOT_CONFIGURED',message:'Chưa cấu hình ngưỡng NEW.'};
 const rows=[[0,0,3,2,2,'BALANCED',0,0],[0,1,1,0,1,'SHORTAGE',1,0],[0,2,4,3,2,'SURPLUS',0,1],[1,0,1,null,null,'UNKNOWN',null,null],[1,1,2,null,1,'UNKNOWN',null,null],[1,2,0,0,0,'BALANCED',0,0]].map(([s,d,registered_count,eligible_count,required_count,state,shortage_count,surplus_count])=>({work_date:'2026-11-02',shift_id:shifts[s].id,shift_name:shifts[s].name,start_time:shifts[s].start_time,end_time:shifts[s].end_time,department_id:departments[d].id,department_name:departments[d].name,registered_count,eligible_count,required_count,status:state,shortage_count,surplus_count,exclusions:d===1?{SKILL_MISMATCH:1}:{},warnings:[global],required_skill_name:d===1?'Thu ngân':null}));
 return {source:'mock',is_mock:true,period:{id:'week',branch_id:'branch',work_start_date:'2026-11-02',work_end_date:'2026-11-08'},branch:{id:'branch'},shifts,departments,requirements:[],summary:{rows,warnings:[global,global]}};
}
function page(data=fixture()){const states=[];let index=0,tree;const hooks={...React,useState(initial){const i=index++;if(!(i in states))states[i]=initial;return[states[i],v=>states[i]=v]}};const mod=load('src/pages/manager/StaffingStatusMatrix.tsx',{'react':hooks,'../../services/staffing-demand.view':view,'../../services/staffing-demand.grid':grid,'../../services/staffing-status.view':status,'../../services/scheduling.view':dates});
 const find=(node,predicate,result=[])=>{if(!React.isValidElement(node))return result;if(predicate(node))result.push(node);React.Children.forEach(node.props.children,c=>find(c,predicate,result));return result;};return{render(){index=0;tree=mod.StaffingStatusMatrix({data});return tree},find(p){return find(tree,p)},html(){return renderToStaticMarkup(this.render())}};
}
const detailButtons=p=>p.find(n=>n.props.className==='staffing-detail-button');
const daySelect=p=>p.find(n=>n.type==='select')[0];
test('status defaults to first day with collapsible configured shifts and nine department rows',()=>{
 const p=page(),html=p.html();assert.equal(detailButtons(p).length,9);assert.equal(p.find(n=>n.props.className==='staffing-shift').length,3);assert.equal(p.find(n=>n.props.className==='staffing-shift'&&n.props.open).length,1);
 for(const text of ['Tình trạng nhân sự theo ca','08:00–12:00','12:00–17:00','17:00–22:00','2 / 2','0 / 1','3 / 2','0 / 0','Đủ người','Thiếu 1','Dư 1 ứng viên','Không cần người','Chưa nhập nhu cầu','Chưa thể đánh giá','chưa phải số người thực tế đã phân công','MOCK'])assert.ok(html.includes(text),text);
 assert.equal(daySelect(p).props.value,'2026-11-02');assert.equal(p.find(n=>n.type==='option').length,7);assert.equal((html.match(/Chưa cấu hình ngưỡng NEW\./g)||[]).length,1);assert.ok(!html.includes('schedule-row-short'));
});
test('details separate VALID from eligibility and show skills, exclusions, warnings; date change closes details',()=>{
 const data=fixture();data.summary.rows[1].warnings.push({code:'SKILL_MISMATCH',message:'Thiếu kỹ năng theo nguồn.'});
 const p=page(data);p.render();detailButtons(p)[1].props.onClick();let html=p.html();
 for(const text of ['Đăng ký hợp lệ (VALID)','Đủ điều kiện trước xếp lịch','Nhu cầu đã khai báo','Còn thiếu','Không đáp ứng kỹ năng bắt buộc','Kỹ năng bắt buộc: ','Thu ngân','Thiếu kỹ năng theo nguồn.'])assert.ok(html.includes(text),text);
 const dl=p.find(n=>n.type==='dl')[0],detailHtml=renderToStaticMarkup(dl);assert.match(detailHtml,/VALID\)<\/dt><dd>1<\/dd>/);assert.match(detailHtml,/Đủ điều kiện trước xếp lịch<\/dt><dd>0<\/dd>/);
 assert.equal((html.match(/Chưa cấu hình ngưỡng NEW\./g)||[]).length,1);assert.equal(p.find(n=>n.props.className==='staffing-detail').length,1);
 daySelect(p).props.onChange({target:{value:'2026-11-03'}});html=p.html();assert.equal(p.find(n=>n.props.className==='staffing-detail').length,0);assert.equal(detailButtons(p).length,9);assert.ok(html.includes('Chưa nhập nhu cầu'));
});
test('labels use Backend counts; null never becomes zero/balanced and zero is explicitly not required',()=>{
 const row=fixture().summary.rows[1];assert.equal(status.staffingStatus(row).ratio,'0 / 1');assert.equal(status.staffingStatus({...row,eligible_count:null}).label,'Chưa thể đánh giá');
 assert.equal(status.staffingStatus({...row,required_count:null}).label,'Chưa thể đánh giá');assert.equal(status.staffingStatus({...row,shortage_count:4}).label,'Thiếu 4');
 assert.equal(status.staffingStatus({...row,required_count:0,eligible_count:0,status:'BALANCED'}).label,'Không cần người');
 assert.equal(status.staffingStatus({...row,required_count:0,eligible_count:null,status:'UNKNOWN'}).label,'Chưa thể đánh giá');
 assert.equal(status.staffingStatus({...row,shortage_count:null}).label,'Chưa thể đánh giá');assert.equal(status.staffingStatus({...row,status:'SURPLUS',surplus_count:7}).label,'Dư 7 ứng viên');
});
test('empty shifts remain visible on any selected day without mutating source rows',()=>{
 const data=fixture();data.summary.rows=data.summary.rows.filter(r=>r.shift_id==='s1');const before=JSON.stringify(data),p=page(data);let html=p.html();
 assert.equal(detailButtons(p).length,9);assert.ok(html.includes('Ca 2'));assert.ok(html.includes('Ca 3'));assert.equal((html.match(/Chưa có nhân viên đăng ký/g)||[]).length,2);assert.ok(html.includes('Chưa nhập nhu cầu'));assert.ok(html.includes('— / —'));
 daySelect(p).props.onChange({target:{value:'2026-11-08'}});p.html();assert.equal(detailButtons(p).length,9);assert.equal(p.find(n=>n.props.className==='staffing-shift').length,3);assert.equal(JSON.stringify(data),before);
});
test('nonstandard or empty Backend catalog never creates invented three-shift templates',()=>{
 const data=fixture();data.shifts=[{...data.shifts[1],id:'custom',name:'Ca riêng',start_time:'09:30',end_time:'14:15'}];let p=page(data),html=p.html();
 assert.equal(p.find(n=>n.props.className==='staffing-shift').length,1);assert.ok(html.includes('Ca riêng'));assert.ok(html.includes('09:30–14:15'));assert.ok(!html.includes('Ca 1'));assert.ok(!html.includes('Ca 3'));assert.ok(html.includes('1<!-- --> ca hoạt động')||html.includes('1 ca hoạt động'));
 data.shifts=[];p=page(data);html=p.html();assert.equal(p.find(n=>n.props.className==='staffing-shift').length,0);assert.ok(html.includes('không tự tạo thêm ca'));
});
test('Crew Leader exclusion stays in details and surplus is never presented as assigned or transferred staff',()=>{
 const data=fixture();data.summary.rows[2].exclusions={CREW_LEADER_EXCLUDED:1};const p=page(data);p.render();detailButtons(p)[2].props.onClick();const html=p.html();
 assert.ok(html.includes('Crew Leader không tính vào nhu cầu thường'));assert.ok(html.includes('Không tự chuyển ứng viên sang bộ phận khác'));assert.ok(html.includes('Dư 1 ứng viên'));assert.ok(html.includes('3 / 2'));assert.equal(data.summary.rows[2].eligible_count,3);
});
test('row-only NEW configuration warnings are retained once in supplementary information',()=>{
 const data=fixture();data.summary.warnings=[];const p=page(data);let html=p.html();
 assert.equal((html.match(/Chưa cấu hình ngưỡng NEW\./g)||[]).length,1);
 assert.match(html,/<details class="staffing-extra">/);
 detailButtons(p)[0].props.onClick();html=p.html();assert.equal((html.match(/Chưa cấu hình ngưỡng NEW\./g)||[]).length,1);
});

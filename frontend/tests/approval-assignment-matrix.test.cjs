const {test}=require('node:test'),assert=require('node:assert/strict'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const {load,ApprovalAssignmentMatrixContent}=require('./helpers/approval-matrix.cjs');
const {approvalMatrixView}=load('approvalMatrix.view');
const assignment={id:'a',employee_id:'person',department_id:'assigned-dept',work_date:'2026-11-09',status:'DRAFT',assignment_source:'REGULAR',employees:{full_name:'Nhân viên thử nghiệm',department_id:'home-dept',departments:{name:'Bộ phận nhà'}},departments:{name:'Bếp'},shifts:{id:'s',name:'Ca thực',start_time:'08:00:00',end_time:'12:00:00'}};
const schedule={id:'real-id',version:4,status:'PENDING_APPROVAL',registration_periods:{work_start_date:'2026-11-09',work_end_date:'2026-11-15'},shift_assignments:[assignment]};
const coverage={id:'r',department_id:'assigned-dept',shift_id:'s',work_date:'2026-11-09',required_count:5,assigned_count:4,missing_count:1,existing_count:3,experienced_count:1,experienced_target:2,missing_experienced_count:1,warning:'EXPERIENCE_SHORTAGE',warnings:['STAFFING_SHORTAGE','EXPERIENCE_SHORTAGE']};
const review={validation:{schedule_id:'real-id',version:4,coverage:[coverage],issues:[],warnings:[{code:'GENERAL',message:'Do not attach to cell'}]},labels:{shifts:{s:'Ca thực'},departments:{'assigned-dept':'Bếp'}},ready:true,workflow_enabled:true};
test('matrix uses backend values, real IDs, period dates and assignment department, without mutating input',()=>{
 const before=JSON.stringify({schedule,review}),m=approvalMatrixView(schedule,review);
 assert.equal(m.days.length,7);assert.equal(m.cells.length,7,'not fixed to 63');
 const c=m.cells[0];assert.equal(c.departmentId,'assigned-dept');assert.equal(c.assignments.length,1);assert.equal(c.coverage.assigned_count,4);assert.equal(c.coverage.required_count,5);assert.equal(c.experienceShortage,true);assert.equal(c.staffingShortage,true);
 assert.equal(JSON.stringify({schedule,review}),before);
});
test('missing coverage is unknown, does not become 0/0 or sufficient; optional experience remains unknown',()=>{
 const m=approvalMatrixView(schedule,null);assert.equal(m.cells[0].coverage,null);
 const html=renderToStaticMarkup(React.createElement(ApprovalAssignmentMatrixContent,{schedule,review:null}));
 assert.ok(html.includes('Chưa có dữ liệu định biên'));assert.ok(!html.includes('0/0'));assert.ok(!html.includes('class="approval-matrix-cell covered"'));
 const partial={...review,validation:{...review.validation,coverage:[{...coverage,warning:null,warnings:[],experienced_count:undefined,experienced_target:undefined,missing_experienced_count:undefined}]}};
 assert.equal(approvalMatrixView(schedule,partial).cells[0].experienceShortage,false);
 assert.ok(renderToStaticMarkup(React.createElement(ApprovalAssignmentMatrixContent,{schedule,review:partial})).includes('Chưa có dữ liệu kinh nghiệm'));
});
test('REPLACED assignments do not contribute names; missing IDs remain inspectable outside cells',()=>{
 const s={...schedule,shift_assignments:[assignment,{...assignment,id:'replaced',status:'REPLACED'},{...assignment,id:'unknown',department_id:undefined}]};
 const m=approvalMatrixView(s,review);assert.equal(m.active.length,2);assert.equal(m.replacedCount,1);assert.equal(m.ungrouped.length,1);assert.equal(m.cells[0].assignments.length,1);
 assert.equal(m.cells[0].coverage.assigned_count,4,'never overwrite backend coverage');
 const html=renderToStaticMarkup(React.createElement(ApprovalAssignmentMatrixContent,{schedule:s,review}));assert.ok(html.includes('chưa thể đặt vào ô'));assert.ok(html.includes('phân công đã thay thế'));
});
test('duplicate coverage is not silently summed and historical IDs are preserved',()=>{
 const duplicate={...review,validation:{...review.validation,coverage:[coverage,{...coverage,id:'other'}]}};
 assert.equal(approvalMatrixView(schedule,duplicate).cells[0].coverage,null);
 const old={...schedule,shift_assignments:[{...assignment,department_id:'old',shifts:{...assignment.shifts,id:'retired'}}]};
 const m=approvalMatrixView(old,null);assert.equal(m.cells[0].departmentId,'old');assert.equal(m.cells[0].shift.id,'retired');assert.equal(m.cells[0].assignments.length,1);
});
test('experience warning remains visible when its numeric count is missing',()=>{
 const data={...review,validation:{...review.validation,coverage:[{...coverage,missing_experienced_count:undefined}]}};
 const m=approvalMatrixView(schedule,data);assert.equal(m.cells[0].experienceShortage,true);
 const html=renderToStaticMarkup(React.createElement(ApprovalAssignmentMatrixContent,{schedule,review:data}));
 assert.ok(html.includes('Cảnh báo thiếu kinh nghiệm'));assert.ok(!html.includes('Thiếu undefined'));
});
function harness(props){
 let i=0;const states=[];
 const hooks={...React,useState(init){const index=i++;if(!(index in states))states[index]=init;return[states[index],v=>states[index]=v]},useMemo:fn=>fn(),useRef:()=>({current:null}),useEffect:()=>{}};
 const Component=load('ApprovalAssignmentMatrix',{react:hooks}).ApprovalAssignmentMatrixContent;
 let tree;const walk=n=>!React.isValidElement(n)?[]:[n,...React.Children.toArray(n.props.children).flatMap(walk)];
 const render=()=>{i=0;tree=Component(props);return tree};
 return{render,html:()=>renderToStaticMarkup(render()),nodes:()=>walk(tree)};
}
test('filters, cell selection, employee disclosure, warnings and close are read-only',()=>{
 const h=harness({schedule,review});h.render();
 const select=h.nodes().filter(n=>n.type==='select');select[0].props.onChange({target:{value:'2026-11-09'}});select[1].props.onChange({target:{value:'assigned-dept'}});select[2].props.onChange({target:{value:'attention'}});h.render();
 assert.equal(h.nodes().filter(n=>n.type==='button'&&'aria-pressed'in n.props).length,1);
 h.nodes().find(n=>n.type==='button'&&'aria-pressed'in n.props).props.onClick();
 const html=h.html();for(const t of ['Nhân viên thử nghiệm','4/5','Phân công có sẵn hợp lệ','Thiếu 1 người','Thiếu 1 nhân viên kinh nghiệm'])assert.ok(html.includes(t),t);
 assert.ok(html.includes('<summary>Nhân viên thử nghiệm</summary>'));assert.ok(!html.includes('Do not attach to cell'));assert.ok(!html.includes('skill_level'));assert.ok(!html.includes('<textarea'));
 h.nodes().find(n=>n.type==='button'&&n.props.children==='Đóng chi tiết').props.onClick();assert.ok(!h.html().includes('aria-label="Chi tiết ô phân công"'));
});

function reviewHarness(initial){
 let props=initial,index=0;const states=[],effects=[],pending=[];
 const hooks={...React,useState(init){const i=index++;if(!(i in states))states[i]=init;return [states[i],v=>states[i]=v]},useEffect(fn,deps){const i=index++,old=effects[i];if(!old||deps.some((d,j)=>!Object.is(d,old.deps[j]))){old?.cleanup?.();effects[i]={deps};pending.push(()=>effects[i].cleanup=fn());}}};
 const {ApprovalAssignmentMatrix}=load('ApprovalAssignmentMatrix',{react:hooks});
 function render(){index=0;const tree=ApprovalAssignmentMatrix(props);while(pending.length)pending.shift()();return tree;}
 return {render,setProps(p){props=p},async settle(){await new Promise(r=>setImmediate(r));return render();}};
}
test('review failures and mismatched versions never display stale coverage',async()=>{
 for(const service of [{reviewSchedule:async()=>{throw Error('fixture failure')}},{reviewSchedule:async()=>({...review,validation:{...review.validation,version:99}})}]){
  const h=reviewHarness({schedule,service});h.render();const result=await h.settle();assert.equal(result.props.review,null);assert.ok(result.props.error);assert.equal(result.props.loading,false);
 }
 let resolve;const service={reviewSchedule:()=>new Promise(r=>resolve=r)},h=reviewHarness({schedule,service});h.render();
 const oldResolve=resolve;const next={...schedule,id:'next',version:5};h.setProps({schedule:next,service});h.render();oldResolve(review);const result=await h.settle();assert.equal(result.props.review,null);assert.equal(result.props.loading,true);
});

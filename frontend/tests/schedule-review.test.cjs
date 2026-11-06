const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');
function load(file,overrides={},globals={}){const source=fs.readFileSync(file,'utf8').replace('import.meta.env',"{VITE_API_URL:'/api'}");const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;const context={exports:{},Error,Intl,Date,AbortSignal,...globals,require(id){if(id in overrides)return overrides[id];if(id.endsWith('.css'))return{};return require(id)}};vm.runInNewContext(code,context);return context.exports;}
const validation={schedule_id:'saved',version:2,scope:'DECLARED_REQUIREMENTS_AND_VALID_REGISTRATIONS',hard_constraints:'FAIL',data_complete:true,coverage_complete:false,input_current:true,can_submit:false,issues:[{code:'SKILL_MISMATCH',message:'Nhân viên thiếu kỹ năng bắt buộc.'}],warnings:[],coverage:[],checked_at:'2026-10-29T00:00:00Z',input_revision:'revision'};
const handoff={validation,payload:null,current_status:'DRAFT',target_status:'PENDING_APPROVAL',delivery:{configured:false,sent:false,message:'Chưa kết nối API tiếp nhận TV4. Lịch chưa được gửi.'}};
const saved={schedule:{id:'saved',version:2,status:'DRAFT'},assignments:[],generation_snapshot:null};
function component(react=React,service={},globals={}){return load('src/pages/manager/ScheduleReviewPanel.tsx',{react,'../../services/scheduling.service':{schedulingService:service}},globals);}

test('saved DRAFT explains how to enable sending before handoff has been checked',()=>{
 const states=[null,null,'',false,''];let n=0;
 const hooks={...React,useState:()=>[states[n++],()=>{}],useRef:()=>({current:false}),useEffect:()=>{}};
 const {ScheduleReviewPanel}=component(hooks);const html=renderToStaticMarkup(React.createElement(ScheduleReviewPanel,{saved}));
 assert.ok(html.includes('Gửi lịch phê duyệt'));
 assert.ok(html.includes('Kiểm tra lịch đã lưu trước khi gửi'));
 assert.ok(!html.includes('Chưa kết nối API tiếp nhận TV4'));
 assert.match(html,/<button[^>]*disabled=""[^>]*>Gửi Giám sát khu vực phê duyệt<\/button>/);
});
test('panel offers TV3 validation/preparation, disables sending and never claims approval',()=>{
 const states=[validation,handoff,'',false,''];let index=0;
 const hooks={...React,useState:()=>[states[index++],()=>{}],useRef:()=>({current:false}),useEffect:()=>{}};
 const {ScheduleReviewPanel}=component(hooks);const html=renderToStaticMarkup(React.createElement(ScheduleReviewPanel,{saved}));
 for(const text of ['Kiểm tra lịch','Chuẩn bị dữ liệu gửi phê duyệt','Gửi Giám sát khu vực phê duyệt','Bản nháp','Nhân viên thiếu kỹ năng bắt buộc','Chưa thể bàn giao','Chưa thể gửi lịch trong tuần này'])assert.ok(html.includes(text),text);
 assert.match(html,/<button[^>]*disabled=""[^>]*>Gửi Giám sát khu vực phê duyệt<\/button>/);assert.ok(!html.includes('đã được gửi thành công'));
});
test('ready handoff preview is labelled unsent and respects target/current status',()=>{
 const ready={...validation,hard_constraints:'PASS',coverage_complete:true,can_submit:true,issues:[]};
 const states=[ready,{...handoff,validation:ready,payload:{schedule_id:'saved',current_status:'DRAFT',requested_status:'PENDING_APPROVAL',is_mock:true}},'',false,''];let index=0;
 const hooks={...React,useState:()=>[states[index++],()=>{}],useRef:()=>({current:false}),useEffect:()=>{}};
 const {ScheduleReviewPanel}=component(hooks);const html=renderToStaticMarkup(React.createElement(ScheduleReviewPanel,{saved}));
 assert.ok(!html.includes('<pre'));assert.ok(html.includes('Dữ liệu đáp ứng kiểm tra'));assert.ok(html.includes('Bản nháp'));assert.ok(html.includes('Chưa thể gửi lịch trong tuần này'));
});
test('validation client uses POST endpoints and expected version, without a submit or approval request',async()=>{
 class ApiError extends Error{};const calls=[];
 const service=load('src/services/scheduling.service.ts',{'./auth.service':{ApiError,authService:{getMe:async()=>{},getStoredToken:()=> 'fixture'}}},{fetch:async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({status:'ok',result:url.endsWith('/validate')?validation:handoff}))}}).schedulingService;
 await service.validate('saved',2);await service.prepareHandoff('saved',2,'Manager checked');
 assert.deepEqual(calls.map(call=>call.url),['/api/schedules/saved/validate','/api/schedules/saved/approval-handoff']);
 assert.deepEqual(JSON.parse(calls[1].options.body),{expected_version:2,note:'Manager checked'});assert.ok(calls.every(call=>call.options.method==='POST'));
});
test('preparation errors are displayed and no payload is fabricated',async()=>{
 const states=[],refs=[];let i=0,r=0;
 const hooks={...React,useState(initial){const index=i++;if(!(index in states))states[index]=initial;return[states[index],value=>{states[index]=value}]},useRef(initial){return refs[r++] ||= {current:initial}},useEffect:()=>{}};
 const {ScheduleReviewPanel}=component(hooks,{prepareHandoff:async()=>{throw Error('Phiên bản lịch đã đổi')}});
 const render=()=>{i=r=0;return ScheduleReviewPanel({saved})};
 const find=node=>{if(!React.isValidElement(node))return null;if(node.type==='button'&&React.Children.toArray(node.props.children).includes('Chuẩn bị dữ liệu gửi phê duyệt'))return node;for(const child of React.Children.toArray(node.props.children)){const found=find(child);if(found)return found;}return null;};
 find(render()).props.onClick();await new Promise(resolve=>setImmediate(resolve));const html=renderToStaticMarkup(render());assert.ok(html.includes('Phiên bản lịch đã đổi'));assert.ok(!html.includes('Xem dữ liệu bàn giao TV4 (chưa gửi)'));
});

test('shortage DRAFT can send after validation and confirmation, preserving request ID on retry',async()=>{
 const ready={...validation,hard_constraints:'PASS',coverage_complete:false,can_submit:true,issues:[],warnings:[{code:'STAFFING_SHORTAGE',message:'Lịch còn thiếu 1 lượt phân công.'}]};
 const states=[ready,{...handoff,validation:ready,delivery:{configured:true,sent:false,message:'Ready'}},'checked',false,''],refs=[];let i=0,r=0,confirm=false,calls=[],notified=0;
 const hooks={...React,useState(initial){const n=i++;if(!(n in states))states[n]=initial;return[states[n],v=>states[n]=v]},useRef(initial){return refs[r++]||=( {current:initial})},useEffect:()=>{}};
 const {ScheduleReviewPanel}=component(hooks,{submitApproval:async(...args)=>{calls.push(args);if(calls.length===1)throw Error('Retry');return{schedule:{status:'PENDING_APPROVAL'}}}},{window:{confirm:()=>confirm},crypto:require('node:crypto').webcrypto});
 const render=()=>{i=r=0;return ScheduleReviewPanel({saved,onSubmitted:()=>notified++})};
 const find=node=>{if(!React.isValidElement(node))return null;if(node.type==='button'&&React.Children.toArray(node.props.children).includes('Gửi Giám sát khu vực phê duyệt'))return node;for(const child of React.Children.toArray(node.props.children)){const found=find(child);if(found)return found;}return null;};
 find(render()).props.onClick();await new Promise(setImmediate);assert.equal(calls.length,0);
 confirm=true;find(render()).props.onClick();await new Promise(setImmediate);assert.equal(states[4],'Retry');assert.equal(notified,0);
 find(render()).props.onClick();await new Promise(setImmediate);assert.equal(calls[0][3],calls[1][3]);assert.equal(calls[0][1],2);assert.equal(notified,1);assert.equal(find(render()).props.disabled,true);
});

test('preview send choice prepares the saved DRAFT on mount but never submits it',async()=>{
 const effects=[],states=[],refs=[];let index=0,refIndex=0,prepared=0,submitted=0;
 const hooks={...React,useState(initial){const i=index++;if(!(i in states))states[i]=initial;return[states[i],v=>states[i]=v];},useRef(initial){return refs[refIndex++]||={current:initial};},useEffect(fn){effects.push(fn);}};
 const {ScheduleReviewPanel}=component(hooks,{prepareHandoff:async(id,version)=>{prepared++;assert.equal(id,saved.schedule.id);assert.equal(version,saved.schedule.version);return handoff;},submitApproval:()=>{submitted++;}},{window:{confirm:()=>assert.fail('No automatic confirmation')}});
 ScheduleReviewPanel({saved,prepareOnMount:true});for(const effect of effects)effect();await new Promise(r=>setImmediate(r));
 assert.equal(prepared,1);assert.equal(submitted,0);assert.equal(states[1],handoff);
});

for(const [label,complete,warnings] of [
 ['thiếu',false,[{code:'STAFFING_SHORTAGE',message:'Lịch còn thiếu 1 lượt phân công.'}]],
 ['đủ',true,[]],
 ['dư ứng viên',true,[{code:'CANDIDATE_SURPLUS',message:'Dư 2 ứng viên đủ điều kiện; không phải phân công vượt nhu cầu.'}]],
])test('validated '+label+' staffing keeps the send button available and displays advisory warnings',()=>{
 const ready={...validation,hard_constraints:'PASS',coverage_complete:complete,can_submit:true,issues:[],warnings};
 const states=[ready,{...handoff,validation:ready,payload:{schedule_id:'saved'},delivery:{configured:true,sent:false,message:'Chưa gửi'}},'',false,''];let n=0;
 const hooks={...React,useState:()=>[states[n++],()=>{}],useRef:()=>({current:false}),useEffect:()=>{}};
 const {ScheduleReviewPanel}=component(hooks);const html=renderToStaticMarkup(React.createElement(ScheduleReviewPanel,{saved}));
 const button=html.match(/<button[^>]*>Gửi Giám sát khu vực phê duyệt<\/button>/)[0];assert.ok(!button.includes('disabled'));
 assert.ok(html.includes('không chặn gửi duyệt'));for(const warning of warnings)assert.ok(html.includes(warning.message));
});

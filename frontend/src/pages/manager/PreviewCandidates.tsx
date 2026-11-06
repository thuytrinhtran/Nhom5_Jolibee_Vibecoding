import { useEffect, useState } from 'react';
import { schedulingService } from '../../services/scheduling.service';
import type { SchedulePreview, PreviewCandidate, CheckedPreviewCandidates } from '../../types/scheduling';
type Candidate=Awaited<ReturnType<typeof schedulingService.candidates>>[number];
export function PreviewCandidates({preview,requirementId,replaceIndex,disabled,onConfirm,initialCandidates,onChecked}:{preview:SchedulePreview;requirementId:string;replaceIndex?:number;disabled:boolean;onConfirm:(id:string)=>void|Promise<void>;initialCandidates?:PreviewCandidate[];onChecked?:(result:CheckedPreviewCandidates)=>void}){
 const [rows,setRows]=useState<Candidate[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState(''),[confirmed,setConfirmed]=useState(false);
 const [confirming,setConfirming]=useState(false);
 const [checked,setChecked]=useState(false);
 const cell=preview.result?.coverage?.find(c=>c.id===requirementId);
 const full=replaceIndex===undefined&&!!cell&&cell.assigned_count>=cell.required_count;
 useEffect(()=>{
  setRows([]);setSelected('');setConfirmed(false);setError('');setChecked(false);
  setLoading(false);
  if(disabled||full||!requirementId)return;
  if(initialCandidates){setRows(initialCandidates);setChecked(true);return;}
  let active=true;setLoading(true);
  void schedulingService.candidates(preview,requirementId,replaceIndex).then(value=>{if(active){setRows(value);setChecked(true);onChecked?.({preview,requirementId,replaceIndex,count:value.length,experiencedCount:value.filter(e=>['REGULAR','CREW_TRAINING'].includes(e.skill_level)).length});}}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Không tải được ứng viên.');}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[preview,requirementId,replaceIndex,disabled,initialCandidates,full]);
 const confirm=async()=>{
  if(disabled||confirming||loading||!confirmed||!rows.some(r=>r.id===selected))return;
  setConfirming(true);setError('');
  try{await onConfirm(selected);setSelected('');setConfirmed(false);}
  catch(e){setError(e instanceof Error?e.message:'Chưa thể bổ sung. Hãy kiểm tra lại phương án.');}
  finally{setConfirming(false);}
 };
 const level=(value:string)=>({NEW:'Nhân viên mới',REGULAR:'Có kinh nghiệm',CREW_TRAINING:'Hướng dẫn viên',CREW_LEADER:'Trưởng ca'}[value]??'Chưa có cấp độ');
 return <section className="preview-candidates" tabIndex={-1} aria-label="Ứng viên đủ điều kiện">
  <h4>{replaceIndex===undefined?'Bổ sung vị trí trống':'Thay nhân viên'}</h4>
  {loading&&!disabled&&<p role="status">Đang kiểm tra nhân viên phù hợp…</p>}
  {error&&<p role="alert">{error}</p>}
  {disabled?<p>Kiểm tra lại phương án trước khi tìm ứng viên.</p>:full?<p>Vị trí đã đủ số lượng. Chọn “Tìm người thay” nếu cần thay nhân viên hoặc bổ sung kinh nghiệm.</p>:<>
  {checked&&!loading&&!error&&!rows.length&&<p>Không có ứng viên nội bộ đáp ứng đồng thời đăng ký ca, bộ phận, kỹ năng và giới hạn giờ làm. Chưa hỗ trợ chi viện từ chi nhánh khác.</p>}
  {!!rows.length&&<p>{rows.length} nhân viên đủ điều kiện cho thao tác này. Cấp độ hiển thị theo hồ sơ; danh sách đã được kiểm tra với lịch hiện tại.</p>}
  {rows.map(e=><label className="candidate-contact" key={e.id}><input type="radio" disabled={confirming} name={`candidate-${requirementId}`} checked={selected===e.id} onChange={()=>{setSelected(e.id);setConfirmed(false);}}/><span><strong>{e.full_name}</strong> · {level(e.skill_level)}<br/>{e.phone?<a href={`tel:${e.phone}`}>{e.phone}</a>:'Chưa có SĐT'}<br/><small>{e.employee_status==='ACTIVE'?'Đang làm việc · ':''}{e.availability}</small></span></label>)}
  {!!selected&&<label className="candidate-contact"><input type="checkbox" disabled={confirming} checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Đã liên hệ và nhân viên xác nhận nhận ca</label>}
  {!!selected&&<p role="status">Đang chọn: <strong>{rows.find(r=>r.id===selected)?.full_name}</strong> · Chưa cập nhật phân công.</p>}
  <button type="button" className="btn btn-outline" disabled={!selected||!confirmed||loading||confirming} onClick={()=>void confirm()}>{confirming?'Đang kiểm tra lại…':`Xác nhận ${replaceIndex===undefined?'thêm':'thay'} phân công`}</button>
  </>}
 </section>;
}

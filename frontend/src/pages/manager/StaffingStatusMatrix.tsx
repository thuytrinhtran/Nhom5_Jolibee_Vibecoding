import { useState } from 'react';
import type { DemandContext } from '../../types/scheduling';
import { demandDays, demandRows, demandRowKey } from '../../services/staffing-demand.view';
import { gridDepartments, gridShifts } from '../../services/staffing-demand.grid';
import { dateLabel } from '../../services/scheduling.view';
import { exclusionLabel, staffingStatus } from '../../services/staffing-status.view';
import './StaffingStatusMatrix.css';

export function StaffingStatusMatrix({data}:{data:DemandContext}) {
  const days=demandDays(data),shifts=gridShifts(data),departments=gridDepartments(data),rows=demandRows(data);
  const [day,setDay]=useState(days[0]??''),[selected,setSelected]=useState('');
  const detail=rows.find(row=>demandRowKey(row)===selected);
  const general=[...new Map(data.summary.warnings.map(w=>[w.code,w])).values()];
  return <section className="card staffing-status" aria-labelledby="staffing-status-heading">
    <div className="schedule-heading"><h3 id="staffing-status-heading">Tình trạng nhân sự từng ca</h3>
      <label htmlFor="staffing-status-day">Ngày xem<select id="staffing-status-day" value={day} onChange={e=>{setDay(e.target.value);setSelected('');}}>{days.map(d=><option key={d} value={d}>{dateLabel(d)}</option>)}<option value="">Cả tuần</option></select></label>
    </div>
    <p className="schedule-muted">Số người đủ điều kiện trước xếp lịch / Số người cần. Đây là dữ liệu đã lưu, chưa phải số người thực tế đã phân công. Nhấn một ô để xem nguyên nhân.</p>
    <div className="staffing-status-scroll"><table className="staffing-status-table"><caption className="demand-sr-only">Tình trạng nhân sự theo ngày, ca và bộ phận</caption>
      <thead><tr><th scope="col">Ngày / ca</th>{departments.map(d=><th key={d.id} scope="col">{d.name}</th>)}</tr></thead>
      {days.filter(d=>!day||d===day).map(date=><tbody key={date}><tr className="staffing-status-date"><th colSpan={departments.length+1} scope="rowgroup">{dateLabel(date)}</th></tr>
        {shifts.map((shift,index)=><tr key={shift.id}><th scope="row">Ca {index+1}<small>{shift.start_time.slice(0,5)}–{shift.end_time.slice(0,5)}</small>{!rows.some(r=>r.work_date===date&&r.shift_id===shift.id&&r.registered_count>0)&&<small>Chưa có nhân viên đăng ký</small>}</th>{departments.map(department=>{
          const row=rows.find(r=>r.work_date===date&&r.shift_id===shift.id&&r.department_id===department.id);
          if(!row)return <td key={department.id}>Chưa thể đánh giá</td>;
          const key=demandRowKey(row),status=staffingStatus(row);
          return <td key={department.id}><button type="button" className={`staffing-cell staffing-${status.tone}`} aria-label={`${dateLabel(date)}, ${shift.name}, ${department.name}: ${status.ratio}, ${status.label}`} aria-expanded={selected===key} aria-controls="staffing-status-detail" onClick={()=>setSelected(selected===key?'':key)}><strong>{status.ratio}</strong><span>{status.label}</span></button></td>;
        })}</tr>)}
      </tbody>)}
    </table></div>
    {detail&&<section className="staffing-detail" id="staffing-status-detail" aria-labelledby="staffing-detail-heading" role="region">
      <div className="schedule-heading"><h4 id="staffing-detail-heading">{dateLabel(detail.work_date)} · {detail.shift_name} · {detail.department_name}</h4><button className="btn btn-outline" type="button" onClick={()=>setSelected('')}>Đóng chi tiết</button></div>
      <dl>{[['Đăng ký hợp lệ (VALID)',detail.registered_count],['Đủ điều kiện trước xếp lịch',detail.eligible_count??'Chưa xác định'],['Số người cần',detail.required_count??'Chưa nhập'],['Còn thiếu',detail.shortage_count??'Chưa thể đánh giá'],['Dư',detail.surplus_count??'Chưa thể đánh giá']].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {detail.required_skill_name&&<p>Kỹ năng bắt buộc: {detail.required_skill_name}</p>}
      {detail.status==='SHORTAGE'&&<p>{detail.registered_count===0?'Chưa có nhân viên đăng ký hợp lệ cho tổ hợp này.':'Số người đủ điều kiện đang thấp hơn nhu cầu đã nhập; xem các điều kiện loại trừ bên dưới.'}</p>}
      {detail.status==='SURPLUS'&&<p>Số ứng viên đủ điều kiện cao hơn nhu cầu. Đây là khả năng nhận ca, chưa phải số người được phân công dư.</p>}
      <ul>{Object.entries(detail.exclusions).filter(([,n])=>n>0).map(([code,n])=><li key={code}>{exclusionLabel[code]||'Không đáp ứng điều kiện nhận ca'}: {n} người.</li>)}
        {detail.warnings.filter(w=>w.code!=='NEW_THRESHOLD_NOT_CONFIGURED'&&!general.some(g=>g.code===w.code)).map(w=><li key={w.code}>{w.message}</li>)}</ul>
      <p className="schedule-muted">Ứng viên được đánh giá độc lập từng ca. Một người có thể đủ điều kiện ở nhiều ca; Rule Engine tiếp tục kiểm tra ràng buộc trên toàn lịch khi phân công.</p>
    </section>}
    <details className="staffing-extra"><summary>Thông tin bổ sung{general.length?` · ${general.length} lưu ý`:''}</summary>{general.map(w=><p key={w.code}>{w.message}</p>)}<p>Thời gian và bộ phận lấy từ danh mục Backend. Không thay đổi cách đếm đăng ký, tính đủ điều kiện hay thiếu/thừa.</p></details>
  </section>;
}

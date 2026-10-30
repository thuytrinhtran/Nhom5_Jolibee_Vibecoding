import { Fragment, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { DemandContext } from '../../types/scheduling';
import { demandDays, demandRows, demandRowKey } from '../../services/staffing-demand.view';
import { gridDepartments, gridShifts } from '../../services/staffing-demand.grid';
import { dateLabel } from '../../services/scheduling.view';
import { exclusionLabel, staffingStatus } from '../../services/staffing-status.view';
import './StaffingStatusMatrix.css';

type StaffingStatusData = Pick<DemandContext,'period'|'branch'|'summary'|'shifts'|'departments'> & Partial<Pick<DemandContext,'source'|'is_mock'>>;

export function StaffingStatusMatrix({data,catalogComplete=true}:{data:StaffingStatusData;catalogComplete?:boolean}) {
  const days = demandDays(data);
  const shifts = gridShifts(data), departments = gridDepartments(data), rows = demandRows(data);
  const [day,setDay] = useState(days[0] ?? ''), [selected,setSelected] = useState('');
  const currentDay = days.includes(day) ? day : days[0] ?? '';
  const scope = `staffing-status-${data.period.id}`;
  const general = [...new Map([
    ...data.summary.warnings,
    ...data.summary.rows.flatMap(row => row.warnings.filter(w => w.code === 'NEW_THRESHOLD_NOT_CONFIGURED')),
  ].map(w => [w.code,w])).values()];
  const isMock = data.is_mock || data.source === 'mock' || data.summary.is_mock || data.summary.source === 'mock';
  return <section className="card staffing-status" aria-labelledby={`${scope}-heading`}>
    <header className="schedule-heading"><h3 id={`${scope}-heading`}>Tình trạng nhân sự theo ca</h3>
      <span className="badge badge-slate">{isMock ? 'Dữ liệu thử nghiệm — Dữ liệu mô phỏng (MOCK)' : 'Dữ liệu Supabase'}</span>
    </header>
    <div className="staffing-status-controls">
      <label htmlFor={`${scope}-day`}>Ngày xem<select id={`${scope}-day`} value={currentDay} onChange={e => {setDay(e.target.value);setSelected('');}}>{days.map(d => <option key={d} value={d}>{dateLabel(d)}</option>)}</select></label>
      <p className="schedule-muted">Số người đủ điều kiện trước xếp lịch / Số người cần. Số đăng ký VALID được đếm riêng; đây chưa phải số người thực tế đã phân công.</p>
    </div>
    {data.branch.name && <p className="schedule-muted">Chi nhánh: {data.branch.name}</p>}
    {isMock && <p className="staffing-source-note">Đang dùng dữ liệu mô phỏng. Không lưu hoặc tạo lịch thật từ phần tổng hợp này.</p>}
    {!catalogComplete && <p className="staffing-source-note" role="status">Chưa có danh mục ca đầy đủ của tuần. Đang hiển thị các ca có trong dữ liệu tổng hợp Backend; không tự bổ sung ca.</p>}
    {catalogComplete && shifts.length !== 3 && <p className="staffing-source-note" role="status">Danh mục Backend hiện có {shifts.length} ca hoạt động. Giao diện dùng đúng cấu hình, không tự tạo thêm ca.</p>}
    {!departments.length && <p className="staffing-source-note" role="status">Chưa có danh mục bộ phận để hiển thị tình trạng nhân sự.</p>}
    <div className="staffing-shifts">
      {shifts.map((shift,index) => <details className="staffing-shift" key={`${currentDay}/${shift.id}`} open={index === 0}>
        <summary><ChevronRight className="staffing-shift-chevron" size={16} aria-hidden="true" /><strong>{shift.name}</strong>
          <span className="staffing-shift-time">{shift.start_time && shift.end_time ? <>{shift.start_time.slice(0,5)}–{shift.end_time.slice(0,5)}{shift.end_time < shift.start_time ? ' (hôm sau)' : ''}</> : 'Chưa có giờ ca'}</span>
          {!rows.some(r => r.work_date === currentDay && r.shift_id === shift.id && r.registered_count > 0) && <small>Chưa có nhân viên đăng ký</small>}
        </summary>
        <div className="staffing-shift-body"><table className="staffing-departments">
          <caption className="staffing-sr-only">{dateLabel(currentDay)} · {shift.name} · Khả năng đáp ứng trước xếp lịch</caption>
          <thead><tr><th scope="col">Bộ phận</th><th scope="col">Đủ điều kiện / Cần</th><th scope="col">Tình trạng</th><th scope="col">Thông tin</th></tr></thead>
          <tbody>{departments.map(department => {
            const row = rows.find(r => r.work_date === currentDay && r.shift_id === shift.id && r.department_id === department.id);
            if (!row) return <tr key={department.id}><th scope="row">{department.name}</th><td colSpan={3}>Chưa thể đánh giá</td></tr>;
            const key = demandRowKey(row), status = staffingStatus(row), detailId = `${scope}-${encodeURIComponent(key)}`;
            const technical = [...new Map(row.warnings.filter(w => w.code !== 'NEW_THRESHOLD_NOT_CONFIGURED').map(w => [w.code,w])).values()];
            const exclusions = Object.entries(row.exclusions).filter(([,n]) => n > 0);
            return <Fragment key={department.id}>
              <tr className="staffing-department-row">
                <th scope="row">{department.name}</th>
                <td data-label="Đủ điều kiện / Cần"><strong className="staffing-ratio">{status.ratio}</strong>
                  {row.required_count === null && <small>Chưa nhập nhu cầu</small>}
                  {row.required_count === 0 && <small>Không cần người</small>}
                </td>
                <td data-label="Tình trạng"><span className={`staffing-badge staffing-${status.tone}`}>{status.label}</span></td>
                <td data-label="Thông tin"><button type="button" className="staffing-detail-button" aria-label={`Xem chi tiết ${department.name}, ${shift.name}, ${dateLabel(currentDay)}`} aria-expanded={selected === key} aria-controls={detailId} onClick={() => setSelected(selected === key ? '' : key)}>{selected === key ? 'Đóng chi tiết' : 'Xem chi tiết'}</button></td>
              </tr>
              {selected === key && <tr className="staffing-detail-row"><td colSpan={4}>
                <section className="staffing-detail" id={detailId} aria-label={`${department.name} · ${shift.name} · Chi tiết điều kiện nhận ca`}>
                  <h4>{department.name} · Chi tiết điều kiện nhận ca</h4>
                  <dl>{[['Đăng ký hợp lệ (VALID)',row.registered_count],['Đủ điều kiện trước xếp lịch',row.eligible_count ?? 'Chưa xác định'],['Nhu cầu đã khai báo',row.required_count ?? 'Chưa nhập nhu cầu'],['Còn thiếu',row.shortage_count ?? 'Chưa thể đánh giá'],['Dư ứng viên',row.surplus_count ?? 'Chưa thể đánh giá']].map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
                  <p>Kỹ năng bắt buộc: {row.required_count === null ? 'Chưa có nhu cầu để xác định' : row.required_skill_name || 'Không yêu cầu cụ thể'}</p>
                  {row.status === 'SHORTAGE' && <p>{row.registered_count === 0 ? 'Chưa có nhân viên đăng ký hợp lệ cho tổ hợp này.' : 'Số người đủ điều kiện thấp hơn nhu cầu đã nhập.'}</p>}
                  {row.status === 'SURPLUS' && <p>Đây là ứng viên có thể nhận ca, chưa phải phân công dư. Không tự chuyển ứng viên sang bộ phận khác.</p>}
                  <div><h5>Lý do không đủ điều kiện</h5>{exclusions.length ? <ul>{exclusions.map(([code,n]) => <li key={code}>{exclusionLabel[code] || 'Không đáp ứng điều kiện nhận ca'}: {n} người.</li>)}</ul> : <p>Nguồn dữ liệu không ghi nhận lý do loại trừ cho tổ hợp này.</p>}</div>
                  {!!technical.length && <div><h5>Cảnh báo từ dữ liệu nguồn</h5><ul>{technical.map(w => <li key={w.code}>{w.message} <span className="staffing-warning-code">({w.code})</span></li>)}</ul></div>}
                  <p className="schedule-muted">Ứng viên được đánh giá độc lập từng ca. Rule Engine kiểm tra lại trên toàn lịch khi phân công. Crew Leader không tính vào nhu cầu nhân viên thường.</p>
                </section>
              </td></tr>}
            </Fragment>;
          })}</tbody>
        </table></div>
      </details>)}
    </div>
    <details className="staffing-extra"><summary>Thông tin bổ sung{general.length ? ` · ${general.length} lưu ý` : ''}</summary>
      {general.map(w => <p key={w.code}>{w.message}</p>)}
      {data.summary.notes?.map(note => <p key={note}>{note}</p>)}
      <p>Ca và bộ phận lấy từ danh mục Backend. Không đổi cách đếm đăng ký, đánh giá đủ điều kiện hoặc quy tắc phân công. Không điều chuyển ứng viên giữa các bộ phận.</p>
    </details>
  </section>;
}

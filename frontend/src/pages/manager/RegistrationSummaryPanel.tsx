import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { schedulingService } from '../../services/scheduling.service';
import { dateLabel } from '../../services/scheduling.view';
import { demandRows } from '../../services/staffing-demand.view';
import type { RegistrationSummary, RegistrationSummaryRow, SchedulingContext } from '../../types/scheduling';

export function filterRegistrationRows(rows: RegistrationSummaryRow[], filters: { date: string; shift: string; department: string }) {
  return rows.filter(row => (!filters.date || row.work_date === filters.date) &&
    (!filters.shift || row.shift_id === filters.shift) && (!filters.department || row.department_id === filters.department));
}
export function RegistrationSummaryTable({ rows, forecastByKey, onEdit, editingDisabled }: {
  rows: RegistrationSummaryRow[]; forecastByKey?: Record<string,string|null>;
  onEdit?: (row:RegistrationSummaryRow)=>void; editingDisabled?:boolean;
}) {
  const value = (count: number | null) => count === null ? 'Chưa xác định' : count;
  return <div className="schedule-table-scroll" tabIndex={0} role="region" aria-label="Bảng cung cầu nhân sự">
    <table className="schedule-table summary-table"><caption>Cung–cầu nhân sự từ đăng ký hợp lệ</caption>
      <thead><tr>{['Ngày / ca', 'Bộ phận', 'Đăng ký VALID', 'Đủ điều kiện', 'Nhu cầu', 'Thiếu', 'Thừa', 'Đánh giá / cảnh báo'].map(label => <th scope="col" key={label}>{label}</th>)}{forecastByKey && <th scope="col">Nguồn Sales Forecast</th>}{onEdit && <th scope="col">Nhu cầu</th>}</tr></thead>
      <tbody>{rows.map(row => <tr key={`${row.work_date}/${row.shift_id}/${row.department_id}`} className={row.status === 'SHORTAGE' ? 'schedule-row-short' : undefined}>
        <th scope="row">{dateLabel(row.work_date)}<small>{row.shift_name}</small>{row.start_time && row.end_time && <small>{row.start_time.slice(0,5)} – {row.end_time.slice(0,5)}</small>}</th>
        <td>{row.department_name}{row.required_skill_name && <small>Kỹ năng: {row.required_skill_name}</small>}</td>
        <td>{row.registered_count}{row.registered_count===0&&<small>Chưa có nhân viên đăng ký</small>}</td><td>{value(row.eligible_count)}</td><td>{row.required_count===null?'Chưa nhập nhu cầu':row.required_count}</td><td>{value(row.shortage_count)}</td><td>{value(row.surplus_count)}</td>
        <td><span className={`badge ${row.status === 'BALANCED' ? 'badge-green' : row.status === 'UNKNOWN' ? 'badge-slate' : 'badge-yellow'}`}>
          {{ UNKNOWN: 'Chưa đủ dữ liệu đánh giá', SHORTAGE: 'Thiếu người', SURPLUS: 'Thừa ứng viên', BALANCED: 'Đủ ứng viên' }[row.status]}</span>
          {row.warnings.length > 0 && <ul className="summary-warnings">{row.warnings.map(item => <li key={item.code}>{item.message}</li>)}</ul>}
        </td>
        {forecastByKey && <td className="demand-forecast-cell">{forecastByKey[`${row.work_date}/${row.shift_id}/${row.department_id}`] || 'Chưa có nguồn forecast'}</td>}
        {onEdit && <td><button type="button" className="btn btn-outline btn-sm" disabled={editingDisabled} onClick={()=>onEdit(row)}>{row.required_count===null?'Nhập':'Sửa'}</button></td>}
      </tr>)}</tbody>
    </table>
  </div>;
}
export function RegistrationSummaryPanel({ periodId, refreshKey, context, onSummary }: { periodId: string; refreshKey: number; context?:SchedulingContext|null;onSummary?:(summary:RegistrationSummary|null)=>void }) {
  const [summary, setSummary] = useState<RegistrationSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ date: '', shift: '', department: '' });
  useEffect(() => {
    let active = true;
    setSummary(null);onSummary?.(null);setError('');setFilters({ date: '', shift: '', department: '' });
    if (!periodId) { setLoading(false); return; }
    setLoading(true);
    schedulingService.summary(periodId).then(data => { if (active){setSummary(data);onSummary?.(data);} })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Không thể tổng hợp đăng ký.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [periodId, refreshKey, onSummary]);
  const catalogMatches=summary&&context?.period.id===summary.period.id&&context.period.branch_id===summary.branch.id&&(!context.source||context.source===summary.source);
  const calendarRows=(catalogMatches?demandRows({period:summary.period,branch:summary.branch,summary,departments:context.departments,shifts:context.shifts.map(s=>({...s,is_active:s.is_active!==false}))}):summary?.rows??[])
    .slice().sort((a,b)=>a.work_date.localeCompare(b.work_date)||(a.start_time??'').localeCompare(b.start_time??'')||a.shift_id.localeCompare(b.shift_id)||a.department_id.localeCompare(b.department_id));
  const rows = filterRegistrationRows(calendarRows, filters);
  return <section className="summary-panel card" aria-labelledby="registration-summary-heading" aria-busy={loading}>
    <div className="schedule-heading"><h3 id="registration-summary-heading">Tổng hợp đăng ký</h3>
      {summary && <span className={`badge ${summary.is_mock ? 'badge-yellow' : 'badge-slate'}`}>{summary.is_mock ? 'Dữ liệu thử nghiệm — Dữ liệu mô phỏng (MOCK)' : 'Dữ liệu Supabase'}</span>}</div>
    <p className="schedule-muted">Dùng bộ chọn tuần ở trên. Số người đăng ký và số người đủ điều kiện được tính riêng cho từng ngày, ca và bộ phận.</p>
    {loading && <p className="summary-loading" role="status"><Loader2 className="spin" size={18} aria-hidden="true" />Đang tổng hợp đăng ký và cung–cầu…</p>}
    {error && <div className="schedule-alert schedule-alert-error" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span>{error} Bấm “Tải lại tuần” để thử lại.</span></div>}
    {!periodId && <p className="schedule-muted">Chọn đợt/tuần để xem tổng hợp đăng ký.</p>}
    {summary && <>
      <p className="schedule-muted">Chi nhánh: {summary.branch.name}</p>
      {summary.is_mock && <div className="schedule-alert" role="status">Đang dùng dữ liệu mô phỏng cho Bếp, Thu ngân và Phục vụ. Không lưu hoặc tạo lịch thật trong chế độ này.</div>}
      <div className="summary-filters">
        <label>Ngày<select value={filters.date} onChange={e => setFilters({ ...filters, date: e.target.value })}><option value="">Tất cả ngày</option>{[...new Set(calendarRows.map(row => row.work_date))].sort().map(date => <option key={date} value={date}>{dateLabel(date)}</option>)}</select></label>
        <label>Ca làm<select value={filters.shift} onChange={e => setFilters({ ...filters, shift: e.target.value })}><option value="">Tất cả ca</option>{[...new Map(calendarRows.map(row => [row.shift_id,row.shift_name])).entries()].map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label>Bộ phận<select value={filters.department} onChange={e => setFilters({ ...filters, department: e.target.value })}><option value="">Tất cả bộ phận</option>{[...new Map(calendarRows.map(row => [row.department_id,row.department_name])).entries()].map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></label>
      </div>
      {summary.warnings.map(item => <div className="schedule-alert" key={item.code}>{item.message}</div>)}
      {rows.length ? <RegistrationSummaryTable rows={rows} /> : <p className="schedule-muted">Không có dữ liệu tổng hợp phù hợp với bộ lọc.</p>}
      {summary.notes.map(note => <p className="schedule-muted" key={note}>{note}</p>)}
    </>}
  </section>;
}

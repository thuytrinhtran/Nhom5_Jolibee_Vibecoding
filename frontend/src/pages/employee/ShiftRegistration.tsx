import React, { useEffect, useRef, useState } from 'react';
import { CalendarDays, Save, Send } from 'lucide-react';
import { ApiError } from '../../services/auth.service';
import { useAuth } from '../../context/AuthContext';
import { RegistrationData, Preference } from '../../services/registration.service';
import { getRegistrationService, registrationDemoEnabled } from '../../services/registration-mode';
import { toggleShift, dayDeclaration, validateSelection } from '../../services/registration-selection';
import './shift-registration.css';
const labels: Record<string,string> = { DRAFT: 'Nháp', INVALID: 'Cần bổ sung', VALID: 'Hợp lệ' };
const timestamp = (value: string) => new Date(value).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
export const ShiftRegistration: React.FC = () => {
  const { user } = useAuth();
  const registrationService = getRegistrationService(user?.id);
  const [data, setData] = useState<RegistrationData | null>(null);
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [dirty, setDirty] = useState(false), [now, setNow] = useState(Date.now());
  const offset = useRef(0);
  const load = async () => {
    setLoading(true); setError('');
    try {
      const result = await registrationService.load(); setData(result); setPreferences(result.registrations.map(({work_date,shift_id}) => ({work_date,shift_id})));
      offset.current = Date.parse(result.server_now)-Date.now(); setNow(Date.now()+offset.current); setDirty(false);
    } catch (e) { setError(e instanceof Error ? e.message : 'Không tải được đăng ký.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); const timer = window.setInterval(() => setNow(Date.now()+offset.current), 1000); return () => window.clearInterval(timer); }, [user?.id]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const period = data?.period;
  const editable = !!period && now >= Date.parse(period.open_at) && now < Date.parse(period.close_at);
  const unavailable = preferences.filter(p => !data?.shifts.some(s => s.id === p.shift_id));
  const toggle = (work_date: string, shift_id: string) => {
    setPreferences(toggleShift(preferences, work_date, shift_id));
    setDirty(true); setMessage(''); setError('');
  };
  const save = async (mode: 'draft' | 'submit') => {
    if (!period || saving) return;
    const errors = data ? validateSelection(preferences, data) : [];
    if (errors.length) { setError(errors.join(' ')); return; }
    if (mode==='submit' && !window.confirm(`Gửi đăng ký với ${preferences.length} ca? Ngày không chọn ca sẽ được xác nhận OFF, kể cả cả tuần nếu không chọn ca nào. Bạn có thể sửa trước hạn.`)) return;
    setSaving(true); setError(''); setMessage('');
    try { const result = await registrationService.save(period.id, preferences, mode); await load(); setMessage(result.message); }
    catch (e) { setError(e instanceof Error ? e.message : 'Không lưu được đăng ký.'); if (e instanceof ApiError && e.status === 422 && !preferences.length && mode==='submit') { await load(); setError(e.message); } }
    finally { setSaving(false); }
  };
  if (!registrationDemoEnabled && user?.employee?.skill_level === 'CREW_LEADER') return <section className="registration"><h1>Đăng ký ca làm</h1><p className="reg-card">Crew Leader có lịch do quản lý thiết lập. Vui lòng xem Lịch làm của tôi.</p></section>;
  return <section className="registration" aria-busy={loading || saving}>
    <header className="reg-heading"><h1><CalendarDays size={25}/> Đăng ký ca làm</h1><p>Chọn mọi ca bạn có thể làm. Ngày trống chỉ được xem là OFF sau khi gửi.</p></header>
    {registrationDemoEnabled && <details className="reg-demo"><summary><strong>DEMO – dữ liệu giả lập</strong><span>Hướng dẫn &amp; công cụ thử</span></summary><p>Lưu và gửi chỉ ở bộ nhớ; không ghi Supabase. Tải lại trang sẽ xóa DEMO. Đăng nhập vẫn dùng hệ thống thật. Ba ca liền nhau được chọn đồng thời. Gửi không chọn ca để mô phỏng nghỉ cả tuần; nháp không xác nhận OFF.</p><div className="reg-demo-actions"><button className="btn btn-secondary" disabled={loading || saving} onClick={async () => { await registrationService.resetDemo?.(); setMessage(''); await load(); }}>Đặt lại DEMO</button><button className="btn btn-secondary" disabled={loading || saving || !editable} onClick={async () => { await registrationService.closeDemo?.(); setMessage(''); await load(); }}>Mô phỏng đóng đợt</button></div></details>}
    <div className="reg-profile"><strong>{data?.employee.full_name || user?.employee?.full_name || user?.username}</strong><span>Chi nhánh: {data?.employee.branch_name || user?.branch_name || 'Chưa có thông tin'}</span><span>Bộ phận: {data?.employee.department_name || user?.employee?.department_name || 'Chưa có thông tin'}</span></div>
    {error && <div role="alert" className="reg-alert">{error} {!data && <button className="btn" onClick={() => void load()}>Thử lại</button>}</div>}
    {message && <p role="status" className="reg-success">{message}</p>}
    {data?.has_sample_data && <p className="reg-note">Nhóm đang có dữ liệu mẫu TV3 cho hồ sơ này. Dữ liệu mẫu không phải đăng ký của bạn; hãy chọn và gửi các ca bạn thực sự có thể làm.</p>}
    {loading ? <p role="status" className="reg-card">Đang tải đợt đăng ký…</p> : !data ? null : !period ? <p className="reg-card">Chưa có đợt đăng ký cho chi nhánh của bạn.</p> : <>
      <div className="reg-card reg-period"><div><small>Tuần làm việc</small><h2>{new Date(period.work_start_date+'T00:00:00+07:00').toLocaleDateString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})} – {new Date(period.work_end_date+'T00:00:00+07:00').toLocaleDateString('vi-VN',{timeZone:'Asia/Ho_Chi_Minh'})}</h2></div><div><small>Mở · giờ Việt Nam</small><span>{timestamp(period.open_at)}</span></div><div><small>Hạn gửi · giờ Việt Nam</small><span>{timestamp(period.close_at)}</span></div><div><small>Đợt đăng ký</small><strong>{editable ? 'Đang mở đăng ký' : now < Date.parse(period.open_at) ? 'Đợt chưa mở' : 'Đợt đã đóng'}</strong></div><div><small>Đăng ký của bạn</small><span className="reg-badge">{dirty ? 'Chưa lưu thay đổi' : labels[data?.submission?.status || data?.registrations[0]?.status || ''] || 'Chưa đăng ký'}</span></div></div>
      {data?.schedule && <p className="reg-note">Lịch định kỳ: {['','thứ Hai','thứ Ba','thứ Tư','thứ Năm','thứ Sáu','thứ Bảy','Chủ nhật'][data.schedule.open_iso_day]} {data.schedule.open_local_time.slice(0,5)} → {['','thứ Hai','thứ Ba','thứ Tư','thứ Năm','thứ Sáu','thứ Bảy','Chủ nhật'][data.schedule.close_iso_day]} {data.schedule.close_local_time.slice(0,5)} · Giờ Việt Nam.</p>}
      {!data?.shifts.length && <p className="reg-alert">Chưa có ca hoạt động trong cấu hình chi nhánh. Vui lòng liên hệ quản lý.</p>}
      {unavailable.length > 0 && <div className="reg-alert">Có {unavailable.length} nguyện vọng dùng ca đã ngừng hoạt động. Hãy bỏ các nguyện vọng này rồi chọn ca mới. <button className="btn btn-secondary" disabled={!editable || saving} onClick={() => { setPreferences(old => old.filter(p => data?.shifts.some(s => s.id === p.shift_id))); setDirty(true); setMessage(''); }}>Bỏ ca ngừng hoạt động</button></div>}
      <div className="reg-days">{Array.from({length:7},(_,i) => {
        const d = new Date(period.work_start_date+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+i); const day=d.toISOString().slice(0,10);
        return <fieldset key={day} className="reg-card reg-day" disabled={!editable || saving}><legend>{['Thứ Hai','Thứ Ba','Thứ Tư','Thứ Năm','Thứ Sáu','Thứ Bảy','Chủ nhật'][i]} <small>{d.toLocaleDateString('vi-VN',{timeZone:'UTC',day:'2-digit',month:'2-digit'})}</small></legend>
          {data?.shifts.map(s => <label key={s.id} className="reg-shift"><input type="checkbox" checked={preferences.some(p => p.work_date===day && p.shift_id===s.id)} onChange={() => toggle(day,s.id)}/><span><strong>{s.name}</strong><small>{s.start_time.slice(0,5)}–{s.end_time.slice(0,5)}{s.end_time<s.start_time ? ' (+1 ngày)' : ''}</small></span></label>)}
          <p className="reg-day-state">{preferences.some(p => p.work_date===day) ? `${preferences.filter(p => p.work_date===day).length} ca đã chọn` : !dirty && dayDeclaration(preferences, data?.submission?.status, day)==='OFF' ? 'OFF · Đã gửi đăng ký' : 'Chưa gửi đăng ký'}</p>
        </fieldset>;
      })}</div>
      {data?.submission?.errors?.map(e => <p className="reg-alert" key={e}>{e}</p>)}
      <footer className="reg-actions"><span><strong>{preferences.length}</strong> ca đã chọn · <strong>{!dirty && data?.submission?.status==='VALID' ? 7-new Set(preferences.map(p => p.work_date)).size : 0}</strong> ngày OFF đã xác nhận {dirty && '· Chưa lưu'}</span><button className="btn btn-secondary" disabled={!editable || saving} onClick={() => void save('draft')}><Save size={17}/> Lưu nháp</button><button className="btn btn-primary" disabled={!editable || saving} onClick={() => void save('submit')}><Send size={17}/> {saving ? 'Đang lưu…' : 'Gửi đăng ký'}</button></footer>
      <p className="reg-note">Đây là nguyện vọng, chưa phải lịch phân công. Ngày trống sau khi gửi là OFF; trước khi gửi hoặc khi lưu nháp là chưa gửi đăng ký.</p>
    </>}
  </section>;
};

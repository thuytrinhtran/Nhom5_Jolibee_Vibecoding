import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ClipboardList, RefreshCw, ArrowRight, Building2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { schedulingService } from '../../services/scheduling.service';
import { dateLabel, statusLabel, weekLabel } from '../../services/scheduling.view';
import type { SchedulingPeriod } from '../../types/scheduling';
import type { CalendarPerson, ManagerCalendarData } from '../../types/manager-calendar';
import './ManagerCalendar.css';

export function calendarDays(start: string) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

export function ManagerCalendar() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'registrations' | 'assignments'>('registrations');
  const [periods, setPeriods] = useState<SchedulingPeriod[]>([]);
  const [periodId, setPeriodId] = useState('');
  const [data, setData] = useState<ManagerCalendarData | null>(null);
  const [scheduleId, setScheduleId] = useState('');
  const [department, setDepartment] = useState('');
  const [person, setPerson] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setPeriods([]);
    setPeriodId('');
    setData(null);
    setError('');
    setLoading(true);
    schedulingService.periods()
      .then(rows => {
        if (active) {
          setPeriods(rows);
          setPeriodId(rows[0]?.id || '');
          setLoading(false);
        }
      })
      .catch(e => {
        if (active) {
          setError(e.message || 'Không tải được danh sách tuần.');
          setLoading(false);
        }
      });
    return () => { active = false; };
  }, [user?.id, user?.branch_id, retry]);

  useEffect(() => {
    let active = true;
    setData(null);
    setScheduleId('');
    setDepartment('');
    setPerson('');
    if (!periodId) return;

    setLoading(true);
    setError('');
    schedulingService.calendar(periodId)
      .then(result => {
        if (!active) return;
        if (result.source !== 'supabase' || result.period.id !== periodId || result.period.branch_id !== user?.branch_id) {
          throw new Error('Dữ liệu không thuộc tuần hoặc chi nhánh hiện tại.');
        }
        setData(result);
        setScheduleId(result.schedules[0]?.id || '');
      })
      .catch(e => {
        if (active) setError(e.message || 'Không tải được lịch.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [periodId, user?.branch_id]);

  const schedule = data?.schedules.find(s => s.id === scheduleId);
  const assignments = data?.assignments.filter(a => a.schedule_id === scheduleId && a.status !== 'REPLACED') || [];
  const map = new Map<string, CalendarPerson>((data?.employees || []).map(e => [e.id, e]));
  for (const a of assignments) {
    if (a.employee) map.set(a.employee.id, { ...a.employee, department_id: a.department_id });
  }
  const candidates = tab === 'registrations'
    ? (data?.employees || [])
    : [...map.values()].filter(e => assignments.some(a => a.employee_id === e.id));
  const people = candidates.filter(e => (!department || e.department_id === department) && (!person || e.id === person));
  const days = data ? calendarDays(data.period.work_start_date) : [];

  const isWeekend = (dateStr: string) => {
    const day = new Date(dateStr + 'T12:00:00Z').getUTCDay();
    return day === 0 || day === 6;
  };

  const shiftName = (id: string) => {
    const s = data?.shifts.find(s => s.id === id) || assignments.find(a => a.shift_id === id)?.shift;
    return s ? `${s.name} · ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}` : 'Ca không còn trong danh mục';
  };

  return (
    <section className="manager-calendar">
      {/* 1. Header Area */}
      <header className="calendar-heading">
        <div className="calendar-heading-info">
          <h2>Đăng ký ca của nhân viên</h2>
          <p>
            <Building2 size={15} aria-hidden="true" />
            <span>{user?.branch_name || 'Chi nhánh được phân công'}</span>
          </p>
        </div>
        <Link className="btn btn-primary" to="/manager/official-schedule">
          <CalendarDays size={18} aria-hidden="true" />
          <span>Lịch chính thức</span>
        </Link>
      </header>

      {/* 2. Segmented Control Tabs */}
      <div className="calendar-tabs" role="tablist" aria-label="Loại lịch">
        <button
          id="calendar-registration-tab"
          role="tab"
          aria-selected={tab === 'registrations'}
          aria-controls="manager-calendar-panel"
          onClick={() => { setTab('registrations'); setPerson(''); }}
        >
          <ClipboardList size={16} aria-hidden="true" />
          <span>Lịch đăng ký</span>
        </button>
        <button
          id="calendar-assignment-tab"
          role="tab"
          aria-selected={tab === 'assignments'}
          aria-controls="manager-calendar-panel"
          onClick={() => { setTab('assignments'); setPerson(''); }}
        >
          <CalendarDays size={16} aria-hidden="true" />
          <span>Lịch phân công</span>
        </button>
      </div>

      {/* 3. Filter Toolbar Card */}
      <div className="calendar-toolbar">
        <div className="calendar-filters">
          <label>
            Tuần
            <select
              value={periodId}
              onChange={e => setPeriodId(e.target.value)}
              disabled={!periods.length}
            >
              <option value="" disabled>Chọn tuần</option>
              {periods.map(p => (
                <option key={p.id} value={p.id}>{weekLabel(p)}</option>
              ))}
            </select>
          </label>

          <label>
            Bộ phận
            <select
              value={department}
              onChange={e => { setDepartment(e.target.value); setPerson(''); }}
              disabled={!data}
            >
              <option value="">Tất cả bộ phận</option>
              {data?.departments.map(d => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>

          <label>
            Nhân viên
            <select
              value={person}
              onChange={e => setPerson(e.target.value)}
              disabled={!data}
            >
              <option value="">Tất cả nhân viên ({candidates.filter(e => !department || e.department_id === department).length})</option>
              {candidates.filter(e => !department || e.department_id === department).map(e => (
                <option key={e.id} value={e.id}>{e.full_name}</option>
              ))}
            </select>
          </label>

          {tab === 'assignments' && (
            <label>
              Lịch đã lưu
              <select
                value={scheduleId}
                onChange={e => { setScheduleId(e.target.value); setPerson(''); }}
                disabled={!data?.schedules.length}
              >
                <option value="" disabled>Chưa có lịch</option>
                {data?.schedules.map(s => (
                  <option key={s.id} value={s.id}>
                    {statusLabel(s.status)} · {new Date(s.created_at).toLocaleDateString('vi-VN')}
                  </option>
                ))}
              </select>
            </label>
          )}

          <button
            className="btn btn-outline"
            onClick={() => setRetry(x => x + 1)}
            disabled={loading}
            title="Tải lại dữ liệu"
          >
            <RefreshCw size={15} className={loading ? 'spin' : ''} aria-hidden="true" />
            <span>Tải lại</span>
          </button>
        </div>
      </div>

      {/* 4. Tab Panel Content */}
      <div
        id="manager-calendar-panel"
        role="tabpanel"
        aria-labelledby={tab === 'registrations' ? 'calendar-registration-tab' : 'calendar-assignment-tab'}
      >
        <p className="calendar-note">
          {tab === 'registrations'
            ? 'Nguyện vọng đã gửi hợp lệ từ nhân viên, chưa phải lịch làm chính thức. OFF chỉ được xác định sau khi gửi hợp lệ; nháp hoặc chưa gửi không được tính là OFF.'
            : 'Phân công theo phiên bản đã lưu. Lịch nháp/đề xuất và lịch đã duyệt chưa công bố không phải lịch chính thức. Đánh giá AI không tự thay đổi phân công.'}
        </p>

        {schedule && tab === 'assignments' && (
          <p className="calendar-status">
            <strong>{statusLabel(schedule.status)}</strong>
            <span>
              {schedule.status === 'PUBLISHED'
                ? ' · Bản đã công bố; chỉ ca ACTIVE được đánh dấu chính thức.'
                : schedule.status === 'APPROVED'
                ? ' · Đã duyệt, chưa công bố.'
                : ' · Chưa phải lịch chính thức.'}
              {schedule.published_at && ` · Công bố: ${new Date(schedule.published_at).toLocaleString('vi-VN')}`}
            </span>
          </p>
        )}

        {loading ? (
          <p role="status">Đang tải lịch…</p>
        ) : error ? (
          <div role="alert" className="schedule-alert schedule-alert-error">
            <p>{error}</p>
            <button className="btn btn-outline" onClick={() => setRetry(x => x + 1)}>Thử lại</button>
          </div>
        ) : !data ? (
          <p>Chưa có kỳ đăng ký để hiển thị.</p>
        ) : tab === 'assignments' && !schedule ? (
          <p>Chưa có lịch phân công được lưu cho tuần này.</p>
        ) : !people.length ? (
          <p>Chưa có dữ liệu phù hợp với bộ lọc.</p>
        ) : (
          <div className="calendar-scroll" tabIndex={0} role="region" aria-label="Lịch tuần, cuộn ngang để xem đủ bảy ngày">
            <table>
              <caption>
                {tab === 'registrations' ? 'Lịch đăng ký' : 'Lịch phân công'} · {weekLabel(data.period)}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Nhân viên</th>
                  {days.map(day => (
                    <th
                      key={day}
                      scope="col"
                      className={isWeekend(day) ? 'calendar-col-weekend' : ''}
                    >
                      {dateLabel(day)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people.map(e => (
                  <tr key={e.id}>
                    <th scope="row">
                      <div className="calendar-employee-badge">
                        <span>{e.full_name}</span>
                        <small>{data.departments.find(d => d.id === e.department_id)?.name || 'Chưa có bộ phận'}</small>
                      </div>
                    </th>
                    {days.map(day => {
                      const registered = data.registrations.filter(r => r.employee_id === e.id && r.work_date === day);
                      const allocated = assignments.filter(a => a.employee_id === e.id && a.work_date === day && (!department || a.department_id === department));

                      return (
                        <td key={day} className={isWeekend(day) ? 'calendar-col-weekend' : ''}>
                          {tab === 'registrations' ? (
                            registered.length ? (
                              registered.map(r => (
                                <div className="calendar-slot" key={r.shift_id}>
                                  {shiftName(r.shift_id)}
                                </div>
                              ))
                            ) : (
                              <span className="calendar-empty">
                                {data.declarations.find(d => d.employee_id === e.id && d.work_date === day)?.declaration === 'OFF' ? (
                                  <span className="calendar-chip-off">OFF</span>
                                ) : (
                                  <span className="calendar-chip-pending">Chưa gửi hợp lệ</span>
                                )}
                              </span>
                            )
                          ) : allocated.length ? (
                            allocated.map(a => (
                              <div className="calendar-slot" key={a.id}>
                                {shiftName(a.shift_id)}
                                <small>
                                  {schedule?.status === 'PUBLISHED' && a.status === 'ACTIVE'
                                    ? 'Chính thức'
                                    : a.status === 'ACTIVE'
                                    ? 'Đang hiệu lực trong phiên bản'
                                    : 'Dự kiến'}
                                </small>
                              </div>
                            ))
                          ) : (
                            <span className="calendar-empty">Chưa phân công</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 5. Footer Navigation Links */}
      <div className="calendar-links">
        <Link to="/manager/schedule">
          <span>Mở công cụ xếp lịch</span>
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
        <span className="calendar-links-separator" aria-hidden="true">·</span>
        <Link to="/manager/publish">
          <span>Mở quy trình phê duyệt / công bố</span>
          <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

import { Toast, errorGuidance } from '../../components/Toast';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Copy, Loader2, RefreshCw, Save } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { schedulingService } from '../../services/scheduling.service';
import { dateLabel, weekLabel } from '../../services/scheduling.view';
import { demandDays, demandRowKey } from '../../services/staffing-demand.view';
import { cellValue, copyDays, countError, demandSyncMessage, gridCells, gridDepartments, gridShifts, overwritesSaved, pasteGrid, saveGrid, updateCell, type DemandDraft } from '../../services/staffing-demand.grid';
import { useUnsavedDemandGuard } from '../../services/staffing-demand.guard';
import { StaffingStatusMatrix } from './StaffingStatusMatrix';
import type { DemandContext, SchedulingPeriod } from '../../types/scheduling';
import './ManagerSchedule.css';
import './ManagerDemand.css';

const dayName = (day: string) => new Intl.DateTimeFormat('vi-VN', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
const weekend = (day: string) => [0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay());
const cellId = (key: string) => `demand-cell-${key}`;
const message = (error: unknown) => error instanceof Error ? error.message : 'Không thể xử lý yêu cầu.';

export function DemandWorkspace({ data, draft, onChange, saving, errors }: {
  data: DemandContext; draft: DemandDraft; onChange: (draft: DemandDraft) => void; saving: boolean; errors: Record<string, string>;
}) {
  const days = demandDays(data), shifts = gridShifts(data), departments = gridDepartments(data), cells = gridCells(data);
  const [day, setDay] = useState(''); const [selected, setSelected] = useState(cells[0] ? demandRowKey(cells[0]) : '');
  const [copyError, setCopyError] = useState('');
  const selectedCell = cells.find(c => demandRowKey(c) === selected);
  const targetDay = day || selectedCell?.work_date || days[0], previous = days[days.indexOf(targetDay) - 1];
  const selectedValue = cellValue(data, draft, selected), selectedRequirement = data.requirements.find(r => demandRowKey(r) === selected);

  const applyCopy = (next: DemandDraft) => {
    if (overwritesSaved(data, draft, next) && !window.confirm('Thao tác này sẽ thay đổi số lượng đã lưu trong các ô đích (kể cả ô trống). Tiếp tục? Chỉ ghi dữ liệu khi bấm Lưu tất cả.')) return;
    onChange(next); setCopyError('');
  };

  return (
    <>
      <section className="card demand-sheet" aria-label="Bảng nhu cầu toàn tuần">
        {/* Streamlined Action Bar: Filters, Copy Tools & Keyboard Shortcuts */}
        <div className="demand-toolbar">
          <div className="demand-toolbar-left">
            <label htmlFor="demand-day-filter">
              <span>Hiển thị</span>
              <select id="demand-day-filter" value={day} disabled={saving} onChange={e => setDay(e.target.value)}>
                <option value="">Cả tuần · {days.length} ngày</option>
                {days.map(d => <option key={d} value={d}>{dayName(d)} · {dateLabel(d)}</option>)}
              </select>
            </label>
          </div>

          <div className="demand-copy-actions">
            <button
              type="button"
              className="btn btn-outline"
              disabled={saving || !cells.length || !days.some(d => new Date(`${d}T00:00:00Z`).getUTCDay() === 1)}
              onClick={() => {
                const monday = days.find(d => new Date(`${d}T00:00:00Z`).getUTCDay() === 1)!;
                applyCopy(copyDays(data, draft, monday, days.filter(d => d !== monday)));
              }}
              title="Sao chép toàn bộ định biên thứ Hai cho các ngày còn lại trong tuần"
            >
              <Copy size={15} aria-hidden="true" />
              <span>Sao chép thứ Hai cho cả tuần</span>
            </button>

            <button
              type="button"
              className="btn btn-outline"
              disabled={saving || !previous || !cells.length}
              title={`Sao chép sang ${targetDay ? dateLabel(targetDay) : ''}. Chọn ngày hoặc ô đích trước.`}
              onClick={() => applyCopy(copyDays(data, draft, previous, [targetDay]))}
            >
              <Copy size={15} aria-hidden="true" />
              <span>Sao chép ngày trước</span>
            </button>
          </div>
        </div>

        {/* Compact Pro-Tip Shortcut Bar */}
        <div className="demand-sheet-hint" id="demand-grid-help">
          <div className="demand-hint-shortcuts">
            <span className="demand-hint-pill"><kbd>Tab</kbd> Ô tiếp</span>
            <span className="demand-hint-pill"><kbd>Enter</kbd> Xuống cùng cột</span>
            <span className="demand-hint-pill"><kbd>Ctrl+V</kbd> Dán vùng số từ Excel</span>
          </div>
          <div className="demand-hint-rules">
            <span>Ô trống = chưa xác định</span>
            <span>·</span>
            <span>0 = không cần người</span>
            <span>·</span>
            <span>Có thể dán vùng số từ Excel. Không tự lưu.</span>
          </div>
        </div>

        {copyError && <p className="schedule-alert schedule-alert-error" role="alert">{copyError}</p>}
        {!shifts.length && <p className="schedule-alert" role="alert">Chưa có ca hoạt động cho chi nhánh. Không thể nhập nhu cầu.</p>}
        {!departments.length && <p className="schedule-alert" role="alert">Chưa cấu hình bộ phận. Không thể nhập nhu cầu.</p>}
        {shifts.length > 0 && shifts.length !== 3 && (
          <p className="schedule-alert">
            Chi nhánh hiện có {shifts.length} ca hoạt động. Bảng dùng đúng danh mục Backend; cần bổ sung cấu hình ca nếu thiếu.
          </p>
        )}

        {/* The Spreadsheet Matrix */}
        {!!shifts.length && !!departments.length && (
          <div className="demand-sheet-scroll" tabIndex={0} aria-label="Cuộn bảng nhu cầu">
            <table className="demand-grid" aria-describedby="demand-grid-help">
              <caption className="demand-sr-only">Nhu cầu nhân sự theo ngày, ca và bộ phận — {weekLabel(data.period)}</caption>
              <thead>
                <tr>
                  <th scope="col">Ngày làm việc</th>
                  <th scope="col">Ca làm việc</th>
                  {departments.map(d => (
                    <th scope="col" key={d.id}>
                      <span className="demand-th-name">{d.name}</span>
                      <small>Số nhân viên cần</small>
                    </th>
                  ))}
                </tr>
              </thead>
              {days.filter(d => !day || d === day).map(date => (
                <tbody key={date} className={weekend(date) ? 'demand-weekend' : ''}>
                  {shifts.map((shift, si) => (
                    <tr key={shift.id}>
                      {si === 0 && (
                        <th scope="rowgroup" rowSpan={shifts.length} className="demand-day">
                          <strong>{dayName(date)}</strong>
                          <span>{dateLabel(date)}</span>
                          {weekend(date) && <small>Cuối tuần</small>}
                        </th>
                      )}
                      <th scope="row" className="demand-shift">
                        <strong>{shift.name}</strong>
                        <span>{shift.start_time.slice(0, 5)}–{shift.end_time.slice(0, 5)}</span>
                      </th>
                      {departments.map(dept => {
                        const cell = { work_date: date, shift_id: shift.id, department_id: dept.id },
                          key = demandRowKey(cell),
                          value = cellValue(data, draft, key);
                        const error = errors[key] || countError(value.count),
                          stored = data.requirements.find(r => demandRowKey(r) === key);
                        const label = `${dayName(date)} ${dateLabel(date)}, ${shift.name}, ${dept.name}`;

                        return (
                          <td key={dept.id} className={draft[key] ? 'demand-edited' : ''}>
                            <input
                              id={cellId(key)}
                              data-demand-cell={key}
                              className="demand-number"
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              autoComplete="off"
                              aria-label={label}
                              aria-invalid={!!error}
                              aria-describedby={error ? `${cellId(key)}-error` : undefined}
                              placeholder="—"
                              value={value.count}
                              disabled={saving}
                              title={`${label}${stored?.required_skill_name ? ` · Kỹ năng: ${stored.required_skill_name}` : ''}${draft[key] ? ' · Chưa lưu' : ''}`}
                              onFocus={() => setSelected(key)}
                              onChange={e => onChange(updateCell(data, draft, key, { ...value, count: e.target.value }))}
                              onKeyDown={e => {
                                const offset = e.key === 'Enter' ? (e.shiftKey ? -1 : 1) * departments.length : e.key === 'ArrowDown' ? departments.length : e.key === 'ArrowUp' ? -departments.length : e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                                if (!offset) return;
                                e.preventDefault();
                                const visible = cells.filter(c => !day || c.work_date === day), i = visible.findIndex(c => demandRowKey(c) === key) + offset;
                                if (visible[i]) document.getElementById(cellId(demandRowKey(visible[i])))?.focus();
                              }}
                              onPaste={e => {
                                const text = e.clipboardData.getData('text');
                                if (!/[\t\n]/.test(text)) return;
                                e.preventDefault();
                                try { applyCopy(pasteGrid(data, draft, cell, text)); }
                                catch (error) { setCopyError(message(error)); }
                              }}
                            />
                            {error && <small id={`${cellId(key)}-error`} className="demand-cell-error">{errorGuidance(error)}</small>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        )}

        <div className="demand-sheet-footer">
          <div className="demand-footer-stats">
            <span>{days.length * shifts.length} ca / tuần</span>
            <span>·</span>
            <span>{cells.length} ô nhu cầu</span>
            <span>·</span>
            <span>{data.requirements.length} ô đã có nhu cầu</span>
          </div>
          <span className="demand-change-key"><i aria-hidden="true" />Ô đang thay đổi</span>
        </div>
      </section>

      {/* Sales Forecast Notes Accordion */}
      <details className="card demand-details">
        <summary>
          <span>Nguồn &amp; ghi chú Sales Forecast</span>
          <span className="demand-badge-optional">Tùy chọn</span>
        </summary>
        <p className="schedule-muted">Không bắt buộc nhập khi lưu. Quản lý xác định nhu cầu thủ công; chưa có công thức quy đổi Sales Forecast thành nhân sự. Chọn ô trong bảng hoặc danh sách dưới đây để sửa ghi chú của riêng ô đó.</p>
        <div className="demand-forecast-grid">
          <label htmlFor="demand-forecast-cell">
            Ô nhu cầu
            <select id="demand-forecast-cell" disabled={saving || !cells.length} value={selected} onChange={e => setSelected(e.target.value)}>
              {cells.map(c => <option key={demandRowKey(c)} value={demandRowKey(c)}>{dateLabel(c.work_date)} · {shifts.find(s => s.id === c.shift_id)?.name} · {departments.find(d => d.id === c.department_id)?.name}</option>)}
            </select>
          </label>
          <label htmlFor="demand-forecast">
            Nguồn / ghi chú Sales Forecast
            <textarea id="demand-forecast" rows={3} disabled={saving || !selectedCell} value={selectedValue.forecast} onChange={e => onChange(updateCell(data, draft, selected, { ...selectedValue, forecast: e.target.value }))} placeholder="Nguồn dự báo, kỳ dự báo hoặc liên kết tham chiếu" />
          </label>
        </div>
        <p className="schedule-muted">Kỹ năng bắt buộc đã lưu: {selectedRequirement?.required_skill_name || 'Không yêu cầu cụ thể'}. Bảng nhập giữ nguyên cấu hình kỹ năng hiện có.</p>
      </details>

      {/* Staffing Status Balance Matrix */}
      <StaffingStatusMatrix key={data.period.id} data={data} />
    </>
  );
}

export function ManagerDemand() {
  const { user } = useAuth();
  const [periods, setPeriods] = useState<SchedulingPeriod[]>([]);
  const [periodId, setPeriodId] = useState('');
  const [data, setData] = useState<DemandContext | null>(null);
  const [draft, setDraft] = useState<DemandDraft>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const sequence = useRef(0), submitting = useRef(false);
  const dirty = Object.keys(draft).length;
  useUnsavedDemandGuard(!!dirty || saving);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setData(null);
    setDraft({});
    setPeriods([]);
    setError('');
    if (!user?.branch_id) { setLoading(false); return; }
    schedulingService.periods()
      .then(list => {
        if (active) {
          setPeriods(list);
          setPeriodId(current => list.some(p => p.id === current) ? current : (list.find(p => p.status === 'CLOSED') ?? list[0])?.id ?? '');
        }
      })
      .catch(err => { if (active) setError(message(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.branch_id, reload]);

  useEffect(() => {
    const request = ++sequence.current;
    if (loading || !periodId || !periods.some(p => p.id === periodId)) return;
    setData(null);
    setDraft({});
    setErrors({});
    setError('');
    setNotice('');
    schedulingService.demand(periodId)
      .then(result => { if (request === sequence.current) setData(result); })
      .catch(err => { if (request === sequence.current) setError(message(err)); });
    return () => { sequence.current++; };
  }, [periodId, periods, loading]);

  const discard = () => !dirty || window.confirm('Có thay đổi chưa lưu. Bỏ thay đổi để chuyển/tải lại tuần?');

  const save = async () => {
    if (!data || submitting.current || !dirty) return;
    const clearing = data.requirements.filter(r => draft[demandRowKey(r)]?.count === '');
    if (clearing.length && !window.confirm(`Đưa ${clearing.length} ô đã lưu về chưa xác định? Nhu cầu, kỹ năng và nguồn forecast của các ô này sẽ được xóa khi lưu. Số 0 vẫn được giữ là nhu cầu bằng 0.`)) return;
    submitting.current = true;
    setSaving(true);
    setError('');
    setNotice('');
    setProgress({ done: 0, total: dirty });
    const request = sequence.current;
    try {
      const result = await saveGrid(data, draft, schedulingService, (done, total) => setProgress({ done, total }));
      if (request !== sequence.current) return;
      const persisted = { ...data, requirements: result.requirements };
      setData(persisted);
      setDraft(result.remaining);
      setErrors(result.errors);
      const failed = Object.keys(result.errors).length;
      if (failed) setError(`Đã lưu ${result.saved}/${result.total} ô; ${failed} ô chưa lưu. Xem lỗi tại ô (kể cả ngày đang bị lọc). Các ô lỗi vẫn giữ nội dung để sửa; nếu dữ liệu đã thay đổi trên server, tải lại tuần trước khi nhập lại.`);
      try {
        const refreshed = await schedulingService.demand(periodId);
        if (request !== sequence.current) return;
        setData(failed ? { ...persisted, summary: refreshed.summary } : refreshed);
        if (!failed) setNotice(`Đã lưu và đọc lại ${result.saved} ô. Lịch dự kiến sẽ dùng nhu cầu vừa lưu.`);
      } catch (err) {
        if (request === sequence.current) setError(`${failed ? `Còn ${failed} ô lỗi. ` : ''}Đã lưu ${result.saved} ô nhưng chưa đọc lại được: ${message(err)} Tải lại tuần để kiểm tra trước khi tiếp tục.`);
      }
    } catch (err) {
      if (request === sequence.current) setError(message(err));
    } finally {
      submitting.current = false;
      if (request === sequence.current) setSaving(false);
    }
  };

  const pending = loading || (!data && !!periodId && !error), ready = !!data && !!gridCells(data).length;

  return (
    <section className="manager-schedule manager-demand" aria-busy={pending || saving}>
      {/* 1. Unified Studio Command Bar (Title, Week Selector, Live Status & Save Actions) */}
      <div className="demand-command-bar card">
        <div className="demand-command-left">
          <header className="dashboard-greeting">
            <h2>Nhu cầu nhân sự</h2>
            <p>
              <Building2 size={15} aria-hidden="true" />
              <span>{user?.branch_name || 'Chi nhánh phụ trách'}</span>
            </p>
          </header>

          <div className="schedule-controls demand-controls">
            <div className="schedule-week-field">
              <label htmlFor="demand-period">Tuần làm việc</label>
              <select
                id="demand-period"
                value={periodId}
                disabled={pending || saving || !periods.length}
                onChange={e => { if (discard()) setPeriodId(e.target.value); }}
              >
                <option value="" disabled>Chọn tuần</option>
                {periods.map(period => (
                  <option key={period.id} value={period.id}>{weekLabel(period)}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="demand-command-right">
          <div className="demand-data-status">
            {data?.is_mock && <span className="badge badge-yellow">Dữ liệu thử nghiệm</span>}
            <span role="status" className={`demand-status-pill ${dirty ? 'has-unsaved' : ''}`}>
              <span className="demand-status-dot" aria-hidden="true" />
              {saving ? `Đang lưu ${progress.total} ô…` : dirty ? `${dirty} ô chưa lưu` : data ? (error ? 'Cần kiểm tra dữ liệu' : 'Đã đồng bộ dữ liệu') : 'Chưa có dữ liệu'}
            </span>
          </div>

          <div className="demand-header-actions">
            <button
              type="button"
              className="btn btn-outline"
              disabled={pending || saving}
              onClick={() => { if (discard()) setReload(n => n + 1); }}
              title="Tải lại tuần"
            >
              <RefreshCw size={15} className={pending ? 'spin' : ''} aria-hidden="true" />
              <span>Tải lại</span>
            </button>

            <button
              type="button"
              className="btn btn-primary demand-save"
              title={saving ? 'Đang lưu, vui lòng chờ.' : !ready ? 'Chọn tuần và chờ tải bảng nhu cầu.' : !dirty ? 'Chưa có thay đổi cần lưu.' : undefined}
              disabled={!ready || !dirty || saving || pending}
              onClick={() => void save()}
            >
              {saving ? <Loader2 className="spin" size={17} aria-hidden="true" /> : <Save size={17} aria-hidden="true" />}
              <span>{saving ? 'Đang lưu…' : 'Lưu tất cả'}</span>
              {dirty > 0 && <span className="demand-save-badge">{dirty}</span>}
            </button>
          </div>
        </div>
      </div>

      {!user?.branch_id && <p className="schedule-alert" role="alert">Quản lý chưa được phân công chi nhánh.</p>}
      {data?.is_mock && <p className="demand-mock-note">Dữ liệu thử nghiệm chỉ lưu trong bộ nhớ Backend, mất khi khởi động lại. Không ghi lên Supabase chung.</p>}
      {error && <div className="schedule-alert schedule-alert-error" role="alert">{errorGuidance(error)}</div>}
      {notice && Toast({ message: notice, onDismiss: () => setNotice('') })}
      {pending && user?.branch_id && (
        <p className="summary-loading" role="status">
          <Loader2 className="spin" size={20} aria-hidden="true" />
          <span>Đang đọc nhu cầu và cung–cầu…</span>
        </p>
      )}
      {!loading && !periods.length && !error && user?.branch_id && (
        <div className="card schedule-empty">Chưa có đợt/tuần của chi nhánh trong nguồn dữ liệu hiện tại. Có thể bật chế độ Dữ liệu thử nghiệm trong development.</div>
      )}

      {/* 2. Main Workspace & Data Grid */}
      {data && (
        <DemandWorkspace
          key={data.period.id}
          data={data}
          draft={draft}
          onChange={next => {
            setDraft(next);
            setNotice('');
            setErrors(current => Object.fromEntries(Object.entries(current).filter(([key]) => next[key] && next[key] === draft[key])));
          }}
          saving={saving}
          errors={errors}
        />
      )}

      {/* 3. Floating Bottom Navigation Bar */}
      {data && (
        <div className="demand-bottom-bar">
          <span role="status">{demandSyncMessage(data, dirty, saving, error)}</span>
          <Link className="btn btn-primary" to={`/manager/schedule?period_id=${encodeURIComponent(data.period.id)}`}>
            <span>Xếp lịch làm việc →</span>
          </Link>
        </div>
      )}
    </section>
  );
}

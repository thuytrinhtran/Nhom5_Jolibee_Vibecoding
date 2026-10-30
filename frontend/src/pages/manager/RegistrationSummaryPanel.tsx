import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { schedulingService } from '../../services/scheduling.service';
import type { RegistrationSummary, SchedulingContext } from '../../types/scheduling';
import { StaffingStatusMatrix } from './StaffingStatusMatrix';

export function RegistrationSummaryPanel({ periodId, refreshKey, context, onSummary }: { periodId: string; refreshKey: number; context?:SchedulingContext|null;onSummary?:(summary:RegistrationSummary|null)=>void }) {
  const [summary, setSummary] = useState<RegistrationSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setSummary(null);onSummary?.(null);setError('');
    if (!periodId) { setLoading(false); return; }
    setLoading(true);
    schedulingService.summary(periodId).then(data => { if (active){setSummary(data);onSummary?.(data);} })
      .catch(err => { if (active) setError(err instanceof Error ? err.message : 'Không thể tổng hợp đăng ký.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [periodId, refreshKey, onSummary]);
  if (summary && summary.period.id === periodId) {
    const catalogMatches = context?.period.id === summary.period.id && context.period.branch_id === summary.branch.id && (!context.source || context.source === summary.source);
    // A summary is not a full catalog. Never invent shift IDs or times while
    // waiting for the matching Backend context.
    const shifts = catalogMatches ? context.shifts.map(s => ({...s,is_active:s.is_active !== false})) : [...new Map(summary.rows.map(row => [row.shift_id,{
      id:row.shift_id,name:row.shift_name,start_time:row.start_time ?? '',end_time:row.end_time ?? '',is_active:true,
    }])).values()];
    const departments = catalogMatches ? context.departments : [...new Map(summary.rows.map(row => [row.department_id,{id:row.department_id,name:row.department_name}])).values()];
    return <StaffingStatusMatrix key={`${summary.source}/${summary.branch.id}/${summary.period.id}`} catalogComplete={!!catalogMatches}
      data={{source:summary.source,is_mock:summary.is_mock,period:summary.period,branch:summary.branch,summary,shifts,departments}} />;
  }
  return <section className="summary-panel card" aria-labelledby="registration-summary-heading" aria-busy={loading}>
    <h3 id="registration-summary-heading">Tình trạng nhân sự theo ca</h3>
    {loading && <p className="summary-loading" role="status"><Loader2 className="spin" size={18} aria-hidden="true" />Đang tổng hợp đăng ký và cung–cầu…</p>}
    {error && <div className="schedule-alert schedule-alert-error" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span>{error} Bấm “Tải lại tuần” để thử lại.</span></div>}
    {!periodId && <p className="schedule-muted">Chọn đợt/tuần để xem tổng hợp đăng ký.</p>}
  </section>;
}

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { GraduationCap, Search } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { employeeCompetencyService, skillLevels, type CompetencyEmployee, type SkillLevel } from '../../services/employee-competency.service';
import './employee-competency.css';

const levelKeys = Object.keys(skillLevels) as SkillLevel[];
const normalize = (value: string) => value.toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
const nameCollator = new Intl.Collator('vi', { sensitivity: 'base', numeric: true });
const givenName = (name: string) => name.trim().split(/\s+/).pop() || '';

function CompetencyModal({ employee, onClose, onSaved }: {
  employee: CompetencyEmployee; onClose: () => void; onSaved: (employee: CompetencyEmployee) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [level, setLevel] = useState<SkillLevel>(employee.skill_level);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); };
  }, []);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || level === employee.skill_level) return;
    setSaving(true); setError('');
    try {
      const updated = await employeeCompetencyService.update(employee, level);
      onSaved({ ...employee, ...updated });
    } catch (e) { setError(e instanceof Error ? e.message : 'Không cập nhật được năng lực.'); }
    finally { setSaving(false); }
  };
  return <dialog ref={dialog} className="competency-modal" aria-labelledby="competency-modal-title"
    onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}>
    <form onSubmit={event => void save(event)} aria-busy={saving}>
      <h2 id="competency-modal-title">Cập nhật năng lực</h2>
      <dl><dt>Nhân viên</dt><dd>{employee.full_name} · {employee.employee_code || 'Chưa có mã'}</dd>
        <dt>Chi nhánh · Bộ phận</dt><dd>{employee.branch_name} · {employee.department_name}</dd>
        <dt>Cấp độ hiện tại</dt><dd>{skillLevels[employee.skill_level]?.label || employee.skill_level} ({employee.skill_level})</dd></dl>
      <label htmlFor="new-skill-level">Cấp độ mới</label>
      <select id="new-skill-level" value={level} disabled={saving} onChange={event => setLevel(event.target.value as SkillLevel)} autoFocus>
        {levelKeys.map(key => <option key={key} value={key}>{key} — {skillLevels[key].label}</option>)}
      </select>
      <p className="competency-description">{skillLevels[level]?.description}</p>
      {error && <p role="alert" className="competency-error">{error}</p>}
      <footer><button type="button" className="btn btn-secondary" disabled={saving} onClick={onClose}>Hủy</button>
        <button className="btn btn-primary" disabled={saving || level === employee.skill_level}>{saving ? 'Đang lưu…' : 'Lưu'}</button></footer>
    </form>
  </dialog>;
}

export function EmployeeCompetency() {
  const { user } = useAuth();
  const [employees, setEmployees] = useState<CompetencyEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [query, setQuery] = useState(''), [branch, setBranch] = useState(''), [department, setDepartment] = useState(''), [level, setLevel] = useState('');
  const [selected, setSelected] = useState<CompetencyEmployee | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setSelected(null); setEmployees([]); setMessage('');
    employeeCompetencyService.list().then(rows => { if (active) setEmployees(rows); })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Không tải được danh sách nhân viên.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [reload, user?.id, user?.branch_id]);
  const branches = [...new Map(employees.map(e => [e.branch_id, e.branch_name])).entries()];
  const departments = [...new Map(employees.map(e => [e.department_id, e.department_name])).entries()];
  const visible = employees.filter(e => normalize(e.full_name).includes(normalize(query.trim())) &&
    (!branch || e.branch_id === branch) && (!department || e.department_id === department) && (!level || e.skill_level === level))
    .sort((a, b) => nameCollator.compare(givenName(a.full_name), givenName(b.full_name)) ||
      nameCollator.compare(a.full_name, b.full_name) || a.id.localeCompare(b.id));
  return <section className="employee-competency" aria-busy={loading}>
    <header><p className="competency-breadcrumb">Quản lý nhân viên</p><h1><GraduationCap size={26} /> Đánh giá năng lực nhân viên</h1>
      <p>Xem và cập nhật cấp độ năng lực của nhân viên thuộc chi nhánh bạn phụ trách.</p></header>
    <div className="competency-filters">
      <label><span><Search size={15} /> Tìm theo tên</span><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Nhập họ tên nhân viên" /></label>
      <label>Chi nhánh<select value={branch} onChange={e => setBranch(e.target.value)}><option value="">Tất cả chi nhánh được phép</option>{branches.map(([id, name]) => <option key={id} value={id}>{name || 'Chưa có tên'}</option>)}</select></label>
      <label>Bộ phận<select value={department} onChange={e => setDepartment(e.target.value)}><option value="">Tất cả bộ phận</option>{departments.map(([id, name]) => <option key={id} value={id}>{name || 'Chưa có tên'}</option>)}</select></label>
      <label>Cấp độ<select value={level} onChange={e => setLevel(e.target.value)}><option value="">Tất cả cấp độ</option>{levelKeys.map(key => <option key={key} value={key}>{skillLevels[key].label}</option>)}</select></label>
    </div>
    {message && <p role="status" className="competency-success">{message}</p>}
    {error ? <div role="alert" className="competency-error">{error} <button className="btn btn-secondary" onClick={() => setReload(n => n + 1)}>Tải lại danh sách</button></div>
      : loading ? <p role="status">Đang tải nhân viên…</p> : <>
        <p className="competency-count">{visible.length} nhân viên</p>
        <div className="competency-table-wrap"><table><caption className="competency-sr-only">Danh sách đánh giá năng lực nhân viên</caption>
          <thead><tr><th>Mã nhân viên</th><th>Họ tên</th><th>Chi nhánh</th><th>Bộ phận</th><th>Cấp độ hiện tại</th><th>Thao tác</th></tr></thead>
          <tbody>{visible.length ? visible.map(employee => <tr key={employee.id}>
            <td>{employee.employee_code || 'Chưa có mã'}</td><td><strong>{employee.full_name}</strong></td><td>{employee.branch_name || 'Chưa có thông tin'}</td><td>{employee.department_name || 'Chưa có thông tin'}</td>
            <td><span className="competency-badge" title={skillLevels[employee.skill_level]?.description}>{skillLevels[employee.skill_level]?.label || employee.skill_level}</span><small>{employee.skill_level}</small></td>
            <td><button className="btn btn-secondary" aria-label={'Cập nhật năng lực ' + employee.full_name} onClick={() => { setSelected(employee); setMessage(''); }}>Cập nhật năng lực</button></td>
          </tr>) : <tr><td colSpan={6} className="competency-empty">Không có nhân viên phù hợp.</td></tr>}</tbody>
        </table></div>
        <p className="competency-note">CREW_TRAINING là nhân viên có khả năng hướng dẫn, đào tạo nhân viên mới.</p>
      </>}
    {selected && <CompetencyModal key={selected.id} employee={selected} onClose={() => setSelected(null)} onSaved={updated => {
      setEmployees(rows => rows.map(e => e.id === updated.id ? updated : e)); setSelected(null);
      setMessage('Đã cập nhật năng lực của ' + updated.full_name + ' thành ' + skillLevels[updated.skill_level].label + '.');
    }} />}
  </section>;
}

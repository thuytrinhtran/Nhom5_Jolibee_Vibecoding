import { authorized } from './auth.service';

export const skillLevels = {
  NEW: { label: 'Nhân viên mới', description: 'Cần được hướng dẫn.' },
  REGULAR: { label: 'Nhân viên thành thạo', description: 'Đã thành thạo công việc được phân công.' },
  CREW_TRAINING: { label: 'Nhân viên hướng dẫn', description: 'Thành thạo tất cả công việc trong bộ phận, có khả năng đào tạo nhân viên mới.' },
  CREW_LEADER: { label: 'Crew Leader', description: 'Nhân viên cấp Crew Leader.' },
} as const;
export type SkillLevel = keyof typeof skillLevels;
export interface CompetencyEmployee {
  id: string; employee_code: string; full_name: string; branch_id: string; branch_name: string;
  department_id: string; department_name: string; skill_level: SkillLevel;
}
export const employeeCompetencyService = {
  async list(): Promise<CompetencyEmployee[]> {
    return (await authorized('', {}, '/employee-competencies')).employees;
  },
  async update(employee: CompetencyEmployee, skill_level: SkillLevel): Promise<{ id: string; skill_level: SkillLevel }> {
    return (await authorized('/' + employee.id + '/skill-level', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skill_level, expected_skill_level: employee.skill_level }),
    }, '/employee-competencies')).employee;
  },
};

export interface AIAssignment {employee_code:string;work_date:string;shift_code:string;department_code:string}
export interface AIReport {
  conclusion:'SUITABLE'|'NEEDS_ADJUSTMENT'|'INSUFFICIENT_DATA';
  good_points:string[];concerns:string[];limitations:string[];
  suggestions:{description:string;reason:string;candidate_assignments:AIAssignment[]|null}[];
}
export interface AISummary {
  contract_version:'tv3-ai.v1';version:number;
  dates:{start:string;end:string};
  rules:{hard_constraints:string;data_complete:boolean;coverage_complete:boolean;codes:string[];new_employee_count_threshold:number|null;test_rules:{max_shifts_per_day:number}|null};
  shifts:{code:string;start:string;end:string}[];
  coverage:{work_date:string;shift_code:string;department_code:string;required:number;assigned:number;registered:number;eligible:number|null;skill_code:string|null;levels:Record<string,number>;warning:string|null}[];
  employees:{code:string;department_code:string;level:string;skill_codes:string[];registered:{work_date:string;shift_code:string}[];assignments:AIAssignment[];shift_count:number;total_weekly_hours:number;max_weekly_hours:number|null}[];
  missing_criteria:string[];
}
export interface CheckedAIReport extends Omit<AIReport,'suggestions'> {
  suggestions:(AIReport['suggestions'][number]&{rule_check:{status:'PASS'|'REJECTED'|'NOT_APPLICABLE';code:string|null;message:string}})[];
}
export interface AIEvaluation {
  contract_version:'tv3-ai.v1';schedule_id:string;version:number;input_revision:string;created_at:string;
  report:CheckedAIReport;
  employee_aliases:{code:string;employee_id:string}[];
  labels:{code:string;label:string}[];
  missing_criteria:string[];
}
export interface AIEvaluationRecord {id:string;status:'SUCCESS'|'FAILED';evaluation:AIEvaluation|null;error_message:string|null;model_name:string|null;created_at:string}
export interface AIReviewResponse {
  status:'NOT_CONFIGURED'|'NOT_EVALUATED'|'AVAILABLE'|'STALE'|'BLOCKED'|'FAILED';message:string;
  schedule_id:string;version:number;configured:boolean;model:string|null;
  evaluation:AIEvaluation|null;rule_check:{hard_constraints:string;codes:string[]};
}

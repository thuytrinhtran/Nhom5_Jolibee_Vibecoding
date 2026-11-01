export interface ScheduleSummary {
  id: string; status: string; version: number; created_at: string; period_id?: string;
}
export interface SchedulingPeriod {
  id: string; branch_id: string; work_start_date: string; work_end_date: string;
  status: string; schedules: ScheduleSummary[];
}
export interface StaffingRequirement {
  id: string; department_id: string; shift_id: string; work_date: string;
  required_count: number; required_skill_name: string | null;
}
export interface ScheduleAssignment {
  id?: string; employee_id: string; work_date: string; shift_id: string;
  department_id: string; status?: string; assignment_source?: string;
  reason?:string;
  selection_history?:{initial:{employee_id:string;reason:string};replacements:{iteration:number;from_employee_id:string;to_employee_id:string;from_hours_before:number;to_hours_before:number;shift_hours:number;objective_before:number;objective_after:number}[]};
}
export interface ScheduleCoverage extends StaffingRequirement {
  assigned_count: number; missing_count: number; warning: string | null;
  new_assigned_count?:number;existing_count?:number;excess_count?:number;
  experienced_target?:number;experienced_count?:number;missing_experienced_count?:number;
  composition_status?:'PASS'|'SHORTAGE';warnings?:string[];
}
export interface ScheduleOptimization {
  method:string;objective:string;max_iterations:number;iterations:number;converged:boolean;limit_reached:boolean;
  before:{objective:number;departments:{department_id:string;employee_count:number;total_hours:number;mean_hours:number;squared_deviation:number}[]};
  after:ScheduleOptimization['before'];
}
export interface SchedulingContext {
  source?: 'mock' | 'supabase';
  can_generate_mock?:boolean;test_rules?:{max_shifts_per_day:number};
  period: Omit<SchedulingPeriod, 'schedules'>; requirements: StaffingRequirement[];
  valid_registration_count: number;
  employees: { id: string; full_name: string; department_id: string;employee_code?:string;skill_level?:string;skills?:string[]|null;max_weekly_hours?:number|null }[];
  shifts: { id: string; name: string; start_time: string; end_time: string; is_active?:boolean }[];
  departments: { id: string; name: string }[];
}
export interface SavedSchedule {
  source?:'mock'|'supabase';is_mock?:boolean;demand_changed?:boolean;note?:string|null;
  test_configuration?:{max_shifts_per_day:number|null;policy_source:string};
  schedule: ScheduleSummary;
  assignments: ScheduleAssignment[];
  generation_snapshot: { new_employee_count_threshold?: number | null; coverage: ScheduleCoverage[]; notes: string[];
    rule_version?:string;plan_origin?:string;optimization?:ScheduleOptimization|null;assignments?:ScheduleAssignment[];
    employee_statistics?:{employee_id:string;shift_count:number;total_weekly_hours:number}[] } | null;
}
export interface SchedulePreview {
  kind:'preview';persisted:false;source:'mock'|'supabase';input_revision:string;
  period:SchedulingContext['period'];context:SchedulingContext;
  result:{rule_version?:string;plan_origin?:string;optimization?:ScheduleOptimization|null;covered_count?:number;existing_count?:number;composition_shortages?:ScheduleCoverage[];employee_statistics?:{employee_id:string;shift_count:number;total_weekly_hours:number}[];assignments:ScheduleAssignment[];coverage:ScheduleCoverage[];shortages:ScheduleCoverage[];required_count:number;assigned_count:number;new_employee_count_threshold:number|null;notes:string[]};
  warnings:{code:string;work_date:string;shift_id:string;department_id:string}[];
  edit_target?:{id:string;version:number}|null;
  persistence:{enabled:boolean;reason:string};
}

export interface RegistrationSummaryWarning { code: string; message: string }
export interface RegistrationSummaryRow {
  branch_id: string; period_id: string; work_date: string;
  shift_id: string; shift_name: string; start_time: string | null; end_time: string | null;
  department_id: string; department_name: string;
  registered_count: number; eligible_count: number | null; confirmed_eligible_count: number;
  required_count: number | null; balance: number | null; shortage_count: number | null; surplus_count: number | null;
  status: 'UNKNOWN' | 'SHORTAGE' | 'SURPLUS' | 'BALANCED';
  required_skill_name: string | null; exclusions: Record<string, number>;
  other_department_registered_count: number; warnings: RegistrationSummaryWarning[];
}
export interface RegistrationSummary {
  source: 'mock' | 'supabase'; is_mock: boolean; branch: { id: string; name: string };
  period: Omit<SchedulingPeriod, 'schedules'>; new_employee_count_threshold: number | null;
  rows: RegistrationSummaryRow[]; warnings: RegistrationSummaryWarning[]; notes: string[];
}

export interface DemandInput {
  work_date: string; shift_id: string; department_id: string; required_count: number;
  required_skill_name: string | null; sales_forecast_ref: string | null; expected_updated_at: string | null;
}
export interface DemandRequirement extends StaffingRequirement {
  sales_forecast_ref: string | null; updated_at: string; created_by: string;
}
export interface DemandContext {
  source: 'mock' | 'supabase'; is_mock: boolean; branch: {id:string;name:string}; period: Omit<SchedulingPeriod,'schedules'>;
  shifts: {id:string;name:string;start_time:string;end_time:string;is_active:boolean}[];
  departments: {id:string;name:string}[]; requirements: DemandRequirement[]; skill_names: string[];
  forecast_mode: 'REFERENCE_ONLY'; staffing_formula_status: 'NOT_CONFIGURED'; summary: RegistrationSummary;
}

export interface ScheduleValidation {
  schedule_id:string;version:number;scope:'DECLARED_REQUIREMENTS_AND_VALID_REGISTRATIONS';
  hard_constraints:'PASS'|'FAIL'|'UNKNOWN';data_complete:boolean;coverage_complete:boolean;input_current:boolean;can_submit:boolean;
  issues:{code:string;message:string}[];warnings:{code:string;message:string}[];coverage:ScheduleCoverage[];checked_at:string;input_revision:string;
}
export interface ApprovalHandoff {
  validation:ScheduleValidation;payload:Record<string,unknown>|null;current_status:string;target_status:'PENDING_APPROVAL';
  delivery:{configured:boolean;sent:boolean;message:string};
}

export interface AIProposalAssignment {employee_code:string;work_date:string;shift_code:string;department_code:string}
export interface AIEvaluation {
  contract_version:'tv3-ai.v1';schedule_id:string;version:number;input_revision:string;created_at:string;
  report:{conclusion:'SUITABLE'|'NEEDS_ADJUSTMENT'|'INSUFFICIENT_DATA';good_points:string[];concerns:string[];limitations:string[];
    suggestions:{description:string;reason:string;candidate_assignments:AIProposalAssignment[]|null;rule_check:{status:'PASS'|'REJECTED'|'NOT_APPLICABLE';code:string|null;message:string}}[]};
  employee_aliases:{code:string;employee_id:string}[];labels:{code:string;label:string}[];missing_criteria:string[];
}
export interface AIReviewResponse {
  status:'NOT_CONFIGURED'|'NOT_EVALUATED'|'AVAILABLE'|'STALE'|'BLOCKED'|'FAILED';message:string;
  schedule_id:string;version:number;configured:boolean;model:string|null;evaluation:AIEvaluation|null;
  rule_check:{hard_constraints:string;codes:string[]};
}
export type PreviewAIEvaluation=Omit<AIEvaluation,'schedule_id'|'version'>&{scope:'preview'};
export interface PreviewAIReviewResponse {
  scope:'preview';persisted:false;input_revision:string;plan_revision:string;
  status:'NOT_CONFIGURED'|'AVAILABLE';message:string;configured:boolean;model:string|null;
  evaluation:PreviewAIEvaluation|null;
}
export interface PreviewAIConfiguration {configured:boolean;model:string|null;message:string}

export interface AdjustmentIntent {
 analysis_token?:string|null;
 scope:'preview';persisted:false;input_revision:string;plan_revision:string;
 status:'READY'|'NEEDS_CLARIFICATION'|'UNSUPPORTED';objectives:string[];employee_codes:string[];
 priority:'HIGH'|'NORMAL'|'LOW';limits:{kind:'AVOID_DATE'|'PREFER_DATE'|'MAX_WEEKLY_HOURS';employee_code:string|null;date:string|null;value:number|null}[];
 preference_strength:'SOFT_PREFERENCE';business_rules_overridable:false;feasibility:'NOT_SOLVED';message:string;employees:{code:string;employee_id:string}[];
}

export interface AdjustmentProposal {
 proposal_token?:string;expires_at?:string;
 scope:'adjustment-proposal';persisted:false;applied:false;input_revision:string;base_plan_revision:string;
 result:SchedulePreview['result'];changes:{added:ScheduleAssignment[];removed:ScheduleAssignment[]};
 satisfaction:{criterion:string;target:string;before:number;after:number;status:string;reason:string}[];
 blocking_reasons:{code:string;message:string;attempts:number}[];coverage_preserved:boolean;unchanged:boolean;search:{attempts:number;bounded:boolean;optimality_guaranteed:false};limitations:string[];
}

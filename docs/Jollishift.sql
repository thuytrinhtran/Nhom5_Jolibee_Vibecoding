BEGIN;

-- (1) BRANCHES: tao truoc USERS de xu ly vong FK branch <-> user
CREATE TABLE public.branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(150) NOT NULL UNIQUE,
  address text,
  supervisor_id uuid,                        -- FK them sau khi tao users
  status varchar(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE'))
);

-- (2) USERS: thong tin nghiep vu; auth.users xu ly mat khau
CREATE TABLE public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username varchar(100) NOT NULL UNIQUE,
  role varchar(30) NOT NULL CHECK (role IN ('NV', 'QL', 'GS')),
  branch_id uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_username_not_blank CHECK (length(btrim(username)) > 0)
);

ALTER TABLE public.branches
  ADD CONSTRAINT branches_supervisor_id_fkey
  FOREIGN KEY (supervisor_id) REFERENCES public.users(id) ON DELETE SET NULL;

-- (3) DEPARTMENTS
CREATE TABLE public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL UNIQUE,
  description text,
  CONSTRAINT departments_name_not_blank CHECK (length(btrim(name)) > 0)
);

-- (4) EMPLOYEES: 4 cap do, tach khoi role dang nhap
CREATE TABLE public.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES public.users(id),
  full_name varchar(150) NOT NULL,
  phone varchar(20),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  department_id uuid NOT NULL REFERENCES public.departments(id),
  skill_level varchar(25) NOT NULL
    CHECK (skill_level IN ('NEW', 'REGULAR', 'CREW_TRAINING', 'CREW_LEADER')),
  experience_level varchar(30),
  max_weekly_hours numeric(5,2)
    CHECK (max_weekly_hours IS NULL OR max_weekly_hours > 0),
  status varchar(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT employees_full_name_not_blank CHECK (length(btrim(full_name)) > 0),
  CONSTRAINT employees_id_department_unique UNIQUE (id, department_id)
);

-- (5) EMPLOYEE_SKILLS
CREATE TABLE public.employee_skills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  skill_name varchar(100) NOT NULL,
  proficiency_level varchar(30) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_skills_unique UNIQUE (employee_id, skill_name),
  CONSTRAINT employee_skills_name_not_blank CHECK (length(btrim(skill_name)) > 0)
);

-- (6) SHIFTS: khong mac dinh so gio/khung ca chua duoc xac nhan
CREATE TABLE public.shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(80) NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  branch_id uuid REFERENCES public.branches(id),   -- NULL: mau ca dung chung
  is_active boolean NOT NULL DEFAULT true,
  CONSTRAINT shifts_times_differ CHECK (start_time <> end_time)
);
-- (7) REGISTRATION_PERIODS: 1 dot / chi nhanh / tuan lam
CREATE TABLE public.registration_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  work_start_date date NOT NULL,
  work_end_date date NOT NULL,
  open_at timestamptz NOT NULL,
  close_at timestamptz NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'PLANNED'
    CHECK (status IN ('PLANNED', 'OPEN', 'CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT registration_periods_week CHECK
    (EXTRACT(ISODOW FROM work_start_date) = 1
      AND work_end_date = work_start_date + 6),
  CONSTRAINT registration_periods_range CHECK (open_at < close_at),
  CONSTRAINT registration_periods_unique UNIQUE (branch_id, work_start_date)
);

-- (8) SHIFT_REGISTRATIONS: moi dong la 1 nguyen vong ngay + ca
CREATE TABLE public.shift_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id uuid NOT NULL REFERENCES public.registration_periods(id),
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  work_date date NOT NULL,
  shift_id uuid NOT NULL REFERENCES public.shifts(id),
  status varchar(25) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'VALID', 'INVALID')),
  submitted_at timestamptz,
  updated_at timestamptz,
  CONSTRAINT shift_registrations_unique
    UNIQUE (period_id, employee_id, work_date, shift_id)
);

-- (9) STAFFING_REQUIREMENTS: so nguoi CAN khong gom Crew Leader
CREATE TABLE public.staffing_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  department_id uuid NOT NULL REFERENCES public.departments(id),
  shift_id uuid NOT NULL REFERENCES public.shifts(id),
  work_date date NOT NULL,
  required_count integer NOT NULL CHECK (required_count >= 0),
  excludes_crew_leader boolean NOT NULL DEFAULT true
    CHECK (excludes_crew_leader = true),
  required_skill_name varchar(100),            -- bo sung ky thuat de so khop ky nang
  sales_forecast_ref text,
  created_by uuid NOT NULL REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staffing_requirements_unique
    UNIQUE (branch_id, department_id, shift_id, work_date)
);

-- (10) SCHEDULES: moi dong la 1 phien ban, khong ghi de phien ban cu
CREATE TABLE public.schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_group_id uuid NOT NULL DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.branches(id),
  period_id uuid NOT NULL REFERENCES public.registration_periods(id),
  version integer NOT NULL CHECK (version > 0),
  status varchar(25) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'NEEDS_REVISION',
                     'APPROVED', 'PUBLISHED')),
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  feedback_deadline_at timestamptz,
  CONSTRAINT schedules_group_version_unique UNIQUE (schedule_group_id, version),
  CONSTRAINT schedules_publication_times CHECK (
    (status <> 'PUBLISHED') OR
    (published_at IS NOT NULL AND feedback_deadline_at IS NOT NULL
      AND feedback_deadline_at >= published_at)
  )
);

-- (11) BRANCH_SUPPORT_REQUESTS tao truoc SHIFT_ASSIGNMENTS de tao FK
-- Day la bang 16 theo danh muc thiet ke; vi phu thuoc FK nen dat som hon.
CREATE TABLE public.branch_support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requesting_branch_id uuid NOT NULL REFERENCES public.branches(id),
  target_branch_id uuid REFERENCES public.branches(id),
  department_id uuid NOT NULL REFERENCES public.departments(id),
  shift_id uuid NOT NULL REFERENCES public.shifts(id),
  work_date date NOT NULL,
  required_count integer NOT NULL CHECK (required_count > 0),
  created_by uuid NOT NULL REFERENCES public.users(id),
  status varchar(25) NOT NULL DEFAULT 'NEW'
    CHECK (status IN ('NEW', 'SENT', 'RESULT_RECORDED', 'UNAVAILABLE')),
  result_notes text,
  CONSTRAINT branch_support_different_branch CHECK
    (target_branch_id IS NULL OR requesting_branch_id <> target_branch_id)
);

-- (12) SHIFT_ASSIGNMENTS: bo phan khop NV qua composite FK
CREATE TABLE public.shift_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.schedules(id),
  employee_id uuid NOT NULL,
  work_date date NOT NULL,
  shift_id uuid NOT NULL REFERENCES public.shifts(id),
  department_id uuid NOT NULL REFERENCES public.departments(id),
  actual_branch_id uuid NOT NULL REFERENCES public.branches(id),
  status varchar(25) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'ACTIVE', 'REPLACED')),
  assignment_source varchar(25) NOT NULL DEFAULT 'REGULAR'
    CHECK (assignment_source IN ('REGULAR', 'CREW_LEADER', 'SUPPORT')),
  branch_support_request_id uuid REFERENCES public.branch_support_requests(id),
  CONSTRAINT shift_assignments_employee_department_fkey
    FOREIGN KEY (employee_id, department_id)
    REFERENCES public.employees(id, department_id),
  CONSTRAINT shift_assignments_unique
    UNIQUE (schedule_id, employee_id, work_date, shift_id),
  CONSTRAINT support_assignment_has_request CHECK
    (assignment_source <> 'SUPPORT' OR branch_support_request_id IS NOT NULL)
);

CREATE TABLE public.shift_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_assignment_id uuid NOT NULL REFERENCES public.shift_assignments(id),
  requesting_employee_id uuid NOT NULL REFERENCES public.employees(id),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  status varchar(25) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'SEARCHING', 'APPROVED', 'REJECTED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES public.users(id),
  resolved_at timestamptz,
  replacement_employee_id uuid REFERENCES public.employees(id)
);
CREATE TABLE IF NOT EXISTS public.schedule_approvals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    schedule_id uuid NOT NULL
        REFERENCES public.schedules(id),

    supervisor_id uuid NOT NULL
        REFERENCES public.users(id),

    decision varchar(25) NOT NULL
        CHECK (decision IN ('APPROVED', 'NEEDS_REVISION')),

    reason text,

    decided_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT schedule_approvals_reason_required
        CHECK (
            decision <> 'NEEDS_REVISION'
            OR length(btrim(coalesce(reason, ''))) > 0
        )
);

CREATE INDEX IF NOT EXISTS idx_schedule_approvals_schedule
ON public.schedule_approvals(schedule_id, decided_at);
-- (15) INCIDENTS: su co phat sinh den ngay lam; tach khoi cua so 30 phut
CREATE TABLE public.incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_assignment_id uuid NOT NULL REFERENCES public.shift_assignments(id),
  reporting_employee_id uuid NOT NULL REFERENCES public.employees(id),
  description text NOT NULL CHECK (length(btrim(description)) > 0),
  status varchar(25) NOT NULL DEFAULT 'REPORTED'
    CHECK (status IN ('REPORTED', 'IN_PROGRESS', 'RESOLVED', 'UNRESOLVED')),
  declared_substitute_id uuid REFERENCES public.employees(id),
  reported_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

-- (16) REPLACEMENT_INVITATIONS: dung 1 trong 2 nguon (XOR)
CREATE TABLE public.replacement_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_change_request_id uuid REFERENCES public.shift_change_requests(id),
  incident_id uuid REFERENCES public.incidents(id),
  target_employee_id uuid NOT NULL REFERENCES public.employees(id),
  status varchar(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  responded_at timestamptz,
  valid_when_confirmed boolean,
  CONSTRAINT replacement_invitation_exactly_one_source CHECK
    (num_nonnulls(shift_change_request_id, incident_id) = 1),
  CONSTRAINT replacement_invitation_expiry CHECK (expires_at > sent_at)
);

-- (17) NOTIFICATIONS
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES public.users(id),
  type varchar(50) NOT NULL,
  title varchar(200) NOT NULL,
  content text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  idempotency_key varchar(120) UNIQUE
);

-- (18) AUDIT_LOGS: bat bien o cap bang, ghi nguon thao tac
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.users(id),    -- NULL = thao tac he thong
  entity_type varchar(80) NOT NULL,
  entity_id uuid NOT NULL,
  action varchar(40) NOT NULL,
  old_data jsonb,
  new_data jsonb,
  change_source varchar(20) NOT NULL DEFAULT 'MANUAL'
    CHECK (change_source IN ('MANUAL', 'AI_APPLIED', 'SYSTEM')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 4 BANG BO TRO PHU LUC VIBECODE (khong thuoc 18 bang goc)
-- ============================================================================

-- (19) WARNING_CONFIGS: nguong 'nhieu NEW' nullable, KHONG tu dat so
CREATE TABLE public.warning_configs (
  branch_id uuid PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
  new_employee_count_threshold integer
    CHECK (new_employee_count_threshold IS NULL
           OR new_employee_count_threshold > 0),
  updated_by uuid REFERENCES public.users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- (20) CREW_LEADER_DAYS_OFF: quan ly NHAP ngay nghi, khong tu sinh
CREATE TABLE public.crew_leader_days_off (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(id),
  day_off date NOT NULL,
  note text,
  created_by uuid NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crew_leader_days_off_unique UNIQUE (employee_id, day_off)
);

-- (21) AI_SCHEDULE_EVALUATIONS: phan biet thanh cong/that bai khi AI khong kha dung
CREATE TABLE public.ai_schedule_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.schedules(id),
  status varchar(15) NOT NULL
    CHECK (status IN ('SUCCESS', 'FAILED')),
  evaluation jsonb,
  error_message text,
  model_name varchar(100),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_evaluations_has_result_or_error CHECK
    ((status = 'SUCCESS' AND evaluation IS NOT NULL)
      OR (status = 'FAILED' AND error_message IS NOT NULL))
);

-- (22) AI_SCHEDULE_SUGGESTIONS: chi luu de xuat, KHONG tu ap dung
CREATE TABLE public.ai_schedule_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.schedules(id),
  evaluation_id uuid REFERENCES public.ai_schedule_evaluations(id),
  changes jsonb NOT NULL CHECK (jsonb_typeof(changes) = 'array'),
  explanation text,
  status varchar(20) NOT NULL DEFAULT 'PROPOSED'
    CHECK (status IN ('PROPOSED', 'SELECTED', 'REJECTED')),
  selected_by uuid REFERENCES public.users(id),
  selected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION public.validate_shift_registration() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  emp_level varchar(25);
  emp_branch uuid;
  period_branch uuid;
  start_day date;
  end_day date;
BEGIN
  SELECT e.skill_level, e.branch_id
    INTO emp_level, emp_branch
    FROM public.employees e WHERE e.id = NEW.employee_id;
  SELECT rp.branch_id, rp.work_start_date, rp.work_end_date
    INTO period_branch, start_day, end_day
    FROM public.registration_periods rp WHERE rp.id = NEW.period_id;

  IF emp_level = 'CREW_LEADER' THEN
    RAISE EXCEPTION 'Crew Leader khong tham gia dang ky nguyen vong';
  END IF;
  IF NEW.work_date < start_day OR NEW.work_date > end_day THEN
    RAISE EXCEPTION 'Ngay dang ky ngoai tuan lam viec cua dot';
  END IF;
  IF emp_branch IS DISTINCT FROM period_branch THEN
    RAISE EXCEPTION 'Nhan vien khong thuoc chi nhanh cua dot dang ky';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_shift_registration
  BEFORE INSERT OR UPDATE OF period_id, employee_id, work_date
  ON public.shift_registrations
  FOR EACH ROW EXECUTE FUNCTION public.validate_shift_registration();

-- Khong cho gan nguon CREW_LEADER cho nhan vien thuong va nguoc lai.
CREATE FUNCTION public.validate_assignment_source() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE emp_level varchar(25);
BEGIN
  SELECT skill_level INTO emp_level FROM public.employees WHERE id = NEW.employee_id;
  IF NEW.assignment_source = 'CREW_LEADER' AND emp_level <> 'CREW_LEADER' THEN
    RAISE EXCEPTION 'Nguon CREW_LEADER chi danh cho nhan vien cap Crew Leader';
  END IF;
  IF NEW.assignment_source <> 'CREW_LEADER' AND emp_level = 'CREW_LEADER' THEN
    RAISE EXCEPTION 'Phan cong Crew Leader phai co assignment_source=CREW_LEADER';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_assignment_source
  BEFORE INSERT OR UPDATE OF employee_id, assignment_source
  ON public.shift_assignments
  FOR EACH ROW EXECUTE FUNCTION public.validate_assignment_source();

CREATE FUNCTION public.validate_crew_leader_day_off() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE emp_level varchar(25);
BEGIN
  SELECT skill_level INTO emp_level FROM public.employees WHERE id = NEW.employee_id;
  IF emp_level IS DISTINCT FROM 'CREW_LEADER' THEN
    RAISE EXCEPTION 'Chi Crew Leader moi co ngay nghi trong bang nay';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_crew_leader_day_off
  BEFORE INSERT OR UPDATE OF employee_id
  ON public.crew_leader_days_off
  FOR EACH ROW EXECUTE FUNCTION public.validate_crew_leader_day_off();


  CREATE FUNCTION public.validate_schedule_approval() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_branch_id uuid;
  v_status varchar(25);
BEGIN
  SELECT s.branch_id, s.status INTO v_branch_id, v_status
  FROM public.schedules s WHERE s.id = NEW.schedule_id;

  IF v_status IS DISTINCT FROM 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION 'Chi phe duyet phien ban dang cho duyet';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.branches b
    JOIN public.users u ON u.id = b.supervisor_id
    WHERE b.id = v_branch_id
      AND u.id = NEW.supervisor_id
      AND u.role = 'GS' AND u.is_active
  ) THEN
    RAISE EXCEPTION 'GS khong co quyen phe duyet chi nhanh nay';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_schedule_approval
  BEFORE INSERT OR UPDATE OF schedule_id, supervisor_id, decision
  ON public.schedule_approvals
  FOR EACH ROW EXECUTE FUNCTION public.validate_schedule_approval();

CREATE FUNCTION public.validate_schedule_publish() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE last_decision varchar(25);
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND
    NEW.status IN ('APPROVED', 'PUBLISHED') THEN

    SELECT a.decision INTO last_decision
    FROM public.schedule_approvals a
    WHERE a.schedule_id = NEW.id
    ORDER BY a.decided_at DESC, a.id DESC
    LIMIT 1;

    IF last_decision IS DISTINCT FROM 'APPROVED' THEN
      RAISE EXCEPTION 'Phien ban lich chua duoc GS phe duyet hop le';
    END IF;
    IF NEW.status = 'PUBLISHED' AND OLD.status <> 'APPROVED' THEN
      RAISE EXCEPTION 'Phai chuyen APPROVED truoc khi cong bo PUBLISHED';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_validate_schedule_publish
  BEFORE UPDATE OF status ON public.schedules
  FOR EACH ROW EXECUTE FUNCTION public.validate_schedule_publish();

CREATE FUNCTION public.prevent_direct_published_schedule() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status IN ('APPROVED', 'PUBLISHED') THEN
    RAISE EXCEPTION 'Khong duoc tao truc tiep lich da duyet/da cong bo';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prevent_direct_published_schedule
  BEFORE INSERT ON public.schedules
  FOR EACH ROW EXECUTE FUNCTION public.prevent_direct_published_schedule();

CREATE FUNCTION public.prevent_audit_log_changes() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Audit log la bat bien: khong duoc UPDATE/DELETE';
END;
$$;
CREATE TRIGGER trg_prevent_audit_log_changes
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_changes();


CREATE INDEX idx_users_branch_role ON public.users(branch_id, role);
CREATE INDEX idx_branches_supervisor ON public.branches(supervisor_id);
CREATE INDEX idx_employees_branch_department ON public.employees(branch_id, department_id);
CREATE INDEX idx_employees_skill_level ON public.employees(skill_level);
CREATE INDEX idx_employee_skills_employee ON public.employee_skills(employee_id);
CREATE INDEX idx_shifts_branch ON public.shifts(branch_id);
CREATE INDEX idx_registration_periods_status ON public.registration_periods(branch_id, status);
CREATE INDEX idx_shift_registrations_period_status ON public.shift_registrations(period_id, status);
CREATE INDEX idx_shift_registrations_employee ON public.shift_registrations(employee_id, work_date);
CREATE INDEX idx_staffing_requirements_date ON public.staffing_requirements(branch_id, work_date, shift_id);
CREATE INDEX idx_schedules_branch_period ON public.schedules(branch_id, period_id, status);
CREATE INDEX idx_shift_assignments_schedule ON public.shift_assignments(schedule_id);
CREATE INDEX idx_shift_assignments_employee_date ON public.shift_assignments(employee_id, work_date);
CREATE INDEX idx_schedule_approvals_schedule ON public.schedule_approvals(schedule_id, decided_at);
CREATE INDEX idx_shift_change_requests_status ON public.shift_change_requests(status, created_at);
CREATE INDEX idx_shift_change_requests_assignment ON public.shift_change_requests(original_assignment_id);
CREATE INDEX idx_incidents_assignment ON public.incidents(original_assignment_id);
CREATE INDEX idx_invitations_change_request ON public.replacement_invitations(shift_change_request_id);
CREATE INDEX idx_invitations_incident ON public.replacement_invitations(incident_id);
CREATE INDEX idx_invitations_target ON public.replacement_invitations(target_employee_id, status);
CREATE INDEX idx_branch_support_requested ON public.branch_support_requests(requesting_branch_id, work_date);
CREATE INDEX idx_notifications_recipient ON public.notifications(recipient_id, status);
CREATE INDEX idx_audit_logs_entity ON public.audit_logs(entity_type, entity_id, created_at);
CREATE INDEX idx_crew_leader_day_off_employee ON public.crew_leader_days_off(employee_id, day_off);
CREATE INDEX idx_ai_evaluations_schedule ON public.ai_schedule_evaluations(schedule_id, created_at);
CREATE INDEX idx_ai_suggestions_schedule ON public.ai_schedule_suggestions(schedule_id, status);


DO $$
DECLARE tablename text;
BEGIN
  FOREACH tablename IN ARRAY ARRAY[
    'branches', 'users', 'departments', 'employees', 'employee_skills',
    'shifts', 'registration_periods', 'shift_registrations',
    'staffing_requirements', 'schedules', 'shift_assignments',
    'schedule_approvals', 'shift_change_requests', 'replacement_invitations',
    'incidents', 'branch_support_requests', 'notifications', 'audit_logs',
    'warning_configs', 'crew_leader_days_off',
    'ai_schedule_evaluations', 'ai_schedule_suggestions'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tablename);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', tablename);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', tablename);
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_shift_registration() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_assignment_source() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_crew_leader_day_off() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_schedule_approval() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_schedule_publish() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_direct_published_schedule() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_audit_log_changes() FROM PUBLIC, anon, authenticated;

COMMIT;

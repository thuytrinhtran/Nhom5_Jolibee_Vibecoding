-- READ ONLY. Before execution this should report FAIL: no data has been seeded yet.
-- Sample scope = employees of the TWO exact branch names below, including existing rows.
WITH scope AS (
  SELECT e.*, b.name AS branch_name, d.name AS department_name
  FROM public.employees e
  JOIN public.branches b ON b.id = e.branch_id
  JOIN public.departments d ON d.id = e.department_id
  WHERE b.name IN ('Jollibee Lê Duẩn', 'Chi nhánh mô phỏng Hải Châu')
), expected_departments(branch_name,department_name,expected) AS (
  VALUES ('Jollibee Lê Duẩn','Bếp',25), ('Jollibee Lê Duẩn','Phục vụ',20),
         ('Jollibee Lê Duẩn','Thu ngân',15), ('Chi nhánh mô phỏng Hải Châu','Bếp',4),
         ('Chi nhánh mô phỏng Hải Châu','Phục vụ',3), ('Chi nhánh mô phỏng Hải Châu','Thu ngân',3)
), expected_skills(branch_name,skill_level,expected) AS (
  VALUES ('Jollibee Lê Duẩn','NEW',8), ('Jollibee Lê Duẩn','REGULAR',36),
         ('Jollibee Lê Duẩn','CREW_TRAINING',10), ('Jollibee Lê Duẩn','CREW_LEADER',6),
         ('Chi nhánh mô phỏng Hải Châu','NEW',2), ('Chi nhánh mô phỏng Hải Châu','REGULAR',6),
         ('Chi nhánh mô phỏng Hải Châu','CREW_TRAINING',1), ('Chi nhánh mô phỏng Hải Châu','CREW_LEADER',1)
), checks AS (
  SELECT 'Tổng nhân viên Lê Duẩn' AS check_name, 60::bigint AS expected,
         count(*) AS actual FROM scope WHERE branch_name='Jollibee Lê Duẩn'
  UNION ALL SELECT 'Tổng nhân viên Hải Châu',10,count(*) FROM scope WHERE branch_name='Chi nhánh mô phỏng Hải Châu'
  UNION ALL SELECT 'Tổng nhân viên dữ liệu mẫu',70,count(*) FROM scope
  UNION ALL SELECT x.branch_name || ' / ' || x.department_name, x.expected,
    (SELECT count(*) FROM scope s WHERE s.branch_name=x.branch_name AND s.department_name=x.department_name)
    FROM expected_departments x
  UNION ALL SELECT x.branch_name || ' / ' || x.skill_level, x.expected,
    (SELECT count(*) FROM scope s WHERE s.branch_name=x.branch_name AND s.skill_level=x.skill_level)
    FROM expected_skills x
  UNION ALL SELECT 'Mã nhân viên/username duy nhất',70,count(DISTINCT u.username)
    FROM scope s JOIN public.users u ON u.id=s.user_id
  UNION ALL SELECT 'Hồ sơ và Auth hợp lệ',70,count(*)
    FROM scope s JOIN public.users u ON u.id=s.user_id JOIN auth.users a ON a.id=u.id
    WHERE u.role='NV' AND u.branch_id=s.branch_id AND u.is_active
      AND s.status IN ('ACTIVE','INACTIVE')
      AND s.skill_level IN ('NEW','REGULAR','CREW_TRAINING','CREW_LEADER')
      AND length(btrim(s.full_name))>0 AND length(btrim(u.username))>0
)
SELECT check_name, expected, actual,
       CASE WHEN actual=expected THEN 'PASS' ELSE 'FAIL' END AS result
FROM checks ORDER BY check_name;

-- Separate employee count from login-account count (QL/GS are not automatically employees).
SELECT count(*) AS all_employee_rows_in_database FROM public.employees;

-- Explicit roster, without exposing Auth emails, password hashes, tokens or keys.
SELECT u.username AS employee_code, e.full_name, b.name AS branch,
       d.name AS department, e.skill_level, e.status
FROM public.employees e
JOIN public.users u ON u.id=e.user_id
JOIN public.branches b ON b.id=e.branch_id
JOIN public.departments d ON d.id=e.department_id
WHERE b.name IN ('Jollibee Lê Duẩn', 'Chi nhánh mô phỏng Hải Châu')
ORDER BY b.name,d.name,u.username;

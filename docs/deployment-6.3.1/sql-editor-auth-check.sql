-- READ ONLY. Target Dashboard project wlbpprpiieonjrqglicv. No password/email/token exported.
WITH planned(id,username) AS (VALUES
('ca7df3c3-6626-4263-8486-b40b783dc03f'::uuid,'tv3_test_ld_bep_1'),
('f071838d-8a02-4bc4-85f0-d8db520edb33'::uuid,'tv3_test_ld_bep_2'),
('48a53fa7-a749-48bc-8afe-94e5d462bec2'::uuid,'tv3_test_ld_bep_3'),
('b8ca0646-33ca-4a18-87d2-131ca14f4434'::uuid,'tv3_test_ld_bep_4'),
('bc729aa0-dac5-4333-8d31-4668776226f8'::uuid,'tv3_test_ld_bep_5'),
('314545a6-bf6a-4cfd-89e1-aa7acf3d34f0'::uuid,'tv3_test_ld_bep_6'),
('4aeab042-7467-42ea-8556-ca245dd6a7e3'::uuid,'tv3_test_ld_pv_1'),
('563b8cc8-f2b5-4217-835f-70a476eb21d5'::uuid,'tv3_test_ld_pv_2'),
('129c84a7-9e46-47cd-8392-da3c9df7a862'::uuid,'tv3_test_ld_pv_3'),
('19346c89-4d56-405a-8bd0-1a411e935bbb'::uuid,'tv3_test_ld_pv_4'),
('576374dd-0857-4f0c-8612-7f91c987f0c2'::uuid,'tv3_test_ld_pv_5'),
('0a17c374-34f4-492c-8655-3c1e0f0fd724'::uuid,'tv3_test_ld_pv_6'),
('bad58911-4003-44e0-8332-8f4ffb9104b0'::uuid,'tv3_test_ld_tn_1'),
('6b34425e-224d-4403-80af-728cb7f15de2'::uuid,'tv3_test_ld_tn_2'),
('49a61669-f3a1-4399-818c-4c515ca90b13'::uuid,'tv3_test_ld_tn_3'),
('7de5ad27-e3d7-4f35-8c2f-906f85a7ea11'::uuid,'tv3_test_ld_tn_4'),
('9de42104-0a53-4864-8d24-683ee19c3057'::uuid,'tv3_test_ld_tn_5')
)
SELECT p.id planned_id,p.username planned_username,u.id profile_id,u.role,u.branch_id,u.is_active,u.must_change_password,
 EXISTS(SELECT 1 FROM auth.users a WHERE a.id=p.id) auth_id_exists,
 (SELECT count(*) FROM public.employees e WHERE e.user_id=u.id) employee_bindings
FROM planned p LEFT JOIN public.users u ON u.id=p.id OR lower(u.username)=lower(p.username) ORDER BY p.id,u.id;

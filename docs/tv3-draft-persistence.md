# TV3 – Triển khai lưu lịch dự kiến

## Nguyên nhân và phạm vi

Backend đã gọi `generate_schedule_draft(uuid,uuid,jsonb,jsonb)` nhưng trước đợt này repository thiếu migration định nghĩa; OpenAPI project thật không công bố RPC. Đây là bằng chứng RPC không khả dụng ở tầng API, chưa chứng minh tuyệt đối function không tồn tại ở schema khác/cache/quyền khác. Phải đọc catalog trước khi áp dụng.

Migration cần duyệt: `backend/migrations/20261031_tv3_schedule_draft.sql`. Không thay bảng, không seed/backfill, không đổi kỳ, lịch hoặc trạng thái phê duyệt. Chỉ tạo helper snapshot, RPC và quyền EXECUTE. Không chạy khi ứng dụng khởi động.

Thuật toán TypeScript hiện có được giữ nguyên. RPC lượt đầu trả snapshot; Backend chạy engine; lượt sau so snapshot và ghi schedules + shift_assignments + audit_logs nguyên tử. Bản đầu có version=1, group UUID mới và trạng thái DRAFT, actual_branch_id đúng branch của kỳ. Không tạo lại khi đã có lịch thủ công, nhiều phiên bản hoặc lịch đã gửi/duyệt/công bố. Replay chỉ trả đúng lịch AUTO_GENERATE chưa bị sửa, có audit của RPC này. Không ghi đè lịch cũ.

Nguồn TV2 cần submission VALID có submitted_at và không phải sample qua registration_submissions_sourced; ngày không đăng ký không được phân công. Kỳ phải CLOSED theo timestamp hiệu lực, không theo cột status cache. QL phải active, đã đổi mật khẩu và đúng branch; RPC kiểm tra lại dù dùng service-role. Frontend không có EXECUTE. Helper không cho service-role gọi trực tiếp; owner postgres gọi nội bộ.

## Trước triển khai – chỉ SELECT

Chạy ở đúng project SQL Editor:

```sql
SELECT current_database(), current_user;
SELECT p.oid::regprocedure, pg_get_userbyid(p.proowner), p.proacl,
       pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN ('generate_schedule_draft','tv3_scheduling_input');
SELECT to_regclass('public.registration_submissions_sourced');
SELECT table_name,column_name,udt_name
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name IN ('schedules','shift_assignments','audit_logs','staffing_requirements');
```

Yêu cầu foundation, Auth gate và migration TV2 effective-state đã tương thích. Đối chiếu PK/FK/CHECK/trigger/GRANT bằng `docs/inspect-integration-schema.sql`. Function snapshot cần employees, users, employee_skills, shifts, periods, submission view, registrations, staffing_requirements, warning_configs và assignments.

Nếu function đã có: **dừng để đối chiếu**. Migration dùng CREATE, không OR REPLACE để không âm thầm thay implementation đã có. Nếu thiếu cột/view/constraint thì lập đề xuất riêng; không chạy lại schema nền, không xóa bảng. Nên chạy migration trên Dev trước, sau đó mới được duyệt cho project dùng chung. Không dùng Supabase CLI tự áp cả thư mục migrations có các tiền tố cũ trùng ngày.

## Áp dụng sau khi được duyệt

Trong SQL Editor role postgres, chạy nguyên file `20261031_tv3_schedule_draft.sql` một lần. File chứa transaction, tạo function và NOTIFY PostgREST reload schema. Nếu lỗi, dừng, rollback phiên bị aborted khi cần và kiểm tra; không bỏ guard. Không cần đổi key hay cấp quyền bảng cho Frontend.

RPC chỉ khóa bảng nguồn/lịch/audit bằng SHARE ROW EXCLUSIVE ở **lượt lưu**, timeout chờ lock 5 giây. Lượt đọc snapshot dùng helper STABLE để các truy vấn bên trong cùng nhìn một snapshot PostgreSQL, không lấy các khóa bảng chặn ghi; thời gian chạy engine nằm ngoài transaction khóa. Đây là lựa chọn bảo thủ, vẫn có thể làm thao tác TV2/TV4 ở chi nhánh khác chờ khi lưu. Cần kiểm thử đồng thời trên Dev. Mọi writer tạo lịch khác phải dùng quy trình phối hợp; không bổ sung unique period toàn bảng vì schema còn hỗ trợ nhiều phiên bản.

Không thay toàn bộ khóa bằng advisory lock theo period lúc này: các writer TV2/TV4 hiện không cùng tuân thủ lock đó, nên nó không chặn cập nhật/phát sinh phantom ở registrations, nhu cầu hay lịch. Phương án tiếp theo cần được thiết kế chung: row lock cho period/employee với mọi writer tuân thủ hoặc transaction SERIALIZABLE qua endpoint/worker có retry 40001 và giới hạn unique phù hợp phiên bản. Không tự đổi isolation bên trong RPC đang chạy; không coi row lock đơn lẻ là đủ ngăn INSERT phantom.

## Ranh giới bảo mật sau review

- SECURITY DEFINER chạy bằng postgres để đọc view security_invoker và ghi bảng dù role gọi bị RLS giới hạn. search_path đã đặt pg_catalog trước public/pg_temp; mọi bảng và helper ứng dụng dùng schema rõ ràng.
- Chỉ service_role được EXECUTE RPC; helper bị thu hồi EXECUTE cho anon/authenticated/service_role. Test đã kiểm tra ACL và thực thi bị từ chối với authenticated. Owner postgres gọi helper nội bộ được.
- p_actor_id **không phải chứng cứ xác thực tự thân**. Backend xác minh JWT qua middleware rồi lấy req.user.id; field actor/branch client gửi không được dùng. RPC kiểm tra lại actor active/role/gate/branch. Ai có service-role key vẫn có thể truyền một QL khác: đây là giới hạn kiến trúc trusted Backend, không phải ràng buộc auth.uid end-user. Không đưa key ra Frontend và không cấp EXECUTE authenticated. Nếu yêu cầu ràng buộc actor trực tiếp với JWT end-user thì cần thiết kế RPC khác, không sửa nửa vời bằng auth.uid trên service-role JWT.
- RPC kiểm tra assignment, ca qua đêm, overlap, nhu cầu, đăng ký, kỹ năng và giới hạn giờ; tổng/coverage/shortages/statistics được tính lại từ phân công đã lưu, không tin chỉ số p_result. reason của engine chỉ là mô tả chẩn đoán có giới hạn độ dài, không phải bằng chứng ràng buộc.
- Một lịch thiếu người vẫn có thể lưu DRAFT. SQL xác minh tính hợp lệ/không vượt nhu cầu, không chứng minh engine tối ưu hoặc bắt buộc phủ hết nhu cầu. Không viết lại thuật toán trong SQL.
- Review sửa lỗi kiểm tra tuần kế tiếp không liên quan: chỉ xét tuần ca mới thực sự giao với khoảng tuần; ca tối Chủ nhật vẫn bị kiểm tra phần giờ sang thứ Hai. Test bao phủ ca liền kề, qua đêm từ Chủ nhật trước và giới hạn tuần sau.

Điều kiện triển khai: đủ cho bước review/triển khai **Dev có kiểm soát** sau khi duyệt migration. Chưa chứng nhận production đồng thời: cần PostgreSQL nhiều session, tải TV2/TV4 và catalog/ACL Supabase thật. Migration mới chưa áp dụng lên Supabase.

## Xác nhận sau áp dụng – chỉ SELECT

```sql
SELECT to_regprocedure('public.generate_schedule_draft(uuid,uuid,jsonb,jsonb)'),
       to_regprocedure('public.tv3_scheduling_input(uuid)');
SELECT r, has_function_privilege(r,
 'public.generate_schedule_draft(uuid,uuid,jsonb,jsonb)','EXECUTE') AS can_generate,
 has_function_privilege(r,'public.tv3_scheduling_input(uuid)','EXECUTE') AS can_read_snapshot
FROM (VALUES ('anon'),('authenticated'),('service_role')) roles(r);
```

Kỳ vọng chỉ service_role có can_generate, cả ba không có can_read_snapshot. Kiểm tra OpenAPI thấy đúng chữ ký RPC. Kiểm tra cron/TV2 không bị sửa; migration này không tạo job.

## Kiểm thử thật sau khi được phép ghi

1. Dùng Dev với QL đúng chi nhánh, dữ liệu TV2 hợp lệ và nhu cầu được duyệt. Kỳ đã đóng theo thời gian thật; không sửa kỳ dùng chung để vượt điều kiện.
2. Qua giao diện tạo lịch một lần; kiểm tra schedules DRAFT/version=1, đầy đủ assignments và một audit AUTO_GENERATE. API phải đọc lại dữ liệu trước khi báo hoàn tất.
3. Tải lại trang/restart Backend; so ID, phân công và coverage. POST lại phải reused=true, không tạo thêm bản.
4. Thử QL khác branch/NV/GS/chưa đổi mật khẩu; đều không ghi được. Dữ liệu đầu vào đổi giữa hai lượt phải 409 INPUT_CHANGED, không có bản dở dang.
5. Hai request cùng tuần, rollback khi FK/audit lỗi, sửa tay assignment, lịch thủ công hoặc lịch PENDING_APPROVAL phải không bị ghi đè. Các thao tác gây lỗi chỉ trên Dev.
6. Mở Quản lý lịch → Lịch phân công, chọn đúng tuần/version. Bản DRAFT không phải chính thức. Chuyển duyệt/chỉnh sửa/trình lại là phạm vi khác, migration này không hoàn thiện chúng.

Hải Châu tuần 02–08/11 hiện còn thiếu điều kiện theo lần audit trước (kỳ đang mở/chưa nhập nhu cầu); cần đọc lại thực tế trước khi test. Không coi 4 nguyện vọng là 4 phân công được bảo đảm.

## Test tự động

`backend/tests/tv3-persistence.test.cjs` dùng PostgreSQL/PGlite cô lập, schema + migrations, engine thật và adapter đọc lại. Opt-in bằng REGISTRATION_PGLITE_PATH; không dùng URL Supabase thật. Bao phủ rollback schedule/assignment/audit, nguồn nháp, quyền, gate đổi mật khẩu, kỳ mở, stale snapshot, retry và bảo vệ lịch đã sửa/gửi. Test PGlite không chứng minh hai session PostgreSQL cạnh tranh, triển khai PostgREST, restart cloud hoặc RLS JWT thật.

`backend/tests/scheduling.database.sql` là fixture transaction cho database Dev dùng một lần; tuyệt đối không chạy trên database dùng chung dù có ROLLBACK. Khi chưa có môi trường disposable, test psql phải SKIP.

# Kiểm tra bàn giao CSDL và JWT – TV1

Ngày 29/10/2026. Chỉ chuẩn bị tài liệu/SQL; chưa chạy SQL metadata hay test JWT thật trong nhiệm vụ này. Không migration, seed, reset mật khẩu hoặc thay đổi dữ liệu dùng chung.

## Chạy SQL chỉ đọc trong Supabase

1. Mở đúng project JolliShift → SQL Editor → New query; dùng phiên quản trị có quyền xem catalog.
2. Mở [inspect-integration-schema.sql](inspect-integration-schema.sql), xem lại nội dung rồi chạy **từng SELECT được đánh số**, tránh bỏ sót result set. File chỉ đọc catalog/information_schema; không gọi RPC nghiệp vụ, không SET ROLE, không DDL/DML.
3. Đối chiếu với `docs/Jollishift.sql` và `backend/migrations/20261029_require_password_change.sql`. Không chạy hai file định nghĩa/migration này để kiểm tra.
4. Lưu kết quả đã rà soát trong biên bản kiểm thử. Không chia sẻ key, JWT, mật khẩu hoặc toàn bộ function definition chưa kiểm tra nội dung. Nếu query bị từ chối quyền, đánh dấu BLOCKED; không cấp thêm quyền hoặc suy ra object không tồn tại.

Các nhóm kết quả cần kiểm tra:

- PK/FK: users.id → auth.users.id; branches.supervisor_id → users.id; employees.user_id → users.id; FK ghép assignment(employee_id,department_id) → employees(id,department_id); toàn bộ FK period/schedule/approval/request/support. Kiểm tra ON DELETE và constraint validated.
- UNIQUE: username, employees.user_id, branch/department name; period(branch_id,work_start_date), schedule(group,version), registration(period,employee,date,shift), assignment(schedule,employee,date,shift). Kiểm tra cả unique/partial index và index valid/ready. Không suy ra chống trùng ca chồng giờ chỉ từ khóa ngày/ca.
- CHECK: role/status/skill, giới hạn tuần/cửa sổ đăng ký, version >0, thời điểm công bố, nguồn SUPPORT, lý do trả chỉnh sửa, XOR nguồn lời mời. So sánh định nghĩa, không chỉ tên constraint.
- Trigger: validate_shift_registration, validate_assignment_source, validate_crew_leader_day_off, validate_schedule_approval, validate_schedule_publish, prevent_direct_published_schedule, prevent_audit_log_changes, guard_password_change_state. Kiểm tra enabled và function body; xem thêm trigger auth.users nếu có.
- RLS: bật trên bảng nghiệp vụ; policy theo command/role, USING và WITH CHECK; điều kiện chủ sở hữu/phạm vi và gate đổi mật khẩu. FORCE RLS=false không tự động là lỗi; phải xét owner và BYPASSRLS. Service-role không dùng để chứng minh quyền NV/QL/GS.
- GRANT: bảng, cột, schema, function EXECUTE/PUBLIC, default privileges. Đặc biệt RPC SECURITY DEFINER có thể vượt RLS: xem owner, search_path, quyền EXECUTE và body. Metadata không chứng minh kiểm tra nghiệp vụ trong transaction hoạt động.

## Kiểm thử JWT còn thiếu – thực hiện an toàn

Người kiểm thử tự đăng nhập tài khoản thật đã có bằng trình duyệt; không gửi mật khẩu/token qua chat. Dùng DevTools Network xem các request ứng dụng tạo, không xuất HAR, không Copy as cURL có Authorization, không dán JWT vào SQL Editor, URL hoặc file. Chỉ ghi endpoint, vai trò, HTTP status và kết luận dữ liệu có nằm trong phạm vi không.

Để gọi GET kiểm tra trong cùng ứng dụng, người kiểm thử có thể dùng service hiện có qua bộ kiểm thử được quản lý hoặc công cụ HTTP nội bộ với token ở bộ nhớ. Không đưa token lên dịch vụ kiểm thử bên ngoài, không hardcode vào script hoặc shell history. API chưa tồn tại phải ghi BLOCKED, không thay bằng endpoint test role rồi kết luận quyền dữ liệu đã đạt.

### Ma trận chỉ đọc trên môi trường dùng chung

| Phiên | Thao tác cần kiểm tra | Kỳ vọng |
| --- | --- | --- |
| Không đăng nhập | GET /api/auth/me và API nghiệp vụ | 401; không dữ liệu |
| NV/QL/GS hợp lệ | GET /api/auth/me | Đúng user/role/branch; NV có employee UUID đúng |
| Mỗi role | GET /api/auth/test/employee-only, manager-only, supervisor-only | 200 đúng role; 403 hai role khác; nếu đang bắt buộc đổi mật khẩu thì endpoint nghiệp vụ 403 |
| NV | Đọc đăng ký/lịch/yêu cầu của mình và thử ID NV khác | Chỉ dữ liệu của mình; ID ngoài quyền 403 hoặc 404 theo hợp đồng, không response chứa row ngoài quyền |
| QL | Đọc danh sách và row tại branch được giao, rồi branch còn lại | Đúng branch được giao; không dữ liệu chi nhánh khác |
| GS gs_jollibee | Đọc lịch chờ duyệt của Lê Duẩn và Hải Châu | Cả hai thuộc phạm vi; không chỉ Lê Duẩn theo users.branch_id |
| GS | Branch ngoài phạm vi nếu môi trường có sẵn | Không truy cập; không tự tạo branch TEST để thử |
| Tài khoản đang phải đổi mật khẩu, nếu có sẵn | /me, /password-policy và GET API nghiệp vụ | Vòng đời Auth hợp lệ; nghiệp vụ bị chặn PASSWORD_CHANGE_REQUIRED |
| Phiên hết hạn/không hợp lệ | API được bảo vệ | 401; phân biệt với mạng/429/503 |

Sau mỗi phiên: F5 giữ trạng thái đúng, direct URL sai role bị chặn; logout về login, request cũ không phục hồi user. Logout không bảo đảm JWT access cũ bị vô hiệu tức thời trên mọi hệ thống; ghi riêng việc thu hồi refresh và hành vi access token theo chính sách Supabase, không giả định.

Nếu có truy cập PostgREST trực tiếp: dùng publishable/anon key được phép công khai làm apikey và JWT người dùng làm Authorization; tuyệt đối không service-role. Thử GET danh sách có giới hạn và GET row của mình/ngoài phạm vi, chỉ chọn cột cần thiết. Với mô hình Backend trung gian và quyền bảng đã thu hồi, từ chối toàn bộ direct table access là kết quả đúng; không yêu cầu mở GRANT để làm test PASS. HTTP 200 với [] có thể là lọc RLS, không chứng minh row không tồn tại. Đối chiếu bằng dữ liệu đã biết qua kênh quản trị, không chia sẻ PII.

Chỉ dùng anon/publishable key không JWT để kiểm tra truy cập ẩn danh bị chặn. Không gọi GET RPC không rõ body: GET function vẫn có thể gây side effect.

### Các test ghi chưa được phép trên CSDL dùng chung

Thực hiện sau trên staging/project tách biệt với dữ liệu kiểm thử đã được duyệt; không chạy ở đợt chỉ đọc này:

- TV2: lưu đúng chủ; chặn employee/period/shift khác branch, ngày sai, trùng khóa, ngoài cửa sổ, Crew Leader; kiểm tra cả batch rollback.
- TV3: lưu lịch tuần/version đúng; chặn vượt branch, phân công sai bộ phận/ngày/ca hoặc xung đột; kiểm tra hai lần lưu đồng thời.
- TV4: đúng GS hai branch; sai GS bị chặn; duyệt đúng version; chặn công bố chưa duyệt và chỉnh sửa sau duyệt trái quy trình; kiểm tra atomicity.
- TV5: yêu cầu đúng assignment; chặn giả mạo người yêu cầu/nhận thay; chấp nhận đồng thời; SUPPORT có yêu cầu viện trợ và đúng phạm vi hai branch; giữ dấu vết lịch sử.
- Auth: không cho user cập nhật role/branch/is_active/must_change_password/reset ID qua bảng/RPC; bắt buộc đổi mật khẩu không bị bỏ qua bằng direct Supabase. Không sửa user_metadata/tài khoản thật để thử trên production.

Không dùng BEGIN/ROLLBACK để thử ghi trên database dùng chung: trigger, webhook, thông báo hoặc Auth ngoài transaction có thể tạo tác động. Không reset mật khẩu hoặc tạo trạng thái must_change_password chỉ để có test case; thiếu tài khoản phù hợp thì BLOCKED.

## Kết luận và phần còn chặn

- Đã xác nhận bằng đọc thực tế ở lượt rà soát trước: hai branch thuộc gs_jollibee; 70 nhân viên; đủ bảng nền. Các kết quả này không phải kiểm thử JWT.
- P1 / BLOCKED nghiệm thu bảo mật: chưa có kết quả metadata triển khai và JWT thật cho quyền dữ liệu/RLS/RPC; chưa xác nhận lỗ hổng cụ thể.
- P2 / BLOCKED E2E: sau merge đã có API TV2–TV4, nhưng persistence/gửi duyệt/trình lại và quyền JWT thật chưa được nghiệm thu đầy đủ trên Supabase. Cần kiểm thử cô lập, kiểm tra triển khai và quyết định version công bố/đổi ca/viện trợ đồng thời; không coi API tồn tại là đủ điều kiện bàn giao.
- P3: tài liệu hợp đồng đã cập nhật GS và ranh giới nghiệp vụ; báo cáo cũ là lịch sử, không dùng ghi nhận supervisor_id=null làm trạng thái hiện tại.

Có thể bàn giao cấu trúc để phát triển; chưa ký PASS nghiệm thu tích hợp/bảo mật. Không yêu cầu thay schema ở bước này. File SQL mới chưa được chạy hoặc xác thực bằng PostgreSQL thực tế; cần người vận hành chạy và trả kết quả đã lọc thông tin nhạy cảm.

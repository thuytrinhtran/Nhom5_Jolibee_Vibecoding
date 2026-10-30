> **B?n hi?n h?nh 30/10/2026:** xem [b? tri?n khai cu?i](../final/README.md). Nh?ng m? t? M1/M2, l?ch th? N?m, automation ch?a l?p tr?nh ho?c ph??ng ?n 05 trong t?i li?u c? b?n d??i ch? ?? truy v?t, kh?ng ph?i h??ng d?n rollout hi?n t?i.

# TV2 — đồng bộ Supabase chung, bản v3

> Cập nhật 30/10/2026: chính sách hiện tại là **thứ Sáu 15:00 → Chủ nhật 12:00, Asia/Ho_Chi_Minh**. Nội dung rollout thứ Năm bên dưới là lịch sử, không được chạy lại `01_apply_tv2.sql` hoặc generator để xử lý lỗi hiện tại vì chúng vẫn đặt thứ Năm. Bản sửa tối thiểu chờ duyệt: [05_repair_friday_registration.sql](05_repair_friday_registration.sql). Chưa thực thi trên database chung.
>
> Kiểm tra GET lúc 15:28 ngày 30/10: kỳ Lê Duẩn `79a979cc-8347-48b5-a411-f03bd8aceb92` đã có giờ mở thứ Sáu đúng, đóng Chủ nhật đúng, nhưng status còn PLANNED; automation=false. Nhân viên Trần Minh Anh và kỳ cùng chi nhánh. Truy vấn header hiện tại lỗi 42703 vì thiếu sample_batch_id. SQL 05 chỉ thêm cột nullable/FK và chuyển đúng kỳ này sang OPEN nếu đang trong cửa sổ, giữ giờ, ID và mọi đăng ký. Không sửa RPC hoặc gán nguồn dữ liệu lịch sử; chưa dùng seed v3 trước khi review RPC provenance riêng.
>
> Sau khi nhóm duyệt và chạy SQL 05: kiểm tra GET `/api/registrations/current` bằng phiên TV1 hiện có phải trả 200, đúng kỳ, OPEN, schedule.open_iso_day=5; F5 trang đăng ký phải hiển thị ca. Việc lưu thật chỉ kiểm thử bằng thao tác được người dùng cho phép; Codex chưa gọi RPC ghi hoặc dùng mật khẩu/token thật. REST/OpenAPI không chứng minh được nội dung RPC, ACL hoặc RLS đầy đủ.

**Chỉ chuẩn bị và kiểm tra. Chưa chạy DDL, migration, seed hoặc cleanup lên Supabase chung.** Bản `tv2-official-shared-compatible-v3` thay thế file cũ `tv2-official-thursday-manual-v2`; cần trưởng nhóm duyệt bản SQL mới. Không chạy lại foundation/Auth/M1/M2 gốc.

## Trạng thái cloud đã đọc và giới hạn xác minh

Đích: `wlbpprpiieonjrqglicv.supabase.co`. Snapshot REST/OpenAPI ngày 29/10/2026 tại [schema-rest-snapshot.json](schema-rest-snapshot.json), [../readiness.json](../readiness.json).

- 2 chi nhánh ACTIVE, 72 profiles, **70 employees**, 3 departments; 62 nhân viên đủ điều kiện hiện tại. 70 employee UUID/user UUID duy nhất, nối public.users đúng, không lệch chi nhánh.
- Đã có **6 ca**, đúng 08–12 / 12–17 / 17–22 cho từng chi nhánh; giữ nguyên ID/name của các ca đó.
- Đã có **2 kỳ tuần 02–08/11/2026**, PLANNED, mở **30/10 15:00**, đóng 01/11 12:00 giờ Việt Nam. ID thật được lưu trong snapshot, không nhúng vào migration.
- Header, schedule config, automation config và RPC save 4 tham số đã xuất hiện; header/ca đăng ký/audit đều 0 dòng ở lần đọc cuối. Config đang open_iso_day=5, automation=false.
- Tên bảng, cột, UUID/date/time/timestamptz và tham số RPC qua REST khớp SQL nhóm/code TV1/TV2. **Chưa có bằng chứng đổi tên cột hoặc sai kiểu ID**. RPC nhận Auth user UUID, sau đó tìm employee qua employees.user_id; không coi Auth UUID là employee.id.

Trạng thái đã thay đổi giữa hai lần đọc trong lượt làm việc (ban đầu REST chưa thấy TV2, sau đó đã có các object trên); báo cáo cuối dùng snapshot mới. Không suy đoán ai đã triển khai hoặc đã dùng file nào.

**Chưa xác minh đầy đủ catalog cloud:** PK/FK/CHECK/UNIQUE thực tế, RLS/policies/ACL, trigger và nội dung SECURITY DEFINER/RPC. API key không cấp kết nối SQL quản trị; OpenAPI chỉ chứng minh được một phần metadata/quan hệ. Bạn đã đồng ý cung cấp kết quả [00_inspect_shared_schema.sql](00_inspect_shared_schema.sql); đang chờ kết quả chỉ SELECT. Chưa kiểm thử đăng nhập/lưu dữ liệu cloud trong lượt này. Checkout hiện tại không có implementation xếp lịch TV3 để chứng nhận truy vấn thật của TV3.

## Những điểm file cũ không đồng bộ

| Vấn đề | Bằng chứng / sửa trong v3 |
| --- | --- |
| Chỉ chạy trên database trống TV2 | Guard cũ từ chối ca/kỳ/bảng/RPC đã tồn tại; hiện cloud đã có chúng. V3 đọc shape, chỉ tạo object TV2 thiếu, tái sử dụng object tương thích |
| CREATE M1/M2 vô điều kiện | Chạy lại sẽ trùng bảng/function. V3 nâng cấp có điều kiện và có thể chạy lại an toàn trong cùng tuần |
| Hai UUID chi nhánh, đúng 70 hồ sơ, tuần cố định bị nhúng vào SQL | Đây không phải điều kiện schema. V3 truy vấn chi nhánh ACTIVE qua employee/profile thật; không phụ thuộc số lượng nhân viên; tuần kế tiếp tính theo giờ Việt Nam |
| Giờ mở thực tế vẫn thứ Sáu | V3 đặt config thứ Năm 15:00; sửa đúng các kỳ PLANNED thứ Sáu **còn trống**, giữ nguyên period_id/close_at. Nếu kỳ có dữ liệu hoặc thời gian khác dự kiến, dừng để nhóm duyệt |
| Dữ liệu mẫu chưa có dấu nguồn trên header | Thêm một cột nullable sample_batch_id trên bảng TV2, FK audit_logs.id. Không ALTER bảng TV1 hoặc shift_registrations |
| Chưa có cleanup có kiểm chứng | File 03 lưu manifest hàng mẫu vào audit; 04 chỉ xóa hàng còn thuộc batch và khớp fingerprint, giữ đăng ký thật sau khi nhân viên tự lưu/gửi |

## Tác động chính xác của 01_apply_tv2.sql

[01_apply_tv2.sql](01_apply_tv2.sql) được sinh từ [template](../../../backend/scripts/tv2-official.sql.template) và RPC M1 hiện có; hash trong [manifest.json](manifest.json). M1/M2 nguồn giữ để truy vết, không được chạy thêm sau bản này.

- Một transaction, lock timeout 5 giây, kiểm tra kiểu cột, PK/FK/UNIQUE/RLS cần thiết; sai shape sẽ dừng, không tự sửa foundation/Auth.
- Tạo registration_submissions và registration_schedule_config **chỉ nếu thiếu**, kiểm tra cấu trúc nếu đã có. Thêm duy nhất sample_batch_id UUID nullable → audit_logs.id trên header TV2, không gán dữ liệu cũ thành mẫu.
- Header/config có RLS, browser không truy cập trực tiếp, service_role chỉ SELECT; ghi qua RPC. Không đổi RLS/policy/permission của bảng TV1.
- Nâng cấp save_employee_registration 4 tham số bằng RPC đã có, thêm việc xóa sample_batch_id khi nhân viên thực sự lưu/gửi. Chỉ thay RPC khi nội dung khớp fingerprint M1 đã review hoặc v3; overload/body khác sẽ dừng, yêu cầu đối chiếu kết quả file 00.
- Config tập trung: Asia/Ho_Chi_Minh, open_iso_day=4 lúc 15:00, close_iso_day=7 lúc 12:00. Chưa chạy cron/n8n/nhắc tự động. Không cài automation config/RPC mới; nếu config cũ tồn tại phải disabled, không tự thay lịch/job của nhóm.
- Reuse ba ca thật đúng giờ cho mỗi chi nhánh; chỉ thêm khung ca thiếu. Ca global tương thích được dùng lại. Nếu có khung giờ khác hoặc trùng ca gây mơ hồ, dừng chứ không tự thêm cấu hình cạnh tranh.
- Dùng kỳ thật của tuần kế tiếp; thêm kỳ thiếu. Với trạng thái cloud đã quan sát, điều chỉnh hai kỳ PLANNED mở thứ Sáu sang thứ Năm **chỉ khi không có bất kỳ header/ca đăng ký nào**, giữ UUID. Giữ deadline; kỳ có dữ liệu/giờ lạ không bị sửa. Không sửa tuần khác.
- Không INSERT/UPDATE/DELETE Auth/users/employees/departments/branches, không tạo đăng ký giả và không tự backfill OFF từ thiếu header.

Không có scheduler nên file này không tự tạo kỳ hằng tuần sau khi triển khai. Deadline vẫn được API/RPC kiểm tra theo timestamp dù status trong bảng chưa tự đổi. Đổi về thứ Sáu sau này qua config open_iso_day=5 và chuẩn bị kỳ sau theo cấu hình được duyệt; không tự đổi lại timestamp của kỳ đã có dữ liệu.

## Backend/frontend TV2 và TV3

Giữ Auth TV1: backend gọi auth.getUser(token), lấy req.user.id, kiểm tra role NV/profile/chi nhánh, rồi gọi RPC bằng server key. Request không nhận user_id/employee_id/p_user của browser. Không đổi hệ thống đăng nhập hoặc bố cục 7 thẻ 4+3; giữ ca liền nhau, chặn chồng lấn, nháp/gửi/sửa trước hạn, OFF chỉ sau VALID có submitted_at.

API GET đã thêm đọc sample_batch_id: nếu header là mẫu, trả has_sample_data=true, không trả trạng thái/ca giả như nhân viên đã gửi. UI hiển thị thông báo dữ liệu mẫu riêng và form đăng ký thật trống. Khi người dùng thật lưu/gửi, RPC thay ca của chính họ và đặt sample_batch_id=NULL. Không có mock fallback; DEMO hiện tắt trong cấu hình runtime. Do cloud chưa có cột provenance v3, backend mới cần SQL v3 trước khi xác nhận luồng live hoạt động.

[../tv3-contract.sql](../tv3-contract.sql) trả employee_id, period_id, work_date, shift_id, submitted_at, sample_batch_id/is_sample. **Mặc định loại mẫu**; để TV3 phát triển với dữ liệu mẫu, đặt trong cùng Run:

```sql
SET app.tv2_period_id='UUID_KY_THAT';
SET app.tv2_include_samples='true';
-- Dán tv3-contract.sql.
```

Truy vấn ngày phân biệt NOT_SUBMITTED / SHIFT / OFF bằng header VALID có submitted_at. TV3 vẫn phải áp dụng quyền QL/chi nhánh và dùng dấu nguồn; chưa có bằng chứng implementation TV3 ngoài nhánh này đã dùng contract mới. Không sửa code module TV3.

## Seed mẫu và cách xóa riêng

[03_seed_registrations_for_tv3.sql](03_seed_registrations_for_tv3.sql), duyệt riêng sau migration:

- Dùng **hai kỳ/chi nhánh hiện có của tuần kế tiếp**, chọn 6 nhân viên đủ điều kiện chưa có bất kỳ dữ liệu đăng ký nào mỗi kỳ: **12 người**, 12 header VALID, 120 nguyện vọng ca. Không tạo user, nhân viên, ca hoặc kỳ.
- Có thể chọn tuần khác đã có kỳ bằng SET app.tv3_seed_work_start='YYYY-MM-DD' trước toàn bộ file trong cùng Run. Không có UUID nhân viên/chi nhánh/ca/kỳ hardcode.
- sample_batch_id tham chiếu audit TV3_SAMPLE_SEED, actor NULL, SYSTEM, is_sample=true. submitted_at là thời điểm mô phỏng trong cửa sổ của kỳ, không tuyên bố nhân viên đã đăng nhập/gửi thật. Manifest audit ghi chính xác row IDs/nội dung trước khi seed.
- Không ghi đè header/ca có sẵn. Khóa kỳ theo thứ tự RPC để tránh đua với người dùng; batch_tag theo tuần chặn chạy trùng, kể cả batch đã cleanup.
- Trả sample_batch_id, period_id, employee_id được dùng để người vận hành đối chiếu. Dữ liệu mẫu chỉ vào TV3 khi chọn include_samples=true trong contract; không phải bài test Auth hoặc self-service cloud.

[04_cleanup_tv3_samples.sql](04_cleanup_tv3_samples.sql), duyệt riêng khi cần dọn:

```sql
SET app.tv3_sample_batch_id='UUID_BATCH_TU_KET_QUA_FILE_03';
-- Dán toàn bộ 04_cleanup_tv3_samples.sql trong cùng Run.
```

Chỉ xóa ca/header còn sample_batch_id của batch và khớp nội dung đã lưu. Nếu hàng mẫu đã sửa ngoài quy trình, dừng để review. Nếu nhân viên đã tự lưu/gửi (provenance NULL), giữ đăng ký thật đó. Không xóa account/employee/shift/period/audit; ghi sự kiện cleanup riêng, giữ nguồn gốc để truy vết.

**02_seed_tv2_test.sql là fixture lịch sử v2**, không nằm trong rollout này; không chạy cùng 03 vì tạo kỳ riêng và chưa có dấu nguồn v3. Không tự chuyển các hàng cũ thành đăng ký thật hoặc mẫu khi chưa review nguồn.

## Thứ tự sau khi trưởng nhóm duyệt

1. Đúng project chung: https://supabase.com/dashboard/project/wlbpprpiieonjrqglicv/sql/new, role postgres. Chạy **00_inspect_shared_schema.sql** chỉ đọc, đối chiếu kết quả catalog/RPC và nội dung SQL trước khi duyệt bước ghi.
2. Duyệt rồi chạy **01_apply_tv2.sql v3** toàn bộ một transaction. Không chạy foundation, migration Auth, M1/M2 gốc hoặc file v2. Nếu lỗi guard, dừng và giữ kết quả; không bỏ guard. Nếu transaction còn aborted, ROLLBACK trước khi kiểm tra tiếp.
3. Chạy **02_verify.sql** chỉ đọc; kiểm tra config thứ Năm, kỳ/ID giữ nguyên, giờ mở/deadline, RLS/ACL/RPC, provenance FK. Có dữ liệu VALID cũ thiếu header thì báo riêng, không tự suy ra OFF.
4. Được duyệt dữ liệu mẫu thì mới chạy **03_seed_registrations_for_tv3.sql**. Đây là tùy chọn, không phải migration bắt buộc. Kiểm tra TV3 bằng contract include_samples=true và đúng period_id.
5. Khi hoàn tất phát triển, duyệt và chạy **04_cleanup_tv3_samples.sql** cho đúng batch. Không dùng DELETE theo toàn bộ tuần/nhân viên.

Sau SQL thành công, frontend chính thức chạy `npm.cmd --prefix frontend run dev:official`, backend build rồi `node backend/scripts/tv2-official-server.cjs`; xử lý đúng tiến trình cũ nếu cổng đã dùng. URL http://localhost:5173/employee/register. Chưa chủ động chuyển/restart server hoặc ghi cloud trong lượt này.

## Kiểm chứng local và trạng thái bàn giao

- Backend: **49/49** tests đạt, gồm TV1 Auth regression, nâng cấp từ M1/M2 đã có, ID tùy ý/14 hồ sơ (không phụ thuộc 70), chạy lại không trùng, từ chối RPC/ca lạ hoặc kỳ có dữ liệu, lịch thứ Năm.
- Seed/cleanup PostgreSQL trong bộ nhớ: 12 header/120 ca, TV3 loại mẫu mặc định/đọc mẫu khi opt-in, nhân viên tự gửi chuyển thành dữ liệu thật, cleanup giữ dữ liệu thật, từ chối hàng mẫu bị sửa, chặn seed lặp.
- Frontend **20/20** tests, build backend/frontend thành công. Giữ giao diện/luồng Auth hiện có. Các test chỉ dùng mocks/PostgreSQL trong bộ nhớ; không kết nối Supabase TEST hoặc gửi SQL ghi lên project chung.
- **Chờ kết quả catalog file 00 và trưởng nhóm duyệt SQL v3/provenance/seed. Chưa xác nhận RPC cloud, Auth cloud, lưu/F5/đăng nhập lại hoặc TV3 thật chạy thành công.**

Sinh lại artifact local: `node backend/scripts/prepare-tv2-official.cjs`. Lệnh chỉ ghi file local; nếu nguồn/hash đổi sau duyệt thì review lại bản mới.

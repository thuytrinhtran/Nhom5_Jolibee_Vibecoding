# Chuẩn bị database jollishift-tv2-test

**Chỉ chuẩn bị, chưa chạy bất kỳ SQL nào lên Supabase.** Đích do bạn cung cấp: `https://wimikwyuzhltpjciafod.supabase.co`, project ref `wimikwyuzhltpjciafod`.

Bộ này dành cho project Supabase mới hoàn toàn. Không dùng trên project nhóm, không sao chép dữ liệu nhân viên thật. Schema nền đầy đủ được giữ để tương thích các FK; dữ liệu thử chỉ có một nhân viên giả lập. Không thay đổi `backend/.env`, Auth TV1 hay flag DEMO đang bật.

## Đúng thứ tự SQL

| Thứ tự | File cần mở và chạy toàn bộ | Mục đích và kết quả |
| --- | --- | --- |
| 1 | [01_foundation.sql](01_foundation.sql) | Tạo schema nền từ `docs/Jollishift.sql`; bỏ duy nhất lần khai báo index trùng trong bản TEST; tạo marker theo dõi từng bước |
| 2 | [02_auth_compatibility.sql](02_auth_compatibility.sql) | Áp dụng phần schema/public policy của migration Auth hiện có: `must_change_password`, `password_reset_id`, guard và restrictive policies; không tạo/sửa mật khẩu Auth |
| 3 | [03_tv2_m1.sql](03_tv2_m1.sql) | M1 cuối: header có `submitted_at`, RPC lưu 4 tham số, audit, automation mặc định disabled |
| 4 | [04_tv2_m2.sql](04_tv2_m2.sql) | M2 cuối: cấu hình thứ Sáu 15:00 → Chủ nhật 12:00, nhắc T-30, timezone Việt Nam; không có bảng OFF riêng |
| — | **Tạo Auth user TEST thủ công, lấy UUID** | Làm bước Auth bên dưới trước file 05 |
| 5 | [05_test_fixture.sql](05_test_fixture.sql) | Gắn Auth user vào một profile NV/employee giả lập, tạo chi nhánh/bộ phận, 3 ca và một kỳ TEST đang mở |
| 6 | [06_verify.sql](06_verify.sql) | Chỉ SELECT: kiểm tra marker, dữ liệu, PK/FK/CHECK/UNIQUE, RLS, ACL và chữ ký RPC; chạy lại được |

Các file 01–04 đã chứa toàn bộ SQL cần thiết theo thứ tự **foundation → Auth compatibility → M1 → M2**. Không chạy thêm các bản gốc hoặc file SQL gộp cũ, vì sẽ trùng object. Chỉ sửa index trong `01_foundation.sql`; `docs/Jollishift.sql`, migration Auth gốc, M1 và M2 không được sửa trong lần chuẩn bị này.

## Cách chạy trong Supabase SQL Editor — khi bạn quyết định triển khai TEST

1. Mở Supabase Dashboard, chọn **jollishift-tv2-test**. Kiểm tra thanh địa chỉ Dashboard có `/project/wimikwyuzhltpjciafod/`. URL project API không phải cửa sổ để dán SQL.
2. Vào **SQL Editor**, tạo query mới, dán toàn bộ nội dung file 01. Kiểm tra lại project, dùng tài khoản SQL quản trị của project, chạy bằng **Run**. Chỉ sang bước tiếp theo nếu kết quả thành công.
3. Tạo query mới cho file 02, rồi file 03, rồi file 04. Mỗi file chạy một lần và gồm một transaction; không chọn chạy riêng một đoạn giữa file. Nếu lỗi, dừng và đọc thông báo, không xóa bảng hoặc bỏ guard để thử tiếp. Nếu phiên còn báo transaction aborted, chạy `ROLLBACK;` trước khi kiểm tra tiếp.
4. Sau file 04, tạo Auth user như phần dưới. Không chạy file 05 khi chưa có UUID Auth TEST đã xác nhận email.
5. Tạo query mới và đặt dòng sau **trước toàn bộ nội dung file 05 trong cùng một lần Run**:

```sql
SET app.tv2_test_auth_user_id = 'UUID_AUTH_TEST_VUA_TAO';
-- Dán toàn bộ 05_test_fixture.sql ngay bên dưới.
```

Thay placeholder bằng UUID thật của user vừa tạo trong **Auth của project TEST này**. Không chạy SET ở tab/lượt riêng vì SQL Editor có thể dùng phiên kết nối khác. UUID không phải mật khẩu và không phải API key.

6. Chạy file 06 để xem dữ liệu và quyền. File này không gọi RPC lưu/automation và không thay dữ liệu.

Supabase cung cấp SQL Editor để thực thi SQL trong Dashboard; xem [tài liệu tables chính thức](https://supabase.com/docs/guides/database/tables).

## Tạo Auth user TEST tương thích với đăng nhập hiện tại

- Trong **Authentication → Users** của chính project TEST, tạo một user disposable bằng luồng tạo user thủ công, với email/mật khẩu TEST bạn tự quản lý; không chọn luồng gửi thư mời. Xem [Supabase Users](https://supabase.com/docs/guides/auth/users).
- Bảo đảm email đã được xác nhận cho user TEST. Nếu giao diện có lựa chọn tự xác nhận email khi tạo user, dùng lựa chọn đó cho user này. Không cần đổi chính sách xác nhận email toàn project để né kiểm tra. File 05 từ chối tài khoản chưa có `email_confirmed_at` hoặc chưa có email.
- Dùng mật khẩu TEST riêng đáp ứng policy đang cấu hình của ứng dụng, mặc định ít nhất 12 ký tự với chữ thường/chữ hoa/số/ký hiệu. Không đưa mật khẩu vào SQL, repository hay chat.
- Copy UUID từ Auth Users. File 05 chỉ **đọc** `auth.users`; nó không tạo tài khoản Auth bằng SQL, không sửa password/metadata/session và không sao chép user của project nhóm.
- Khi đăng nhập ứng dụng sau này, dùng **email/mật khẩu Auth TEST**, không dùng `tv2_test_nv` như email. `tv2_test_nv` là username/mã hồ sơ public.

Profile được tạo với role NV, active, skill REGULAR, user/employee cùng chi nhánh và department FK hợp lệ. `users.id` chính là UUID Auth; `employees.user_id` trỏ về profile đó. User có mật khẩu TEST vĩnh viễn do bạn tạo, nên profile giữ `must_change_password=false` theo default; không cập nhật trạng thái bảo mật của bất kỳ user hiện hữu nào.

## Dữ liệu tối thiểu sau bước 05

| Bảng | Dữ liệu mới |
| --- | --- |
| `branches` | 1 chi nhánh giả lập TEST |
| `departments` | 1 bộ phận giả lập TEST |
| `users` / `employees` | 1 profile NV và 1 hồ sơ nhân viên giả, gắn UUID Auth TEST |
| `shifts` | 3 ca TEST: 08:00–12:00, 12:00–17:00, 17:00–22:00 |
| `registration_periods` | 1 kỳ cho tuần làm việc kế tiếp thứ Hai–Chủ nhật; OPEN từ lúc chạy trừ 1 phút đến lúc chạy cộng 2 giờ |
| `registration_submissions` / `shift_registrations` | Ban đầu 0 dòng để thử trạng thái chưa gửi |
| `registration_schedule_config` | Giữ lịch chính thức thứ Sáu 15:00, Chủ nhật 12:00, nhắc trước 30 phút |
| `registration_automation_config` | `enabled=false` |

Kỳ mở 2 giờ là **fixture TEST có chủ đích**, giúp thử UI/API ngay; nó không thay đồng hồ hệ thống, validation hoặc cấu hình lịch chính thức. Đợi hết hạn sẽ kiểm tra được khóa chỉnh sửa. Không chạy lại seed để kéo dài hạn; cần chuẩn bị batch/kế hoạch thử tiếp riêng nếu cần.

Không tạo bản ghi OFF. Sau khi gửi VALID có `submitted_at`, ngày không có ca mới được suy ra OFF. Nháp hoặc chưa gửi không được xem là OFF. Gửi rỗng sau xác nhận là nghỉ cả tuần.

## Kết quả cần thấy trong file 06

- Có 5 dòng marker từ `01` đến `05`, đúng project ref.
- User role NV, active, `branch_matches=true`, `auth_user_exists=true`, `auth_email_confirmed=true`.
- Ba ca hoạt động, cùng chi nhánh; kỳ đúng 7 ngày và `editable_now=true` nếu chưa quá 2 giờ.
- Lịch chính thức weekday 5 / 15:00, weekday 7 / 12:00, reminder 30; automation tắt.
- Hai truy vấn header/ca ban đầu trả 0 dòng; đây là trạng thái chưa gửi, không phải lỗi.
- RLS bật trên bảng ứng dụng. RPC lưu có **4 tham số**; RPC lưu/automation SECURITY DEFINER, anon/authenticated không được EXECUTE, service_role được EXECUTE. Header và config chỉ cho backend SELECT trực tiếp; ghi qua RPC.

## Guard, thứ tự và giới hạn

File 01 từ chối nếu `public` đã có bảng, do đó không bootstrap lên database nhóm hoặc chạy lại để ghi đè. Các bước sau yêu cầu `tv2_test_installation` đúng ref, checksum bước trước và chưa có marker bước hiện tại. Marker có RLS và thu hồi quyền của browser/backend. Hash nguồn và file đã sinh nằm trong [manifest.json](manifest.json).

**SQL không tự xác minh được URL Dashboard và không tự chuyển database**: project ref trong file/marker là dấu kiểm soát của bundle. Bạn vẫn phải xác nhận đúng project trước mỗi lần Run. Guard không phải quyền cho phép chạy lên project nhóm. Nếu TEST không trống hoặc có bước/bản schema khác đã được áp dụng, dừng và đánh giá trạng thái, không bỏ guard.

`tv2_test_installation` chỉ theo dõi bundle TEST này, không thay thế lịch sử migration Supabase CLI. Các file dành cho thao tác SQL Editor như bảng thứ tự, không dùng làm auto-discovery migrations.

## Cấu hình API TEST ở bước sau

[backend-env.example.txt](backend-env.example.txt) đã điền URL/ref của project TEST, chỉ chứa placeholder server key. Khi đã chuẩn bị DB và được phép thử API, bạn có thể copy thành `backend/.env.tv2-test` rồi điền key của TEST bằng kênh riêng. Không ghi đè `backend/.env` đang dùng cho project nhóm, không đặt secret trong VITE_*.

Launcher hiện có: `node backend/scripts/tv2-test-server.cjs` sau build backend; API TEST cổng 5001, frontend TEST nên dùng cổng 5174 và VITE_TV2_DEMO=false chỉ trong tiến trình đó. **Chưa khởi động/chuyển môi trường trong bước chuẩn bị này; DEMO 5173 giữ nguyên.**

## Kiểm thử đã thực hiện

Bộ SQL được áp dụng và kiểm tra **chỉ trên PostgreSQL PGlite trong bộ nhớ**, dùng Auth/roles fixture: gỡ index trùng trong bản TEST, chặn public không trống, chặn sai thứ tự/chạy lại, chặn UUID Auth thiếu hoặc email chưa xác nhận, tạo đúng dữ liệu tối thiểu, kiểm tra FK/RLS/quyền và lưu/gửi qua RPC 4 tham số. Không có kết nối hoặc SQL nào được gửi tới Supabase TEST hay project nhóm.

PGlite không thay thế Supabase Auth/PostgREST thật. Sau khi bạn tự chạy các bước được duyệt, vẫn cần kiểm tra đăng nhập TEST, schema cache và persistence qua API thật.

Sinh lại artifact nếu nguồn được sửa: `node backend/scripts/prepare-tv2-test-project.cjs`. Lệnh chỉ ghi file local; không thực thi SQL. Trước khi tái dùng với DB đã khởi tạo, kiểm tra version/hash và dừng nếu nguồn thay đổi.

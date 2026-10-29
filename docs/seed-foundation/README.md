# JolliShift – Dữ liệu nền 70 nhân viên (CHƯA ÁP DỤNG)

Chỉ chuẩn bị kế hoạch và script. Chưa chạy bước cấp tài khoản Auth hoặc SQL ghi dữ liệu. Không tạo đăng ký ca, ca làm, lịch phân công, phê duyệt, đổi ca, nhu cầu nhân sự hoặc các bản ghi nghiệp vụ khác.

## Phạm vi và cơ cấu để duyệt

| Chi nhánh | Tổng | Bếp | Phục vụ | Thu ngân | NEW | REGULAR | CREW_TRAINING | CREW_LEADER |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Jollibee Lê Duẩn | 60 | 25 | 20 | 15 | 8 | 36 | 10 | 6 |
| Chi nhánh mô phỏng Hải Châu | 10 | 4 | 3 | 3 | 2 | 6 | 1 | 1 |
| Tổng mẫu | 70 | 29 | 23 | 18 | 10 | 42 | 11 | 7 |

Cơ cấu 10 người Hải Châu là **đề xuất để duyệt**, vì yêu cầu chưa ấn định bộ phận/cấp độ cho chi nhánh này. Đây là chi nhánh mô phỏng, không khẳng định địa điểm kinh doanh thực tế. Không tự thêm địa chỉ, số điện thoại, giờ làm tối đa hoặc kỹ năng chưa được yêu cầu.

Đơn vị kiểm đếm là dòng trong `public.employees`, không phải số tài khoản Auth hoặc số dòng `public.users`. Phạm vi mẫu gồm toàn bộ nhân viên của hai chi nhánh có tên chính xác ở bảng trên. Nhân viên ở chi nhánh khác được giữ nguyên và nằm ngoài tổng mẫu 70. Truy vấn xác nhận cũng hiển thị tổng nhân viên toàn database riêng biệt.

## Hiện trạng đã đọc (29/10/2026)

Đã đọc schema đang phục vụ qua PostgREST OpenAPI và các bảng thực tế `branches`, `departments`, `users`, `employees`; đối chiếu với `docs/Jollishift.sql`. Các cột, kiểu dữ liệu, cột bắt buộc, default và FK được OpenAPI cung cấp đã lưu trong `plan.json`. OpenAPI không cung cấp đầy đủ CHECK, FK liên schema và trigger: trước khi duyệt chạy `inspect-schema.sql` để kiểm tra chúng trực tiếp qua SQL Editor, đặc biệt `public.users.id → auth.users.id` và custom trigger trên `auth.users`.

Schema không có cột `employee_code`; dùng `public.users.username` làm mã nhân viên duy nhất. `employees.id` vẫn là UUID. Role đăng nhập `NV` tách biệt với bốn cấp độ chuyên môn. Không sửa schema để thêm cột mã.

Đã thấy:
- 1 nhân viên hiện hữu ở Lê Duẩn, Bếp, REGULAR, ACTIVE; giữ nguyên toàn bộ tên, mã, UUID và các trường khác, tính vào 60 người.
- 1 hồ sơ NV đang hoạt động (`nv_jollibee_02`) thuộc Lê Duẩn, đã có Auth nhưng chưa có `employees`. Kế hoạch chỉ bổ sung dòng nhân viên mang tên giả lập **Trần Minh Anh**, không đổi hồ sơ/tài khoản/mật khẩu hiện có. Tên và phân bổ này nằm trong CSV để duyệt.
- QL và GS hiện chưa có dòng `employees`; giữ nguyên tài khoản, không tự chuyển role hoặc đưa vào số nhân viên.

Kế hoạch hiện tại: **giữ 1 nhân viên + bổ sung hồ sơ nhân viên cho 1 NV hiện hữu + 58 NV mới Lê Duẩn + 10 NV mới Hải Châu = 70**. Cần tạo mới **68 Auth, 68 public.users, 69 employees, 1 branch, 2 departments**. Sau áp dụng dự kiến có 72 tài khoản đăng nhập/hồ sơ users (70 NV + 1 QL + 1 GS), nhưng vẫn đúng 70 nhân viên.

## File để duyệt

- `roster.csv`: danh sách đủ 70 họ tên tiếng Việt cụ thể, mã/username, chi nhánh, bộ phận, cấp độ, trạng thái và nguồn. UTF-8 có BOM để mở bằng Excel.
- `plan.json`: baseline đầy đủ các bảng nền, danh sách bổ sung, schema đọc được và checksum kế hoạch; không có password, token hoặc key. `preserve` = giữ nguyên; `existing-profile` = bổ sung employee cho NV sẵn có; `new-auth` = tài khoản mới dự kiến.
- `inspect-schema.sql`: chỉ SELECT metadata/constraint/trigger, không thay đổi schema.
- `apply-public.sql`: giao dịch SQL ghi bảng public; chỉ chạy sau khi được duyệt và hoàn tất bước Admin API.
- `verify.sql`: chỉ SELECT, xác nhận từng tổng 60/10/70, từng bộ phận/cấp độ, liên kết Auth và mã duy nhất.
- `../../backend/scripts/seed-foundation.cjs` (đường dẫn thực từ thư mục gốc: `backend/scripts/seed-foundation.cjs`): CLI lập kế hoạch chỉ đọc và bước tạo Auth có khóa duyệt.

## Quy trình chạy SAU KHI ĐƯỢC DUYỆT

### 1. Kiểm tra schema và duyệt roster

Mở Supabase Dashboard → SQL Editor → chạy `inspect-schema.sql` (chỉ đọc). Kiểm tra:
- `users.id` tham chiếu `auth.users.id`; `employees.user_id` tham chiếu `users.id` và unique.
- Username duy nhất; tên chi nhánh và bộ phận duy nhất.
- `users.role` cho phép NV/QL/GS; skill cho phép NEW/REGULAR/CREW_TRAINING/CREW_LEADER; trạng thái branch/employee ACTIVE/INACTIVE.
- Không có custom trigger tạo/đổi hồ sơ khác với kế hoạch khi Admin API tạo Auth. Nếu có, dừng để điều chỉnh kế hoạch; không tự tắt trigger hoặc sửa dữ liệu cũ.

Đọc CSV đủ 70 người và phê duyệt `plan.json`. Không chỉnh tay chỉ một file CSV/SQL: nếu cần đổi cơ cấu, sửa TARGETS/NAMES trong planner rồi tạo kế hoạch mới và duyệt lại.

Nếu dữ liệu đã thay đổi kể từ lúc lập kế hoạch, tạo lại vào thư mục mới (chế độ này chỉ đọc Supabase):

```powershell
# Tại thư mục gốc dự án. Không ghi database, không tạo Auth.
node backend/scripts/seed-foundation.cjs plan D:/JolliShift-foundation-plan-reviewed
```

Dùng bộ plan/CSV/SQL mới nhất cùng nhau. Script từ chối ghi đè `plan.json` đã có. Không đổi baseline để bỏ qua cảnh báo dữ liệu đã thay đổi.

### 2. Tạo các Auth còn thiếu bằng Admin API

Chỉ sau khi có chấp thuận rõ ràng mới chạy bước dưới. Chạy trên máy quản trị/terminal, **không chạy Node script trong SQL Editor hoặc trình duyệt**. Dùng dependencies sẵn có của Backend, không cần thư viện mới.

`backend/.env` phải có `SUPABASE_URL` và `SUPABASE_SECRET_KEY` hoặc `SUPABASE_SERVICE_ROLE_KEY`. Không dán key vào SQL, source, chat, frontend hoặc dòng lệnh. Script tự đọc `.env` và không in key/token/password.

```powershell
# CHỈ CHẠY SAU KHI KẾ HOẠCH ĐƯỢC DUYỆT.
$foundationPlan = 'docs/seed-foundation/plan.json'
$foundationApproval = (Get-Content -LiteralPath $foundationPlan -Raw -Encoding UTF8 | ConvertFrom-Json).approval_sha256
node backend/scripts/seed-foundation.cjs auth $foundationPlan --approve $foundationApproval
```

Tham số `--approve` gắn với checksum nội dung kế hoạch và đúng project, không phải cơ chế tự suy ra sự đồng ý. Người vận hành phải được duyệt trước khi gọi lệnh.

Script chỉ gọi `auth.admin.createUser`, gán UUID ổn định đã duyệt và email mẫu dạng `js_ld_003@example.invalid`; tuyệt đối không INSERT vào `auth.users`. Mỗi tài khoản mới nhận mật khẩu ngẫu nhiên riêng, chỉ tồn tại trong bộ nhớ lúc cấp tài khoản, không in hoặc lưu ra file. Email được xác nhận bởi Admin API và không gửi thư. Domain `.invalid` không nhận email; các tài khoản nền này **không cung cấp mật khẩu đăng nhập để chia sẻ**. Nếu sau này cần đăng nhập bằng chúng, phải có quy trình cấp/reset mật khẩu riêng được duyệt. Ba/bốn tài khoản hiện hữu không bị reset.

Trước khi tạo, script kiểm tra toàn bộ va chạm UUID/email và metadata đánh dấu lô. UUID hoặc email đã thuộc tài khoản khác sẽ làm script dừng; không chiếm dụng, sửa hay xóa tài khoản đó. Chạy lại **cùng kế hoạch** sẽ bỏ qua Auth đúng marker, không reset mật khẩu hoặc tạo bản sao. Không chạy đồng thời nhiều tiến trình cấp tài khoản.

### 3. Chạy giao dịch public trên Supabase

Sau khi bước Auth thành công, mở `apply-public.sql` thuộc đúng bộ kế hoạch đã duyệt, xem lại và chạy trong Supabase SQL Editor với quyền quản trị.

SQL dùng transaction và khóa các bảng nền để ngăn hai lần seed public chạy đồng thời; chỉ INSERT các dòng thiếu vào `branches`, `departments`, `users`, `employees`. Không UPDATE, DELETE hoặc thay đổi cấu trúc bảng. Kiểm tra baseline trước và sau INSERT; nếu một hồ sơ cũ thay đổi, thiếu Auth, trùng mã, dữ liệu khác kế hoạch hoặc tổng không đúng thì giao dịch public rollback. Không chạy những lệnh CREATE TABLE trong `docs/Jollishift.sql` để seed.

Có thể chạy lại cùng SQL: các dòng khớp kế hoạch được giữ nguyên, không thêm bản sao. Nếu trigger tạo profile tự động không khớp kế hoạch, script dừng thay vì ghi đè. Bất kỳ xung đột nào cần được kiểm tra và duyệt lại.

### 4. Xác nhận kết quả

Chạy `verify.sql` trong SQL Editor. Cần tất cả dòng kiểm tra đều PASS, gồm:
- Tổng nhân viên Lê Duẩn = **60**; Hải Châu = **10**; toàn bộ dữ liệu mẫu = **70**.
- Lê Duẩn: Bếp 25, Phục vụ 20, Thu ngân 15; NEW 8, REGULAR 36, CREW_TRAINING 10, CREW_LEADER 6.
- Mã duy nhất = 70; hồ sơ và Auth hợp lệ = 70.

Không kết luận đã seed thành công chỉ dựa trên file CSV hoặc test offline. Trước khi áp dụng, chạy verify sẽ thấy FAIL về số lượng là bình thường vì hiện mới có 1 employee.

## Lỗi giữa chừng và giới hạn giao dịch

Auth Admin API và transaction PostgreSQL là hai bước khác nhau, không thể rollback chung bằng SQL Editor. Nếu tạo Auth lỗi giữa chừng, các Auth đã tạo có thể còn tồn tại nhưng chưa có profile/employee. Không tự xóa chúng; kiểm tra và chạy lại **cùng kế hoạch đã duyệt**. Nếu public SQL rollback, các Auth đã cấp vẫn còn; khắc phục xung đột đã duyệt rồi chạy lại SQL. Script không có đường xóa/rollback tự động có thể đụng tài khoản cũ.

## Kiểm tra đã thực hiện

- Đọc schema OpenAPI và baseline thật, không ghi Supabase.
- Lập kế hoạch chỉ đọc: 70 nhân viên, 1 giữ nguyên, 1 dùng hồ sơ NV sẵn có, 68 Auth mới dự kiến.
- `node --check backend/scripts/seed-foundation.cjs`: đạt.
- `node --test backend/scripts/seed-foundation.test.cjs`: 6/6 đạt (offline: tổng/marginal, bảo toàn hồ sơ, chống trùng khi lập lại, phát hiện drift, phạm vi SQL và chặn Auth khi chưa có checksum duyệt).
- **Chưa chạy** chế độ Auth được duyệt, `apply-public.sql` hoặc verify sau seed trên database thật. Constraint/trigger đầy đủ cần được xác nhận qua `inspect-schema.sql` trước khi duyệt.

Do ổ C hết dung lượng, dependency Backend được chuyển sang `D:/JolliShift-foundation-tools/backend-node_modules` và giữ đường dẫn `backend/node_modules` bằng junction; source/lockfile không đổi. Cần giữ thư mục đích trên D để các lệnh Backend tiếp tục hoạt động.

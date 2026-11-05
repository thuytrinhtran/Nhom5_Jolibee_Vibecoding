# Dữ liệu demo dùng nhân viên hiện có — chưa import

Artifact được chọn: **1793634151022/**, có manifest/hash và rehearsal PostgreSQL cô lập. Các thư mục timestamp khác là các lần chuẩn bị local, không phải lịch đã lưu hoặc quyền import. Chỉ đọc Supabase trong lượt chuẩn bị; chưa tạo Auth, migration hay ghi dữ liệu nguồn.

## Kết quả dữ liệu thật và phương án nhanh hơn

GET mới và repository TV2/TV3 hiện có xác nhận Lê Duẩn vẫn có 60 employees, 2 header/16 registrations thật, 63 demand cells/308 positions; chưa có schedules. Có 7 CREW_LEADER nên chỉ **53 người** thuộc nhóm staffing tự động (NEW/REGULAR/CREW_TRAINING). Không đổi skill_level để tăng số người. Chọn NV demo thuộc 53 người này, không chọn tài khoản Crew Leader rồi kỳ vọng có ca REGULAR.

**Không cần tạo 17 Auth/profile/employee mới** cho mục tiêu 308/308. Đây là phương án thay thế kịch bản mở rộng trước, không phải hoàn thành 60–70 người/ngày: với pool hiện tại, bộ này có 52–53 người/ngày.

| Bộ | Input | Kết quả tính bằng engine |
|---|---|---|
| A — nhân viên hiện có, giữ tuần 02–08/11 | Giữ nguyên 60 employees, 16 real rows và 63/308 nhu cầu; bổ sung 51 header mới của người chưa có header kỳ này, **640 registrations**; tổng **656** | 308/308, thiếu người 0, thiếu cơ cấu 0; theo ngày **53,52,53,53,52,53,53** |
| B — độc lập, local synthetic | 9 người, 3 bộ phận, 2 ca, 12 cells trong 2 ngày của tuần 09–15/11; 21 VALID registrations, nhu cầu **36** | **21/36**, thiếu **15** vị trí tại 6 cells, có cảnh báo cơ cấu; không phân công ngoài đăng ký |

Input A không chạm hai employee có header thật; không thêm row mẫu dưới header thật, không cập nhật 16 rows thật. Đăng ký mẫu có một/hai ca ưu tiên thay đổi theo người/ngày; bổ sung availability ở ô thiếu để tạo positive fixture. Không giới hạn tổng giờ đăng ký, chỉ cấm overlap. Engine vẫn giữ đúng max_weekly_hours thực sự cấu hình cho phân công, kỹ năng/bộ phận và các hard constraint.

Generator **không tạo danh sách assignment** trong seed, không dùng kết quả phân công để ghi sẵn lịch. Gọi `generateSchedule` trên input để tính lại mọi kết quả. Tests thay nhu cầu bộ B xuống 24 positions, engine nhận tổng mới; không có business rule bắt mọi input bằng 308. Con số 308 trong executor là safety gate của fixture Lê Duẩn đã chọn, không áp vào engine/API dữ liệu giảng viên.

## File và cách chạy local

- `1793634151022/real-source-input.json`: source trước overlay, không credential hoặc tên đầy đủ nhân viên.
- `existing-employees-seed.json`: planned insert rows/headers, không có Auth/profile/new employee.
- `existing-employees-input.json`: input overlay cho engine; dữ liệu mô phỏng local, chưa phải đăng ký được DB chấp nhận.
- `shortage-input.json`: bộ B khác UUID/scope, **không dùng để import vào scope M5 hiện tại**.
- `manifest.json`: SHA256 từng file và kết quả; không chứa assignment dựng sẵn.
- `postgres/`: rehearsal bộ A; `expanded-regression/`: kiểm tra bộ mở rộng cũ vẫn tương thích. Các plan SHA tại đây là synthetic/local, không được dùng làm quyền ghi nguồn.

Từ backend sau build, tạo snapshot mới và chạy fixture local (network chỉ GET, không import):

```powershell
node scripts/prepare-existing-employee-fixtures.cjs
node --test tests/existing-employee-fixtures.test.cjs
```

Muốn xem bộ B với input mới, gọi `generateSchedule` trên JSON đó trong test/script local; không cần API import mới. Muốn dùng bộ A trên website, phải đi qua các bước duyệt/schema/fresh prepare bên dưới. Không dùng test-preview (chế độ đó chặn lưu).

## Thay đổi local tối thiểu và bảo toàn provenance

Tái sử dụng `dev-import-executor.cjs`; thêm **fixture_policy=existing-employees-v1** chỉ cho trường hợp không tạo profile/employee. Policy cũ mặc định expanded-70-v1 vẫn kiểm 60–70/ngày như trước. Unknown policy hoặc policy existing kèm account/new employee đều bị chặn. Không thay engine, UI, TV2 validation, deadline, migration scope hay quyền bật dev context.

Vẫn batch allowlist **6e1d2026-1102-4000-8000-000000000017**, project/branch/kỳ cố định. Field sample_batch_id nằm trên header (schema row registration không có cột đó). Executor thực tế tạo batch audit, header VALID và row VALID với thời gian DB lúc import; file không giả submitted_at trước hạn. Receipt immutable/full after-image, checksum, idempotency và rollback dependency checks giữ nguyên. SQL M5/M6 nhận đúng batch/context/receipt, default source không nhận sample.

Vì dùng toàn bộ account cũ, **rollback không xóa employees**; test còn xác minh employee_skills không liên quan thêm sau import vẫn được giữ. Rollback vẫn bị chặn nếu có schedule hoặc after-image bị sửa; không xóa lịch sử/audit. Fresh baseline/plan sau migration vẫn bắt buộc; source đổi thì dừng, không sửa source để khớp fixture. Không dùng 17-account plan cũ để import bộ A.

## Dữ liệu giảng viên đưa vào bằng cách nào?

| Dữ liệu mới | Chức năng hiện có | Giới hạn cần nói đúng |
|---|---|---|
| Nhu cầu ngày × ca × bộ phận | QL: ManagerDemand, nhập/sửa/dán lưới; API `PUT /api/schedules/periods/:id/requirements`, có version check và skill/forecast reference | Chọn kỳ demo khác chưa có dữ liệu cần bảo toàn; không sửa 63/308 hiện tại để thử. Dán lưới đã có, không cần viết CSV import |
| Nguyện vọng | NV: ShiftRegistration; `PUT /api/registrations/:periodId/me`, owner từ token, VALID/overlap/deadline kiểm backend | Chỉ nộp kỳ naturally OPEN; hiện Lê Duẩn không OPEN. Không mở lại kỳ đóng. TV2 context tự chọn kỳ active/upcoming, không tuyên bố nhập arbitrary closed-period CSV trên UI |
| Phân nhóm kinh nghiệm | QL: EmployeeCompetency, `PATCH /api/employee-competencies/:id/skill-level` | Chỉ thay khi thật sự là dữ liệu mới được xác nhận, không đổi nhóm 60 nhân viên để làm đẹp kết quả |
| Xếp/sửa/AI/lưu/duyệt/xem/đổi ca | Các trang/API hiện có | Cần migration và flags được bật sau duyệt; thiếu người phải cảnh báo, không phân công ngoài VALID registration |
| Nhân viên/ca/bộ phận/kỳ mới hoàn toàn | Chưa xác minh có UI CRUD/import đầy đủ cho các loại này | Không tuyên bố hỗ trợ mọi file giảng viên. Nếu cần, chuẩn bị mapping/seed scoped bằng script hiện có và xin duyệt; không xây import UI trước khi yêu cầu thật sự cần |

Bộ B chứng minh engine xử lý quy mô/UUID/nhu cầu khác và thiếu availability, không phải web đã có dữ liệu cho case đó. Để demo website, nhu cầu/nguyện vọng mới phải vào đúng kỳ qua UI/API hoặc dev-import được duyệt. Đăng ký TV2 ở kỳ OPEN khác với workflow tuần đã đóng là hai case, không gọi là một E2E cùng kỳ đã PASS.

## Migration và thứ tự ngắn nhất

- Core lưu DRAFT/duyệt/publish/xem/đổi ca: **TV4 nền nếu thiếu → 20261101 → 20261102 → 20261103 → 20261104**.
- Với dữ liệu mẫu scoped vào kỳ đã đóng: cần thêm **20261105**; **20261106** giữ persist 308 dưới budget 3 giây (N+1 đã được đo/sửa). Không bỏ M6 cho demo này.
- Backup tối thiểu theo lựa chọn hiện có, duyệt bundle code mới → migration/postflight → **fresh prepare bộ A, missing_profiles=0** → duyệt digest import 51 headers/640 rows → bật dev-import/TV3/TV4/TV5 theo bước → QL preview/save, GS duyệt, QL publish, NV xem/đổi ca. Không có bước tạo Auth.
- Chọn NV/QL/GS mà chủ dự án đã đăng nhập được. Chuẩn bị một người thay có VALID availability và được backend xác minh; không ép chọn người không đăng ký. Case B thiếu người dùng để trình bày warning; workflow không được vượt coverage gate để công bố lịch thiếu.

**Hiện chỉ local chuẩn bị và rehearsal. Không migration, import, Auth creation hoặc source write.**

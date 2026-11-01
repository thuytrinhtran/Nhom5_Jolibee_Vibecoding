# TV3: preview kiểm thử Lê Duẩn, 02–08/11/2026

Chạy backend development riêng. Mặc định tắt; production không được tạo test preview.
Không sửa `.env` dùng chung. PowerShell, tại `backend`:

```powershell
$env:NODE_ENV='development'
$env:TV3_TEST_PREVIEW_ENABLED='true'
$env:TV3_TEST_PREVIEW_BATCH_ID='6e1d2026-1102-4000-8000-000000000017'
$env:TV3_DRAFT_PERSISTENCE_ENABLED='false'
npm.cmd run dev
```

Gọi bằng Bearer token TV1 của QL thuộc Lê Duẩn:

```http
POST /api/schedules/test-preview
Authorization: Bearer <token-QL>
Content-Type: application/json

{"period_id":"79a979cc-8347-48b5-a411-f03bd8aceb92"}
```

Không gửi batch/test mode hoặc danh sách nhân viên từ client. Backend chỉ cho batch
trên, đúng branch/kỳ/ngày; dùng auth/RBAC sẵn có. Endpoint `/preview` và nguồn đăng ký
thật không được bật include-samples bởi cấu hình này.

## Dữ liệu và giới hạn

- Chỉ SELECT nguồn thật qua repository Supabase hiện có. Không tạo Auth, nhân viên,
  registration, audit hay schedule trong DB. Không đổi deadline/trạng thái TV2.
- Fixture định danh bằng batch, được tạo và gắn header sample trong bộ nhớ. Bộ lọc
  TV2 dùng lại kiểm tra VALID/timestamp/branch/date/shift, chỉ chấp nhận đúng batch
  trong endpoint kiểm thử. Không mở nhận các sample batch từ Supabase.
- Tận dụng 51 người chưa có header kỳ này, thêm 17 nhân viên ảo: Bếp 6, Phục vụ 6,
  Thu ngân 5. Có 68 người trong fixture, 65 người/ngày, 560 lượt ca; cộng nguồn thật
  nhưng không thêm fixture cho bất kỳ nhân viên nào đã có header, kể cả DRAFT/OFF/sample.
- Giữ nguyên nhân viên thật, cơ cấu/kỹ năng/giới hạn đang cấu hình, nhu cầu và forecast.
  Nhân viên ảo không có giới hạn giờ mặc định. Ma trận ca có dư/thiếu đăng ký và thiếu
  kinh nghiệm, với ngày nghỉ luân phiên; không giới hạn tổng giờ đăng ký.
- Response có `kind=test-preview`, `source=test-fixture`, `persisted=false`, batch,
  UUID phân biệt nhân viên ảo/dòng fixture, số người khác nhau/ngày, shortage và cơ cấu.
  Timestamp fixture là lúc tạo preview, không giả thành nộp TV2 trước deadline.
- Sai/thiếu nguồn, đăng ký thật bị trùng giờ, thay đổi danh mục ca hoặc quy mô vượt
  60–70 người/ngày sẽ dừng; không tự sửa dữ liệu thật để làm fixture chạy được.
- Không nghiệm thu hành trình nộp TV2 hoặc Auth của 17 người ảo. Đây là kiểm thử đọc
  nguồn TV2 thật + fixture trong bộ nhớ → Rule Engine; không gọi AI ngoài hệ thống.

## Không cho ghi lịch

Trong backend bật test mode, tất cả thao tác ghi dưới `/api/schedules` bị chặn,
ngoại trừ hai thao tác tính toán `/preview` và `/test-preview`. Bao gồm ghi nhu cầu,
tạo/sửa DRAFT, AI có persistence, apply adjustment, gửi duyệt, TV4 công bố/trình lại.
Guard trong service vẫn chặn writer DRAFT ngay cả khi cờ persistence là true.
Preview test không có schedule ID; revision khác snapshot thật, không dùng để lưu
ở luồng thường sau khi tắt test mode. Các API TV2 giữ validation và deadline cũ.

Tắt process thử nghiệm để kết thúc. Không cần rollback DB vì overlay chưa từng lưu.
Nếu dùng lại terminal, xóa hai biến `TV3_TEST_PREVIEW_ENABLED`,
`TV3_TEST_PREVIEW_BATCH_ID`; không bật persistence để thử lưu kết quả fixture.

## Kiểm tra offline

Tại backend: đặt `NODE_OPTIONS=--require=./tests/helpers/offline-only.cjs` chỉ trong
process kiểm thử rồi chạy `npm.cmd test` và `npm.cmd run typecheck`. Không dùng preload
này cho server development vì nó chặn Supabase/Auth thật.

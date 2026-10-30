# TV3 — Giai đoạn 2: Tổng hợp đăng ký và cung–cầu nhân sự

Chỉ triển khai Giai đoạn 2 trên nhánh `feature/tri-auto-scheduling`. Không thay đổi schema/migration, không nhập dữ liệu thử lên Supabase, không triển khai CRUD nhu cầu, liên hệ bổ sung, sửa lịch, phê duyệt hoặc AI.

## Chạy và xem giao diện

Giữ nguyên cấu hình/auth hiện có. Đăng nhập bằng tài khoản **QL đã đổi mật khẩu và có chi nhánh**. Mock không bỏ qua đăng nhập hoặc phân quyền.

Chạy backend với dữ liệu Supabase thật (mặc định):

```powershell
cd backend
$env:NODE_ENV = 'development'
$env:SCHEDULING_DATA_SOURCE = 'supabase'
npm.cmd run dev
```

Hoặc bật dữ liệu mô phỏng rõ ràng, không cần sửa `.env`:

```powershell
cd backend
$env:NODE_ENV = 'development'
$env:SCHEDULING_DATA_SOURCE = 'mock'
npm.cmd run dev
```

Trong terminal khác:

```powershell
cd frontend
npm.cmd run dev
```

Mở `http://localhost:5173/manager/schedule`, chọn tuần bằng bộ chọn đang có. Khu vực **Tổng hợp đăng ký** nằm ngay dưới bộ chọn, có lọc ngày/ca/bộ phận. Mock có tuần cố định **02–08/11/2026**, nhãn **Dữ liệu mô phỏng (MOCK)** và khóa thao tác tạo lịch thật. Dừng backend rồi đổi `SCHEDULING_DATA_SOURCE` thành `supabase` để dùng dữ liệu thật; tải lại trang/tuần.

`mock` chỉ được chấp nhận khi `NODE_ENV=development` và `SCHEDULING_DATA_SOURCE=mock`. Chế độ production/test hoặc giá trị cấu hình không hợp lệ trả lỗi, không âm thầm dùng mock. Database lỗi cũng không fallback. Cờ là cấu hình server, không phải query/header do client chọn. Không cần thêm biến frontend.

## API và data contract

`GET /api/schedules/periods/:id/registrations-summary`

- Header: `Authorization: Bearer <access_token>`.
- Chỉ role QL; chi nhánh lấy từ `req.user.branch_id`, không tin `branch_id` client truyền.
- Bộ lọc tùy chọn: `work_date=YYYY-MM-DD`, `shift_id=<UUID>`, `department_id=<UUID>`.
- Sai định dạng: 400; chưa đăng nhập: 401; sai role: 403; đợt ngoài chi nhánh/không tồn tại: 404; database hoặc cấu hình nguồn lỗi: 503.
- Trả `{ status: 'ok', result: { source, is_mock, branch, period, new_employee_count_threshold, rows, warnings, notes } }`.
- Mỗi dòng chứa chi nhánh, đợt, ngày, ca/giờ ca, bộ phận, `registered_count`, `eligible_count`, `confirmed_eligible_count`, `required_count`, `balance`, `shortage_count`, `surplus_count`, `status`, `exclusions`, `warnings`.
- `status`: `BALANCED`, `SHORTAGE`, `SURPLUS`, `UNKNOWN` là kết quả tổng hợp, không phải trạng thái của bảng `schedules`.

Tái sử dụng `GET /periods` và `GET /periods/:id` cho tuần và dữ liệu hiện tại. Trong mock mode hai API này đọc cùng fixture; `context.source` cho frontend biết nguồn. `POST /generate` và `GET /:scheduleId` bị chặn bằng `MOCK_READ_ONLY` khi mock bật, kể cả caller gọi trực tiếp service. Không đưa mock ID sang RPC ghi lịch thật.

## Cách tính

1. Chỉ lấy đăng ký `VALID`, đúng đợt/ngày và nhân viên thuộc chi nhánh QL. Bộ phận lấy từ `employees.department_id`, vì schema đăng ký không có bộ phận riêng.
2. Khử trùng bằng nhân viên + ngày + ca + bộ phận. `registered_count` phản ánh số nhân viên có đăng ký VALID, tách biệt việc hồ sơ hiện còn phù hợp để phân công hay không.
3. `eligible_count` tái sử dụng `generateSchedule` của engine hiện có để kiểm tra từng người độc lập cho một vị trí; chỉ tính toán trong bộ nhớ, không lưu/phân công. Kiểm tra trạng thái, role NV, bộ phận, tên kỹ năng, overlap, giờ tuần. Crew Leader bị loại khỏi ứng viên cho nhu cầu thường.
4. Các phân công chưa REPLACED đang có, kể cả bản nháp, được xem là bận. Người đã được xếp vào ca cũng có thể không còn đủ điều kiện **nhận thêm** ca đó. Tổng hợp này không phải kế hoạch phân công đồng thời và không bảo đảm cộng ứng viên các ca là số người duy nhất toàn tuần.
5. `balance = eligible_count - required_count`; thiếu = max(0, -balance); thừa = max(0, balance). “Thừa” là thừa ứng viên đủ điều kiện, không phải lịch đã phân công dư.
6. Nhu cầu bằng 0 được khai báo rõ là hợp lệ. Không có nhu cầu khác với 0: trả `null` cho nhu cầu/thiếu/thừa và `UNKNOWN`; không tự suy ra nhu cầu từ Sales Forecast.
7. Nhu cầu trùng/sai, thiếu hồ sơ/kỹ năng bắt buộc hoặc ca không hợp lệ được cảnh báo. Nếu chưa đánh giá được toàn bộ ứng viên, `eligible_count=null`; `confirmed_eligible_count` chỉ là số đã xác nhận qua kiểm tra, không dùng để kết luận đủ người.
8. Nhân viên đăng ký thuộc bộ phận khác không được cộng sang bộ phận đang thiếu. Hiển thị cảnh báo giải thích, không tự đổi bộ phận của họ.
9. Đánh giá mức thành thạo theo chính sách mới chưa triển khai trong Giai đoạn 2; engine hiện kiểm tra tên kỹ năng đã cấu hình. Không tự đặt bậc proficiency hay định mức.

## Ngưỡng NEW

Đối chiếu **phụ lục cuối Design, mục 5 Cảnh báo và TC-AI02**: điều kiện đã được người dùng xác nhận là `new_count >= threshold AND crew_training_count = 0`. Đã sửa so sánh của engine và test biên tương ứng. Nguồn ngưỡng thật là `warning_configs.new_employee_count_threshold`; không hard-code ngưỡng.

Summary trả ngưỡng cấu hình; khi NULL UI hiện **Chưa đủ dữ liệu đánh giá**. Không dùng tập ứng viên đăng ký để giả làm cơ cấu người đã được phân công. Đánh giá trên lịch vẫn thuộc luồng lịch dự kiến hiện có. Kết quả lịch mới lưu kèm ngưỡng; kết quả cũ thiếu trường này cũng được hiển thị chưa đủ dữ liệu.

## Repository và dữ liệu mô phỏng

`RegistrationSummaryRepository` có cùng `listPeriods(branchId)` và `load(branchId, periodId)` cho hai adapter:

- Mock: fixture tổng hợp thuần bộ nhớ, không import Supabase; Bếp đủ người; Thu ngân thiếu người; Phục vụ thừa ứng viên; đăng ký trùng; Bếp có ứng viên thiếu kỹ năng; nhân viên Phục vụ không thể bù nhu cầu Bếp; đăng ký chưa có nhu cầu.
- Supabase: chỉ SELECT trên bảng đang có, phân trang để không cắt số lượng ở giới hạn PostgREST. Đọc đợt trong chi nhánh trước rồi mới lấy dữ liệu khác. Truy vấn tên/kỹ năng và quan hệ tài khoản cần thiết, không lấy email, điện thoại hay secret.

API/frontend dùng cùng contract, không phân nhánh tính toán theo nguồn. Xác thực luôn dùng hệ thống thật. Bộ tổng hợp không cần RPC/migration tạo lịch.

## File tạo/sửa trong Giai đoạn 2

Tạo:

- `backend/src/repositories/registration-summary.types.ts`
- `backend/src/repositories/registration-summary.mock.ts`
- `backend/src/repositories/registration-summary.supabase.ts`
- `backend/src/repositories/registration-summary.repository.ts`
- `backend/src/services/registration-summary.service.ts`
- `backend/tests/registration-summary.test.cjs`
- `backend/tests/registration-summary-api.test.cjs`
- `frontend/src/pages/manager/RegistrationSummaryPanel.tsx`
- `frontend/tests/registration-summary.test.cjs`
- `docs/tv3-phase2.md`

Sửa bổ sung trên nội dung đang có:

- `backend/src/services/scheduling.service.ts`
- `backend/src/services/scheduling.engine.ts`
- `backend/src/routes/scheduling.routes.ts`
- `backend/tests/scheduling.test.cjs` — sửa test biên theo quy tắc NEW đã xác nhận.
- `backend/tests/scheduling-read-api.test.cjs` — stub hỗ trợ phân trang của repository.
- `frontend/src/types/scheduling.ts`
- `frontend/src/services/scheduling.service.ts`
- `frontend/src/pages/manager/ManagerSchedule.tsx`
- `frontend/src/pages/manager/ManagerSchedule.css`
- `frontend/tests/scheduling.test.cjs` — giữ các ca cũ, bổ sung kiểm tra khóa tạo lịch thật trong mock và cô lập component tổng hợp trong test lịch.
- `docs/automatic-scheduling.md` — cập nhật tham chiếu quy tắc và báo cáo Giai đoạn 2.

Không thay đổi `server.ts`, `App.tsx`, schema hoặc các migration trong lượt triển khai Giai đoạn 2; các thay đổi đã có từ trước vẫn được giữ nguyên.

## Kiểm thử thực tế

Chạy trong môi trường kiểm thử mặc định/Supabase mode, không để shell test kế thừa `SCHEDULING_DATA_SOURCE=mock` của terminal development:

```powershell
$env:SCHEDULING_DATA_SOURCE = 'supabase'
```

- Backend: `npm.cmd run typecheck` đạt; `npm.cmd test`: **57 pass, 0 fail, 1 skip**.
- Frontend: `npm.cmd run typecheck`, `npm.cmd run build` đạt; `npm.cmd test`: **27 pass, 0 fail**.
- Test bao gồm khử trùng, VALID-only, ba bộ phận, thiếu/thừa, sai kỹ năng/bộ phận, hồ sơ/nhu cầu thiếu, không có đăng ký, phạm vi QL, filter, pagination, hợp đồng Mock/Supabase, không fallback, khóa ghi trong mock, ngưỡng NEW tại đúng biên và UI loading/error.
- Kiểm tra Supabase **chỉ đọc bằng HEAD, không lấy dòng dữ liệu** đã xác minh các cột/quan hệ `employees`, `employee_skills`, `shift_assignments`, `warning_configs`, `registration_periods` dùng cho adapter truy vấn hợp lệ.
- Test PostgreSQL transaction của chức năng tạo lịch cũ vẫn skip vì chưa cấu hình database thử nghiệm. Không chạy migration hoặc ghi fixture lên Supabase chung.
- Chưa kiểm thử trực quan bằng trình duyệt hoặc end-to-end với tài khoản QL thật và dữ liệu đăng ký TV2 thật. Test frontend dùng React render/harness; test hợp đồng adapter dùng Supabase stub, không giả nhận là kiểm thử DB đầy đủ.

## Chờ TV2 và phạm vi còn lại

TV2 cần cung cấp dữ liệu thật trong `registration_periods`/`shift_registrations`, bảo đảm trạng thái VALID đúng nghiệp vụ, UUID và liên kết nhân viên/ca, thời điểm gửi/sửa và quy tắc deadline. Khi dữ liệu có, dùng adapter Supabase; không viết lại UI/logic tổng hợp và không yêu cầu API TV2 phải hoàn tất trước để demo mock.

Cần xác nhận quy tắc nguồn dữ liệu khi có nhiều phiên bản lịch để tránh tính tất cả phiên bản thay thế thành lịch bận. Hiện giữ cách bảo thủ của engine hiện có. Các truy vấn tổng hợp là read-only nhiều bảng, không phải snapshot transaction; dữ liệu có thể thay đổi trong lúc đọc và phải kiểm tra lại khi phân công.

Không triển khai Giai đoạn 3: chưa có form CRUD nhu cầu/forecast/định mức hoặc chính sách đánh giá proficiency mới. Không làm liên hệ bổ sung, chỉnh sửa phiên bản, TV4 submit hoặc AI thật.

# Hợp đồng tích hợp nền tảng TV1 – 29/10/2026

Phạm vi: nhánh `feature/ui-ux-improvements`, repository `D:/Project/Nhom5_Jolibee_Vibecoding`. Không thay đổi database hoặc code nghiệp vụ TV2–TV5.

## Danh tính và phiên

- Frontend dùng `useAuth().user` và service hiện có; không dựng thêm role/chi nhánh từ localStorage hoặc `user_metadata`.
- Backend dùng `authenticate` cho API nghiệp vụ; `authenticateSession` chỉ dành cho vòng đời Auth. Sau đó dùng `requireRole` và kiểm tra phạm vi dữ liệu.
- `user.id` là `public.users.id`/Auth UUID. **`user.employee.id` là `employees.id`**, dùng cho `shift_registrations.employee_id`. Không thay thế bằng user UUID, username hoặc mã nhân viên.
- `user.branch_id` lấy từ hồ sơ database; role NV/QL/GS khác với cấp độ NEW/REGULAR/CREW_TRAINING/CREW_LEADER.
- Login, me, refresh dùng chung `loadProfileDetails`; lỗi đọc bảng chi nhánh/nhân viên trả 503, không âm thầm trả thông tin thiếu như một phản hồi thành công.
- Hồ sơ employee có thể null: chức năng cần employee phải chặn và báo thiếu cấu hình, không tự tạo employee.
- Không dùng Secret/service-role ở Frontend. Nếu TV2 gọi Supabase trực tiếp, phải kiểm tra RLS bằng JWT người dùng; middleware Express không bảo vệ những request đó.

## Mã HTTP

| Mã | Ý nghĩa / hành vi phía gọi |
| --- | --- |
| 400 | Input không hợp lệ; sửa form |
| 401 | Thông tin xác thực/phiên thực sự không hợp lệ |
| 403 | Không có quyền; `PASSWORD_CHANGE_REQUIRED` yêu cầu đổi mật khẩu |
| 429 | Giới hạn tần suất; chờ thử lại, không xóa phiên |
| 503 | Dịch vụ phụ thuộc chưa sẵn sàng; không xóa phiên |
| status 0 phía frontend | Mạng/timeout, kể cả khi đọc body; không xóa phiên |

Envelope hiện có: `{ status: 'ok', ...payload }` hoặc `{ status: 'error', message, code? }`. Không đổi envelope của module khác trong đợt này. Phản hồi phiên cũ bị loại với code `SESSION_CHANGED`; không dùng để xóa phiên mới.

## Kiểm tra phạm vi phía Backend

`data-scope.middleware.ts` cung cấp `requireEmployeeOwner` (NV, employee đúng chủ) và `requireBranchScope` (QL: branch hồ sơ; GS: `branches.supervisor_id`). Cả hai chặn tài khoản đang phải đổi mật khẩu. Phải đặt sau `authenticate` và `requireRole`.

Với đọc/sửa/xóa theo ID, tải row từ database rồi truyền employee/branch của row vào guard; không chỉ tin branch_id/employee_id trong body. Với truy vấn danh sách, lọc ngay SQL/PostgREST theo chủ sở hữu/phạm vi; không tải mọi dữ liệu rồi lọc ở Frontend. Với tạo mới, suy ra employee từ req.user và kiểm tra period/shift trong database. Không cung cấp bypass GS toàn hệ thống.

Hiện nhánh chỉ có API Auth và các endpoint kiểm thử role; chưa có API nghiệp vụ TV2–TV5 để gắn guard. Guard mới **chưa bảo vệ các API chưa tích hợp**. Không thể tuyên bố đã kiểm thử quyền ghi đăng ký của TV2.

## Đăng ký nguyện vọng: schema đã đọc thực tế

- `registration_periods`: id, branch_id, work_start_date, work_end_date, open_at, close_at, status, created_at.
- `shift_registrations`: id, period_id, employee_id, work_date, shift_id, status, submitted_at, updated_at. Không có cột branch_id hoặc user_id.
- `shifts`: id, name, start_time, end_time, branch_id (có thể null cho ca chung), is_active.
- Khóa tự nhiên trong SQL dự án: `(period_id, employee_id, work_date, shift_id)`. Trạng thái đăng ký: DRAFT/VALID/INVALID; đợt: PLANNED/OPEN/CLOSED.
- `docs/Jollishift.sql` có trigger `validate_shift_registration`, gồm quy tắc Crew Leader không đăng ký nguyện vọng. Không sửa quy tắc này trong TV1.
- Ngày làm là date `YYYY-MM-DD`; open_at/close_at là timestamptz. Tránh đổi date qua UTC làm lệch ngày; TV2 cần kiểm tra chính sách thời gian của đợt trước khi lưu.

Những mục trên là hợp đồng cần TV2 đối chiếu với code đang gặp lỗi; **chưa phải kết luận TV2 đã dùng sai**. Cần cung cấp commit/code API hiện tại, HTTP status, mã lỗi PostgREST và thao tác gây lỗi (không token/password/payload nhạy cảm) để xác định nguyên nhân.

## Kết quả đọc Supabase

Chạy `node backend/scripts/audit-integration.cjs` từ thư mục gốc (script tự đọc backend/.env, chỉ GET). Kết quả ngày 29/10/2026:

- Auth health và PostgREST truy cập được.
- 72 users, 70 employees; Lê Duẩn 60, Hải Châu 10; 3 departments, 4 registration_periods, 474 shift_registrations, 6 shifts.
- Không thấy trùng username/employee user/khóa đăng ký; không thấy lỗi role/status/skill, liên kết employee–user–branch–department, phạm vi/ngày đăng ký hoặc đăng ký Crew Leader trong các kiểm tra script.
- **Cả hai branches.supervisor_id đang null.** Guard GS theo schema sẽ không cho truy cập hai chi nhánh này. Không tự gán GS hoặc mở rộng quyền; cần người quản lý xác nhận phân công trước khi đề xuất SQL riêng.

Giới hạn: OpenAPI mô tả PK/FK public nhưng không chứng minh toàn bộ CHECK/UNIQUE/trigger/RLS đã triển khai, FK auth liên schema hoặc quyền ghi của JWT NV. Script không chạy SQL, không tạo phiên và không sửa dữ liệu. Dữ liệu TEST giữ nguyên.

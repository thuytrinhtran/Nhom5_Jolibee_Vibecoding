> **B?n hi?n h?nh 30/10/2026:** xem [b? tri?n khai cu?i](tv2-release/final/README.md). Nh?ng m? t? M1/M2, l?ch th? N?m, automation ch?a l?p tr?nh ho?c ph??ng ?n 05 trong t?i li?u c? b?n d??i ch? ?? truy v?t, kh?ng ph?i h??ng d?n rollout hi?n t?i.

# TV2: nghiệp vụ cuối cùng trước Supabase TEST

Nhánh feature/Lichlamnhanvien. Bản này thay thế hướng dẫn OFF riêng và lịch thứ Năm trước đây. Không có thao tác migration/seed/cloud write/Git commit-push-merge.

## Quy tắc đã triển khai

- Chỉ chọn những ca có thể làm; nhiều ca/ngày được phép nếu không giao nhau, kể cả ca qua đêm. DEMO 08–12, 12–17, 17–22; production lấy shifts từ database.
- Không có checkbox OFF, off_dates payload, RPC p_off_dates hoặc bảng OFF được tạo bởi migration hiện tại.
- Chưa gửi/nháp/INVALID: ngày trống là NOT_SUBMITTED, không phải OFF.
- Header VALID + submitted_at xác nhận gửi: ngày có ca là SHIFT, ngày không có ca là OFF. Không lưu thêm các ngày OFF.
- Có thể gửi 0 ca sau xác nhận rõ ràng để khai báo nghỉ cả tuần; lưu nháp rỗng vẫn chưa gửi. INVALID được giữ trong CHECK để tương thích trạng thái nhưng payload sai bị từ chối/rollback thay vì ghi đè bản hợp lệ.
- Lưu nháp sau khi đã gửi làm bản hiện tại trở lại DRAFT, submitted_at=NULL; cần gửi lại để xác nhận. Các hành động cũ vẫn nằm trong audit_logs. UI khi đang chỉnh chưa lưu không gắn OFF cho các thay đổi chưa gửi.
- Crew Leader không tham gia biểu mẫu thật; Auth TV1 giữ nguyên.

## Thời gian chính thức

Mở thứ Sáu 15:00, đóng Chủ nhật 12:00, tuần làm kế tiếp thứ Hai–Chủ nhật, Asia/Ho_Chi_Minh. Nhắc T-30, tức 11:30 Chủ nhật. Ví dụ tuần 02–08/11/2026 mở 30/10/2026 15:00 = 08:00 UTC, đóng 01/11 12:00 = 05:00 UTC. Không chỉnh đồng hồ hoặc thời gian của đợt hiện hữu.

Nguồn cấu hình production sau khi áp dụng đủ migration: registration_schedule_config với weekday=5/time=15:00, close weekday=7/time=12:00, reminder=30. DEMO mở ngay 2 giờ trong bộ nhớ để phát triển và hiển thị cùng quy tắc định kỳ; không thay đổi đồng hồ production.

## API

GET /api/registrations/current ưu tiên OPEN và open_at <= now < close_at. Nếu không có, lấy kỳ sắp mở PLANNED/OPEN; cuối cùng lấy kỳ gần nhất để xem. CLOSED còn close_at tương lai không che kỳ OPEN. Test hồi quy dùng HTTP và PostgreSQL cô lập.

PUT /api/registrations/:periodId/me chỉ nhận mode=draft/submit và preferences=[{work_date,shift_id}]. Danh tính lấy từ token đã xác thực, không nhận employee_id/off_dates. GET trả registrations, submission (status/errors/submitted_at/updated_at), period/shifts/schedule/employee/server_now. Lưu ca, header và audit cùng transaction. Deadline/RBAC/chi nhánh/Crew Leader/trùng ca đều kiểm tra ở backend/RPC.

## M1 và M2 hiện tại

1. M1: backend/migrations/20261029_employee_registration.sql tạo registration_submissions (có submitted_at và CHECK VALID phải có thời điểm gửi), registration_automation_config mặc định disabled, RPC lưu 4 tham số, audit và automation nền theo Design.
2. M2: backend/migrations/20261029_registration_off_schedule.sql giữ tên file để dễ theo dõi lịch sử, nhưng chỉ tạo registration_schedule_config và thay automation để dùng cấu hình tập trung. Không tạo/đọc/xóa bảng OFF; không DROP hàm hay bảng cũ. M2 kiểm tra M1 mới có submitted_at, từ chối RPC thử nghiệm 5 tham số.

Bảng header và config RLS bật; service_role chỉ SELECT trực tiếp, ghi qua SECURITY DEFINER RPC; PUBLIC/anon/authenticated không được gọi RPC privileged. Migration không thay users/employees/Auth hoặc các đợt hiện có.

Chỉ sửa file migration chưa triển khai. Nếu môi trường đã áp dụng bản M1/M2 thử nghiệm trước đây, dừng và chuẩn bị forward migration được duyệt riêng; không chạy đè, không xóa bảng cũ. M1/M2 là migration apply-once, không phải script chạy lặp. Automation riêng có UNIQUE(branch,week), advisory lock và idempotency_key để chạy lặp an toàn.

## Dữ liệu cho TV3

Dùng docs/tv2-release/tv3-contract.sql: truy vấn 1 đếm ca từ header VALID có submitted_at và dòng ca VALID; truy vấn 2 trả employee_id, users.username, tuần/ngày, trạng thái và timestamps, declaration=NOT_SUBMITTED/SHIFT/OFF. Thiếu ca chỉ suy ra OFF sau khi đã xác nhận gửi. Không có API/view TV3 được tạo trong lần này.

## Quy trình triển khai cần duyệt

- Xác nhận đúng project và chạy docs/tv2-release/preflight.sql (chỉ SELECT).
- Kiểm tra lịch sử migration của nhóm: M1, M2 chưa có thì duyệt hash/nội dung và áp dụng M1 rồi M2 một lần; ghi nhận từng version vào quy trình triển khai của nhóm. Nếu object tồn tại/migration lỗi thì kiểm tra catalog, không chạy lại tùy tiện.
- DB nhóm đã có foundation/Auth thì không chạy lại chúng. DB TEST trống có generator riêng, chỉ xuất SQL để duyệt.
- Chuẩn bị ca thật và kỳ đúng giờ; automation mặc định disabled, chỉ bật token/scheduler sau khi được phê duyệt.
- Chỉ sau khi DB TEST sẵn sàng mới chạy smoke test API thật. Không tự tắt VITE_TV2_DEMO trên máy này.

## File và phạm vi

Frontend: ShiftRegistration.tsx, CSS, registration-selection.ts, registration.service.ts, registration-mode.ts, registration-demo.ts. Backend: validation.ts, registration.routes.ts; M1/M2 và check-tv2-readiness.cjs. Cập nhật các test đăng ký, adapter PostgreSQL, browser scripts, preflight/contract TV3 và seed/verify/cleanup TEST. Không sửa Auth/sidebar/dashboard hoặc code TV3–TV5.

Cần trưởng nhóm duyệt việc áp dụng M1/M2, ca/kỳ thật, cấu hình scheduler; ghi nhận sự đơn giản hóa OFF và việc gửi 0 ca xác nhận nghỉ cả tuần. Không có quyền sửa database nhóm tự động.

URL DEMO: http://localhost:5173/employee/register. DEMO vẫn bật. Sẵn sàng thử trên Supabase TEST sau khi project riêng và migrations được chuẩn bị; chưa xác nhận persistence/Auth trên Supabase cloud.

## Kết quả kiểm tra lần cuối

- Backend: 38 test đạt, 0 fail, 0 skip; frontend: 20 test đạt, 0 fail, 0 skip. Typecheck/build hai phía đạt.
- Regression API với CLOSED còn deadline tương lai và PLANNED sắp mở: OPEN đang trong hạn được ưu tiên. Khi không còn OPEN, kỳ sắp mở được chọn để xem và không được ghi trước hạn.
- PostgreSQL: 1/3 ca liền nhau, ca chồng giờ/qua đêm, DRAFT không OFF, VALID có timestamp mới suy ra OFF, gửi 0 ca/7 OFF, sửa và đọc lại, quyền/chi nhánh/Crew Leader/deadline đều đạt.
- Clock fixture chỉ trong database cô lập: trước thứ Sáu 15:00 không tạo kỳ; đúng 15:00 tạo một lần, lần gọi lặp không trùng; Chủ nhật 11:29:59 chưa nhắc, 11:30 nhắc một lần, đã gửi nghỉ cả tuần không bị nhắc, 12:00 đóng.
- Browser DEMO: 7 thẻ, không checkbox OFF, lưu nháp/gửi/sửa/reset/đóng, 0 API đăng ký. Laptop 1366 có 4 cột/2 hàng, tablet 1024 có 2 cột, mobile 390 có 1 cột; không tràn ngang. Form laptop ban đầu khoảng 605px.
- Browser không DEMO dùng Express + PostgreSQL/Auth fixture riêng: login, draft, submit, reload, chỉnh 3 ca và khóa sau hạn đạt; ngày trống chỉ hiển thị OFF sau gửi. Đây chưa phải test Supabase Auth/PostgREST thật.
- Không áp dụng SQL hoặc sửa dữ liệu Supabase nhóm; không đổi backend/.env hay flag DEMO.

Danh sách version/hash để trưởng nhóm đối chiếu trước khi chạy: tv2-release/migration-manifest.json. Các filename M1/M2 giữ nguyên theo yêu cầu; nếu chuyển sang Supabase CLI auto-discovery cần duyệt prefix version riêng (hai file hiện cùng ngày), không dùng nguyên prefix ngày làm định danh trùng. Với SQL Editor, ghi nhận hai deployment_id riêng và thứ tự M1 → M2.

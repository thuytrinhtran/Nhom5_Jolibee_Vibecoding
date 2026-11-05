# Công bố lịch và ngoại lệ thời gian đăng ký local

Ngày 03/11/2026, project `wlbpprpiieonjrqglicv`. Không chạy migration/import, không tạo Auth, không tự lưu đăng ký hoặc công bố, không commit/push.

## A. Công bố

Kiểm tra SELECT: lịch `969c3446-9357-40ef-a40e-1296cca573b8`, v1, APPROVED, 308 phân công, một quyết định APPROVED; published_at và feedback_deadline_at còn NULL. Quản lý tạo lịch `ql_jollibee` active. TV4 workflow bật và đúng scope; gửi/duyệt đã hoạt động thực tế.

Người dùng xác nhận nút hiện biểu tượng cấm, không thể bấm: đây là trạng thái disabled phía frontend, chưa phải lỗi RPC công bố. Trong code nút bị disabled khi chưa nhập thời hạn phản hồi; trường datetime-local cần đủ ngày và giờ. Không thu thập trực tiếp DOM/giá trị trường từ phiên trình duyệt; không khẳng định lỗi SQL từ một thao tác chưa gọi API.

Đã làm rõ thông báo cạnh trường: nhập thời hạn tương lai để bật Công bố lịch; chặn ngày lỗi/quá khứ ở frontend, kiểm tra lại khi xác nhận và backend trước RPC. Modal xác nhận hiển thị thời hạn đã chọn. SQL vẫn kiểm tra APPROVED có quyết định duyệt, version/quyền/hard constraints và deadline tương lai. Không tự chọn deadline thay người dùng, không bỏ phê duyệt.

**Thao tác:** Quản lý mở `http://localhost:5173/manager/publish` → tải lại/Làm mới → mở thẻ Lê Duẩn APPROVED → nhập đủ **Thời hạn phản hồi** ở tương lai → **Công bố lịch** → **Xác nhận**. Nếu vẫn thấy biểu tượng cấm sau khi nhập đủ, hoặc API trả lỗi, cần giữ nguyên trạng thái và gửi nguyên văn thông báo; không sửa DB để ép công bố.

## B. Đăng ký ca linh hoạt

Trong `backend/.env`:

```ini
REGISTRATION_DEV_TEST_MODE=true
REGISTRATION_DEV_PG_CONNECTION_FILE=D:/JolliShift-private/minimal-backup/deployment-connection.json
REGISTRATION_DEV_PG_CLIENT=D:/JolliShift-private/tv3-postgres-tools/node-client/node_modules/pg
```

Chỉ backend development, đúng project, đúng branch `11111111-1111-1111-1111-111111111111`, period `7f48f53e-d707-4a32-9f15-eb32aeb0095a`, ngày 09–15/11/2026. Kỳ 02–08/11 không có ngoại lệ. Không đổi open_at/close_at/stored status trong DB; logic thời gian gốc giữ nguyên.

GET current ưu tiên kỳ test ở đúng chi nhánh, trả `registration_window.dev_test_override=true`; frontend lấy chính xác cờ backend này để giữ form mở dù timer qua deadline. Không có flag frontend độc lập. Hiển thị ghi chú ngắn dữ liệu vẫn lưu thật.

RPC save_employee_registration hiện có **hai clock gate SQL** nên bỏ chặn frontend/backend đơn thuần không đủ. Giữ nguyên RPC, không CREATE/ALTER function trên Supabase. Với đúng ngoại lệ, backend sử dụng client PG/config riêng **đã có**, TLS xác minh, đúng project/user/session pooler và transaction trực tiếp. Browser không nhận kết nối/password/key. Những kỳ khác tiếp tục dùng RPC gốc.

Transaction dev-only giữ trình tự khóa period rồi employee, xác minh lại users/employee/branch/role NV/active/không CREW_LEADER; khóa cấu hình ca; tái sử dụng validatePreferences cho phạm vi ngày, ca hoạt động/chi nhánh, trùng nguyện vọng và trùng giờ qua đêm, tối đa 500. Khi nhân viên chủ động Lưu nháp/Gửi, thay thế đúng nguyện vọng của chính nhân viên trong kỳ test theo semantics RPC gốc, timestamp thực và audit thêm dev_test_window=true; lỗi bất kỳ rollback. Không tự tạo đăng ký khi khởi động/bật flag; không xóa dữ liệu nhóm hoặc kỳ đã duyệt. Việc sửa lựa chọn của chính nhân viên qua web vẫn là thay thế bộ nguyện vọng của họ như luồng gốc.

**Dùng:** nhân viên mở `http://localhost:5173/employee/register`, tải lại trang, phải thấy tuần 09–15/11 và ghi chú Kiểm thử local → chọn ca → Lưu nháp hoặc Gửi đăng ký. API vẫn lấy user từ token, không nhận employee_id/branch_id giả mạo. Không dùng nút DEMO/memory store.

**Tắt:** đổi `REGISTRATION_DEV_TEST_MODE=false`, khởi động lại backend, tải lại trang. Không phải migration/rollback DB, không xóa đăng ký đã lưu. API/form trở về giờ mở/đóng gốc; normal RPC được sử dụng lại. Hai biến đường dẫn private không cần xóa nhưng không được truy cập khi flag tắt.

## C. Lịch nhân viên và kiểm tra sau công bố

SELECT thực tế cuối bước: lịch vẫn APPROVED; `nv_jollibee` và `nv_jollibee_02` mỗi người có 5 phân công, employee_schedule_week trả 0 ca vì chưa PUBLISHED. Không gọi transition ghi để thử.

Sau khi người dùng tự công bố: đăng nhập lần lượt hai tài khoản (hoặc cửa sổ riêng), mở `http://localhost:5173/employee/schedule`, chọn tuần 02–08/11/2026, bấm Tải lại. Mỗi người dự kiến 5 ca của chính mình, đúng ngày/giờ/bộ phận. Chưa thể xác nhận kết quả sau công bố trước khi người dùng thực hiện; không báo PASS vòng đời chưa chạy. DRAFT/PENDING/APPROVED không phải lịch chính thức.

## D. Kiểm thử và vận hành

- Backend build/typecheck PASS; regression 11 PASS/2 SKIP. Bao gồm route đăng ký thực với SDK mock, sở hữu từ token, flag tắt trở về gate gốc, old period không ghi, deadline công bố, validation và lịch nhân viên.
- Riêng PostgreSQL native cô lập loopback: 3 PASS, trong đó integration test thực kiểm tra RPC gốc chặn thời gian, dev writer lưu hợp lệ khi CLOSED, chặn trùng/sai ngày/sai quyền, audit lỗi rollback, kỳ khác giữ nguyên. Không kết nối Supabase trong test ghi này.
- Frontend build/typecheck PASS; regression 19 PASS, gồm đăng ký/exception backend, lịch cá nhân, deadline công bố và API workflow không mock fallback.
- Backend đã khởi động lại, health/db-health 200. Frontend Vite đang chạy, module mới có validator deadline và server override. Hai trang publish/register HTTP 200.
- Supabase thật trong bước này chỉ SELECT; bằng chứng `read-only-check.json`. Các body RPC/trigger phục vụ phân tích được lưu ngoài repository, không chứa password trong báo cáo.

File chính: `backend/src/registrations/dev-test-window.ts`, `backend/src/routes/registration.routes.ts`, `backend/src/services/schedule-workflow.service.ts`, `frontend/src/pages/schedules/ScheduleWorkflow.tsx`, `frontend/src/pages/employee/ShiftRegistration.tsx`, `frontend/src/services/registration.service.ts`, tests liên quan và backend/.env.

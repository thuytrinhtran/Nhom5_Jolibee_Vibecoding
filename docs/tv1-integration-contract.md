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

Cập nhật sau tích hợp TV2–TV4: nhánh đã có API đăng ký, nhu cầu, lập lịch và workflow. API đăng ký dùng guard chủ sở hữu; API quản lý dùng role và branch từ phiên, repository/RPC kiểm tra phạm vi tương ứng. Guard chung không tự bảo vệ mọi route: cần kiểm thử riêng từng module. Chưa thể dùng test mock để tuyên bố quyền ghi JWT thật hoặc luồng xuyên module đã đạt.

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
- Lần rà soát mới nhất ngày 29/10/2026 xác nhận **cả hai chi nhánh cùng thuộc GS `gs_jollibee`**, UUID `521a77f3-2a2d-421b-b115-70cef8d78f79`, role GS, đang hoạt động. Hai `branches.supervisor_id` cùng trỏ đến `public.users.id` này. Kết quả này thay thế ghi nhận `null` trước đó; TV1 không thực hiện UPDATE.

Giới hạn: OpenAPI mô tả PK/FK public nhưng không chứng minh toàn bộ CHECK/UNIQUE/trigger/RLS đã triển khai, FK auth liên schema hoặc quyền ghi của JWT NV. Script không chạy SQL, không tạo phiên và không sửa dữ liệu. Dữ liệu TEST giữ nguyên.

## Quyền dữ liệu thống nhất

| Vai trò | Phạm vi | Điều kiện tích hợp |
| --- | --- | --- |
| NV | Dữ liệu của employee liên kết với tài khoản | Suy ra employee từ phiên; chỉ đọc lịch công bố/phân công của mình, đăng ký và yêu cầu liên quan đến mình. Không cho tự duyệt/công bố hoặc sửa phân công chính thức. |
| QL | Chi nhánh `users.branch_id` | Kiểm tra branch của period/schedule/assignment trong database; không mở quyền chi nhánh khác bằng tham số client. Quyền xử lý đổi ca theo quy trình nghiệp vụ đã duyệt. |
| GS | Tập các branches có `supervisor_id = user.id` | Một GS được phụ trách nhiều chi nhánh; không giới hạn bằng `users.branch_id` của GS. Quyền duyệt cần lịch thuộc chi nhánh phụ trách. |

Mọi API nghiệp vụ phải kiểm tra active, yêu cầu đổi mật khẩu, role và phạm vi. Danh sách phải lọc phía Backend/database. Một row không tồn tại/ngoài quyền không được làm lộ dữ liệu qua response lỗi. `requireBranchScope` không thay `requireRole`, không tự cấp quyền NV đọc mọi dữ liệu cùng chi nhánh.

Theo SQL nền, anon/authenticated bị thu hồi quyền bảng và Backend dùng service-role. Đây là mô hình Backend trung gian; chưa kết luận GRANT/RLS triển khai giống file SQL. Nếu thành viên muốn dùng Supabase trực tiếp, cần hợp đồng và chính sách được duyệt riêng, không tự cấp quyền rộng. Policy restrictive đổi mật khẩu chỉ hạn chế thêm, không thay policy permissive theo chủ sở hữu/chi nhánh. Service-role bypass RLS nên Backend vẫn phải kiểm tra quyền.

## Lịch tuần và phiên bản công bố

Đã có `schedules`, `shift_assignments`, `schedule_approvals`, `shift_change_requests`, `replacement_invitations`, `branch_support_requests`; không tạo bảng trùng. Tại lần đọc gần nhất các bảng này chưa có bản ghi; cấu trúc tồn tại không đồng nghĩa luồng nghiệp vụ đã đạt kiểm thử.

- `schedules.period_id` xác định tuần qua registration_periods; `schedules.branch_id` phải khớp branch của period. `schedule_group_id` nhận diện nhóm phiên bản, `version` tăng trong cùng nhóm; phiên bản mới phải giữ group ID, không dùng default UUID mới cho cùng nhóm.
- `shift_assignments.schedule_id` luôn trỏ đến **một phiên bản cụ thể**; mỗi dòng có employee/ngày/ca/bộ phận/chi nhánh thực tế. Không coi nguyện vọng VALID là phân công chính thức.
- Trạng thái thiết kế: DRAFT → PENDING_APPROVAL → APPROVED → PUBLISHED; NEEDS_REVISION trả về xử lý chỉnh sửa. `schedule_approvals.schedule_id` phải đúng phiên bản được duyệt; không chuyển quyết định duyệt của bản cũ sang bản mới.
- Lịch nhân viên chỉ đọc phiên bản PUBLISHED có hiệu lực và assignment ACTIVE. Không lấy `MAX(version)` trên mọi trạng thái, không gộp assignment các phiên bản; bản nháp mới không che bản đã công bố.
- **Cần TV3/TV4 phê duyệt trước khi triển khai:** quy tắc chọn một bản công bố có hiệu lực cho mỗi chi nhánh/tuần, cách xử lý khi có nhiều group hoặc nhiều bản PUBLISHED. Schema hiện có không đủ để suy ra quy tắc lựa chọn duy nhất. Không tự chọn theo created_at hoặc bổ sung trạng thái/unique index trong TV1. Trong thời gian chưa thống nhất, coi trường hợp nhiều ứng viên là xung đột, không trả lịch tùy ý.
- Duyệt phải ghi decision và cập nhật trạng thái theo giao dịch nguyên tử; công bố phải dựa trên đúng bản đã duyệt, có published_at/feedback_deadline_at hợp lệ theo nghiệp vụ. Kiểm tra lại trạng thái/phạm vi tại thời điểm ghi để tránh hai thao tác đồng thời hoặc chỉnh sửa nội dung sau duyệt mà giữ quyết định cũ.

## Ranh giới TV2–TV5

| Thành viên | Dữ liệu đầu vào/kết quả | Điều kiện cần phối hợp |
| --- | --- | --- |
| TV2 | registration_periods + shift_registrations | Dùng employee UUID, kiểm tra ngày/ca/chi nhánh/cửa sổ đăng ký, chống trùng khóa tự nhiên; giữ quy tắc Crew Leader hiện có. Không ghi schedules/assignments như kết quả đăng ký. |
| TV3 | Nguyện vọng, nhân sự/nhu cầu → schedules + shift_assignments | Phân công đúng tuần và bộ phận; xử lý xung đột ca/phiên bản. Việc dùng dữ liệu mẫu không chứng minh thuật toán xếp lịch đạt yêu cầu. |
| TV4 | schedules + schedule_approvals | GS chỉ duyệt các branches được phân công; API danh sách hỗ trợ cả Lê Duẩn/Hải Châu. Công bố theo đúng thẩm quyền trong tài liệu nghiệp vụ, không suy ra từ role đơn thuần. |
| TV5 | assignment chính thức → shift_change_requests/replacement_invitations; branch_support_requests | original_assignment_id là ID phân công, không phải nguyện vọng. Kiểm tra chủ yêu cầu, phiên bản/assignment còn hiệu lực và điều kiện người thay thế. |

Viện trợ phải kiểm tra cả chi nhánh yêu cầu và chi nhánh nguồn/đích theo vai trò được phép; một guard trên một branch không đủ cho thao tác liên chi nhánh. Phân biệt `employees.branch_id` (đơn vị gốc) với `shift_assignments.actual_branch_id` (nơi làm thực tế). Trong SQL thiết kế, nguồn SUPPORT cần branch_support_request_id; giữ quy tắc nguồn CREW_LEADER riêng. Kiểm tra đồng thời trước khi chấp nhận lời mời/đổi người để tránh hai người thay cùng phân công hoặc xếp trùng lịch.

**Cần TV3–TV5 thống nhất:** khi công bố phiên bản mới, các yêu cầu đổi ca/lời mời đang gắn assignment bản cũ được xử lý thế nào; cách lưu dấu vết thay thế và tránh sửa mất lịch sử. TV1 không tự di chuyển FK, xóa yêu cầu, thay quy tắc hoặc sửa schema.

Hướng dẫn đọc metadata và kiểm thử JWT: [tv1-database-handover-checklist.md](tv1-database-handover-checklist.md). Các mục chưa xác minh vẫn BLOCKED cho nghiệm thu, không dùng kết quả mock để thay thế.

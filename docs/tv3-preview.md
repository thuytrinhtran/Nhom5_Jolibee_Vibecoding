# TV3: preview → kiểm tra → lưu và chỉnh sửa DRAFT

Code đã có persistence; **chưa áp dụng migration hoặc bật ghi Supabase chung**. Không đổi Rule Engine, không thêm bảng.

## Luồng API

- POST `/api/schedules/preview`: `period_id`; tùy chọn `schedule_id`, `expected_version` để sửa DRAFT. `use_saved_assignments: true` mở đúng phân công đã lưu; không gửi cờ này khi review chỉnh sửa. API này chỉ đọc/chạy trong bộ nhớ.
- Kiểm tra lại: gửi `assignments`, `input_revision` và target/version nếu sửa DRAFT. Backend loại đúng phân công của bản đang sửa khỏi xung đột, giữ các lịch khác, chạy `reviewAssignments()`.
- POST `/api/schedules/drafts`: lưu mới với `period_id`, `assignments`, `input_revision`, `request_id` UUID.
- PATCH `/api/schedules/:id/draft-assignments`: lưu chỉnh sửa với các trường trên và `expected_version`. Mock development cũ giữ cơ chế riêng, không ghi Supabase.

Actor/branch lấy từ phiên QL, không từ body. Backend tải lại nguồn, đối chiếu revision, kiểm tra phân công bằng engine/review. Backend đọc snapshot nhất quán của RPC, so sánh dữ liệu quy tắc đã chuẩn hóa với repository, review lại và gửi snapshot/result vào transaction SQL. Database so sánh snapshot dưới khóa, kiểm tra độc lập nhân viên/đăng ký/nhu cầu/kỹ năng/trùng giờ/giới hạn tuần và dựng lại coverage. Hash client không phải bằng chứng quyền truy cập hoặc chứng nhận tính hợp lệ.

## Transaction, phiên bản và retry

Migration `backend/migrations/20261031_tv3_schedule_draft.sql` bổ sung `persist_schedule_draft(uuid,uuid,jsonb,jsonb,uuid,integer,uuid,text)`. RPC generate_schedule_draft bốn tham số cũ vẫn là wrapper tương thích; helper input chỉ gọi nội bộ. Chỉ service_role được gọi RPC, Express suy ra actor sau xác thực JWT. Không cấp EXECUTE cho anon/authenticated.

Lưu mới tạo version 1. Chỉnh sửa chỉ nhận DRAFT mới nhất của group/period/branch; chặn bản đã gửi duyệt/công bố và trường hợp nhiều group. Mỗi lần sửa tạo **schedule ID mới, cùng group, version + 1**. Không xóa/ghi đè schedule hoặc audit cũ. Phân công REGULAR/DRAFT cũ được đánh dấu REPLACED trong cùng transaction, tránh nhân đôi xung đột/giờ làm. Không sửa NEEDS_REVISION, Crew Leader hoặc viện trợ ở tác vụ này.

Schedule mới, assignments, thay thế bản cũ và audit cùng transaction; bất kỳ lỗi nào đều rollback. Audit giữ actor, request ID/fingerprint, snapshot trước/sau. Action AUTO_GENERATE giữ tương thích reader; new_data.operation phân biệt CREATE_DRAFT/EDIT_DRAFT, change_source MANUAL cho API mới.

Frontend giữ request ID cho cùng phương án khi retry sau lỗi mạng/đọc lại. Backend/RPC đối chiếu fingerprint và actor; request trùng trả lại cùng lịch, request ID dùng cho nội dung khác bị từ chối. Nếu lịch đã bị thay thế/gửi duyệt, retry cũ bị chặn. Hai yêu cầu sửa cùng version chỉ một thành công. Không tự nâng expected_version hoặc bỏ kiểm tra revision.

Transaction lưu dùng NOWAIT: 7 bảng nguồn có SHARE, 3 bảng schedules/shift_assignments/audit_logs có SHARE ROW EXCLUSIVE. Chỉ khóa các dòng period, branch, actor và tài khoản nhân viên tham gia, thay vì khóa toàn bảng branches/users/registration_periods; cron có thể thêm kỳ khác. Phân quyền được kiểm tra trước và sau khi khóa. Transaction nhường khi nguồn đang ghi, trả 503 SCHEDULING_BUSY thay vì xếp hàng khóa. Ngân sách xử lý 3 giây được kiểm tra giữa các bước và trong vòng lặp; quá hạn rollback. Đây không phải hard timeout: SQL/trigger dài được bảo vệ bằng statement_timeout=5s trong metadata cả persist_schedule_draft và wrapper generate_schedule_draft để PostgREST hoist trước câu lệnh chính. Đã kiểm chứng trên PostgREST local, nhưng phải xác minh phiên bản và db-hoisted-tx-settings của Supabase khi triển khai. Gọi SQL trực tiếp phải tự đặt timeout trước câu lệnh, không dựa vào SET bên trong function. Khóa nguồn còn lại vẫn có thể tạm chặn TV2/TV4, kể cả chi nhánh khác; chưa kiểm thử lock contention bằng PostgreSQL nhiều session. Không thay bằng advisory lock đơn phương khi các writer khác chưa cùng tuân thủ.

## Frontend và TV4

Preview luôn persisted=false, không có schedule ID mới, không được gửi TV4. Lưu bị khóa khi chưa kiểm tra thay đổi hoặc persistence chưa bật. Sau khi ghi, UI GET lại rồi mới hiển thị DRAFT đã lưu. Nếu GET lỗi, giữ phương án/request ID, báo rõ đã ghi nhưng chưa đọc lại và cho retry cùng yêu cầu.

Nút chỉnh sửa chỉ hiện với DRAFT; backend kiểm tra status/version lại. AI và handoff chỉ nhận lịch đã đọc lại. Group/version/assignment UUID giữ hợp đồng TV4; quyết định duyệt không chuyển sang version mới. Gateway TV4 hiện chưa cấu hình: chuẩn bị handoff không đồng nghĩa đã gửi hoặc đổi PENDING_APPROVAL. Luồng NEEDS_REVISION/công bố nằm ngoài phạm vi này.

## Triển khai sau phê duyệt

1. Đọc schema/ACL/trigger thật, backup và xác minh chưa có RPC trùng. Migration dùng CREATE để từ chối ghi đè function hiện có; không chạy lại file khi đã có bản cũ.
2. Sau phê duyệt, áp dụng **migration đã cập nhật cùng bộ code này** theo quy trình nhóm. Chưa thực hiện ở đợt này.
3. Kiểm tra definition/ACL/cache PostgREST, bật `TV3_DRAFT_PERSISTENCE_ENABLED=true` trong backend và restart. `.env.example` mặc định false; `.env` thật chưa đổi.
4. Thống nhất kỳ/chi nhánh test rồi kiểm thử JWT thật, lưu/đọc/sửa và bàn giao TV4. Việc ghi thật cần phê duyệt riêng.

Test dùng HTTP local/mock và PostgreSQL PGlite cô lập, có fixture local, kiểm tra rollback/audit/concurrency. Không chứng minh đã triển khai hoặc E2E Supabase thật đạt. PGlite serialize truy vấn. Bộ kiểm tra nhiều kết nối native PostgreSQL và gateway thật được mô tả trong tv3-deployment-checks.md; chưa thay thế xác minh trên Supabase chung.


## Công tắc khóa ghi

`draft-write-policy.ts` là kiểm tra chung cho `/generate`, `/drafts`, `/:id/draft-assignments` và service tạo/sửa tương ứng, kể cả mock trong bộ nhớ. Chỉ chuỗi chính xác `true` bật ghi; thiếu biến/false/giá trị khác đều trả 503 DRAFT_PERSISTENCE_DISABLED trước khi đọc kho nghiệp vụ hoặc gọi RPC. Service kiểm tra lại ngay trước lượt RPC ghi sau các bước await. Preview, review và đọc lịch không bị khóa; API nghiệp vụ TV2/TV4 không thay đổi. Cờ không thu hồi quyền service_role trực tiếp trong database và không hủy transaction đã được gửi; cần chờ request đang chạy kết thúc trước thao tác bảo trì.

Writer regression tests bật cờ rõ ràng trong tiến trình test. Launcher mock không tự bật cờ: khi muốn kiểm thử tạo/lưu mock, người vận hành phải đặt cờ true cho tiến trình đó. Không đổi `.env` thật.

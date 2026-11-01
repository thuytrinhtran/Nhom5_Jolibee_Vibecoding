# Giai đoạn 5 — thay người sau công bố (local)

## Căn cứ và trạng thái

Đã đối chiếu `Jollishift.sql`, migration hiện có, 14 CSV audit và mục FR20–26/G07–08, BR08/14–18 trong DESIGN/INTENT. Schema mô tả thay người một chiều, không phải swap hai ca. CSV xác nhận CHECK/FK hiện có và RLS bật; anon/authenticated không có quyền CRUD các bảng này. Chưa có RPC TV5 trong bản audit. Không mở quyền browser/Supabase trực tiếp.

- `shift_change_requests`: PENDING → SEARCHING → APPROVED / REJECTED.
- `incidents`: REPORTED → IN_PROGRESS → RESOLVED / UNRESOLVED.
- `replacement_invitations`: PENDING → ACCEPTED / DECLINED / EXPIRED.

NV gửi đổi ca trong `feedback_deadline_at` đã được lưu khi công bố; không tự áp một deadline khác. Báo sự cố không thể làm là form riêng, không tự chuyển yêu cầu quá hạn thành sự cố. Không sửa timestamp/deadline lịch.

Đề xuất người thay chỉ ghi nhận đề xuất. QL kiểm tra ứng viên và nhập thời hạn lời mời, không có TTL tự đặt. Nhiều người có thể xác nhận nhận ca; QL chọn một lời mời đã ACCEPTED hợp lệ để duyệt. Xác nhận trong hạn vẫn được lưu làm bằng chứng đồng ý sau hạn; khi duyệt luôn kiểm tra lại điều kiện hiện tại. Lời mời PENDING hết hạn không thể nhận. Không tự phân công khi nhận lời hoặc khi hết deadline.

## API/UI

- `/employee/shift-requests`, `/employee/incidents`: lịch ACTIVE của bản thân qua API giai đoạn 4, form lý do/đề xuất tùy chọn, lịch sử yêu cầu và inbox riêng.
- `/manager/shift-requests`: queue theo chi nhánh, ứng viên, hạn mời, phản hồi, chọn người nhận, phê duyệt/từ chối; có cảnh báo nguồn đã thay đổi và tìm người chưa thành công.
- GET `/api/shift-changes`: queue của NV hoặc chi nhánh QL, trạng thái hiệu lực của lời mời; không ghi trên GET.
- GET `/api/shift-changes/candidates?assignment_id=...`: chỉ QL đúng chi nhánh hoặc chủ ca.
- POST `/api/shift-changes/actions`: CREATE_REQUEST / REPORT / INVITE / ACCEPT / DECLINE / APPROVE / REJECT / EXPIRE; cần request_id UUID và data đúng whitelist. Actor lấy từ token, không nhận employee_id/branch_id/role tùy ý.

`TV5_PERSISTENCE_ENABLED` mặc định tắt; chỉ thêm false vào .env.example, không thay env chạy thật. Test-preview chặn writer độc lập. UI có loading/lỗi/401, thông báo thật từ kết quả, giữ nội dung/request ID khi retry và xác nhận thao tác quyết định của QL.

## Transaction, lịch sử và tương thích

RPC khóa theo thứ tự phối hợp TV3/TV4, kiểm tra role/branch/employee ACTIVE, ca ACTIVE thuộc PUBLISHED mới nhất, snapshot thuộc tính ca, nguồn yêu cầu và người nhận lời mời. Chặn yêu cầu mở trùng giữa cả hai bảng, retry khác nội dung, chọn lời mời sai nguồn và stale assignment. Recheck bộ phận, kỹ năng, đăng ký VALID không sample, trùng giờ và giờ cấu hình bằng helper eligibility v2. Giữ nguyên coverage khi thay một người trong cùng ô. Cơ cấu kinh nghiệm được tính/cảnh báo; không biến mục tiêu mềm thành hard constraint mới.

Chỉ APPROVE của QL tạo dòng ACTIVE mới cùng schedule, có `replaces_assignment_id`; dòng cũ chuyển REPLACED, không đổi nhân viên/ngày/ca trên dòng cũ. Request/incident, phân công, đóng lời mời PENDING và audit cùng transaction. Mỗi thay đổi có audit actor/request ID/nội dung trước/sau; audit xếp lịch và quyết định duyệt không bị ghi đè.

Migration tăng dần `20261104_tv5_shift_replacement.sql`:

- Thêm snapshot ca, người đề xuất, quyết định và FK nối chuỗi phân công.
- Thay UNIQUE mọi trạng thái trên `(schedule_id, employee_id, work_date, shift_id)` bằng UNIQUE chỉ dòng chưa REPLACED, để hỗ trợ A → B → A bằng **ba dòng lịch sử khác nhau**. Guard kiểm tra định nghĩa constraint trước khi thay; không CASCADE.
- UNIQUE successor và yêu cầu đang mở; dữ liệu cũ mâu thuẫn khiến migration dừng, không tự dọn.
- Tái sử dụng body metric v2 thành helper TV5 riêng, chỉ bỏ dòng REPLACED khỏi metric lịch hiện tại. Không sửa Rule Engine/RPC TV3. `readDraft` ghép metric mới nhất từ audit SHIFT_REPLACED cho lịch PUBLISHED, giữ metadata tối ưu lịch sử từ audit ban đầu.
- Owner postgres, search_path cố định; chỉ service_role được EXECUTE ba RPC công khai. Helper không cấp cho browser/service trực tiếp.

Nguồn cũ thiếu snapshot không được tự duyệt: QL có thể từ chối/đóng để tạo yêu cầu đúng nguồn. Việc xuất bản mới không di chuyển request/lời mời cũ sang assignment khác.

## Nghiệm thu và giới hạn

Test tự động chạy offline và PostgreSQL native cách ly, không chứng minh Supabase đã triển khai. Chưa chạy migration/seed/Auth hoặc bật writer dùng chung.

Cần nghiệm thu web sau khi được phép triển khai: NV A gửi → QL mời B/C → B/C phản hồi → QL chọn một → A mất ca/B có ca → lịch QL cập nhật; từ chối, hết hạn, mất mạng/retry, hai phiên duyệt, nguồn mới thay thế, chain A → B → A, scope khác chi nhánh và rollback audit. Kiểm tra ACL/FK/partial indexes/function body, PostgREST cache và timeout ngoài RPC trước khi bật flag.

Phạm vi hiện thực: thay người REGULAR trong cùng chi nhánh và đăng ký hợp lệ. CREW_LEADER/SUPPORT/liên chi nhánh không được tự suy rộng thành thay người thông thường; ứng viên trả rỗng và cần quy trình riêng. Không có swap hai chiều hoặc hạn chế giờ/ca mặc định mới. GET tính hiệu lực hết hạn; thao tác EXPIRE của QL ghi nhận và tạo notification outbox. Chưa nối timer/n8n tự động hoặc gửi thông báo ra ngoài. Khóa bảng kế thừa giao thức TV3 có thể trả bận khi tranh chấp.

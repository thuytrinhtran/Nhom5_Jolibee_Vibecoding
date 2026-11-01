# Giai đoạn 3 — workflow lịch, local

## Trạng thái và đường đi

Schema và CHECK hiện có dùng `NEEDS_REVISION`, không có `REJECTED`.

`DRAFT → PENDING_APPROVAL → APPROVED → PUBLISHED`.
Khi bị từ chối: `PENDING_APPROVAL → NEEDS_REVISION`; quản lý mở editor giai đoạn 2, chỉnh sửa/kiểm tra, lưu **DRAFT phiên bản mới**, rồi gửi lại. Không đổi trạng thái phiên bản bị từ chối về DRAFT và không cập nhật quyết định cũ. Allocator TV3 giữ audit/previous_state và đánh dấu phân công phiên bản đã được thay thế là REPLACED như luồng v2 hiện có.

Luồng trình lại bằng các ca demo cố định đã được loại khỏi giao diện API. Endpoint shift-only cũ `/workflow/:id/resubmit` trả 410 `RESUBMIT_USE_DRAFT_EDITOR`; không gọi writer không được xác minh. API chính thức của trình lại là preview → PATCH draft-assignments tạo version mới → workflow submit.

## API và an toàn

- POST `/api/schedules/workflow/:id/submit`: QL của chi nhánh, DRAFT mới nhất.
- POST `/:id/decision`: GS được branches.supervisor_id phân công, APPROVED hoặc NEEDS_REVISION; từ chối cần lý do.
- POST `/:id/publish`: QL của chi nhánh, APPROVED mới nhất, có quyết định duyệt và thời hạn phản hồi hợp lệ.
- GET `/:id/review`: QL/GS đúng phạm vi, trả kiểm tra hiện tại, coverage, cơ cấu kinh nghiệm và cảnh báo. List/history hiện có tiếp tục kiểm tra chi nhánh/giám sát.
- Mỗi POST chuyển trạng thái cần `expected_version`, `request_id` UUID. Client giữ cùng request ID khi thử lại yêu cầu lỗi. RPC trả lại kết quả audit cho retry trùng chính xác; khác nội dung cùng ID bị từ chối.
- RPC kiểm tra độc lập caller/role/branch/tài khoản, nguồn đăng ký VALID không có sample, bộ phận/kỹ năng, trùng giờ, giới hạn thực sự cấu hình và coverage. Thiếu kinh nghiệm là cảnh báo, không trở thành hard constraint mới.
- Khóa theo thứ tự TV3, bảo vệ cả khoảng trống/version/source. NOWAIT và timeout trả lỗi thử lại, tránh chờ ghi đè. Quyết định + trạng thái + audit cùng transaction; công bố kích hoạt phân công cùng transaction.

## Khác biệt database đã audit

14 CSV không có RPC TV4; có body `validate_schedule_approval` nhưng thiếu trigger gắn với bảng. Migration cũ `20261029_tv4_schedule_workflow.sql` tạo published_by/FK và RPC cũ nhưng chưa có CAS phối hợp TV3/audit đầy đủ.

Migration tăng dần `20261102_tv4_workflow_v2.sql` phụ thuộc migration TV4 cũ và TV3 rule v2. Nó gắn trigger kiểm tra/khóa lịch sử quyết định, bổ sung RPC v2, thu hồi EXECUTE RPC TV4 cũ khỏi service_role và mở allocator TV3 cho việc tạo phiên bản kế tiếp từ NEEDS_REVISION. Nếu đoạn allocator mong đợi không khớp, migration dừng để review.

Thứ tự nghiệm thu sau khi được xác nhận: backup/catalog hiện tại → kiểm tra các migration nền đã triển khai → TV4 cũ nếu thiếu → TV3 DRAFT/rule v2 nếu thiếu → TV4 v2 → kiểm tra ACL/trigger/body → test bằng QL/GS/NV và hai phiên cạnh tranh → mới cân nhắc bật các writer. Chưa áp dụng bất kỳ bước ghi nào lên Supabase trong giai đoạn này.

## Cấu hình và nghiệm thu còn lại

`TV4_WORKFLOW_PERSISTENCE_ENABLED` mặc định tắt, chưa thay đổi env. TV3 vẫn có gate DRAFT riêng. Test-preview chặn mọi writer độc lập. Không tự bật các gate.

Đã test tự động bằng transport offline và PostgreSQL cục bộ cách ly. Cần nghiệm thu Supabase sau khi migration được phép triển khai: ACL/RLS thực tế, PostgREST schema reload, timeout ngoài RPC, cơ chế Auth QL/GS đúng chi nhánh, hai phiên sửa/gửi/duyệt, rollback khi audit lỗi, UI loading/confirm/retry và nhân viên đọc phân công ACTIVE sau công bố. Phần UI nhân viên/đổi ca thuộc các giai đoạn tiếp theo.

Giới hạn hiện tại: khóa bảng trong transaction ngắn được tái sử dụng từ TV3 để bảo vệ các writer chưa cùng giao thức; khi tải lớn có thể gặp WORKFLOW_BUSY và cần retry. Chưa thay bằng cơ chế khóa riêng theo chi nhánh.

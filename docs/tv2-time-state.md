> **B?n hi?n h?nh 30/10/2026:** xem [b? tri?n khai cu?i](tv2-release/final/README.md). Nh?ng m? t? M1/M2, l?ch th? N?m, automation ch?a l?p tr?nh ho?c ph??ng ?n 05 trong t?i li?u c? b?n d??i ch? ?? truy v?t, kh?ng ph?i h??ng d?n rollout hi?n t?i.

# TV2: trạng thái kỳ theo thời gian server

Chính sách: Asia/Ho_Chi_Minh, thứ Sáu 15:00 đến trước Chủ nhật 12:00; nguyện vọng cho thứ Hai–Chủ nhật tiếp theo. Bản thay đổi này được chuẩn bị local, chưa triển khai SQL lên Supabase chung.

## Quy tắc và triển khai

`now < open_at` → PLANNED; `open_at <= now < close_at` → OPEN; `now >= close_at` → CLOSED. Cột status cũ chỉ là cache/lịch sử, không còn quyền ghi đè cửa sổ. Không có trạng thái hủy kỳ riêng trong schema hiện tại; nếu cần hủy phải thiết kế riêng, không dùng CLOSED lưu tay làm cách cấm ghi giữa cửa sổ.

- GET lựa chọn kỳ theo timestamp và chi nhánh, trả `period.status` hiệu lực, `stored_status` để chẩn đoán; không UPDATE bảng khi đọc.
- PUT kiểm tra đồng hồ Express; RPC kiểm tra đồng hồ PostgreSQL sau khi khóa kỳ/employee và kiểm tra lại deadline ngay trước khi ghi. Đồng hồ database là chốt chặn cuối cùng. Không nhận thời gian hoặc danh tính employee từ browser. Máy chủ ứng dụng cần đồng bộ NTP; nếu lệch đồng hồ, RPC vẫn có thể từ chối và không được bỏ guard.
- Frontend dùng server_now và bộ đếm hiện có, không khóa theo status lưu cũ. Việc đếm giờ frontend chỉ điều khiển giao diện; không cấp quyền lưu.
- TV3 dùng view `registration_periods_effective` có security_invoker và cột `status` tính bằng statement_timestamp của database. Contract trả thêm `period_status` ở cả ba truy vấn, giữ lọc dữ liệu thật/mẫu. Backend TV3 vẫn phải lọc phạm vi QL/GS, không dùng trực tiếp status từ bảng gốc. View chỉ cấp SELECT cho service_role, không mở quyền browser.

Migration: [20261030_registration_effective_state.sql](../backend/migrations/20261030_registration_effective_state.sql), sinh bởi `node backend/scripts/prepare-tv2-time-state.cjs`. Chỉ thay RPC nếu fingerprint/chữ ký/owner khớp M1/v3 đã biết hoặc chính bản mới; khác sẽ rollback để đối chiếu `pg_get_functiondef`. Không suy luận nội dung RPC cloud chỉ từ OpenAPI.

Migration thêm sample_batch_id nullable/FK nếu thiếu, giữ nguyên mọi row cũ và giá trị provenance sẵn có. RPC giữ cơ chế thay nguyện vọng của chính người đang lưu, xóa dấu mẫu khi họ tự lưu/gửi, không dọn dữ liệu trong migration. NULL ở hàng lịch sử chưa chứng minh đó là dữ liệu thật; không tự gán lại fixture v2. Migration không chuyển status hay sửa giờ của kỳ hiện tại. Config tương lai được chuẩn hóa thứ Sáu; giờ các kỳ đã tồn tại phải được kiểm tra riêng nếu khác chính sách.

**Không chạy file 05 cũ, không chạy lại migration gốc hoặc bundle 01/generator v3 lịch thứ Năm sau migration này.** File 05 đã được thay bằng thông báo ngừng sử dụng. Bundle v3 lịch sử chưa được nâng cấp thành installer của cơ chế mới.

## Tạo kỳ tương lai: chưa tự vận hành hàng tuần

Code hiện có RPC `run_registration_automation`, được gọi từ endpoint nội bộ có Bearer secret riêng. RPC dùng lịch config Việt Nam, tính thứ Hai tuần sau, tạo kỳ cho branch ACTIVE bằng UNIQUE(branch_id, work_start_date)/ON CONFLICT DO NOTHING; chỉ tạo trong cửa sổ đăng ký. Nó không chạy nếu config enabled=false; Express không tự gọi định kỳ. Không thấy cấu hình triển khai scheduler trong repo để bảo đảm endpoint được gọi. Lần đọc Supabase trước thay đổi ghi nhận enabled=false. Đọc REST không chứng minh không có scheduler bên ngoài.

**Đề xuất chưa kích hoạt:** tác vụ định kỳ bền vững (Supabase pg_cron hoặc scheduler của hạ tầng) gọi một RPC chỉ tạo kỳ theo config. Nên tạo trước 2–4 tuần, chạy hằng ngày và catch-up khi phục hồi, dùng unique hiện có và không sửa kỳ/đăng ký đã tồn tại; lấy thứ Hai theo giờ Việt Nam và đặt mở vào thứ Sáu trước đó, đóng Chủ nhật trước đó. Có giám sát thất bại và cảnh báo trước thứ Sáu. Không dựa vào request người dùng, setInterval trong Express hoặc trạng thái OPEN ghi sẵn. Nếu tái sử dụng automation hiện có cần review riêng vì nó còn cập nhật status và xếp hàng notification; không bật toàn bộ chỉ để tạo kỳ.

Sau khi nhóm chọn scheduler, duyệt RPC tạo kỳ riêng và lịch chạy, mới có thể chứng nhận tự vận hành mỗi tuần. **Thay đổi hiện tại tự mở/đóng các kỳ đã có; chưa giải quyết việc tạo kỳ tuần mới trong production.** Không bật cron/n8n hoặc automation trong lượt này.

## Thứ tự bàn giao và xác nhận

1. Người vận hành đối chiếu catalog/RPC thực tế bằng truy vấn chỉ đọc và duyệt migration bổ sung; chạy một lần, không chạy M1/M2/01/05 cũ. Khi fingerprint không khớp phải dừng, không bỏ guard.
2. Triển khai backend/frontend cùng migration; RPC cloud cũ vẫn chặn PLANNED nên chỉ deploy code sẽ chưa đủ. Không tuyên bố cloud đã sửa trước khi SQL được duyệt và áp dụng.
3. Dùng phiên NV TV1: GET phải 200, status hiệu lực OPEN dù stored_status PLANNED, đúng branch và kỳ 02–08/11/2026. API không token vẫn 401, role khác không được quyền ghi.
4. Kiểm thử trên database cô lập tại 30/10 14:59, 15:00 và 01/11 11:59, 12:00 (+07); GET/PUT/RPC phải cùng trạng thái, cả draft/submit ngoài hạn bị từ chối. Không truyền fake clock vào production. Bộ test PGlite kiểm tra replay migration, giữ row mẫu, quyền RPC, deadline và view TV3.
5. Sau triển khai, người dùng tự kiểm tra lưu/F5 bằng nguyện vọng thật được phép. Codex chưa chạy ghi trên database chung hoặc dùng token/mật khẩu thật. Việc triển khai và kiểm thử cloud vẫn đang chờ.

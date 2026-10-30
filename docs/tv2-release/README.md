> **B?n hi?n h?nh 30/10/2026:** xem [b? tri?n khai cu?i](final/README.md). Nh?ng m? t? M1/M2, l?ch th? N?m, automation ch?a l?p tr?nh ho?c ph??ng ?n 05 trong t?i li?u c? b?n d??i ch? ?? truy v?t, kh?ng ph?i h??ng d?n rollout hi?n t?i.

# TV2 chính thức trên Supabase chung

Theo yêu cầu hiện tại, tiếp tục với project chung **wlbpprpiieonjrqglicv**, dùng Auth TV1 và 70 nhân viên hiện có. Không tiếp tục triển khai project TEST.

Bản cần duyệt hiện tại: **tv2-official-shared-compatible-v3**, xem [báo cáo đồng bộ và triển khai](official/README.md). [official/01_apply_tv2.sql](official/01_apply_tv2.sql) nâng cấp các object TV2 đã có, giữ ID ca/kỳ, lịch **thứ Năm 15:00 → Chủ nhật 12:00**, tuần kế tiếp. Không phụ thuộc UUID chi nhánh/số nhân viên/bảng trống. Không cron, không nhắc tự động; chưa chạy SQL cloud. Không chạy lại foundation/Auth/M1/M2 gốc.

[official/schema-rest-snapshot.json](official/schema-rest-snapshot.json) và [readiness.json](readiness.json) ghi lần đọc mới nhất ngày 29/10/2026: 70 nhân viên, 6 ca, 2 kỳ thứ Sáu PLANNED, bảng/RPC TV2 đã có. Snapshot cũ official-snapshot.json không chứng nhận trạng thái hiện tại. [official/00_inspect_shared_schema.sql](official/00_inspect_shared_schema.sql) kiểm tra catalog chỉ đọc; đang chờ kết quả để xác minh FK/CHECK/RLS/ACL và body RPC thực tế.

[official/03_seed_registrations_for_tv3.sql](official/03_seed_registrations_for_tv3.sql) dùng 12 nhân viên/kỳ/ca thật, gắn sample_batch_id trên header, không tạo account/period hoặc ghi đè đăng ký thật. [official/04_cleanup_tv3_samples.sql](official/04_cleanup_tv3_samples.sql) dọn riêng hàng mẫu còn nguyên nguồn/nội dung. Cả hai cần duyệt riêng, chưa chạy. Fixture lịch sử 02_seed_tv2_test.sql đã được thay thế trong rollout hiện tại.

[tv3-contract.sql](tv3-contract.sql) phân biệt OFF/chưa gửi và trả ID ca/nhân viên; mặc định loại mẫu, chỉ lấy mẫu khi opt-in. API/frontend TV2 không hiển thị mẫu như nhân viên đã tự gửi; lưu thật chuyển provenance về NULL.

Mode frontend tv2-official và cấu hình development hiện tại đều đặt DEMO=false, gọi API/Auth TV1 hiện có. Không chỉ ẩn nhãn, không có mock fallback. Chưa chủ động restart server trước khi schema được triển khai. Chưa ghi/sửa/xóa dữ liệu Supabase chung; chờ bạn xác nhận phiên bản cuối và chạy SQL Editor, rồi kiểm tra lưu dữ liệu cloud.

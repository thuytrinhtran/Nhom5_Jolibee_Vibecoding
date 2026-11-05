# Xếp lịch & AI

Đã đối chiếu `Nhom5_PhanTichTuDongHoa.docx`, đặc biệt bước 5–9: tổng hợp nhu cầu, lọc ứng viên, kiểm tra cơ cấu, tạo phương án và quản lý xác nhận điều chỉnh.

## Trạng thái khi tiếp tục

Không có thay đổi chưa commit trong source đã track. Các tài liệu/script/migration chưa track từ phiên trước được giữ nguyên. Source hiện có đã hỗ trợ preview chưa lưu, AI tự đánh giá, chỉnh sửa qua Rule Engine, lưu DRAFT chủ động và quy trình phê duyệt/công bố riêng.

## Bổ sung

- Mở mặc định bảng phân công, giữ AI bên phải trên desktop; thu về một cột trên màn hình nhỏ. Tái sử dụng bộ lọc ngày/tuần, ca và bộ phận.
- Thêm API QL `/api/schedules/preview/candidates`. Kiểm tra toàn bộ phương án bằng `reviewAssignments`, bao gồm đăng ký, kỹ năng, bộ phận, trùng ca, giờ làm và nhu cầu. Chỉ đọc SĐT cho ứng viên đủ điều kiện trong chi nhánh của quản lý. SĐT không nằm trong snapshot gửi AI.
- Quản lý chọn ứng viên, liên hệ và xác nhận nhận ca trước khi thêm/thay phân công. Thay đổi chưa kiểm tra làm mất hiệu lực danh sách ứng viên và báo cáo AI. Giữ thao tác bỏ phân công; kiểm tra lại trước khi lưu.
- Nút Đề xuất lại tạo preview; Cân đối/Điều chỉnh dùng API đề xuất hiện có, chỉ áp dụng khi quản lý chọn. AI tự đánh giá phương án đã kiểm tra, chỉ tư vấn.
- Chỉ backend `NODE_ENV=development`, nguồn Supabase, kỳ `7f48f53e-d707-4a32-9f15-eb32aeb0095a` trạng thái OPEN được preview. Không đổi trạng thái trong CSDL, không thay Rule Engine hay chính sách ghi. Kỳ có lịch PUBLISHED bị chặn. Kỳ OPEN không thể lưu DRAFT.

## Kiểm tra thật

Supabase đọc thành công kỳ OPEN trên; Rule Engine tạo 30 phân công preview. Gemini `gemini-3.6-flash` trả AVAILABLE, kết luận INSUFFICIENT_DATA. Không gọi API lưu/gửi duyệt/công bố, không migration.

API ứng viên cũng đã đọc thật thành công: ô được kiểm tra có 1 ứng viên hợp lệ với SĐT, không ghi dữ liệu. Typecheck và build cả hai phía PASS. Frontend: 216 test PASS. Backend: 259 PASS, 26 SKIP vì cần cấu hình/database dùng riêng. Chưa chạy thao tác end-to-end trong trình duyệt.

Các test chạy với `--test-concurrency=2` để tránh cạn bộ nhớ khi nhiều tiến trình TypeScript cùng chạy. Khi chạy backend tests, đặt các cờ vận hành sau thành `false` trong tiến trình test, không sửa `.env`: `DEV_IMPORT_ENABLED`, `TV3_WRITE_SCOPE_ENABLED`, `TV3_DRAFT_PERSISTENCE_ENABLED`, `TV5_LOCAL_PG_RPC_ENABLED`, `REGISTRATION_DEV_TEST_MODE`. Test riêng có thể chủ động bật lại cờ cho test double của mình.

## Test web

1. Backend dùng `.env` hiện có với Supabase/Gemini thật, `NODE_ENV=development`, `SCHEDULING_DATA_SOURCE=supabase`; chạy `npm run dev` trong backend. Frontend chạy `npm run dev` trong frontend. Không dùng `dev:tv3-test` vì script đó bật mock.
2. Đăng nhập QL đúng chi nhánh; mở `/manager/schedule?period_id=7f48f53e-d707-4a32-9f15-eb32aeb0095a`.
3. Tạo lịch dự kiến, quan sát bảng phân công và AI tự đánh giá bên phải. Chọn ngày hoặc cả tuần, ca, bộ phận và ô cần xem để kiểm tra tên/cấp độ, đã xếp/cần, vị trí thiếu.
4. Chọn ô thiếu hoặc Tìm người thay. Kiểm tra tên/cấp độ/SĐT/trạng thái đăng ký; chọn ứng viên rồi xác nhận đã liên hệ nhận ca. Kiểm tra lại phương án; AI đánh giá lại. Thử bỏ phân công rồi kiểm tra lại. Lưu DRAFT bị khóa tại kỳ OPEN.
5. Đề xuất lại yêu cầu xác nhận bỏ thay đổi chưa lưu. Thử lỗi mạng AI: phương án vẫn còn, có thể thử lại AI.
6. Với kỳ CLOSED đủ điều kiện theo chính sách ghi hiện có: chỉ bấm Lưu DRAFT khi muốn ghi thật; phê duyệt và công bố tiếp tục dùng quy trình hiện có. Kỳ PUBLISHED chỉ xem, không tạo/sửa lịch.

Unit/API tests dùng test doubles cô lập, không dùng dữ liệu giả trong ứng dụng. Các test PostgreSQL cần database dùng riêng được skip khi chưa cấu hình; không dùng Supabase chung để chạy test ghi dữ liệu.

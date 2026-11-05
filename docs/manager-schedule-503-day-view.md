# /manager/schedule: Gemini 503 và xem ngày

## Chẩn đoán thực tế

- Development dùng Supabase thật, AI bật, provider Gemini, model `gemini-3.6-flash`. Không sửa `.env` hoặc đổi model.
- Đọc metadata model qua v1beta: HTTP 200, hỗ trợ `generateContent`.
- Request đánh giá preview thực tế: 37.000 byte, JSON schema, không có tools; dữ liệu nhân viên gửi dưới mã giả danh theo API hiện có.
- Tái hiện 3 phản hồi HTTP 503; nội dung lỗi được phân loại `MODEL_OVERLOADED` từ `UNAVAILABLE` và bằng chứng quá tải/high demand. Log cũ không ghi lỗi provider nên không có bằng chứng cho lần lỗi trước; lượt kiểm tra hiện tại xác nhận tình trạng quá tải ở Gemini.
- Lần 1: 503 sau 3.889 ms; backoff 1.044 ms. Lần 2: 503 sau 1.511 ms; backoff 2.239 ms. Lần 3: 503 sau 4.770 ms; dừng. Preview 30 phân công vẫn trong bộ nhớ, không lưu lịch.
- Phân loại này phù hợp [tài liệu lỗi Gemini](https://ai.google.dev/gemini-api/docs/api-errors). Model tồn tại không bảo đảm khả dụng tại mọi thời điểm.

Adapter giờ chỉ retry HTTP 503/429: tối đa 3 lần tổng cộng, backoff 1s/2s cộng jitter, tôn trọng Retry-After. Nếu Retry-After vượt 8s hoặc không còn thời gian trong ngân sách 45s thì dừng, để quản lý thử lại thủ công. Không retry các lỗi request/quyền/model, JSON sai, timeout hoặc lỗi kết nối. Log chỉ chứa model, endpoint, HTTP, phân loại, lần gọi và backoff; không ghi key, prompt, thông tin nhân viên hoặc nguyên văn lỗi provider.

Lỗi quá tải bên nhà cung cấp có thể tiếp tục sau retry. Giao diện giữ nguyên preview và nút Thử lại AI; không tự đánh giá lại vô hạn khi cùng phương án bị lỗi. Cân đối/Điều chỉnh và tự đánh giá lại sau kiểm tra phương án vẫn dùng luồng hiện có.

## Giao diện

- Mở ngày đầu kỳ khi tải hoặc tạo phương án. Nhóm ca → bộ phận; tên nhân viên, cấp độ, đã xếp/cần, vị trí trống hiển thị trực tiếp.
- Chọn Xem tuần để mở tổng quan gọn. Bấm ô sẽ mở đúng ngày và chi tiết vị trí; bộ lọc không đổi dữ liệu lịch.
- Nền phân công bình thường là trắng. Chỉ vị trí thiếu và cảnh báo có màu nhấn; chỉnh sửa chưa kiểm tra không tô vàng toàn bảng.
- Tìm nhân viên phù hợp dùng API ứng viên thật có sẵn: tên/cấp độ/SĐT/trạng thái đăng ký. Quản lý xác nhận đã liên hệ và nhân viên nhận ca trước khi thêm/thay, sau đó kiểm tra lại phương án bằng Rule Engine. PUBLISHED chỉ xem.

## Test web

Backend và frontend development hiện nghe cổng 5000 và 5173. Đăng nhập QL đúng chi nhánh rồi mở:

`http://localhost:5173/manager/schedule?period_id=7f48f53e-d707-4a32-9f15-eb32aeb0095a`

1. Tạo lịch dự kiến; kiểm tra tên/cấp độ trong ngày mặc định và AI bên phải.
2. Nếu Gemini vẫn quá tải, chờ tối đa 3 lần gọi rồi bấm Thử lại AI khi cần; bảng phân công phải giữ nguyên.
3. Chuyển Xem tuần, chọn một ô để trở về ngày tương ứng.
4. Bấm Tìm nhân viên phù hợp tại vị trí trống; xem liên hệ, xác nhận rồi phân công, kiểm tra lại. AI đánh giá lại phương án đã kiểm tra.

Có thể chạy lại chẩn đoán đọc thật bằng `node scripts/inspect-schedule-ai-readonly.cjs` trong backend sau build. Script không gọi lưu/gửi duyệt/công bố hoặc migration. Không chạy kiểm thử ghi trên Supabase chung.

## Kết quả kiểm thử

- Typecheck và build cả backend/frontend: PASS.
- Frontend: 218 PASS, 0 lỗi. Bao gồm xem ngày, drill-down tuần, phân công chưa kiểm tra, giữ preview khi AI lỗi và thử lại thủ công.
- Backend: 263 PASS, 26 SKIP cần cấu hình/database dùng riêng, 0 lỗi. Bao gồm backoff 503/429, giới hạn 3 lần, Retry-After, ngân sách thời gian, giữ nguyên model/request và không lộ dữ liệu trong log.
- `git diff --check`: PASS. Không commit/push, migration hoặc ghi dữ liệu Supabase. Chưa chạy thao tác end-to-end trong trình duyệt; kiểm tra provider thật chỉ tạo preview và gọi AI.

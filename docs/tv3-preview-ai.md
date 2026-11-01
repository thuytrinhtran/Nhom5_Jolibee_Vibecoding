# TV3 – AI đánh giá preview chưa lưu

Luồng: tạo preview → điều chỉnh nếu cần → **Kiểm tra lại phương án** thành công → **Đánh giá bằng AI**. Backend tải lại dữ liệu đúng chi nhánh/kỳ, đối chiếu `input_revision` và gọi `reviewAssignments()` trước khi gửi tóm tắt giả danh qua Gemini adapter hiện có. Backend kiểm tra lại nguồn sau khi Gemini phản hồi; nguồn thay đổi thì từ chối báo cáo.

- `GET /api/schedules/preview/ai-evaluation`: đọc cấu hình khả dụng, không gọi Gemini.
- `POST /api/schedules/preview/ai-evaluation`: chỉ QL, chi nhánh từ JWT/profile tin cậy; body gồm `period_id`, `input_revision`, `assignments` với bốn trường phân công. Khi chỉnh một DRAFT đã có, gửi thêm `schedule_id`, `expected_version` và kiểm tra quyền/phiên bản qua luồng preview hiện có.
- Báo cáo trả `scope=preview`, `persisted=false`; không ghi bảng đánh giá, lịch, phân công hoặc audit, không gọi RPC lưu. Không có API đọc lại báo cáo preview từ database.
- Tái sử dụng `buildAISummary`, `parseAIReport`, Gemini adapter và `ScheduleAIPanel`. Summary dùng E/D/S/K, không gửi tên, email, điện thoại hoặc UUID. `version=0` chỉ đánh dấu preview trong summary, không phải phiên bản database.
- AI chỉ đưa nhận xét bằng lời. Phản hồi chứa phương án phân công bị từ chối; không có nút áp dụng AI hoặc tự thay lịch. Đánh giá DRAFT đã lưu giữ nguyên endpoint và cơ chế lưu báo cáo cũ.

## Kiểm tra trên giao diện

1. Giữ `TV3_DRAFT_PERSISTENCE_ENABLED=false`. Khởi động backend/frontend; đăng nhập QL có chi nhánh, chọn kỳ CLOSED có đăng ký và nhu cầu.
2. Tạo lịch dự kiến, xác nhận nhãn chưa lưu. Panel AI xuất hiện. Nếu AI chưa được cấu hình, nút bị khóa và thông báo rõ; không có đánh giá giả.
3. Với cấu hình Gemini hiện có hợp lệ (`TV3_AI_EXTERNAL_ENABLED`, `TV3_AI_PROVIDER`, `TV3_AI_MODEL`, `GEMINI_API_KEY` ở backend), bấm **Đánh giá bằng AI**. Network chỉ có POST đánh giá khi người dùng bấm; không gửi key từ frontend. Đây là thao tác gửi dữ liệu giả danh ra provider, có thể tiêu thụ quota.
4. Xem coverage, giờ làm, phân bố và giới hạn/đề xuất bằng lời trong báo cáo. Không có thao tác lưu hoặc tự chỉnh lịch.
5. Thay phân công: báo cáo cũ hiện hết hiệu lực và nút đánh giá bị khóa. Kiểm tra lại phương án hợp lệ, rồi chủ động đánh giá lại. Phương án vượt nhu cầu/không đăng ký vẫn bị backend từ chối.
6. Nếu provider lỗi, báo lỗi và giữ phân công; thử lại bằng nút. Nếu dữ liệu nguồn đã đổi, tạo/kiểm tra lại preview trước khi đánh giá.

## Giới hạn

Báo cáo preview chỉ ở bộ nhớ giao diện, mất khi rời trang/tải lại. Không có polling phát hiện thay đổi Supabase liên tục; nguồn được đối chiếu khi gửi yêu cầu và sau khi provider trả lời. Khóa chống đánh giá đồng thời nằm trong tiến trình backend, chưa phải khóa phân tán. Không bổ sung AI điều chỉnh lịch.

Kiểm thử lượt này dùng repository/provider giả lập và HTTP Express localhost; không gọi Gemini thật hoặc ghi Supabase chung. Kiểm thử trình duyệt với Gemini thật cần người vận hành thực hiện các bước trên.

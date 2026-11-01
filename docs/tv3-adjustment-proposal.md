# TV3 – Đề xuất phương án từ nguyện vọng đã phân tích

Luồng hiện tại: preview đã kiểm tra → phân tích nguyện vọng → **Tạo phương án đề xuất** → xem danh sách phân công riêng. Đã có so sánh và áp dụng vào editor theo mục cuối tài liệu; chưa lưu đề xuất. Lịch gốc và báo cáo AI đánh giá của lịch gốc không bị thay thế.

## Backend

`POST /api/schedules/preview/adjustment-proposal`: JWT QL, chi nhánh từ profile tin cậy; body gồm `period_id`, `input_revision`, bốn trường của mỗi phân công gốc, `analysis_token`, và target ID/version nếu đang sửa DRAFT. Không chấp nhận JSON mục tiêu/nhân viên tùy ý từ frontend.

Kết quả phân tích READY được cấp receipt ký HMAC, gắn actor/branch/period và hash nguồn + phương án gốc + target. Receipt không chứa câu nhập/tên thật, hết hạn sau 15 phút. Khóa ký ngẫu nhiên chỉ trong tiến trình backend: restart hoặc chuyển sang instance khác sẽ yêu cầu phân tích lại, không mở khóa dự phòng. Đây là giới hạn triển khai nhiều instance còn lại; không thay đổi cấu hình bí mật hiện tại.

Backend tải lại nguồn qua `inspectPreview()`, xác minh receipt rồi tạo ứng viên bằng `generateSchedule()` hiện có và thử thay nhân viên/hoán đổi có giới hạn. Candidate pool có thể thu hẹp theo ưu tiên nhưng không nới ràng buộc hoặc thêm nhu cầu. Nhu cầu còn trống được tính từ số đã chọn, chỉ dùng trong bộ nhớ để gọi engine điền phần còn thiếu.

Mỗi ứng viên được kiểm tra bằng `reviewAssignments()` trên input gốc, rồi kết quả cuối được kiểm tra lại; nguồn được đọc/đối chiếu thêm một lần trước khi trả. Không gọi Gemini để tạo phân công, không gọi RPC lưu, không ghi bảng lịch/audit hoặc thay đổi kỳ.

Thứ tự chọn: không giảm số người ở **từng ô nhu cầu so với lịch gốc**, ưu tiên tổng coverage cao hơn; khi coverage bằng nhau, ưu tiên ít cảnh báo cơ cấu hơn, sau đó đến các tiêu chí SOFT. Điểm SOFT tổng hợp các chỉ số chuẩn hóa theo baseline: giờ của người cần giảm/tăng tải, độ phân tán giờ trong cùng bộ phận và mức vi phạm giới hạn/ngày ưu tiên. Mức HIGH/NORMAL/LOW hiện là mức ưu tiên chung của một yêu cầu; chưa có cơ chế phân xử nhiều yêu cầu độc lập với mức ưu tiên khác nhau. Các tiêu chí cân bằng chỉ là cách xếp hạng đề xuất, không trở thành quy tắc nghiệp vụ bắt buộc.

Kết quả gồm toàn bộ phân công/coverage/shortages/statistics, `changes.added/removed`, `satisfaction` theo tiêu chí, các ràng buộc gặp khi thử ứng viên, giới hạn tìm kiếm và `persisted=false, applied=false`. Nếu không tìm thấy phương án tốt hơn, trả lịch gốc hợp lệ với `unchanged=true` và lý do; không báo đã đáp ứng mọi nguyện vọng. Coverage có thể vẫn thiếu nếu nguồn thiếu người.

Tìm kiếm tối đa 400 lượt review ứng viên, ba lượt thay người và một lượt hoán đổi, ngân sách thời gian hợp tác 750 ms; không phải timeout cứng cho một lời gọi engine. Input tương tác giới hạn 1000 phân công gốc, 200 nhân viên và 500 nhu cầu. Không bảo đảm tối ưu toàn cục hay tìm ra mọi phương án khả thi. Nguồn thay đổi giữa các lần đọc hoặc receipt hết hạn thì yêu cầu phân tích lại.

## Kiểm thử lượt triển khai

Dùng dữ liệu giả lập và HTTP localhost; kiểm tra đáp ứng ưu tiên, bất khả thi, thiếu người, kỹ năng, đăng ký, bộ phận, giờ làm, xung đột ca, nguồn/actor/receipt thay đổi và không đột biến input. Kiểm tra UI chỉ hiển thị đề xuất riêng, bỏ phản hồi cũ khi preview thay đổi. Chưa gọi Gemini thật hoặc kiểm thử trình duyệt/Supabase thật. Không bật persistence, sửa migration, commit hoặc push.

## So sánh và áp dụng vào editor (đã bổ sung)

Sau khi tạo đề xuất, giao diện hiển thị các ô ngày/ca/bộ phận thay người, danh sách thêm/bỏ, ca và giờ tuần của nhân viên liên quan, coverage trước/sau và mức đáp ứng nguyện vọng. Số ca là số lượt phân công trong phương án, giờ tuần lấy từ thống kê backend (gồm lịch hiện hữu). Nếu thiếu thống kê giờ thì hiển thị chưa có dữ liệu, không tự đặt bằng 0.

- **Giữ lịch hiện tại**: bỏ đề xuất ở giao diện; không gọi backend, không sửa editor. Nếu đang chờ kiểm tra áp dụng, phản hồi đến muộn bị bỏ qua.
- **Áp dụng phương án**: `POST /api/schedules/preview/apply-adjustment` gửi lịch gốc, toàn bộ phân công đề xuất dạng bốn trường và receipt đề xuất do backend cấp. Backend xác thực QL/chi nhánh, source revision, DRAFT target/version và hash hai phương án; receipt hết hạn hoặc dữ liệu khác thì từ chối. Receipt đề xuất kế thừa thời hạn của phân tích, không thể gia hạn bằng việc tạo lại đề xuất.

Endpoint áp dụng chỉ đọc nguồn và gọi lại luồng preview/review cho toàn bộ phân công, không ghi database. Token áp dụng có mục đích riêng, không dùng token phân tích để thay thế; không tin metrics/diff do frontend gửi. Backend trả preview đã kiểm tra và frontend mới thay toàn bộ preview/editor. Thất bại giữ nguyên lịch gốc và đề xuất để người dùng xem lỗi. Phản hồi khác tuần/phiên bản hoặc đến muộn sau khi chỉnh lịch/câu nhập bị bỏ qua.

Áp dụng thành công không lưu/công bố hoặc gửi TV4. AI đánh giá cũ hết hiệu lực khi phương án đổi; phân tích/nguyện vọng và đề xuất cũ được bỏ khỏi phần kết quả, có thể phân tích lại. Quản lý tiếp tục thêm/bỏ/thay nhân viên và kiểm tra thủ công bằng editor hiện có.

Cách kiểm tra: tạo preview → phân tích nguyện vọng → tạo đề xuất → xem so sánh → thử Giữ lịch hiện tại → tạo lại đề xuất → Áp dụng phương án → kiểm tra editor và nhãn chưa lưu → chỉnh thủ công → Kiểm tra lại phương án. Trường hợp hết hạn/nguồn thay đổi cần phân tích và tạo lại; không cố dùng receipt cũ. Kiểm thử trong lượt triển khai dùng mock/local, chưa xác nhận qua trình duyệt hoặc Supabase thật.

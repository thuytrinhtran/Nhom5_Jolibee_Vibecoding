# TV3 – Phân tích nguyện vọng điều chỉnh (chưa tạo lịch)

Tại preview đã được Rule Engine xác nhận, nhập nguyện vọng trong card **Phân tích nguyện vọng điều chỉnh** rồi bấm nút cùng tên. Ví dụ:

- `Cân bằng giờ làm.`
- `Giảm tải cho E001, ưu tiên cao.`
- `Ưu tiên E001 làm ngày 2026-10-26.`
- `Giảm tải cho E001, tối đa 20 giờ.`

Mã E được ánh xạ từ dữ liệu lịch hiện tại, không cố định giữa các lịch. Danh sách tên/mã hiển thị tại ứng dụng; backend tự dựng lại ánh xạ, không tin mapping từ frontend. Có thể nhập tên đầy đủ nếu khớp duy nhất; tên trùng/tên gọi tắt cần thay bằng mã E. Không nhập dữ liệu liên hệ hoặc thông tin cá nhân khác.

## Luồng và giới hạn hỗ trợ

`POST /api/schedules/preview/adjustment-intent` yêu cầu JWT QL, chi nhánh từ profile backend, `period_id`, `input_revision`, các phân công đã xác nhận và `wish` tối đa 2000 ký tự. Khi preview đang sửa một DRAFT, gửi thêm ID/expected_version theo luồng hiện có. Backend tái sử dụng `inspectPreview()`, `reviewAssignments()`, `buildAISummary()` và Gemini transport/cấu hình hiện tại; kiểm tra lại nguồn khi provider trả lời.

Phạm vi đầu tiên gồm cân bằng giờ, tăng/giảm tải, ưu tiên/tránh ngày và giới hạn giờ tuần. Bộ từ vựng bảo thủ chặn đoạn nhập chưa nhận diện an toàn trước khi gọi provider; không hỗ trợ mọi câu tiếng Việt tùy ý. Dùng ngày ISO YYYY-MM-DD và số giờ nguyên trong câu nhập hiện tại. Yêu cầu ngoài phạm vi hoặc mơ hồ cần diễn đạt lại; không tự suy đoán nhân viên.

Provider chỉ nhận câu đã chuyển tên đầy đủ thành mã E và qua kiểm tra từ vựng, số liệu giả danh của lịch, ngày/coverage và các quy tắc không được ghi đè. Không nhận username, UUID, tên, email, điện thoại hoặc mapping nội bộ. Không gửi nguyên văn chưa kiểm tra sang provider.

JSON được kiểm tra trường bắt buộc/không cho trường thừa, enum mục tiêu/ưu tiên, mã nhân viên có thật và được nhắc tới, định dạng ngày/số, quan hệ giới hạn với nhân viên. Ngày ngoài tuần, ưu tiên ngày không có đăng ký/vị trí phù hợp, giới hạn giờ cao hơn cấu hình hoặc thấp hơn phân công hiện hữu, yêu cầu tránh/ưu tiên cùng ngày bị từ chối. Các kiểm tra này chỉ phát hiện bất khả thi rõ ràng, chưa giải tính khả thi tổng thể hoặc đánh giá tổ hợp nhiều nguyện vọng.

Kết quả luôn `preference_strength=SOFT_PREFERENCE`, `business_rules_overridable=false`, `feasibility=NOT_SOLVED`, `persisted=false`. `READY` chỉ nghĩa là phân tích được nội dung; không có nghĩa đã có một lịch mới hợp lệ. `NEEDS_CLARIFICATION`/`UNSUPPORTED` không phải yêu cầu được chấp thuận. Giao diện hiển thị JSON và làm hết hiệu lực kết quả khi sửa nội dung hoặc preview. Không có nút áp dụng, tạo lại lịch theo AI hoặc lưu kết quả.

Không thay đổi Rule Engine/migration/AI đánh giá. Không bật persistence hoặc external AI tự động. Gemini cần cấu hình backend đã được phép dùng; khóa không xuất hiện trên frontend. Chống gọi đồng thời ở phạm vi tiến trình backend, chưa có rate limit phân tán.

## Bước tạo phương án đã bổ sung

Kết quả READY có receipt `analysis_token` để backend tạo đề xuất riêng từ JSON đã xác nhận; xem [luồng đề xuất](tv3-adjustment-proposal.md). Phần phân tích vẫn không tạo hoặc lưu lịch. Giao diện có nút tạo đề xuất chỉ đọc; chưa có so sánh/áp dụng/lưu. Tạo lại phân tích sau khi thay đổi nguồn, phương án, hết hạn receipt hoặc backend khởi động lại.

Trước bước áp dụng sau này cần đối chiếu source/plan revision lần nữa, kiểm tra toàn bộ phương án và yêu cầu quản lý xác nhận. Không dùng JSON phân tích hoặc receipt này làm payload ghi lịch trực tiếp.

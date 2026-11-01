# Giai đoạn 2: quản lý lịch ở local

## Thay đổi

- Editor giữ preview đã được backend xác nhận, các phân công đang sửa và cờ chưa lưu trong cùng state. AI và lưu DRAFT chỉ dùng bản đã kiểm tra; không dùng bản sửa chưa hợp lệ.
- Đổi tuần, tải lại và tạo lại phải xác nhận khi có thay đổi chưa lưu. Điều hướng/rời trang có guard; không tự lưu dữ liệu.
- Bảng lịch dùng coverage backend, bao gồm phân công hiện hữu hợp lệ. Có chi tiết nhân viên, giờ tuần, cơ cấu kinh nghiệm, lý do ban đầu và lịch sử local search.
- AI nhận cơ cấu kinh nghiệm theo hợp đồng v2. Đề xuất là phương án riêng, chỉ chuyển vào editor sau khi quản lý chấp nhận và backend kiểm tra lại. Không giảm coverage hoặc số người kinh nghiệm từng ô để đáp ứng mong muốn.
- Mở DRAFT kiểm tra lại hard constraints theo nguồn hiện tại, giữ lý do/lịch sử từ audit server và metadata tối ưu lịch sử. Không tin metadata từ trình duyệt.
- Lưu và đọc lại DRAFT giữ idempotency/version checks hiện có. Khi kiểm tra thất bại, giữ các phân công đang sửa.

## Kiểm thử trình duyệt

1. Đăng nhập quản lý có chi nhánh; mở trang lập lịch, chọn kỳ CLOSED có đăng ký và nhu cầu. Tạo lịch, kiểm tra ngày/ca/bộ phận, thiếu người, cơ cấu, tổng giờ và chi tiết lý do.
2. Thay/thêm/bỏ nhân viên. Trước khi kiểm tra lại, AI và lưu phải bị khóa. Thử trùng giờ, sai đăng ký, thiếu kỹ năng; backend phải từ chối và giữ chỉnh sửa. Không thêm giới hạn giờ/ca khi nguồn không cấu hình.
3. Kiểm tra phương án hợp lệ, gọi AI đánh giá. Sửa lịch trong lúc AI trả lời: phản hồi cũ không được coi là đánh giá của bản mới.
4. Gửi yêu cầu điều chỉnh, phân tích rồi tạo đề xuất; so sánh phương án. Từ chối giữ nguyên editor; chấp nhận chỉ cập nhật editor, không ghi DB. Đề xuất hết hạn/nguồn thay đổi phải bị từ chối.
5. Thử đổi tuần, tải lại, điều hướng và đóng tab khi chưa lưu; hủy xác nhận phải giữ chỉnh sửa.
6. Chỉ sau khi được phép áp dụng migration v2 và bật persistence ở môi trường phù hợp: lưu DRAFT, mở lại, đối chiếu phân công/coverage/lý do/lịch sử. Thử hai phiên sửa cùng lịch để kiểm tra version conflict. Hiện bước này chỉ được chạy tự động trên PostgreSQL cục bộ cách ly.

## Giới hạn xác minh

Chưa áp dụng migration, bật persistence hoặc ghi Supabase. Chưa gọi nhà cung cấp AI thật và chưa nghiệm thu thao tác bằng trình duyệt thật. Test AI dùng transport thay thế; SQL lifecycle dùng PostgreSQL cục bộ. Guard không thay thế việc lưu DRAFT và không phục hồi dữ liệu sau khi người dùng xác nhận bỏ thay đổi.

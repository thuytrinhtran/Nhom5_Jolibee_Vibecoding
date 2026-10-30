# DEMO TV2 theo nghiệp vụ cuối cùng

**Tài liệu DEMO lịch sử. Cấu hình hiện tại đã chuyển VITE_TV2_DEMO=false để dùng API thật và Auth TV1. Không bật lại DEMO khi triển khai chính thức.** Xem [hướng dẫn chính thức](tv2-release/official/README.md); bản SQL hiện tại mở thứ Năm 15:00, không cron/nhắc tự động. Phần dưới chỉ mô tả code DEMO được giữ lại, không phải dữ liệu đang chạy chính thức.

Form 7 thẻ 4+3, tablet 2 cột, mobile 1 cột. Chỉ checkbox ca sáng 08–12, chiều 12–17, tối 17–22; có thể chọn cả ba. Không có checkbox OFF. Thanh DEMO thu gọn cho phép đặt lại và mô phỏng đóng đợt.

1. Chọn ca và lưu nháp: ngày trống hiển thị chưa gửi; không suy ra OFF.
2. Gửi/xác nhận: ngày có ca là SHIFT, ngày trống mới được xem là OFF. Có thể gửi 0 ca để xác nhận nghỉ cả tuần.
3. Sửa rồi gửi lại trước hạn. Nếu lưu nháp sau gửi thì phải gửi lại để xác nhận.
4. Tải lại toàn trang xóa DEMO vì dữ liệu chỉ nằm trong bộ nhớ; chuyển trang rồi quay lại cùng phiên vẫn giữ trạng thái đã lưu.
5. Mô phỏng đóng đợt khóa thao tác; đặt lại mở phiên giả mới. Không đổi giờ máy hoặc backend.

Code DEMO cũ lưu/gửi trong bộ nhớ và hiện không được chọn bởi cấu hình. Bản chính thức gọi API thật, không có mock fallback. Chưa xác nhận lưu dữ liệu cloud cho đến khi SQL đã được duyệt/chạy và tài khoản TV1 thật thao tác thành công.

# Flash-Lite: nghiệm thu web bằng dữ liệu mock

Backend chỉ chọn `TV3_AI_DEVELOPMENT_MODEL` khi `NODE_ENV=development`.
Production/test vẫn chọn `TV3_AI_MODEL`. Trên ASUS, development override là
`gemini-3.5-flash-lite`, model nền vẫn là `gemini-3.6-flash`.
Credentials, project, các cờ nghiệp vụ và file cấu hình production không đổi.

## Chạy mock trước

Mở terminal PowerShell mới tại gốc repository. Các biến sau chỉ có hiệu lực
trong terminal này; không sửa thêm `.env`:

```powershell
$env:NODE_ENV='development'
$env:SCHEDULING_DATA_SOURCE='mock'
$env:SCHEDULING_MOCK_SCENARIO='tv3-flow'
$env:TV3_DRAFT_PERSISTENCE_ENABLED='false'
$env:TV4_WORKFLOW_PERSISTENCE_ENABLED='false'
$env:TV5_PERSISTENCE_ENABLED='false'
npm.cmd --prefix backend run dev
```

Terminal thứ hai tại gốc repository:

```powershell
npm.cmd --prefix frontend run dev
```

Không dùng preload `offline-only.cjs` trong phiên nghiệm thu Gemini thật:
preload đó cố ý tắt AI và chặn mạng ngoài localhost. Test tự động vẫn dùng
preload để không gọi provider. Phiên web này vẫn dùng cơ chế đăng nhập QL hiện
có; nguồn lịch là fixture mock, không phải dữ liệu nhân viên lấy từ Supabase.
Không thao tác đăng ký, nhu cầu hoặc các màn hình ghi dữ liệu thật khác.

## Checklist

1. Khởi động lại backend sau khi đổi cấu hình. Vào `/manager/schedule`, chọn
   kỳ fixture đã đóng. Kiểm tra nhãn dữ liệu thử nghiệm.
2. Bấm Tạo lịch dự kiến. AI phải tự chạy, model hiển thị
   `gemini-3.5-flash-lite`. Rule Engine của fixture phải hiện nhu cầu 9,
   đã đáp ứng 8, còn thiếu 1, tính theo lượt phân công.
3. Đợi báo cáo: nhận xét/đề xuất chỉ tư vấn. AI không đổi bảng lịch. Nút lưu/gửi
   bị khóa trong phiên mock này; không có công bố hay gửi duyệt tự động.
4. Bấm Cân đối lịch và đổi/bỏ một phân công. Nhận xét AI cũ biến mất ngay;
   số liệu Rule Engine được đánh dấu thuộc phương án đã kiểm tra gần nhất.
5. Bấm Kiểm tra lại phương án. Khi hợp lệ, số liệu cập nhật và AI tự đánh giá
   lại. Khi Rule Engine từ chối, giữ lựa chọn đang chỉnh, không gửi AI cho
   phương án chưa hợp lệ.
6. Bấm Đề xuất lịch: Rule Engine tạo lại phương án, cần xác nhận bỏ thay đổi
   chưa lưu nếu có. Phương án mới hợp lệ được AI tự đánh giá. Dữ liệu không
   thay đổi có thể tạo cùng phân công; không hứa một lịch khác ngẫu nhiên.
7. Nếu Gemini lỗi, lịch và số liệu vẫn còn, không hiện nhận xét cũ như kết quả
   hiện hành. Bấm Thử lại AI một lần khi sẵn sàng; không có vòng retry nền.

Mỗi lần tạo/kiểm tra lại phương án có thể gọi Gemini và tiêu thụ quota. Dùng
một vài lượt có chủ đích, không tạo lại liên tục để vượt lỗi provider.

## Quay lại model nền

Trong terminal backend, đặt override về model cũ rồi khởi động lại:

```powershell
$env:TV3_AI_DEVELOPMENT_MODEL='gemini-3.6-flash'
npm.cmd --prefix backend run dev
```

Biến của tiến trình ghi đè giá trị từ dotenv. Dùng tên model tường minh để hoạt
động cả trên Windows PowerShell cũ, nơi gán chuỗi rỗng có thể xóa biến môi
trường. Đóng terminal để bỏ override tạm. Không cần đổi model production hoặc
khôi phục credentials. Trong code, override vắng/rỗng vẫn dùng TV3_AI_MODEL.

Nghiệm thu mock không chứng nhận workflow ghi thật hay mọi tình huống dữ liệu
lớn. Trình tự DRAFT/GS/công bố trên Supabase cần được cho phép riêng.

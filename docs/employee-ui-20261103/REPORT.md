# UI Nhân viên — 03/11/2026

Đã hoàn thiện local, tái sử dụng component và transport hiện có. Không sửa backend/API, cấu hình kết nối, migration, Rule Engine, phân quyền hoặc dữ liệu Supabase. Không thêm thư viện.

## Thay đổi

- `/employee/schedule`: lịch tuần 7 cột trên laptop, chuyển tuần, chuyển lịch/danh sách, màu kèm nhãn sáng/chiều/tối, nổi bật hôm nay theo giờ Việt Nam. Ngày không có phân công hiển thị gọn; tuần chưa công bố có thông báo riêng. Bấm thẻ mở chi tiết, dẫn đến đổi ca/báo sự cố với tuần và ca đã chọn. Chỉ hiện liên kết yêu cầu đổi khi còn hạn phản hồi; backend vẫn xác minh đầy đủ điều kiện thực tế.
- `/employee/shift-requests`: ba bước chọn ca → lý do/người thay tùy chọn → xem lại/xác nhận. Chuyển bước không gửi API ghi. Lỗi gửi giữ lý do và mã idempotency để thử lại. Không tự thay phân công khi gửi hoặc nhận lời mời.
- `/employee/incidents`: form riêng nhấn mạnh báo nhanh, chọn ca và mô tả; không có dropdown đổi loại yêu cầu, không yêu cầu người thay, dùng đúng action REPORT hiện hữu. Không gọi API tìm ứng viên khi mở form sự cố.
- Lịch sử: thẻ có ngày, ca, lý do, nhãn trạng thái và kết quả xử lý; lọc đang xử lý/hoàn tất/tất cả, 6 thẻ mỗi trang. Đổi ca và sự cố có khu vực theo dõi riêng. Giữ inbox lời mời và các thao tác quản lý hiện có.
- Sidebar: nhóm thu gọn “Điều chỉnh ca làm” chứa hai route cũ. Không thêm route hoặc chức năng trùng.
- Date hiển thị dd/MM/yyyy; timestamp theo Asia/Ho_Chi_Minh. Input, select, textarea và nút có khoảng cách, focus, trạng thái disabled/loading. Laptop dùng hai cột cho lý do/người thay; mobile chuyển một cột. Thanh tuần mobile dùng bố cục gọn.

## File chính

- `frontend/src/pages/employee/EmployeeSchedule.tsx`
- `frontend/src/pages/employee/ShiftChanges.tsx`
- `frontend/src/pages/employee/EmployeeWorkspace.css` (mới)
- `frontend/src/services/employee-schedule.service.ts` (chỉ thêm helper hiển thị ngày/màu/hạn phản hồi, không đổi request/API)
- `frontend/src/dashboard.config.ts`
- Tests: `frontend/tests/employee-schedule.test.cjs`, `frontend/tests/shift-changes.test.cjs`
- Kiểm tra bố cục: `frontend/scripts/inspect-employee-layout.cjs`, `frontend/scripts/capture-employee-layout.cjs`

## Kiểm thử

- Frontend typecheck/build PASS; **199 tests PASS**, không skip.
- Backend không đổi; typecheck/build PASS, **257 tests PASS, 26 SKIP** (integration cần opt-in). Kết quả kiểm tra lại trong `backend-tests.txt`.
- Bao phủ lịch chưa công bố, lịch không phân công, ca qua đêm, chuyển tuần và bỏ response cũ, định dạng ngày/màu, đóng hạn phản hồi, deep link chỉ chọn ca thuộc kết quả API cá nhân, form ba bước không ghi trước xác nhận, retry idempotency, REPORT riêng, trạng thái/phân trang, quyền thao tác lời mời và giữ luồng quản lý.
- Chrome headless đã chụp ba trang với viewport CSS chính xác **1366×768** và **390×768**. `layout-results.json`: 6/6 trường hợp không tràn ngang. Ảnh `calendar-1366.png`, `request-1366.png`, `incident-1366.png` và bản `-390.png`.
- Ảnh dùng dữ liệu tổng hợp trong HTML local để kiểm tra bố cục component thật, **không phải bằng chứng đã gửi yêu cầu bằng tài khoản thật**. Không truy cập phiên đăng nhập, không gửi API hoặc tạo dữ liệu trên Supabase để chụp ảnh. Các file HTML chỉ là artifact kiểm tra, không được import vào ứng dụng.
- Build giữ lazy loading. JS ban đầu khoảng **233,97 KB / gzip 74,28 KB**, gần như bản trước 233,86 KB / gzip 74,23 KB. CSS riêng mới khoảng 1,90 KB gzip; không thêm API cho trang lịch. Danh sách yêu cầu vẫn đọc bằng API hiện có, phân trang hiển thị local.

## Tự kiểm tra trên website

1. Đăng nhập Nhân viên → “Lịch làm của tôi”: chọn tuần có lịch công bố, xem hai chế độ, mở chi tiết thẻ ca.
2. Ca còn hạn → “Yêu cầu đổi ca”: kiểm tra ca đã chọn, nhập lý do, xem lại rồi tự xác nhận nếu muốn kiểm thử ghi. Không còn hạn thì hiển thị hướng sang báo sự cố, không gia hạn ngầm.
3. “Điều chỉnh ca làm” → “Báo cáo sự cố”: chọn ca, mô tả và tự gửi; xem đúng báo cáo trong khu theo dõi sự cố. Việc gửi không tự đổi lịch.
4. Sau khi quản lý chấp thuận người thay bằng luồng hiện hữu, mở lại lịch cá nhân hoặc bấm “Tải lại”. Trang vẫn gọi API lịch chính thức theo token và lấy phân công đang có hiệu lực, không dùng cache danh sách lịch hay dữ liệu minh họa.

Lệnh tái tạo ảnh local (không cần cài thư viện): `node frontend/scripts/inspect-employee-layout.cjs`, sau đó `node frontend/scripts/capture-employee-layout.cjs "<đường dẫn Chrome hoặc Edge hiện có>"`.

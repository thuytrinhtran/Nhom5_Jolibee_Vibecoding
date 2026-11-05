# Quản lý — bố cục lập lịch và AI

Đã hoàn thiện local trên component/API hiện có. Không sửa Rule Engine, backend nghiệp vụ, workflow, phân quyền, migration, cấu hình Supabase hoặc dữ liệu. Không tạo lịch, đánh giá AI thật, gửi duyệt hay công bố để kiểm thử.

## Thay đổi

- Sidebar Quản lý rộng 216px, giảm chiều cao từng mục và tiêu đề nhóm, bỏ tiêu đề Tổng quan lặp; giữ đủ 9 chức năng và toàn bộ route cũ. CSS sidebar áp dụng từ đầu cho mọi trang quản lý, không cần vào Xếp lịch trước. Giữ nhóm có thể thu gọn và menu đang chọn.
- Xếp lịch & AI chia 3 tab: **Tạo lịch**, **Phân công nhân viên**, **Đánh giá AI**. Dùng chung state `editor` hiện có cho preview/phân công/dirty/unsaved; không reset chỉnh sửa khi đổi tab.
- Thanh tiến trình hiển thị trạng thái đăng ký → xếp lịch → phê duyệt → công bố từ dữ liệu đang đọc. Phê duyệt không được hiển thị như đã công bố.
- Tab Tạo lịch giữ thông tin đăng ký/nhu cầu, chỉ số, tạo/mở bản nháp và kiểm tra gửi duyệt. Thông tin dài nằm trong disclosure. Một đường dẫn rõ đến Phê duyệt & công bố, không lặp nhiều liên kết trên trang.
- Tab Phân công dùng bảng ngày × ca/bộ phận với tỷ lệ đã xếp/cần, cảnh báo thiếu người/kinh nghiệm, bộ lọc ngày/ca/bộ phận. Không hiển thị toàn bộ tên của 308 lượt. Mở một ô mới hiển thị nhân viên, giờ, kinh nghiệm, lý do và lịch sử trong panel cạnh bảng. Đóng/Escape quay lại nút ô đã mở; mở panel đưa focus tới nút đóng.
- Chỉnh sửa preview chỉ hiển thị công cụ của ô được chọn, giữ logic thêm/thay/bỏ và kiểm tra lại hiện tại. Khi chưa kiểm tra, ô dùng nhãn “Đang chọn”, không lấy cơ cấu cũ để báo đạt. Giữ một bộ nút Kiểm tra lại/Lưu bản nháp ở phía trên các tab.
- Tab AI có khu vực đánh giá và đề xuất riêng. Chỉ mount lần đầu khi mở; sau đó giữ instance khi chuyển tab để không mất kết quả. Các cờ dirty/stale và kiểm tra trước chấp nhận đề xuất giữ nguyên; không tự áp dụng/lưu/công bố.
- Đổi tuần xóa ô và ngày lọc cũ, tránh hiển thị bảng trống do bộ lọc của tuần trước. Giữ tab đang xem. Không gọi API mới khi đổi bộ lọc hoặc chọn ô.

## Nghiệp vụ được giữ

- Nhu cầu lấy theo snapshot của lịch đang xem; ô chưa có nhu cầu vẫn là chưa xác định, không biến thành 0. Giữ ô lịch sử ngoài danh mục hiện tại.
- Phân công REPLACED và Crew Leader không tính vào nhu cầu nhân sự thường, theo helper hiện hữu.
- Không làm mất lý do/lịch sử tối ưu khi lưu; payload vẫn dùng contract cũ và backend xác minh như trước.
- Lịch PUBLISHED chỉ xem; nút tạo lại bị khóa, không có editor hay handler áp dụng đề xuất. DRAFT/NEEDS_REVISION mới mở chỉnh sửa theo luồng hiện có.
- Lỗi kiểm tra và thông báo lưu nằm trên các tab, không bị che trong panel đã đóng. Lỗi gửi vẫn giữ editor và idempotency hiện có.

## Bằng chứng và kiểm thử

- Snapshot đọc Supabase `wlbpprpiieonjrqglicv`, Lê Duẩn, 02–08/11/2026: **PUBLISHED, 308 phân công, 63 ô nhu cầu** (`read-evidence.json`). Script chỉ gọi các service đọc; không gọi generate/preview/save/evaluate AI.
- Chrome kiểm tra 4 bố cục Tạo lịch/bảng/panel/AI ở **1366×768** và **390×768**: 8/8 không tràn ngang; `navigation_overflow=false`. Tại snapshot này bảng có 63 nút ô, 0 dòng nhân viên mở mặc định, 5 người khi mở ô được kiểm tra (`layout-results.json`).
- Ảnh là render component thật từ snapshot dữ liệu thật, không sinh fixture hoặc ghi dữ liệu thử. JSON/HTML thô nằm trong thư mục tạm ngoài repository. Không lấy token/phiên đăng nhập. Ảnh AI thể hiện bố cục lúc khởi tạo đọc thông tin, không phải bằng chứng đã gọi provider và nhận đánh giá thật.
- Frontend typecheck/build PASS; **210 tests PASS**, 0 fail/skip. Toàn bộ regression: xem `frontend-build.txt`, `frontend-tests.txt`.
- Backend không đổi nghiệp vụ; typecheck/build PASS, **257 PASS, 26 SKIP** (integration cần opt-in), `backend-tests.txt`.
- Regression bổ sung: 63 ô không bung danh sách tên; panel đúng ô; số 0 khác thiếu nhu cầu; bản nháp chưa kiểm tra không báo cơ cấu đạt; APPROVED khác PUBLISHED; đổi tab giữ sửa/không đọc lại nguồn; AI vẫn nhận dirty; PUBLISHED chỉ xem; đổi tuần xóa lọc cũ. Giữ các test lưu DRAFT, retry, version, áp dụng đề xuất và phân quyền trước đó.

## Hiệu năng và giới hạn

- Không thêm thư viện/UI framework. Giữ lazy loading cấp route.
- JavaScript ban đầu khoảng **233,82 KB / gzip 74,28 KB**, gần như bản trước (233,75 KB / gzip 74,24 KB). Chunk Xếp lịch tăng từ khoảng 64,8 lên 74,7 KB raw để có bảng/panel; không tải chunk đó ở trang khác. Không khẳng định giảm thời gian tải bằng số đo browser chưa thực hiện.
- Bảng vẫn dùng context/phân công được API hiện tại trả về, không thêm request mỗi ô và không thay pagination API của lịch chính thức. Cải thiện chính là giảm số trường chỉnh sửa/tên phân công phải hiển thị, chia nội dung theo tác vụ và không tải AI trước khi mở.
- Ở mobile hoặc khi bảng hẹp vẫn có cuộn ngang riêng cho bảng; không ép 7 ngày vào chữ quá nhỏ. Bảng nhiều hàng vẫn có thể cần cuộn trang; dùng bộ lọc để tập trung vào ngày/ca/bộ phận. Không thêm vùng cuộn dọc lồng nhau cho panel.
- Chưa chạy thao tác ghi bằng tài khoản thật hoặc AI provider trong lần này; người dùng tự nghiệm thu trên website khi muốn.

## File chính

- `frontend/src/pages/manager/ManagerSchedule.tsx`: tabs/progress/bảng/panel và nối state hiện có.
- `frontend/src/pages/manager/ManagerPlanner.css`: bố cục mới, responsive.
- `frontend/src/components/layout/AppLayout.tsx`, `frontend/src/workspace.css`: sidebar Quản lý gọn, route giữ nguyên.
- `frontend/tests/scheduling.test.cjs`, `frontend/tests/tv3-flow.test.cjs`: regression phù hợp với tab và mở chi tiết theo ô.
- `backend/scripts/read-manager-planner-snapshot.cjs`, `frontend/scripts/inspect-manager-live-layout.cjs`: đọc snapshot/chụp bố cục local; mở rộng metrics trong script chụp hiện có `capture-employee-layout.cjs`.

## Tự kiểm tra

Mở `/manager/schedule` và tải lại trang. Tab **Tạo lịch** để tạo/mở bản nháp; **Phân công nhân viên** để lọc và bấm ô; **Đánh giá AI** để đánh giá hoặc yêu cầu đề xuất. Chấp nhận đề xuất chỉ cập nhật phương án đang sửa; vẫn phải kiểm tra và tự lưu bản nháp. Với lịch đã công bố, bảng và AI chỉ phục vụ xem/đánh giá; chuyển ca dùng workflow đổi ca hiện có.

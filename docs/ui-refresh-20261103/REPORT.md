# Cải thiện giao diện JolliShift theo giai đoạn

Ngày 03/11/2026. Project giữ nguyên `wlbpprpiieonjrqglicv`. Chỉ sửa local và đọc Supabase; không migration/import/Auth creation, không tự lưu nhu cầu/đăng ký/lịch, không gửi duyệt/công bố/đổi ca, không commit/push.

## 1. Dashboard — đã hoàn thiện

Nguyên nhân: cả ba route tổng quan dùng component tĩnh DashboardOverview, luôn render “Chưa có dữ liệu”, không có truy vấn KPI. Không phải dữ liệu Supabase bị mất.

Quản lý có API GET `/api/schedules/periods/:id/overview`: dùng snapshot lịch/đăng ký hiện có, nhu cầu phân trang và queue đổi ca; bắt buộc token QL, branch từ profile và period thuộc branch. Không tin branch trong query. Không hardcode fixture/tổng phân công.

KPI: tổng nhân viên branch; số người đã gửi đăng ký hợp lệ (kể cả OFF cả tuần), không cộng trùng theo số lượt ca; trạng thái lịch mới nhất; phân công hiện tại ưu tiên lịch PUBLISHED có hiệu lực, chỉ ACTIVE, bỏ REPLACED; yêu cầu đổi ca PENDING/SEARCHING thuộc tuần; ô/vị trí thiếu từ nhu cầu hiện có. Có bản nháp mới không làm mất thống kê lịch chính thức cũ. Không có lịch hoặc nhu cầu thì shortage=null, không giả là 0; dữ liệu 0/đang tải/lỗi/không có tuần được phân biệt.

Đối chiếu Supabase chỉ đọc: **60 nhân viên, 53 người đăng ký, PUBLISHED, 308 phân công chính thức, 1 yêu cầu đổi ca đang chờ, 0 ô thiếu nhân sự**. Đây là snapshot tại thời điểm kiểm tra, không là giá trị mặc định. Bằng chứng `dashboard-live.json`; số liệu website được tải lại mỗi lần chọn tuần/Tải lại.

Dashboard nhân viên thay nội dung tĩnh bằng lịch cá nhân đã công bố, queue yêu cầu/lời mời và điều khiển chuyển tuần. Dashboard giám sát dùng danh sách chờ duyệt/lịch sử API trong đúng phạm vi được giao. Không dùng mock hoặc đưa Supabase key ra browser.

## 2. Điều hướng — đã hoàn thiện

Menu QL chia đúng bốn nhóm thu gọn:

- Tổng quan: Tổng quan.
- Lập lịch làm việc: Đăng ký ca; Nhu cầu nhân sự; Xếp lịch & AI; Phê duyệt & công bố.
- Vận hành: Lịch làm việc chính thức; Xử lý đổi ca.
- Quản trị: Nhân viên; Lịch sử.

Giữ toàn bộ route cũ. Thêm `/manager/official-schedule` có ProtectedRoute QL. Nhóm được chọn và mục active rõ ràng; giữ menu mobile/focus/đăng xuất hiện có. Không thêm thư viện UI.

## 3. Các trang — đã hoàn thiện trong luồng chính

- **Lịch chính thức** mới: API lịch hiện có, chỉ PUBLISHED có published_at, chọn bản công bố hiệu lực; chỉ ACTIVE. REPLACED và bản nháp không hiển thị. Có lọc tuần/ngày/ca/bộ phận/nhân viên, 20 hàng mỗi trang. Nếu có nhiều nhóm PUBLISHED trùng phạm vi thì báo lỗi, không ghép lẫn. Khi duyệt đổi ca, Tải lại đọc successor ACTIVE nên phản ánh đúng người thay.
- **Phê duyệt & công bố**: QL theo dõi cả bản nháp/chờ duyệt/đã duyệt/đã công bố/cần điều chỉnh trong cùng route cũ. Đây chỉ là mở rộng trạng thái READ; quyền và điều kiện transition không đổi. Bản nháp liên kết về editor gửi duyệt, không tự gửi. Bộ lọc tuần/trạng thái; chi tiết theo ngày/bộ phận; 20 phân công/trang. Mặc định thẻ đóng, không mở toàn bộ phân công. Bảng định biên/kinh nghiệm đóng mặc định. Nút duyệt/công bố đặt **trước bảng phân công**, vẫn có xác nhận và deadline hợp lệ.
- **Đăng ký nhân viên**: đổi tiêu đề trang quản lý để phân biệt nguyện vọng với phân công; ẩn ID lịch khỏi lựa chọn. Các tab/route cũ được giữ để không mất khả năng tra cứu, có đường dẫn rõ sang lịch chính thức.
- **Xếp lịch & AI**: phần nguồn đăng ký/định biên và thống kê nâng cao nằm trong mục mở khi cần. Editor lọc theo ngày, mặc định ngày đầu khi tạo phương án, nhưng vẫn giữ nguyên toàn bộ state/phân công của tuần khi đổi ngày. Không thay thuật toán hay payload. Gửi duyệt vẫn ngay đầu trang cho bản nháp đã lưu. Không hiển thị UUID lịch; thông báo lưu dùng “Bản nháp”.
- **Nhu cầu**: chỉ còn một nút “Lưu tất cả”, giữ toàn bộ dirty state, validation, copy/paste và xác nhận ghi đè hiện có; thanh cuối chỉ phản ánh trạng thái và liên kết bước tiếp.
- **Ngôn ngữ**: nhãn Bản nháp/Chờ phê duyệt/Đã phê duyệt/Đã công bố/Cần điều chỉnh; màu trạng thái dùng cùng palette; bỏ payload JSON bàn giao khỏi UI, mã người công bố và ID đề xuất thay thế khỏi phần dành cho người dùng. Lịch nhân viên không hiện số phiên bản kỹ thuật. Đổi ca vẫn là luồng có nhận lời và quản lý duyệt, không thành đổi hai chiều tự động.
- **Bố cục**: CSS gọn, bộ lọc co giãn, KPI 3 cột laptop/desktop và 2 cột màn hình nhỏ, bảng chỉ cuộn ngang khi cần, bỏ giới hạn cuộn dọc riêng của chi tiết công bố. Không thêm animation.

## 4. Hồi quy và giới hạn nghiệm thu

- Frontend build/typecheck PASS; **190/190 tests PASS** trong `frontend-tests.txt`.
- Backend build/typecheck PASS; **253 PASS, 25 SKIP**, 0 FAIL, trong `backend-tests.txt`. Test PostgreSQL cô lập phụ thuộc công cụ riêng được skip ở suite này; không chạy test ghi lên Supabase thật.
- Sau bổ sung phân trang demand, kiểm tra lại HTTP calendar/overview và KPI: **3 PASS**. Kiểm tra ownership/QL-only, branch query giả mạo không đổi scope, null/0, lịch chính thức mới nhất, bỏ REPLACED, nhóm PUBLISHED bất thường, phân trang và bộ lọc không thay assignments.
- Suite cũ được cập nhật nhãn/selector theo UI mới, giữ nguyên các assertion về request ID, confirmation, role, chống ghi tự động, payload, version và state sau lỗi. Các fixture giả chỉ thuộc unit tests hiện có; runtime sử dụng API thật.
- Đối chiếu API service với Supabase thật chỉ đọc. Các trang HTTP 200; API thống kê chưa token trả 401. Không thực hiện lại toàn bộ vòng đời ghi trên shared Supabase.
- Backend đang được chạy bằng tsx watch của workspace, đã tự reload sau thay đổi route/service. Không dừng nhầm watcher; lần thử khởi động instance thứ hai bị EADDRINUSE và không thay cấu hình/dữ liệu. Frontend Vite đang chạy, nhận source/CSS mới.

**Còn cần kiểm chứng trực tiếp:** thao tác bằng phiên đăng nhập thật, quan sát bố cục 1366×768 và desktop, và nghiệm thu toàn luồng bằng các lần bấm của người dùng. Không có kiểm thử trình duyệt đăng nhập tự động hoặc ảnh chụp UI để khẳng định visual PASS. Các trang hỗ trợ nhân sự/tình hình chi nhánh GS vốn là placeholder không được biến thành chức năng giả; không mở rộng nghiệp vụ ngoài luồng chính.

## Trang cần xem lại

Tải lại trang (Ctrl+F5 nếu CSS cũ): `/manager`, `/manager/official-schedule`, `/manager/publish`, `/manager/schedule`, `/manager/demand`, `/employee`, `/supervisor`.

Checklist thủ công, không để agent tự ghi:

1. NV đăng ký trên `/employee/register`; QL xem đúng tuần trong `/manager/registrations`.
2. QL xem/sửa nhu cầu `/manager/demand`, chỉ một nút lưu, không mất chỉnh sửa khi đổi bộ lọc.
3. QL preview `/manager/schedule`, chuyển ngày không mất phân công; AI đánh giá/đề xuất không tự áp dụng hoặc lưu; lưu bản nháp rồi mở lại.
4. Gửi duyệt → GS `/supervisor/approvals` xem định biên/chi tiết có phân trang, duyệt/từ chối có lý do.
5. QL `/manager/publish` nhập deadline và công bố; bản chưa công bố không vào `/manager/official-schedule` hoặc lịch cá nhân.
6. NV `/employee/schedule` chỉ thấy ca riêng; gửi yêu cầu/lời mời theo `/employee/shift-requests` và `/manager/shift-requests`.
7. Sau khi NV nhận lời và QL duyệt, tải lại lịch cá nhân và lịch chính thức; ca gốc không còn ACTIVE, người thay xuất hiện, tổng định biên không tăng.

Không đổi Rule Engine, RPC phê duyệt, quy tắc thời gian hoặc quyền sở hữu trong bước UI này. Các feature flags và giới hạn kỳ kiểm thử đã được chủ dự án cho phép trước đó giữ nguyên.

## Nhóm file chính

- Backend: `services/manager-overview.service.ts`, `routes/scheduling.routes.ts`, `routes/schedule-workflow.routes.ts`, tests manager-overview/calendar.
- Frontend Dashboard/menu: `ManagerDashboard.tsx`, `RoleOverview.tsx`, `manager-overview.service.ts`, `dashboard.config.ts`, `AppLayout.tsx`, `App.tsx`.
- Frontend lịch: `OfficialSchedule.tsx`, `ScheduleWorkflow.tsx`, `ManagerSchedule.tsx`, `ManagerCalendar.tsx`, `ManagerDemand.tsx`, `ScheduleReviewPanel.tsx`, `EmployeeSchedule.tsx`, `ShiftChanges.tsx`, `scheduling.view.ts`, `workspace.css`.
- Regression: `workspace.test.cjs` và các test hiện có liên quan nhãn, phân trang và các thao tác luồng lịch.

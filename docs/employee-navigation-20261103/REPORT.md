# Nhân viên — Tổng quan và Yêu cầu & hỗ trợ

Hoàn thiện local ngày 03/11/2026 (giờ Việt Nam). Không sửa nghiệp vụ backend, API, Rule Engine, quyền, migration hoặc dữ liệu Supabase. Không gửi yêu cầu/nhận lời/phê duyệt thử trên database thật.

## Giao diện

- Sidebar NV chỉ còn **Tổng quan**, **Đăng ký ca làm**, **Yêu cầu & hỗ trợ**; rộng 212px trên laptop, vẫn thu gọn được. Các đường dẫn `/employee/schedule`, `/employee/shift-requests`, `/employee/incidents` giữ hoạt động, ánh xạ đúng mục menu đang chọn.
- `/employee`: dùng lại Calendar hiện có ngay trong Dashboard. Ba KPI lấy từ cùng response `employee_schedule_week`: số ca, tổng giờ theo thời gian ca (kể cả qua đêm), ca sắp bắt đầu tiếp theo trong tuần đang xem. Mặc định tuần hiện tại; khi chuyển tuần, nhãn số ca đổi theo tuần được chọn. KPI không hardcode, lỗi tải không biến thành 0.
- Calendar gọn, tên buổi và giờ/bộ phận dễ đọc; tên ca thật có trong chi tiết. Màu ưu tiên tên buổi từ danh mục; chỉ suy từ giờ bắt đầu khi tên không xác định được. Giữ nút chuyển tuần, chế độ tuần/danh sách, chi tiết và deep link đổi ca/báo sự cố.
- Dưới lịch có tối đa 3 yêu cầu/sự cố mới nhất, nhãn trạng thái và đường dẫn lịch sử. Đọc danh sách độc lập để đổi tuần không gọi lại API yêu cầu.
- `/employee/support`: ba tab **Đổi ca**, **Báo cáo sự cố**, **Lịch sử yêu cầu**. Tái sử dụng `ShiftChanges`; tab tạo chỉ có form và inbox lời mời thu gọn, không lặp lịch sử dưới mỗi form. Tab lịch sử bao gồm cả REQUEST/INCIDENT, mặc định tất cả trạng thái, phân trang 6 thẻ, mở chi tiết kết quả và thời điểm xử lý nếu API có trả về.
- Tab lịch sử không gọi API lịch tuần, không hiển thị form ghi. Chuyển tab không ghi nghiệp vụ. Các thao tác thực tế vẫn qua `shiftChangeService` và backend hiện có.

## Kiểm chứng Supabase thật — chỉ đọc

`supabase-transfer-evidence.json` ghi nhận đúng project `wlbpprpiieonjrqglicv`, Lê Duẩn, 02–08/11/2026, transaction `REPEATABLE READ READ ONLY`.

- Có 1 yêu cầu PENDING của `nv_jollibee_02` cho ca 02/11. Phân công gốc vẫn ACTIVE, vẫn có trong response lịch cá nhân; chưa có lời mời ACCEPTED hoặc bản ghi thay thế. Lịch sử yêu cầu vẫn tồn tại.
- `nv_jollibee` và `nv_jollibee_02` hiện mỗi tài khoản có 5 phân công. Không sửa số ca, nhân viên, đăng ký hoặc nhu cầu để đạt kết quả này.
- Đọc function body thực tế `tv5_mutate`: nội dung khớp migration local 20261104 sau chuẩn hóa newline. SHA-256 định nghĩa được lưu trong evidence. Nhánh tạo yêu cầu/đồng ý không cập nhật phân công; nhánh quản lý hoàn tất giữ bản gốc REPLACED, tạo bản ACTIVE có `replaces_assignment_id`, giữ source/audit.
- **Chưa thể nghiệm thu trực tiếp trên dữ liệu thật bước người thay đồng ý và bước chuyển hoàn tất:** database hiện không có hai tình huống đó trong phạm vi này. Không tạo dữ liệu thử để lấp bằng chứng. Chưa phát hiện lý do phải đổi nghiệp vụ.
- `native-transfer-tests.txt`: 1 integration test PostgreSQL cô lập PASS, bao phủ quyền, đồng ý, phê duyệt cạnh tranh, rollback, giữ bản gốc và lịch người gửi mất ca/người nhận có ca sau chuyển hoàn tất. Đây là bằng chứng kiểm thử local, không thay thế nghiệm thu thao tác thật.

Sau khi người dùng tự hoàn tất một yêu cầu hợp lệ trên website, có thể chạy lại `node backend/scripts/inspect-employee-transfer-readonly.cjs` để đối chiếu source, phân công gốc/mới và response lịch của hai người. Script chỉ SELECT, không tự xử lý yêu cầu. Nếu ca đã tiếp tục được thay ở yêu cầu sau, cần xem cả chuỗi thay thế; không kết luận lỗi chỉ vì bản thay đầu tiên không còn ACTIVE.

## Kiểm thử và hiệu năng

- Frontend typecheck/build PASS; **203 tests PASS**, 0 fail/skip.
- Backend typecheck/build PASS; **257 tests PASS**, 26 SKIP (integration cần opt-in). Integration TV5 đã chạy riêng và PASS như trên.
- Test bổ sung: KPI ca qua đêm/ca tiếp theo, không mutate dữ liệu API, giới hạn 3 yêu cầu gần nhất, ba tab/URL context, route cũ, lịch sử đủ hai loại và kết quả, lịch sử không tải lịch hoặc gửi thao tác ghi. Regression quản lý và các vai trò khác vẫn PASS.
- Bố cục 4 màn hình (Dashboard, đổi ca, sự cố, lịch sử) được chụp bằng Chrome ở đúng **1366×768** và **390×768**: 8/8 không tràn ngang (`layout-results.json`). Ảnh 1366 được lưu cùng báo cáo.
- Ảnh dùng **snapshot chỉ đọc từ tài khoản thật `nv_jollibee_02`**, không sinh dữ liệu mô phỏng. JSON/HTML gốc để trong thư mục tạm ngoài repository; không truy cập token hoặc phiên trình duyệt. Ảnh xác minh bố cục, không phải bản ghi thao tác ghi trên website.
- Dashboard đọc 1 API lịch + 1 API yêu cầu; KPI dùng chung lịch, chuyển tuần không đọc lại queue. Trang không tải dữ liệu của tab chưa mở. Giữ lazy loading, không thêm thư viện. Initial JS khoảng 233,75 KB / gzip 74,24 KB, gần như không tăng so với trước (233,97 KB / gzip 74,28 KB). Chưa có số đo wall time trình duyệt đầy đủ để khẳng định cải thiện tốc độ.

## File thay đổi chính

- `frontend/src/pages/employee/{EmployeeDashboard,EmployeeSchedule,ShiftChanges,EmployeeSupport}.tsx`
- `frontend/src/pages/employee/EmployeeWorkspace.css`
- `frontend/src/{App.tsx,dashboard.config.ts,components/layout/AppLayout.tsx}`
- `frontend/src/services/{employee-schedule,shift-change}.service.ts`: helper hiển thị/nhãn và type metadata hiện đã có trong response; không đổi endpoint hay payload ghi.
- `frontend/tests/{employee-navigation,employee-schedule,shift-changes}.test.cjs`
- Script kiểm chứng SELECT `backend/scripts/inspect-employee-transfer-readonly.cjs`.
- Script bố cục từ snapshot thật `frontend/scripts/inspect-employee-live-layout.cjs`; mở rộng script chụp hiện có `capture-employee-layout.cjs` để nhận thư mục/trang tùy chọn.

## Kiểm thử trên website

1. Nhân viên → **Tổng quan**: mặc định tuần hiện tại; đổi tuần, mở thẻ ca, chuyển danh sách, tải lại lịch khi cần.
2. **Yêu cầu & hỗ trợ → Đổi ca**: chọn ca hợp lệ, nhập lý do/người thay nếu có, kiểm tra và tự xác nhận gửi. Gửi/nhận lời chưa làm thay đổi lịch.
3. **Báo cáo sự cố**: form riêng, không tự gia hạn đổi ca. **Lịch sử yêu cầu**: xem cả hai loại, lọc trạng thái, mở kết quả.
4. Sau khi người dùng tự xử lý lời mời và quản lý phê duyệt theo workflow hiện có, mở lại Tổng quan hoặc bấm **Tải lại** bằng hai tài khoản để kiểm tra phân công chính thức. Không dùng nhãn “đã nhận lời” làm bằng chứng chuyển ca đã hoàn tất.

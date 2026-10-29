# TV1 – Sửa nền tảng và rà soát tích hợp

Ngày 29/10/2026. Repository `D:/Project/Nhom5_Jolibee_Vibecoding`, nhánh `feature/ui-ux-improvements`. Working tree sạch trước khi sửa. Không đọc repository cũ ở C, không commit/push/merge, không ghi Supabase.

## Lỗi và thay đổi

| Mức | Nguyên nhân đã xác nhận | Sửa |
| --- | --- | --- |
| P1 | AuthContext không loại bỏ getMe/changePassword/init/login cũ; logout chờ HTTP mới xóa trạng thái. Service có thể nhận login cũ hoặc xóa token mới khi getMe cũ trả 401. | Generation cho cập nhật state và phiên, kiểm tra trước retry/request và sau response; logout xóa token/user ngay; completion/error/finally cũ không ảnh hưởng phiên mới. |
| P1 | Refresh route chỉ coi status >=500 là lỗi dịch vụ, status 0/undefined thành 401. | Mapper chung coi lỗi transport là 503, giữ phiên phía client. |
| P2 | Login, refresh, middleware đổi Supabase 429 thành 401. | Giữ 429, thông báo chờ thử lại; không xóa phiên. |
| P2 | response.text nằm ngoài try/catch của fetch. | Chuẩn hóa lỗi body timeout thành ApiError status 0. JSON lỗi trong response 2xx thành 502. |
| P2 | Login và middleware lặp logic lấy branch/employee và bỏ qua lỗi truy vấn phụ. | Loader chung; lỗi đọc trả 503 thay vì thông tin thiếu âm thầm. |
| P3 | Form login thiếu liên kết label/input, autocomplete và tên truy cập của nút hiện mật khẩu. | Bổ sung thuộc tính accessibility, alert; giữ nguyên bố cục/màu/ảnh. |

Middleware mới hỗ trợ kiểm tra chủ sở hữu employee/phạm vi branch. Không có API nghiệp vụ TV2–TV5 trên nhánh này để áp dụng trực tiếp. Không tuyên bố các API ở nhánh thành viên khác đã được bảo vệ. Chi tiết cách dùng và điều kiện dữ liệu trong [hợp đồng tích hợp](tv1-integration-contract.md).

## File thay đổi

- Frontend: `src/context/AuthContext.tsx`, `src/services/auth.service.ts`, `src/pages/Login.tsx`.
- Backend: `src/routes/auth.routes.ts`, `src/middleware/auth.middleware.ts`; thêm `src/middleware/data-scope.middleware.ts`, `src/utils/auth-error.ts`, `src/utils/profile-details.ts`.
- Test: bổ sung frontend `tests/auth-context.test.cjs`, mở rộng `tests/auth.test.cjs`; thêm backend `tests/auth-errors.test.cjs`, `tests/data-scope.test.cjs`, `tests/profile-details.test.cjs`.
- Kiểm tra chỉ đọc: `backend/scripts/audit-integration.cjs`.
- Tài liệu: báo cáo này và `docs/tv1-integration-contract.md`.

## Dữ liệu và phối hợp

Đã đọc OpenAPI schema và dữ liệu Supabase thực tế: users 72, employees 70 (60 Lê Duẩn, 10 Hải Châu), departments 3, periods 4, registrations 474, shifts 6. Các kiểm tra duplicate, trạng thái, liên kết tài khoản/nhân viên/chi nhánh, ngày/phạm vi đăng ký trong script không phát hiện lỗi.

Hai branch chưa gán supervisor_id. Đây là thiếu cấu hình phân công cho kiểm tra phạm vi GS, không tự gán dữ liệu và không bỏ kiểm tra quyền. Chưa cần SQL thay đổi schema; chỉ lập SQL dữ liệu riêng sau khi có quyết định phân công và phê duyệt.

TV2 cần đối chiếu `employee_id = user.employee.id`, period/shift/date/status theo schema thật. Không có code đọc/lưu của TV2 hoặc HTTP lỗi để chứng minh nguyên nhân lỗi của TV2; không khẳng định nhầm UUID, RLS hay trigger là nguyên nhân. Các bảng TEST giữ nguyên.

TV3–TV5 cần áp dụng kiểm tra phạm vi trên row database và truy vấn danh sách, không chỉ role; tôn trọng 429/503/status 0. Giữ `authenticate` và cơ chế đổi mật khẩu bắt buộc. Không dùng service-role ở Frontend.

## Kiểm thử đã thực hiện

| Kiểm tra | Kết quả và giới hạn |
| --- | --- |
| Frontend TypeScript + production build | Đạt |
| Backend TypeScript + build | Đạt |
| Frontend regression | 19/19 đạt; service/hooks/route/render có mock và proxy HTTP, không phải E2E trình duyệt |
| Backend regression | 20/20 đạt; HTTP Express thật với SDK/database mock, gồm NV/QL/GS, đổi mật khẩu, retry trạng thái, reauthentication, middleware phạm vi |
| Supabase thực tế | Auth health và đọc schema/dữ liệu thành công; chỉ GET bằng quyền quản trị |
| Backend HTTP thực tế từ build hiện tại | Server cổng tạm: /api/health 200, /api/db-health 200 connected, /api/auth/me không token 401; server đã dừng |
| Git diff whitespace | Đạt |
| Login/đổi mật khẩu thật, desktop/mobile browser | Chưa kiểm thử trong đợt này; không có công cụ browser; không lấy mật khẩu hoặc reset tài khoản |

Frontend node_modules ban đầu thiếu lucide-react/executable tsc. Đã cài lại bằng `npm ci --ignore-scripts --no-audit --no-fund` theo lockfile hiện có; không đổi package.json/lockfile hoặc nâng dependency. Hai lỗi ở harness mock React mới đã được sửa trước lần chạy regression cuối cùng.

## Giới hạn còn lại

- Chưa kiểm tra đầy đủ CHECK/UNIQUE/trigger/RLS triển khai hoặc FK liên schema Auth bằng SQL metadata. OpenAPI và SELECT không đủ chứng minh chúng. Có thể dùng `docs/seed-foundation/inspect-schema.sql` chỉ đọc trong SQL Editor theo quy trình hiện có.
- Chưa kiểm thử RLS bằng JWT thật hoặc lưu đăng ký TV2; không thử ghi lên database dùng chung.
- Chưa kiểm thử đăng nhập thực NV/QL/GS hay responsive qua trình duyệt sau thay đổi. Các kết quả thành công ở lượt cũ không thay cho kiểm thử bản sửa hiện tại.
- Dashboard/header/sidebar hiện giữ nguyên thiết kế và route; thay đổi UI chỉ ở accessibility/login và thông báo lỗi dịch vụ. Chưa có bằng chứng thực nghiệm để báo PASS responsive.
- Thiếu tài liệu chi tiết đổi mật khẩu/phiên: `docs/first-login-password.md` đang trống; hợp đồng mới ghi nhận cơ chế đang có, không tự thay đổi chính sách nghiệp vụ.

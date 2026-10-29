# NHẬT KÝ TƯƠNG TÁC VÀ LÀM VIỆC VỚI AI (AI WORK LOG)
**Học phần:** MIS3047 – Quản lý Quy trình Kinh doanh  
**Đề tài:** Ứng dụng hỗ trợ đăng ký, xếp lịch và phân công lịch làm việc tại Jollibee  
**Nhóm thực hiện:** Nhóm 5  
**Công cụ hỗ trợ:** Google Antigravity  

---

## 1. Mục đích của tài liệu
Tài liệu này ghi nhận nhật ký các tương tác thực tế giữa Nhóm 5 và Google Antigravity trong suốt quá trình phân tích, thiết kế và phát triển ứng dụng theo phương pháp Vibecoding. Nhật ký chỉ ghi lại các hành động, quyết định và kết quả thực sự diễn ra, bảo đảm tính minh bạch và truy vết nguồn gốc phát triển.

---

## 2. Nhật ký các phiên làm việc (Work Log)

### Phiên 1: Phân tích 4 tài liệu yêu cầu & Lập kế hoạch tổng thể
- **Thời gian:** 28/10/2026 (23:20 – 23:29)
- **Nội dung yêu cầu từ nhóm:**
  - Đọc và phân tích toàn diện 4 tài liệu trong `docs/`: `Nhom5_INTENT_HoanChinh_Vibecode.docx`, `Nhom5_DESIGN_HoanChinh_Vibecode.docx`, `Nhom5_BPMN_Jolibee_Tobe.drawio`, `Nhom5_PhanTichTuDongHoa.docx`.
  - Phân tích chi tiết quy trình To-Be, 26 FR, BR01–BR18, các phụ lục nghiệp vụ chốt (4 cấp độ nhân viên, Crew Leader, nhu cầu nhân sự không gồm Crew Leader, cảnh báo cơ cấu, luồng AI 8 bước).
  - Phân tích mô hình CSDL 18 bảng, kiến trúc 3 lớp, đề xuất kế hoạch 6 sprint và phương án chia việc cho 5 thành viên để tránh xung đột mã nguồn.
- **Hành động thực hiện:**
  - Trích xuất và giải mã toàn bộ dữ liệu văn bản từ file `.docx` và file đồ họa XML `.drawio`.
  - Báo cáo xác nhận tình trạng đọc 100% tài liệu, làm rõ đường dẫn thực tế (`docs/` thay vì `docs/requirements/`).
  - Xây dựng sơ đồ quy trình To-Be dạng Mermaid, ma trận chức năng, phân định rõ ràng giữa điều kiện cứng (Hard constraints) và điều kiện mềm/cảnh báo cơ cấu (Soft constraints).
  - Xác định 5 điểm nghiệp vụ nhóm chưa chốt và đề xuất giải pháp xử lý an toàn kỹ thuật (không tự tiện hardcode quy tắc mới).
- **Kết quả:** Nhóm 5 xem xét, phê duyệt báo cáo phân tích và đồng ý bắt đầu triển khai Sprint 1.

---

### Phiên 2: Sprint 1 – Bước 1: Khởi tạo cấu trúc ứng dụng (Project Scaffolding)
- **Thời gian:** 28/10/2026 (23:30 – Hiện tại)
- **Nội dung yêu cầu từ nhóm:**
  - Thiết lập cấu trúc thư mục `frontend/` và `backend/`.
  - Khởi tạo ứng dụng React + Vite + TypeScript cho Frontend.
  - Khởi tạo ứng dụng Node.js + Express + TypeScript cho Backend với endpoint `/api/health`.
  - Thiết lập `.gitignore`, `.env.example`, `README.md` và mẫu nhật ký `docs/ai-work-log.md`.
  - Kiểm tra thực tế: Cả frontend và backend đều khởi động thành công, endpoint `/api/health` trả về kết quả hợp lệ, không có lỗi TypeScript nghiêm trọng.
  - Tuân thủ giới hạn: Chưa tạo database, chưa kết nối Supabase, chưa viết auth/phân quyền, không tự động commit/push git.
- **Hành động thực hiện:**
  - Kiểm tra môi trường hệ thống Windows: Cấu hình môi trường thực thi cho Node.js LTS v24.22.1 và Git v2.56.0.
  - Tạo cấu trúc thư mục backend: `package.json`, `tsconfig.json`, `.env.example`, `.env`, `src/server.ts` với route `/api/health` và cấu hình CORS.
  - Tạo cấu trúc thư mục frontend: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts` (cấu hình proxy `/api`), `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`.
  - Tạo file `.gitignore` toàn diện ở thư mục gốc (bảo vệ `node_modules`, `.env`, build artifacts).
  - Tạo file `.env.example` với danh mục các biến môi trường dự kiến cho Express, Supabase, Gemini API và n8n.
  - Cập nhật `README.md` với hướng dẫn cài đặt và khởi chạy chi tiết trên hệ điều hành Windows.
  - Cài đặt dependencies cho cả frontend và backend, thực hiện typecheck và build thử nghiệm.
  - Khởi động thử nghiệm backend và frontend, gửi request đến `/api/health` để xác thực phản hồi hợp lệ.
- **Kết quả:** Bước 1 của Sprint 1 hoàn thành trọn vẹn, hệ thống sẵn sàng để nhóm nghiệm thu trước khi bước sang thiết lập CSDL và xác thực.

---

### Phiên 3: Sprint 1 – Bước 2: Kết nối Express Backend với Supabase & Kiểm thử truy vấn thực tế
- **Thời gian:** 29/10/2026 (01:13 – 01:21)
- **Nội dung yêu cầu từ nhóm:**
  - Đọc `docs/Jollishift.sql` và rà soát mã nguồn Backend hiện hữu.
  - Cài đặt và sử dụng `@supabase/supabase-js` kết nối qua các biến môi trường trong `backend/.env`.
  - Tạo endpoint `GET /api/db-health` thực hiện truy vấn `SELECT` thật từ một bảng hiện có trong database (`public.branches`), đo lường độ trễ và trả về JSON kết quả.
  - Giữ nguyên endpoint `/api/health`.
  - Cập nhật `.env.example` và kiểm tra build.
  - Tuân thủ các ràng buộc: Không sửa CSDL, không dùng mock data, không đổi Frontend, không triển khai Auth, không làm lộ secret key, không tự commit/push.
- **Hành động thực hiện:**
  - Đọc và phân tích `docs/Jollishift.sql` xác nhận danh mục 18 bảng.
  - Cài đặt gói `@supabase/supabase-js` cho backend.
  - Khởi tạo module cấu hình `backend/src/config/supabase.ts`, bổ sung logic chuẩn hóa `SUPABASE_URL` tự động loại bỏ hậu tố `/rest/v1/` để tương thích tuyệt đối với SDK.
  - Thêm API `GET /api/db-health` vào `backend/src/server.ts` thực hiện truy vấn `SELECT id, name FROM branches LIMIT 1`.
  - Cập nhật `.env.example` ở cả thư mục gốc và thư mục `backend/`.
  - Thực hiện build kiểm tra: `npm run build` (tsc) thành công 100% với 0 lỗi.
  - Thử nghiệm kết nối thực tế tới Supabase: Endpoint `/api/db-health` trả về HTTP 200 `status: "ok"`, `database: "connected"`, đo lường độ trễ thực tế. Endpoint `/api/health` được duy trì nguyên vẹn.
- **Kết quả:** Kết nối giữa Express Backend và Supabase đạt trạng thái PASS, sẵn sàng cho các nghiệp vụ tiếp theo.

---

### Phiên 4: Sprint 1 – Bước 3: Đăng nhập, Đăng xuất, Phân quyền 3 vai trò (RBAC) & Khung giao diện
- **Thời gian:** 29/10/2026 (01:26 – 01:38)
- **Nội dung yêu cầu từ nhóm:**
  - Rà soát `docs/Jollishift.sql` xác định cơ chế liên kết giữa `auth.users` và `public.users`.
  - Xây dựng tính năng đăng nhập bằng email/mật khẩu, đăng xuất, duy trì phiên qua Supabase Auth.
  - Phân quyền 3 vai trò (`NV`, `QL`, `GS`) lấy từ database, bảo vệ API bằng middleware Backend.
  - Xây dựng trang Login (không có chức năng Sign up tự do, thông báo tài khoản do Admin cấp) và 3 khung Dashboard theo vai trò, phong cách Jollibee (đỏ - trắng - vàng).
  - Bảo vệ điều hướng (Protected routes) theo vai trò, hiển thị thông báo 403 khi truy cập trái quyền.
  - Kiểm tra build cả Frontend và Backend; hướng dẫn chi tiết cách tạo tài khoản kiểm thử trên Supabase.
- **Hành động thực hiện:**
  - Xác nhận cơ chế liên kết: `public.users.id REFERENCES auth.users(id) ON DELETE CASCADE`, không cần sửa schema CSDL.
  - Backend: Tạo `auth.types.ts`, `auth.middleware.ts` (xác thực token Supabase JWT, truy vấn `public.users` và `public.employees`, kiểm tra vai trò), `auth.routes.ts` (`POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`, các endpoint test phân quyền).
  - Frontend: Cài đặt `react-router-dom`, tạo `types/auth.ts`, `services/auth.service.ts`, `context/AuthContext.tsx`, `components/ProtectedRoute.tsx`, `components/Navbar.tsx`, `pages/Login.tsx`, các dashboard `EmployeeDashboard.tsx`, `ManagerDashboard.tsx`, `SupervisorDashboard.tsx`.
  - Kiểm tra build: Frontend (`vite build`) và Backend (`tsc`) đều vượt qua 100% với 0 lỗi.
  - Kiểm tra endpoint bảo mật: Chặn không có token (401), thiếu thông tin (400), sai mật khẩu (401).
- **Kết quả:** Bộ khung Đăng nhập, Đăng xuất và Phân quyền RBAC 3 vai trò đã hoàn thành trên mã nguồn, sẵn sàng để nhóm tạo 3 tài khoản kiểm thử trên Supabase Studio để xác thực thực tế.

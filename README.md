# Ứng Dụng Hỗ Trợ Đăng Ký, Xếp Lịch & Phân Công Lịch Làm Việc Tại Jollibee

> **Đồ án môn học:** MIS3047 – Quản lý Quy trình Kinh doanh  
> **Đơn vị:** Trường Đại học Kinh tế – Đại học Đà Nẵng  
> **Nhóm thực hiện:** Nhóm 5  
> **Giai đoạn hiện tại:** Sprint 1 – Bước 1: Khởi tạo cấu trúc ứng dụng (Project Scaffolding)

---

## 1. Giới thiệu dự án

Dự án số hóa và tự động hóa quy trình đăng ký, xếp lịch và phân công lịch làm việc tại Jollibee dựa trên mô hình BPMN To-Be, tích hợp công nghệ AI-assisted và tự động hóa theo luật (Rule-based Automation).

Hệ thống phục vụ 3 vai trò người dùng chính:
- **Nhân viên (NV):** Đăng ký nguyện vọng làm việc hàng tuần, xem lịch làm cá nhân, gửi yêu cầu đổi ca (trong cửa sổ 30 phút), phản hồi lời mời nhận ca và khai báo sự cố ngày làm.
- **Quản lý ca (QL):** Nhập nhu cầu nhân sự từ Sales Forecast, tạo lịch làm việc dự kiến (hỗ trợ bởi Rule Engine & AI đánh giá), kiểm tra cảnh báo cơ cấu, quản lý yêu cầu đổi ca và xác nhận phân công chính thức.
- **Giám sát khu vực (GS):** Xem xét phê duyệt hoặc yêu cầu điều chỉnh lịch làm việc của các chi nhánh, điều phối viện trợ nhân sự liên chi nhánh.

---

## 2. Công nghệ sử dụng (Tech Stack)

- **Frontend:** React 18, Vite, TypeScript, Lucide Icons, CSS3.
- **Backend:** Node.js, Express, TypeScript, CORS, Dotenv.
- **Database (Kế hoạch):** PostgreSQL (quản trị trên Supabase) với 18 bảng nghiệp vụ.
- **Authentication (Kế hoạch):** Supabase Auth (quản lý người dùng, mật khẩu băm, JWT).
- **Workflow & AI (Kế hoạch):** n8n (scheduler đợt đăng ký & nhắc hạn T-30) + Google Gemini API (AI đánh giá & đề xuất phương án lịch).
- **Version Control:** Git & GitHub (tối thiểu 15 commits có ý nghĩa).

---

## 3. Cấu trúc thư mục dự án

```text
Nhom5_Jolibee_Vibecoding/
├── backend/                        # Mã nguồn Backend API (Express + TypeScript)
│   ├── src/
│   │   └── server.ts               # Entry point Express server & /api/health
│   ├── .env.example                # Mẫu biến môi trường backend
│   ├── .env                        # Biến môi trường cục bộ (được gitignore)
│   ├── package.json
│   └── tsconfig.json
│
├── frontend/                       # Mã nguồn Frontend (React + Vite + TypeScript)
│   ├── src/
│   │   ├── App.tsx                 # Giao diện tổng quan & kiểm tra kết nối API
│   │   ├── main.tsx                # Entry point React
│   │   └── index.css               # Phong cách giao diện chuẩn thương hiệu Jollibee
│   ├── .env.example                # Mẫu biến môi trường frontend
│   ├── .env                        # Biến môi trường cục bộ (được gitignore)
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── tsconfig.node.json
│   └── vite.config.ts              # Cấu hình Vite & Proxy /api -> Backend
│
├── docs/                           # Tài liệu phân tích và thiết kế gốc
│   ├── Nhom5_INTENT_HoanChinh_Vibecode.docx
│   ├── Nhom5_DESIGN_HoanChinh_Vibecode.docx
│   ├── Nhom5_BPMN_Jolibee_Tobe.drawio
│   ├── Nhom5_PhanTichTuDongHoa.docx
│   └── ai-work-log.md              # Nhật ký tương tác phát triển cùng AI
│
├── .gitignore                      # Danh sách loại trừ commit (node_modules, .env, build)
├── .env.example                    # Mẫu cấu hình môi trường toàn hệ thống
└── README.md                       # Tài liệu hướng dẫn cài đặt & vận hành
```

---

## 4. Hướng dẫn cài đặt và chạy ứng dụng trên Windows

### 4.1. Yêu cầu hệ thống
- **Hệ điều hành:** Windows 10/11
- **Node.js:** Phiên bản 18+ (khuyến nghị Node.js v24 LTS hoặc v20 LTS)
- **Trình quản lý gói:** `npm` (đi kèm Node.js)
- **Git:** Git for Windows (phiên bản 2.x+)

### 4.2. Cài đặt các gói phụ thuộc (Dependencies)

Mở **PowerShell** hoặc **Command Prompt** tại thư mục gốc của dự án `Nhom5_Jolibee_Vibecoding`:

```powershell
# 1. Cài đặt dependencies cho Backend
cd backend
npm install
cd ..

# 2. Cài đặt dependencies cho Frontend
cd frontend
npm install
cd ..
```

### 4.3. Cấu hình biến môi trường
Các file `.env` đã được tạo sẵn cho môi trường phát triển cục bộ. Nếu cần tùy biến, sao chép từ `.env.example`:
- Backend: `backend/.env.example` -> `backend/.env` (Mặc định: `PORT=5000`)
- Frontend: `frontend/.env.example` -> `frontend/.env` (Mặc định: `VITE_API_URL=http://localhost:5000/api`)

### 4.4. Khởi chạy ứng dụng trong môi trường phát triển (Development Mode)

Để ứng dụng hoạt động đầy đủ cả Frontend và Backend, cần mở **2 cửa sổ PowerShell riêng biệt**:

#### Cửa sổ 1: Khởi động Backend API
```powershell
cd backend
npm run dev
```
*Kết quả:* Server Express sẽ khởi động tại: `http://localhost:5000`  
*Endpoint kiểm tra sức khỏe:* `http://localhost:5000/api/health`

#### Cửa sổ 2: Khởi động Frontend React
```powershell
cd frontend
npm run dev
```
*Kết quả:* Ứng dụng React sẽ sẵn sàng tại: `http://localhost:5173`

---

## 5. Hướng dẫn kiểm tra ứng dụng trên trình duyệt

1. Mở trình duyệt web (Google Chrome, Microsoft Edge, Firefox).
2. Truy cập vào địa chỉ: [http://localhost:5173](http://localhost:5173)
3. Quan sát giao diện:
   - Thẻ **"Trạng thái kết nối Backend Express"** sẽ tự động gửi yêu cầu đến `/api/health` thông qua Vite Proxy.
   - Khi kết nối thành công, huy hiệu màu xanh lá sẽ hiển thị: **`Backend Hoạt động bình thường (Status: OK)`** kèm theo dữ liệu JSON phản hồi từ Express server.
   - Có thể bấm nút **"Kiểm tra lại"** để gửi yêu cầu re-fetch kiểm tra thời gian phản hồi thực tế.

---

## 6. Quy tắc phối hợp làm việc cho 5 thành viên (Git Workflow)

1. **Phân nhánh (Branching Strategy):**
   - Tuyệt đối không commit trực tiếp lên nhánh `main` hoặc `develop`.
   - Mỗi thành viên tạo nhánh tính năng riêng từ `develop`:
     - `feature/tv1-auth-rbac` (Thành viên 1 - Core & Auth)
     - `feature/tv2-rule-engine` (Thành viên 2 - Xếp lịch & AI)
     - `feature/tv3-shift-change` (Thành viên 3 - Đổi ca & n8n)
     - `feature/tv4-ui-employee` (Thành viên 4 - Giao diện Nhân viên)
     - `feature/tv5-ui-manager` (Thành viên 5 - Giao diện Quản lý & Giám sát)
2. **Pull Request (PR) & Code Review:**
   - Mọi tính năng sau khi hoàn thành và vượt qua typecheck (`npm run typecheck`) phải tạo PR vào nhánh `develop`.
   - Cần ít nhất 1 thành viên khác review và phê duyệt trước khi merge để tránh xung đột mã nguồn.
3. **Bảo mật:**
   - Tuyệt đối không đưa thông tin mật khẩu, Supabase Service Role Key hoặc Gemini API Key lên kho GitHub. Toàn bộ bí mật phải được lưu trong file `.env` cục bộ.

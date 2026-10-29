# JolliShift – Báo cáo hoàn thiện Phần 1

Ngày kiểm tra: 29/10/2026. Nhánh: `feature/auth-ui-fix`.

## Nguyên nhân và bằng chứng

Frontend trước đây gọi cố định `/api/auth/login`, không sử dụng `VITE_API_URL` đã có trong `frontend/.env`, rồi gọi `res.json()` trước khi kiểm tra HTTP hoặc nội dung phản hồi. Kiểm thử đã tái hiện cấu hình proxy cũ khi upstream không kết nối được: HTTP 500, body rỗng. Đọc JSON từ body này gây `Unexpected end of JSON input`. Đây là lỗi ở xử lý phản hồi/đường truyền API, không phải bằng chứng mật khẩu sai hoặc dữ liệu Supabase hỏng.

Sau khi khởi động Backend trong lần kiểm tra này, API trực tiếp và qua Vite đều trả JSON hợp lệ. Không có log tiến trình hoặc Network của lần lỗi ban đầu nên chưa thể xác nhận hồi tố Backend đã dừng, sai địa chỉ hay nguyên nhân kết nối cụ thể tại thời điểm đó.

Ngoài ra đã phát hiện: chỉ lưu access token, bỏ qua refresh token; logout chỉ trả thông báo mà chưa thu hồi phiên Supabase; layout Sidebar mới chưa được gắn vào route; quay lại URL trước đăng nhập có thể đưa tài khoản đến phân hệ sai quyền; frontend build lỗi do thiếu khai báo Vite/ảnh và import không dùng.

## Thay đổi

- Auth service sử dụng `VITE_API_URL`, mặc định `/api`; phân biệt lỗi mạng, phản hồi rỗng/HTML và lỗi HTTP; giới hạn thời gian chờ; kiểm tra profile trước khi lưu phiên.
- Lưu đầy đủ phiên; refresh token được xoay qua `/api/auth/refresh`; gộp yêu cầu refresh đồng thời trong một tab; `/me` luôn xác minh Auth và đọc quyền từ `public.users`. Lỗi hạ tầng tạm thời không xóa token đang lưu.
- Backend logout gọi Supabase Auth để thu hồi phiên hiện tại; frontend luôn xóa phiên cục bộ và báo nếu không thể thu hồi phía máy chủ. Theo cơ chế JWT, access token đã phát hành có thể còn hiệu lực đến thời hạn của nó; refresh token của phiên đã logout được thu hồi.
- Backend từ chối hồ sơ thiếu, không hoạt động hoặc role ngoài NV/QL/GS. Không lấy quyền từ request body hay profile tự khai của frontend. Lỗi đọc phân quyền trả 503, không gộp thành mật khẩu sai.
- Gắn `AppLayout` có sẵn vào ba Dashboard; giữ giao diện và Sidebar theo role. Route sai quyền vẫn hiện 403. Menu chức năng chưa triển khai chỉ mở trang thông báo có sẵn và vẫn được bảo vệ theo role.
- Proxy dev/preview trả JSON 502 khi Backend không kết nối được; dùng `API_PROXY_TARGET`, mặc định `http://127.0.0.1:5000`. Script Vite chỉ rõ cấu hình TS để tránh chọn file JS được sinh trước đây. TypeScript config build xuất vào cache thay vì ghi đè cấu hình nằm cạnh source.
- API auth có `Cache-Control: no-store`; lỗi JSON đầu vào và API không tồn tại cũng trả JSON. Không ghi log toàn bộ lỗi SDK hoặc trả chi tiết SDK trong phản hồi xác thực.

## File đã sửa/thêm

Backend:
- `backend/src/config/supabase.ts`: tải `.env` theo vị trí Backend, không phụ thuộc thư mục chạy lệnh.
- `backend/src/routes/auth.routes.ts`: login, refresh, logout, kiểm tra trạng thái/role và lỗi.
- `backend/src/middleware/auth.middleware.ts`: xác minh trạng thái, role và phân biệt lỗi dịch vụ.
- `backend/src/server.ts`: phản hồi lỗi JSON và cache header.
- `backend/package.json`, `backend/tests/auth.test.cjs`: lệnh và kiểm thử.

Frontend:
- `frontend/src/services/auth.service.ts`: API và vòng đời phiên.
- `frontend/src/context/AuthContext.tsx`: khôi phục phiên, giữ thông báo lỗi và logout cục bộ.
- `frontend/src/App.tsx`: Dashboard, Sidebar và bảo vệ các route con.
- `frontend/src/pages/Login.tsx`: điều hướng theo quyền, hiển thị lỗi phiên.
- `frontend/src/components/layout/AppLayout.tsx`, `frontend/src/pages/employee/EmployeeDashboard.tsx`: bỏ import/biến không dùng để build được, giữ thiết kế.
- `frontend/src/vite-env.d.ts`: khai báo kiểu Vite và tài nguyên ảnh.
- `frontend/vite.config.ts`, `frontend/tsconfig.node.json`, `frontend/package.json`, `frontend/.env.example`: proxy, build và cấu hình mẫu.
- `frontend/tests/auth.test.cjs`, `frontend/tests/proxy.test.mjs`: kiểm thử service và tái hiện lỗi proxy.
- `docs/auth-part1-report.md`: báo cáo này.

## Kết quả kiểm tra

| Kiểm tra | Kết quả |
| --- | --- |
| Frontend `npm run build` | Đạt, TypeScript và Vite |
| Backend `npm run build` | Đạt |
| Frontend `npm test` | 8/8 đạt |
| Backend `npm test` | 4/4 đạt; script cũng build Backend |
| Ma trận quyền Backend | 9 tổ hợp NV/QL/GS, đúng role 200, khác role 403 |
| HTTP qua Vite → Backend thật | `/api/health` 200, `/api/db-health` 200, login thiếu dữ liệu 400, `/me` không token 401; tất cả JSON |
| Supabase kiểm tra chỉ đọc | Mỗi role có 1 hồ sơ đang hoạt động, cả 3 liên kết đúng Auth theo id |
| `git diff --check` | Không có lỗi khoảng trắng sau khi dọn |

Kiểm thử tự động xác thực thành công dùng SDK/HTTP fixture trong bộ nhớ để kiểm tra logic; không tạo tài khoản giả hoặc bản ghi Supabase. Việc đọc ba hồ sơ thực và đối chiếu Auth được thực hiện riêng bằng truy vấn chỉ đọc, chỉ xuất số lượng theo role.

## Kiểm thử bằng ba tài khoản thật

1. Mở hai terminal tại dự án. Chạy `cd backend` rồi `npm run dev`; terminal còn lại chạy `cd frontend` rồi `npm run dev`. Mở `http://localhost:5173`.
2. Cấu hình hiện tại `VITE_API_URL=http://localhost:5000/api` được dùng trực tiếp. Nếu muốn đi qua Vite proxy, đặt `VITE_API_URL=/api` trong `frontend/.env`, giữ `API_PROXY_TARGET=http://127.0.0.1:5000`, rồi khởi động lại frontend. Không đưa secret Supabase vào frontend. Khi dùng preview hoặc origin khác với 5173, dùng `/api` qua proxy hoặc cấu hình `FRONTEND_URL` tương ứng.
3. Đăng nhập lần lượt bằng ba tài khoản đã được cấp, nhập mật khẩu trực tiếp trên form, không gửi mật khẩu vào chat hoặc log.

| Role thật | Dashboard cần đến | Sidebar |
| --- | --- | --- |
| NV | `/employee` | Menu Nhân viên |
| QL | `/manager` | Menu Quản lý ca |
| GS | `/supervisor` | Menu Giám sát khu vực |

4. Với từng tài khoản: tải lại trang, mở lại URL Dashboard trong tab cùng origin và kiểm tra phiên được khôi phục. Truy cập trực tiếp hai phân hệ khác, kể cả route con: phải hiện 403 và không hiện nội dung phân hệ đó. Nút quay về phải về đúng Dashboard của role.
5. Kiểm tra refresh mà không đọc/sao chép token: trong DevTools Console chạy `localStorage.setItem('jollishift_expires_at', '1'); location.reload();`. Tab Network phải có POST `/auth/refresh` thành công rồi GET `/auth/me`; vẫn ở đúng Dashboard. Không chụp hoặc sao chép nội dung response vì có token.
6. Kiểm tra Backend theo phiên hiện có mà không đọc token: trong Console của frontend chạy đoạn dưới. Nó chỉ in endpoint và mã HTTP:

```js
const { authService } = await import('/src/services/auth.service.ts');
for (const endpoint of ['employee-only', 'manager-only', 'supervisor-only']) {
  try {
    await authService.testRoleEndpoint(endpoint);
    console.log(endpoint, 200);
  } catch (error) {
    console.log(endpoint, error.status);
  }
}
```

Đoạn này dùng Vite dev server. Endpoint đúng role phải 200, hai endpoint còn lại phải 403.

7. Bấm Đăng xuất, sau đó tải lại trang hoặc dùng nút Back: không được mở Dashboard khi chưa đăng nhập lại. Đăng nhập tài khoản tiếp theo và lặp lại các bước. Có thể kiểm tra thêm mật khẩu sai và Backend tạm dừng: giao diện phải hiện thông báo phù hợp, không hiện lỗi JSON kỹ thuật.

## Chưa xác minh

- Đã kiểm thử đăng nhập, tải lại trang và logout bằng ba tài khoản thật qua thao tác trình duyệt của người dùng; chưa kiểm chứng refresh khi access token thực sự hết hạn hoặc thu hồi refresh token bằng một yêu cầu dùng lại phiên thật.
- Người dùng đã xác nhận trực quan Sidebar và điều hướng trên trình duyệt cho cả ba role. Agent không trực tiếp điều khiển được trình duyệt vì lệnh mở trình duyệt bị hệ thống kiểm duyệt tự động chặn; chưa kiểm thử responsive.
- Chưa có bằng chứng lịch sử để xác định nguyên nhân Backend không phản hồi ở lần lỗi ban đầu.
- Chưa kiểm thử triển khai production hoặc đồng bộ refresh đồng thời giữa nhiều tab.

Không thay đổi cấu trúc/dữ liệu Supabase, không triển khai nghiệp vụ đăng ký ca/xếp lịch/phê duyệt, không commit hoặc push.


## Cập nhật kiểm thử ứng dụng đang chạy – 29/10/2026

Ứng dụng được khởi động bằng cấu hình môi trường sẵn có và tiếp tục chạy để người dùng kiểm thử:
- Frontend: http://localhost:5173/login (tiến trình Vite PID 21580).
- Backend: http://localhost:5000 (tiến trình khởi chạy tsx PID 10248; watcher quản lý tiến trình HTTP con).

Các kết quả dưới đây là kiểm thử giao diện thực tế do người dùng nhập mật khẩu và thao tác trên trình duyệt, sau đó xác nhận trong chat; không phải kiểm thử UI tự động do agent điều khiển:

| Tài khoản | Đăng nhập / Dashboard / Sidebar | F5 giữ phiên | Hai phân hệ ngoài quyền |
| --- | --- | --- | --- |
| NV | Đạt, /employee và Sidebar Nhân viên | Đạt | /manager và /supervisor hiện 403 |
| QL | Đạt, /manager và Sidebar Quản lý ca | Đạt | /employee và /supervisor hiện 403 |
| GS | Đạt, /supervisor và Sidebar Giám sát khu vực | Đạt | /employee và /manager hiện 403 |

Người dùng xác nhận sau logout, mở lại Dashboard chuyển về /login. Không ghi nhận lỗi ứng dụng mới trong các bước này.

Agent kiểm tra trực tiếp qua HTTP:
- Frontend entry, các module TSX/service và ảnh thương hiệu trả 200, không có lỗi biên dịch Vite trên các tài nguyên đã kiểm tra.
- API health và db-health trả 200, database connected, cả trực tiếp và qua proxy Vite.
- Login thiếu thông tin trả JSON 400; /me và ba endpoint role khi không xác thực trả JSON 401.
- CORS preflight từ http://localhost:5173 trả 204 và cho phép content-type/authorization.
- Đọc Supabase lần nữa: mỗi role NV/QL/GS có một hồ sơ active và một liên kết Auth đúng id; không xuất thông tin tài khoản hoặc khóa.
- git diff --check không báo lỗi.

Giới hạn môi trường: ổ C gần hết dung lượng; việc cài Playwright tạm thất bại với ENOSPC. Hệ thống kiểm duyệt tự động cũng chặn lệnh mở trình duyệt thông thường và Edge có cổng điều khiển, nên người dùng tự mở URL để kiểm thử. Thao tác dọn thư mục công cụ tạm bị kiểm duyệt từ chối và thư mục được giữ nguyên. Không dùng cách khác để vượt các chặn này.

Chưa kiểm thử: refresh với token thật đã hết hạn, ma trận endpoint Backend 200/403 bằng token thật của cả ba tài khoản, responsive và thu hồi refresh token thật. Kết quả ma trận Backend tự động ở phần trên sử dụng SDK giả lập trong bộ nhớ.

Không sửa code nghiệp vụ thêm ở lượt chạy này; chỉ cập nhật báo cáo. Không sửa dữ liệu Supabase, không commit/push.

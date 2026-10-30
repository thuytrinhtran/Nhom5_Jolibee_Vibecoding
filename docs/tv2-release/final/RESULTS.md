> Ki?m tra t?ch h?p m?i nh?t: nh?nh TV2 ?? ??ng b? origin/main e30694b; gi? nguy?n API v? route TV4. Backend 68/68, frontend 68/68 v? build hai ph?a ??t. Kh?ng ch?y SQL/cron cloud. File .env th?c t? kh?ng ??a v?o commit; ch? template placeholder.

# Kết quả kiểm thử TV2 — 30/10/2026

| Kiểm chứng | Kết quả |
|---|---|
| Backend TypeScript/build | Đạt |
| Backend + SQL PostgreSQL cô lập | **62/62 đạt, 0 skip** |
| Frontend toàn bộ | **29/29 đạt** |
| Frontend production build | Đạt |
| Edge headless, không DEMO | Đạt: login fixture, 21 checkbox, nháp/gửi/sửa 3 ca, F5 giữ dữ liệu, OFF sau VALID, khóa hết hạn |
| Fake clock browser | Đạt: từ 14:59 sang 15:00 tự bật, từ Chủ nhật 11:59 qua 12:00 tự khóa; không F5 tại thời điểm chuyển mốc |
| Scheduler SQL | Đạt: hai branch đủ điều kiện, bỏ inactive/empty branch, 4 tuần, không trùng, không ghi đè kỳ cũ, phục hồi sau gián đoạn, qua tháng/năm |
| Activation SQL | Đạt trong catalog cron giả lập: thiếu extension bị chặn, bootstrap/replay một job, từ chối command lạ. Không test engine pg_cron thật |
| RPC | Đạt 14:59/15:00/11:59/12:00 với draft và submit; ngoài hạn giữ nguyên dữ liệu; browser JWT không được execute privileged RPC |
| Quyền | Đạt owner NV, branch QL, GS theo supervisor_id; lỗi DB fail closed; Crew Leader bị chặn |
| Persistence/restart | Đạt qua HTTP load lại và khởi động lại HTTP server/đăng nhập fixture, giữ PostgreSQL cô lập |
| TV3/dữ liệu mẫu | Đạt VALID/OFF/chưa đăng ký; mặc định bỏ mẫu, opt-in đọc được; migration replay giữ rows, fixture v2 nhận diện qua audit, tự lưu trở thành thật |
| Auth TV1 | Test hồi quy upstream đạt: profile chung, lỗi 401/403/429/503, body timeout, SESSION_CHANGED, phản hồi cũ không phá phiên mới |
| Supabase chính thức | **Chỉ GET**. Còn thiếu sample_batch_id và các view mới, automation cũ=false. Chưa áp dụng migration/kích hoạt cron hoặc thử ghi cloud |

Lỗi test proxy cũ đã được xác định: Vite test bind localhost/IPv6 nhưng fetch IPv4 có thể gọi nhầm web thật trên 5173. Đã cố định bind IPv4 trong test; không đổi logic proxy sản phẩm để làm test đạt.

## Lệnh tái lập

```powershell
npm.cmd --prefix backend run build
# Trỏ tới package PGlite cài riêng, không phải cấu hình database chung:
$env:REGISTRATION_PGLITE_PATH=(Resolve-Path '.tmp/tv2-time-state/node_modules/@electric-sql/pglite').Path
node --test --test-concurrency=2 backend/tests/*.test.cjs
npm.cmd --prefix frontend test
npm.cmd --prefix frontend run build
node frontend/scripts/tv2-api-ui.cjs
```

Browser test cần playwright-core qua REGISTRATION_PLAYWRIGHT_PATH hoặc thư mục test temp đã có và Edge qua TV2_BROWSER_PATH nếu không dùng đường dẫn mặc định. Browser/SQL fixtures không gọi Supabase chung. Biến PGlite chỉ áp dụng cho tiến trình test; không đưa vào server production. Không đổi thời gian hệ thống thật.

## Các phần còn chờ

- Nhóm trưởng chạy SELECT preflight để xác nhận catalog/RPC thật và pg_cron khả dụng; REST không xác minh được những quyền này.
- Duyệt/apply migration, deploy ứng dụng, bật integration Cron và chạy activation một lần, kiểm tra job thật và cloud smoke test bằng tài khoản được phép.
- Quyền sở hữu UI `/manager/registrations` chưa được tài liệu hiện hành giao TV2; giữ placeholder của người khác, API đọc đã bàn giao. Không tuyên bố UI đó đã xong.
- Tích hợp main bằng quy trình Git của nhóm và review trước merge; thay đổi đang ở working tree, nhiều file TV2 chưa được Git theo dõi. Không commit/push/merge trong lượt này.

Danh sách file và hash artifact ở [manifest.json](manifest.json). Không có thao tác DDL/DML/cron activation nào trên Supabase chính thức, không secrets trong artifact.

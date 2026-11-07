# Phát hành Gmail nhắc đăng ký ca

## Phạm vi và luồng

Service Google Apps Script được dùng lại. Worker trong Express chạy ngay khi
listen và mỗi 60 giây sau khi lượt trước kết thúc, chỉ khi
EMAIL_NOTIFICATIONS_ENABLED=true. Không có hai vòng lặp trong cùng process.

Mỗi lượt gọi RPC enqueue_registration_mail_reminders rồi đọc notifications loại
REGISTRATION_REMINDER, khóa reg-reminder:<period_id>:<employee_id>. RPC mới chỉ
xếp hàng nhắc; không tạo kỳ, đổi deadline/status hoặc thay cron. Giữ nguyên
registration_automation_config.enabled=false: automation legacy không cần bật.
Scheduler tv2-create-registration-periods hiện có vẫn đảm nhiệm tạo kỳ tương lai.

Hàm SQL cần migration additive 20261107_registration_mail_reminders.sql. Khi chưa
có hàm hoặc đọc dữ liệu lỗi, worker fail closed, không gửi email. Không tự áp
migration hoặc kích hoạt cấu hình production từ ứng dụng.

## Điều kiện

- Cửa sổ [close_at - reminder_minutes, close_at); mặc định 11:30 đến trước 12:00
  Chủ nhật, Asia/Ho_Chi_Minh. Kỳ thuộc tuần thứ Hai–Chủ nhật ngay sau ngày đóng.
- open_at <= thời gian kiểm tra; mở sớm để thử không khiến gửi nhắc sớm.
- Branch/employee ACTIVE; user NV đang hoạt động, cùng chi nhánh; năng lực thuộc
  NEW/REGULAR/CREW_TRAINING; không gồm Crew Leader.
- Chưa có registration_submissions VALID với submitted_at. VALID toàn tuần OFF
  cũng bị loại; DRAFT/chưa gửi có thể nhận nhắc.
- Worker kiểm tra recipient và khóa kỳ/employee, lấy email Admin Auth, đọc lại kỳ
  và submission trước HTTP gửi. Lỗi thì không gửi. Không khóa đăng ký trong lúc
  HTTP đang chạy: nếu nhân viên nộp sau lần đọc cuối, email có thể trùng thời điểm.

RPC dùng DB clock, worker kiểm tra clock backend. Các máy chủ phải đồng bộ giờ.
Apps Script chống trùng qua restart theo hướng dẫn google-mail-setup.md. Không đổi
notification.status vì đó là trạng thái dùng chung của thông báo trong ứng dụng.

## Kiểm tra không gửi thư

```powershell
npm.cmd --prefix backend run build
node --test backend/tests/google-mail.test.cjs backend/tests/registration-mail.test.cjs backend/tests/registration-mail-db.test.cjs backend/tests/registration-mail-startup.test.cjs
npm.cmd --prefix backend run mail:reminders:check
```

Tests dùng fixture/transport giả và PGlite nếu REGISTRATION_PGLITE_PATH trỏ tới
package đã cài riêng. Test DB không được bỏ qua khi nghiệm thu phát hành.
mail:reminders:check chỉ SELECT/Admin Auth GET; không enqueue hoặc gọi Apps Script.
Ngoài cửa sổ nhắc/hàng đợi rỗng, eligible=0 là đúng. Số eligible không xác nhận thư
chưa từng gửi. Dùng mail:check để kiểm tra contract Apps Script mà không gửi thư.

## Các bước quản lý Render/Supabase phải hoàn thành

1. Review/merge PR email vào fix/draft-resave (branch chính thức do người dùng xác nhận).
2. Chủ database review và áp backend/migrations/20261107_registration_mail_reminders.sql.
   Không bật legacy automation, không sửa kỳ hay đăng ký hiện có. Migration không
   được agent áp lên production. Giữ scheduler tạo kỳ hiện có, kiểm tra job history.
3. Trong đúng Render backend service của repository, kiểm tra deploy branch
   fix/draft-resave, root backend, Build npm ci --include=dev && npm run build,
   Start npm start. Không tạo service trùng hoặc đổi env workflow khác.
4. Đặt GOOGLE_SCRIPT_URL, GOOGLE_MAIL_SECRET từ cấu hình đã được kiểm thử vào Render
   Environment; đặt EMAIL_NOTIFICATIONS_ENABLED=true sau khi migration đã được duyệt.
   Chọn Manual Deploy / Deploy latest commit; không ghi secret vào Git/log.
5. GET /api/health: status=ok và registration_mail.enabled=true, started=true,
   last_checked_at có giá trị, last_run_ok=true sau một lượt. Đây chỉ xác nhận lượt
   worker đã thành công, không chứng minh thư tới hộp thư hoặc toàn bộ cron đã chạy.
6. Kiểm tra Apps Script contract v2 bằng mail:check; không gửi mẫu thật nếu chưa được
   phép. Kiểm tra log [registration-mail] chỉ có số tổng hợp và mã lỗi.

Render Free ngủ sau 15 phút không có inbound traffic; setTimeout không giữ service
thức. Để nhắc đúng giờ cần service luôn chạy, hoặc lịch HTTP bên ngoài truy cập
/api/health mỗi phút trong cửa sổ nhắc (tương ứng Chủ nhật 04:25–04:59 UTC để dự
phòng cold start trước 11:30 giờ Việt Nam). Không có wake-up đã cấu hình thì không
được tuyên bố worker chạy đúng hạn. Agent không tạo gói trả phí hay lịch bên ngoài.
Nguồn: https://render.com/docs/free

Nếu lỡ toàn bộ cửa sổ thì không gửi bù sau deadline. Rollback: đặt email flag=false,
restart backend; nếu cần thì review backend/rollbacks/20261107_registration_mail_reminders.sql
chỉ drop hàm mới, giữ nguyên notifications. Không tự gửi lại pending.

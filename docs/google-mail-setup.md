# Gmail qua Google Apps Script

Backend POST JSON `{ secret, to, subject, message }` tới Web App HTTPS `/exec`.
Chỉ `success:true` kèm `status:sent` hoặc `duplicate` được xác nhận thành công.
HTTP 200 đơn thuần, HTML và JSON sai đều không được coi là thành công.

## Cấu hình backend

```dotenv
GOOGLE_SCRIPT_URL=<WEB_APP_EXEC_URL>
GOOGLE_MAIL_SECRET=<SERVER_ONLY_SECRET>
EMAIL_NOTIFICATIONS_ENABLED=false
```

Không dùng biến VITE_ cho secret. Không commit `.env`. Biến GOOGLE_SCRIPT_SECRET
legacy không được service này sử dụng. Worker mặc định tắt; chỉ bật sau khi hoàn
thành các điều kiện trong [hướng dẫn phát hành](registration-mail-local.md).

## Apps Script

Copy toàn bộ `docs/google-mail-webapp.gs` vào dự án Apps Script hiện có. Đặt
GOOGLE_MAIL_SECRET trong Project Settings / Script Properties, giống backend.
Chạy authorizeMail một lần trong editor để cấp quyền MailApp, không gửi email.
Deploy cùng Web App: Execute as Me, truy cập Anyone, Edit / New version / Deploy.
Giữ URL hiện có. Contract hiện tại là jollishift-mail.v2.

Chẩn đoán không gửi email, từ thư mục gốc:

```powershell
npm.cmd --prefix backend run mail:check
```

Kết quả mong đợi là 302 tới Google content, HTTP 200 JSON, currentContract=true,
success=true, status=diagnostic. Lệnh không gửi recipient, không sửa sổ chống trùng,
không in URL/secret/raw response. remainingQuota/pendingRecords là số tổng hợp.

## Gửi mẫu hoặc một thông báo có sẵn

Chỉ thực hiện khi được phép gửi thư thật:

```powershell
npm.cmd --prefix backend run mail -- --to your-address@gmail.com
npm.cmd --prefix backend run mail:send -- --notification UUID_THONG_BAO
```

Các lệnh tự build. Lệnh notification chỉ nhận REGISTRATION_REMINDER, đọc email
người nhận từ Admin Auth và dùng cùng formatter như worker, không ghi database.
Lệnh thủ công không áp điều kiện thời gian của worker: không dùng nó để kiểm tra
quy trình tự động trên nhân viên thật.

## Chống trùng và lỗi

Backend gộp request đồng thời, timeout 15 giây và không tự retry trong service.
Script dùng Script Lock + Script Properties, khóa SHA-256 theo to/subject/message;
nhắc tự động gắn ID notification để phân biệt sự kiện. Lưu 7 ngày, tối đa 1000
bản ghi còn hạn; restart backend không xóa sổ phía Google. Đây không phải bảo đảm
exactly-once vô thời hạn hay xác nhận thư đã tới Inbox.

Script reserve pending trước sendEmail. Khi pending chưa xác nhận, không tự gửi
lại hoặc xóa pending. Đối chiếu Gmail Sent / Apps Script Executions trước khi xử lý.
Worker ghi nhớ sent/duplicate và kết quả không rõ đến deadline trong process.

Backend phân biệt MAIL_UNAUTHORIZED, MAIL_PROVIDER_INVALID_INPUT,
MAIL_PROVIDER_BUSY, MAIL_PROVIDER_CAPACITY, MAIL_PROVIDER_DELIVERY_UNKNOWN,
MAIL_HTML_RESPONSE, MAIL_INVALID_JSON, MAIL_TIMEOUT_RESULT_UNKNOWN,
MAIL_NETWORK_RESULT_UNKNOWN. Stage SEND là lỗi trong sendEmail; CONFIRM là lỗi
lưu sent sau khi sendEmail trả về; PENDING_PREVIOUS_ATTEMPT là bị chặn gửi lại.
Chỉ mã/stage trong allowlist được log, không có dữ liệu provider hoặc credential.

Tài liệu Google: https://developers.google.com/apps-script/reference/mail/mail-app
và https://developers.google.com/apps-script/guides/properties

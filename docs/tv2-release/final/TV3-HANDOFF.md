# Bàn giao đăng ký cho TV3 và người phụ trách UI quản lý

Áp dụng sau migration 20261030 cuối cùng, không chạy SQL seed hoặc migration gốc. View không tự cấp quyền browser; TV3 phải dùng backend và Auth/guard TV1.

| Nguồn | Ý nghĩa |
|---|---|
| registration_periods_effective | status hiệu lực từ giờ database; stored_status chỉ chẩn đoán |
| registration_submissions_sourced | Header; sample_batch_id tính thêm nguồn fixture v2 còn khớp audit, stored_sample_batch_id là cột gốc. View không sửa dữ liệu |
| shift_registrations | employee_id là employees.id; period/date/shift/status/submitted_at |

[tv3-contract.sql](../tv3-contract.sql) là ba SELECT: số NV VALID theo ngày/ca/bộ phận, khai báo SHIFT/OFF/NOT_SUBMITTED cho từng ngày, và từng nguyện vọng VALID theo employee. Cả ba trả period_status từ view. Không lọc PLANNED từ bảng gốc để kết luận kỳ chưa mở. DRAFT/INVALID/không header không xác nhận OFF; VALID phải có submitted_at. Mặc định loại mẫu.

```sql
SET app.tv2_period_id='UUID_KY_DA_KIEM_TRA_QUYEN';
-- Chỉ môi trường phát triển nếu muốn xem dữ liệu mẫu sẵn có:
SET app.tv2_include_samples='true';
-- Dán toàn bộ docs/tv2-release/tv3-contract.sql trong cùng Run.
```

QL chỉ đọc branch trong profile; GS chỉ đọc branch có branches.supervisor_id bằng users.id của GS. Không tự gán supervisor hoặc bypass toàn hệ thống. SET period chỉ là tham số truy vấn, không phải kiểm tra quyền.

API Express bàn giao: `GET /api/registration-reports/:periodId?include_samples=true` với Bearer token TV1; QL/GS được kiểm tra trên period tải từ DB. Envelope `{status:'ok',period,include_samples,submissions,registrations,server_now}`; submissions gồm header (cả DRAFT), registrations chỉ có dòng VALID thuộc header VALID có timestamp, employee/user ACTIVE đúng branch, ca ACTIVE và date trong kỳ. Mặc định bỏ mẫu. API này chưa trả ma trận toàn bộ nhân viên chưa đăng ký; dùng SELECT thứ hai trong contract để lấy đầy đủ ngày/employee. Không tự coi employee vắng khỏi response là OFF.

GET này chỉ đọc; không cung cấp thao tác sửa hộ nhân viên, nhu cầu nhân sự, xếp lịch hoặc UI07. HTTP: 400 ID/input sai, 401 phiên thiếu/sai, 403 sai phạm vi/role, 404 không có kỳ, 503 DB/schema chưa sẵn sàng; không xóa phiên khi 503. Nếu Supabase chưa suy luận được relation employee trên sourced view sau triển khai, đối chiếu OpenAPI/schema cache trước khi nhận bàn giao API quản lý; contract SQL không phụ thuộc suy luận join PostgREST.

Legacy fixture không khớp đầy đủ dấu kiểm toán sẽ không tự bị gán lại nguồn; cần trưởng nhóm đối chiếu nguồn ngoài hệ thống. Migration giữ nguyên mọi hàng. Dữ liệu mẫu v3 có sample_batch_id tiếp tục hoạt động, nhân viên tự lưu/gửi sẽ chuyển đăng ký của chính họ thành dữ liệu thật theo RPC; không tác động người khác.

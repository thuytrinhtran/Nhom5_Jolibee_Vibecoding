# Backend tự động xếp lịch JolliShift

Đã thêm chức năng tạo **một lịch dự kiến DRAFT** cho một đợt đăng ký tuần. Không tự trình duyệt, phê duyệt, công bố hoặc gửi thông báo. Không đổi đăng nhập, middleware RBAC hay frontend.

## Các file thay đổi

- `backend/src/server.ts`: gắn router `/api/schedules`.
- `backend/src/routes/scheduling.routes.ts`: xác thực bằng middleware hiện có, chỉ `QL`, validation và response HTTP.
- `backend/src/services/scheduling.engine.ts`: thuật toán thuần TypeScript, không phụ thuộc database.
- `backend/src/services/scheduling.service.ts`: đọc snapshot, tính lịch, lưu qua RPC và đọc lại database.
- `backend/migrations/20261029_automatic_scheduling.sql`: hai RPC, không thêm bảng/cột, không sửa/xóa lịch cũ.
- `backend/tests/scheduling.test.cjs`: kiểm thử thuật toán.
- `backend/tests/scheduling-api.test.cjs`: integration HTTP/middleware/service với Supabase stub trong bộ nhớ.
- `backend/tests/scheduling-database.test.cjs` và `backend/tests/scheduling.database.sql`: kiểm thử PostgreSQL opt-in bằng fixture trong transaction rồi rollback.
- `docs/automatic-scheduling.md`: tài liệu này.

## Nguồn và thuật toán

Đối chiếu schema `docs/Jollishift.sql`, tài liệu Intent/Design (bao gồm phụ lục), tài liệu tự động hóa, BPMN To-Be, frontend và backend hiện tại. Chưa có API xếp lịch hoặc Rule Engine trước thay đổi này.

1. Chọn `registration_periods` bằng `period_id`, dùng tuần thứ Hai–Chủ nhật và chi nhánh đã có trong đợt; đợt phải `CLOSED`. Backend kiểm tra QL thuộc chi nhánh đang hoạt động.
2. Đọc nhu cầu nhân sự từng ngày/ca/bộ phận, đăng ký, hồ sơ/kỹ năng, ca, giới hạn giờ và các phân công hiện có. Thiếu hoàn toàn nhu cầu là lỗi 422; khai báo số người cần bằng 0 là hợp lệ.
3. Chỉ chọn nhân viên và tài khoản đang hoạt động, role `NV`, thuộc ba cấp `NEW`, `REGULAR`, `CREW_TRAINING`, đúng bộ phận, có kỹ năng yêu cầu và đăng ký `VALID` cho đúng ngày/ca. Ca phải hoạt động và thuộc chi nhánh hoặc là mẫu dùng chung.
4. Xử lý nhu cầu ít ứng viên dư trước (`số ứng viên - số người cần`). Hòa được sắp theo ngày, mã ca, mã bộ phận. Mỗi lượt chọn kiểm tra lại overlap và giới hạn giờ. Không dùng hai ca có ID khác nhau để bỏ qua overlap.
5. Trong các ứng viên hợp lệ, ưu tiên cấp độ `CREW_TRAINING → REGULAR → NEW` theo phụ lục; cùng cấp độ ưu tiên ít ca đang có hơn, sau đó mã nhân viên tăng dần. Đây là thứ tự ổn định, không phụ thuộc thứ tự trả dữ liệu của database.
6. Mỗi vị trí chỉ phân đủ số cần; phần thiếu được lưu để QL xử lý tiếp. Trả thống kê và mã giải thích cho mỗi phân công.
7. Cảnh báo mềm `MANY_NEW_WITHOUT_CREW_TRAINING` khi số NEW **đạt hoặc vượt** `warning_configs.new_employee_count_threshold` và không có Crew Training trong cùng ngày/ca/bộ phận. Ngưỡng NULL không tự phát cảnh báo; không áp đặt tỷ lệ nhân viên mới.

Giờ làm dùng `Asia/Ho_Chi_Minh` (UTC+07). `end_time < start_time` là ca qua nửa đêm; hai ca chỉ chạm đầu/cuối không chồng lấn. Giờ qua Chủ nhật được chia theo hai tuần lịch; kiểm tra cả giờ đã đặt trong tuần kế tiếp. `total_weekly_hours` là giờ trong tuần được chọn, bao gồm lịch có sẵn; `shift_count` là số ca mới tạo. Cân bằng số ca có tính số ca cũ chạm tuần.

## API

Yêu cầu `Authorization: Bearer <access_token>`. Dùng middleware `authenticate` và `requireRole(['QL'])` hiện có, nên tài khoản chưa đổi mật khẩu cũng bị chặn. Không nhận `branch_id` hoặc `created_by` từ client.

```http
POST /api/schedules/generate
Content-Type: application/json
Authorization: Bearer <access_token>

{"period_id":"<UUID của registration_periods>"}
```

Trả `201` khi tạo, `200` khi gửi lặp và nhận lại cùng bản nháp:

```text
{
  status: "ok",
  reused: false,
  result: {
    schedule: { id, period_id, branch_id, version: 1, status: "DRAFT", ... },
    week: { id, branch_id, work_start_date, work_end_date, status },
    assignments: [{ employee_id, work_date, shift_id, department_id, requirement_id, reason }],
    coverage: [{ id, work_date, shift_id, department_id, required_count, assigned_count, missing_count, warning, ... }],
    shortages: [...những dòng coverage còn thiếu...],
    required_count,
    assigned_count,
    employee_statistics: [{ employee_id, shift_count, total_weekly_hours }],
    notes: [...]
  }
}
```

`GET /api/schedules/:id`: QL đọc lịch trong chi nhánh của mình; trả `result.schedule`, `result.assignments` hiện tại và `result.generation_snapshot` (kết quả gốc trong audit, không đại diện các sửa đổi sau này). Đọc lại Supabase, không dùng cache trong tiến trình.

Mã lỗi: 400 UUID/JSON không hợp lệ; 401 chưa xác thực; 403 sai quyền/chi nhánh/chưa đổi mật khẩu; 404 không tìm thấy; 409 đợt chưa đóng, đã có lịch khác hoặc snapshot thay đổi; 422 nhu cầu/ca/giới hạn không hợp lệ; 503 dịch vụ/database không khả dụng. Không trả chi tiết database/secret cho client.

## Database và triển khai

Đọc các bảng `branches`, `users`, `employees`, `employee_skills`, `shifts`, `registration_periods`, `shift_registrations`, `staffing_requirements`, `warning_configs` và `shift_assignments` hiện có. Ghi vào **`schedules`, `shift_assignments`, `audit_logs`**.

Áp dụng migration mới sau schema nền và migration `20261029_require_password_change.sql` bằng quy trình migration của nhóm. Ứng dụng không tự chạy migration khi khởi động. Giữ cấu hình Supabase backend hiện có với secret/service-role key; anon key không được gọi các RPC mới. Không thêm biến môi trường sản phẩm.

- `scheduling_input`: truy vấn snapshot tối thiểu, không lấy email/điện thoại/mật khẩu.
- `generate_schedule_draft`: lượt đầu trả snapshot hoặc kết quả đã lưu; lượt sau nhận snapshot và kết quả từ backend để ghi nguyên tử lịch, phân công, audit.
- RPC chỉ cho `service_role` gọi; kiểm tra lại actor, role, trạng thái tài khoản và chi nhánh trong database. Thuật toán được tin cậy chạy trong backend; RPC không cung cấp cho client để tự truyền phân công tùy ý.
- Lượt lưu khóa các bảng dữ liệu nguồn và bảng lịch trong transaction ngắn rồi so snapshot. Dữ liệu đổi trả 409 `INPUT_CHANGED`, client chạy lại. Khóa bảng là lựa chọn bảo thủ cho phạm vi đồ án, có thể làm các thao tác ghi ở chi nhánh khác phải chờ; cần đo tải trước khi mở rộng.
- Bất kỳ lịch tồn tại nào của đợt đều chặn tạo mới; ngoại lệ duy nhất là replay chính bản `DRAFT` tự sinh chưa bị sửa phân công và đợt chỉ có một lịch. Lịch nháp thủ công, nhiều phiên bản, lịch chờ duyệt/đã duyệt/đã công bố trả 409. Không sửa bản cũ hoặc tự mở quy trình phiên bản mới.
- Lỗi chèn phân công hoặc audit làm rollback cả transaction. Không reset/xóa dữ liệu Supabase.

## Kiểm thử và giới hạn xác minh

Tại `backend`: `npm.cmd run typecheck`, `npm.cmd test` (Windows PowerShell dùng `npm.cmd` nếu `npm.ps1` bị execution policy chặn).

Bộ test có các ca đủ/thiếu người, chưa đăng ký/đăng ký không VALID, sai kỹ năng/bộ phận, trạng thái nhân viên/tài khoản, Crew Leader, overlap/ca đêm, giới hạn giờ và ca qua tuần, ưu tiên/cân bằng/tie-break, không vượt nhu cầu/trùng phân công, cảnh báo có cấu hình, retry, lỗi đọc/lưu, RBAC và phạm vi chi nhánh. Bộ auth/password cũ vẫn chạy cùng.

Kết quả đã thực thi: **43 test pass**; build TypeScript thành công. Test HTTP/service dùng mock, không chứng minh transaction thực trên PostgreSQL. Test reload service chứng minh đọc lại database adapter, không phải kiểm thử khởi động lại backend với Supabase thật.

Kịch bản database `backend/tests/scheduling.database.sql` kiểm tra RPC đọc, lưu lịch/phân công/audit, rollback khi phân công trùng, snapshot stale, replay, chặn NV, trạng thái bảo vệ và quyền gọi RPC. Chỉ chạy với **database Supabase thử nghiệm** đã có schema và migrations. Cài `psql`, đặt `SCHEDULING_TEST_DATABASE_URL` trong môi trường cục bộ (không commit), chạy `npm.cmd test`; hoặc chạy file SQL bằng SQL Editor của database thử nghiệm. Fixture dùng UUID ngẫu nhiên và toàn bộ transaction kết thúc bằng ROLLBACK. Test tự động sẽ skip khi chưa cấu hình database thử nghiệm.

**Chưa thực thi:** migration/RPC trên PostgreSQL thật, kiểm thử hai request đồng thời thực tế và kiểm thử persistence sau khi dừng/khởi động backend thật. Môi trường hiện không có `psql`/Docker trong PATH. Không áp dụng migration lên Supabase hiện có.

Để xác minh restart trên môi trường thử nghiệm: áp migration; tạo fixture nhu cầu/đăng ký VALID/đợt CLOSED; POST bằng tài khoản QL; ghi nhận `schedule.id`; dừng rồi khởi động backend; GET bằng cùng QL và so lịch/phân công; POST lại phải trả cùng ID với `reused: true`. Kiểm tra database không có lịch/phân công/audit trùng. Cần token thực của tài khoản thử nghiệm.

## Giả định và phạm vi còn lại

- Thuật toán tham lam ưu tiên ca khan hiếm, không bảo đảm số vị trí phủ tối ưu toàn cục. Có thể cần QL điều chỉnh dù tồn tại phương án tốt hơn. Không dùng AI để vượt ràng buộc.
- `max_weekly_hours = NULL` nghĩa chưa cấu hình trần; không tự đặt số giờ, số ca/ngày, khoảng nghỉ hoặc giới hạn ca/tuần. Schema chưa có các cấu hình này.
- Kỹ năng so khớp chính xác `required_skill_name` với `employee_skills.skill_name`; chưa có ngưỡng proficiency hay yêu cầu role theo vị trí trong schema nên không tự suy diễn.
- Các phân công chưa `REPLACED` được coi là bận, kể cả bản nháp của lịch khác. Đây là lựa chọn bảo thủ; chưa có mô hình lựa chọn phiên bản lịch có hiệu lực đầy đủ trong backend.
- Crew Leader không được sinh ca vì không có đăng ký nguyện vọng; lịch do QL thiết lập riêng và không được trừ vào nhu cầu. Các phân công Crew Leader hiện có được giữ nguyên. Nếu đã có lịch Crew Leader trong cùng đợt, API trả 409 thay vì sửa lịch của chức năng khác. Cần thống nhất quy trình tích hợp lịch Crew Leader trước khi triển khai đầy đủ end-to-end.
- Chức năng này không thay thế bộ kiểm tra/trình duyệt/công bố: bản nháp thiếu người được lưu để QL xử lý, chưa có endpoint trình duyệt mới trong phạm vi này.
- Chưa bổ sung frontend, tìm người bổ sung ngoài đăng ký, viện trợ, AI hoặc sinh nhiều phương án.

Không commit, push hoặc merge.

## Tích hợp trang quản lý `/manager/schedule`

Nguyên nhân placeholder: `frontend/src/App.tsx` chưa có route cụ thể và bắt `/manager/schedule` bằng wildcard `/manager/*`. Backend đã gắn `/api/schedules` trong `server.ts`.

Thay đổi bổ sung trong bước tích hợp giao diện:

- `frontend/src/App.tsx`: route cụ thể, giữ `ProtectedRoute(['QL'])` và `AppLayout`.
- `frontend/src/pages/manager/ManagerSchedule.tsx` và `.css`: chọn tuần có thật trong database, trạng thái tải/tạo, thông báo lỗi/thiếu đăng ký/thiếu nhu cầu/thiếu người, bảng phân công theo ngày-ca-bộ phận, yêu cầu/đã xếp/còn thiếu.
- `frontend/src/types/scheduling.ts`: định dạng dữ liệu API.
- `frontend/src/services/scheduling.service.ts`: dùng session hiện có, gọi API qua `VITE_API_URL`/proxy; không thay đổi auth service hoặc storage đăng nhập.
- `frontend/src/services/scheduling.view.ts`: nhãn ngày/trạng thái, chọn phiên bản, đối chiếu nhu cầu snapshot với phân công thực đã lưu.
- `backend/src/routes/scheduling.routes.ts` và `backend/src/services/scheduling.service.ts`: thêm hai API **chỉ đọc**, giữ hợp đồng POST/GET cũ; báo lỗi rõ nếu thiếu RPC.
- `backend/tests/scheduling-read-api.test.cjs`, `frontend/tests/scheduling.test.cjs`: kiểm thử các phần mới.
- Không sửa schema/migration trong bước tích hợp giao diện.

API dùng cho giao diện:

| API | Mục đích |
| --- | --- |
| `GET /api/schedules/periods` | Danh sách tuần của chi nhánh QL, gồm mã/trạng thái/phiên bản lịch đã có |
| `GET /api/schedules/periods/:id` | Nhu cầu tuần, tổng đăng ký VALID, tên nhân viên, ca/giờ ca và bộ phận; chỉ trường cần hiển thị |
| `POST /api/schedules/generate` | Tạo DRAFT bằng `{period_id}`; lưu qua RPC transaction đã có |
| `GET /api/schedules/:id` | Đọc lại phân công đã lưu ngay sau POST và khi mở lại tuần |

Các endpoint mới dùng middleware auth/RBAC hiện có và lấy `branch_id` từ tài khoản được xác thực. Yêu cầu tham chiếu đợt ngoài chi nhánh trả 404. Không mở API phê duyệt/công bố.

Giao diện không sinh tuần, nhân viên hoặc phân công giả. Dropdown chỉ dùng đợt thực có trong `registration_periods`. Tuần chưa đóng không được tạo; thiếu nhu cầu bị chặn; thiếu đăng ký hợp lệ được báo để QL hiểu bản nháp sẽ thiếu người. Tuần có lịch được đọc lại, không POST khi mở trang. Sau POST luôn GET lại; nếu đã lưu nhưng GET lỗi, báo riêng và hướng dẫn tải lại tuần.

Xác minh sau tích hợp: frontend typecheck và production build đạt; **21 test frontend pass**; backend typecheck/build đạt, **44 test pass, 1 test database opt-in skip**. Kiểm tra HTTP localhost: backend health 200, `/manager/schedule` 200, API `/api/schedules/periods` trực tiếp và qua Vite proxy đều 401 khi không đăng nhập. Kiểm thử UI dùng React render/hook harness và API mock, chưa kiểm tra trực quan bằng trình duyệt hoặc tạo lịch end-to-end bằng tài khoản QL thật.

**Lỗi triển khai đã xác định:** kiểm tra chỉ đọc `scheduling_input` bằng GET RPC trên Supabase đang cấu hình trả mã thiếu function (`PGRST202`). Vì vậy RPC xếp lịch hiện chưa khả dụng; API tạo lịch trả 503 `SCHEDULING_NOT_CONFIGURED`. Cần người có quyền xem xét và áp dụng migration xếp lịch theo quy trình nhóm, sau đó xác minh POST/GET và khởi động lại backend trên môi trường thử nghiệm. Không chạy migration trên Supabase chung, không ghi dữ liệu thử, không chỉnh sửa/in `.env` hoặc secret key trong bước này.


Bổ sung Giai đoạn 2: xem [Tổng hợp đăng ký và cung–cầu nhân sự](tv3-phase2.md). Quy tắc ngưỡng NEW đã được xác nhận là >=, thay cho so sánh > của bản thử nghiệm trước.

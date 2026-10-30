# Đồng bộ TV2 với TV3 — 30/10/2026

## Git và phạm vi

TV3 phát triển trên `feature/tri-auto-scheduling`: `07a0e76` (xếp lịch/Gemini), `b5108de` (UI nhu cầu/xếp lịch), `d621f8d` (tích hợp main). Nhánh đã merge vào main bằng `2cb5509` (PR #6); main cũng chứa TV2 `66fe9a3` qua PR #5. Lượt này chỉ fast-forward **nhánh TV2** tới main, không merge riêng nhánh TV3, không cập nhật nhánh main. Cấu hình local đã sao lưu ngoài Git; stash TV2 cũ vẫn được giữ.

Đã đọc routes, repository Supabase/mock, summary/service/engine, tài liệu TV3 và kiểm tra migrations trong Git. TV3 bổ sung 78 file thay đổi so với commit TV2: adapter/service tổng hợp, Rule Engine, nhu cầu, AI, UI manager, test/tài liệu. Không có migration định nghĩa generate_schedule_draft/scheduling_input trong tree TV3 đã fetch dù tài liệu yêu cầu các RPC đó.

## Điểm lệch đã sửa ở ranh giới đọc

| Trước | Sau |
|---|---|
| TV3 chỉ lấy shift_registrations.status=VALID | Cần header VALID có submitted_at từ registration_submissions_sourced; ca cũng VALID có timestamp |
| Dữ liệu mẫu có thể được tính như thật | Loại provenance mẫu mặc định, kể cả fixture v2 được view nhận diện |
| Kỳ lấy status lưu PLANNED | Trả status hiệu lực theo cùng hàm thời gian server TV2, giữ stored_status để chẩn đoán |
| Chỉ số ca, không phân biệt tuần trống đã gửi | Trả thêm registration_declarations với SHIFT/OFF/NOT_SUBMITTED cho employee/ngày đủ điều kiện |
| GET tuần đếm raw rows riêng với GET summary | Cả hai dùng cùng repository/nguồn đăng ký đã kiểm tra |
| Hai lần đọc có thể trộn header trước/sau gửi lại | Đọc header trước/sau các trang ca; revision khác trả 409 REGISTRATION_CHANGED, yêu cầu tải lại |

Không sửa thuật toán, ưu tiên ứng viên, giới hạn ca/giờ, nhu cầu, AI, mock TV3, chức năng Auth TV1 hoặc workflow TV4. Thay adapter thật là cần thiết để dùng contract TV2 đã duyệt. Frontend TV3 hiện vẫn hiển thị tổng số theo ca; trường khai báo từng người/ngày là dữ liệu bổ sung cho bên tiêu thụ, không tự thay UI nghiệp vụ.

TV3 đọc lại nguồn khi GET, không cache trong tiến trình. Gửi lại thành công thay hàng cũ bằng hàng mới thì GET sau phản ánh bản mới; nháp sau VALID rút xác nhận. Lịch DRAFT/đã duyệt/đã công bố đã sinh không tự bị sửa theo đăng ký mới. Luồng RPC tạo lịch thật vẫn thuộc TV3; chưa chứng nhận body/cloud snapshot của nó chỉ bằng metadata REST.

## Đối chiếu cloud (chỉ GET)

Project chính thức `wlbpprpiieonjrqglicv`, cấu hình source mặc định supabase. Cột sample_batch_id, registration_submissions_sourced và registration_periods_effective hiện đã đọc được; khác snapshot trước, không suy đoán ai đã triển khai.

Adapter TV3 mới đọc thực kỳ Lê Duẩn 02–08/11: **5 dòng ca thật VALID**, 5 ngày SHIFT, 2 OFF, 371 NOT_SUBMITTED trên các nhân viên đủ điều kiện. Status hiệu lực OPEN, stored_status PLANNED; giờ mở thứ Sáu 30/10 15:00, đóng Chủ nhật 01/11 12:00, Asia/Ho_Chi_Minh. Số liệu theo thời điểm trong [báo cáo GET](tv2-release/final/tv3-sync-read-only.json), có thể đổi nếu người dùng đăng ký tiếp.

Lần kiểm tra đầu, bảng nhu cầu/lịch có 0 dòng; lần GET cuối, adapter đã đọc được **63 nhu cầu và 63 nhóm tổng hợp**, vẫn có 5 dòng đăng ký thật. Dữ liệu chung thay đổi giữa hai lần đọc; không suy đoán ai đã cập nhật, lượt này không ghi database. REST OpenAPI không thấy generate_schedule_draft/scheduling_input với server key hiện có: có thể chưa triển khai/chưa cấp quyền/chưa vào schema cache. **Không kết luận chắc chắn hàm không tồn tại chỉ từ OpenAPI.** TV3/nhóm trưởng cần chạy [preflight chỉ đọc](tv2-release/final/tv3-rpc-preflight.sql), cung cấp migration/RPC thật và kiểm tra nguồn dùng header/sample/effective status, stale snapshot. Không tự tạo RPC hoặc nới quyền trong lượt này.

Scheduler TV2 không bị thay đổi: tạo kỳ UUID bất kỳ, UNIQUE(branch_id,work_start_date), mốc thời gian cố định Việt Nam, không ghi đè kỳ. Adapter TV3 nhận kỳ theo branch/UUID thật và tính status hiệu lực nên không cần scheduler UPDATE status. Chưa kiểm tra catalog pg_cron/activation cloud; không bật cron hay automation cũ.

## Kiểm thử

- Backend: **160 pass, 0 fail, 1 skip** khi chạy từ thư mục backend, PGlite cô lập được bật. Test bỏ qua là TV3 PostgreSQL RPC thật cần disposable database/psql; không trỏ vào Supabase chung để chạy test.
- Frontend: **132/132 pass**. TypeScript và build production hai phía đạt.
- Browser Edge headless sau đồng bộ: login/nháp/gửi/sửa/F5 và tự bật/khóa theo fake clock đạt trên PostgreSQL/Auth fixture; không kết nối Supabase chung trong browser test.
- Test API liên module dùng Express thật + PostgreSQL/PGlite + Auth fixture: nháp → gửi → sửa/gửi → OFF cả tuần → nháp lại; loại mẫu và tự gửi trở thành thật; phạm vi QL và PLANNED trong cửa sổ. TV3 đọc đúng ca mới thay ca cũ, không đếm cả hai.
- Unit test lọc header thiếu/nháp/mẫu, branch/ngày/ca sai, Crew Leader, người dùng inactive, trùng ca và phát hiện revision thay đổi.
- Các route /employee/register, /manager/demand, /manager/schedule và workflow phê duyệt/công bố TV4 còn nguyên. Không sửa App.tsx/server.ts sau fast-forward.
- Chạy test từ root ban đầu làm hai test TV3 phụ thuộc cwd thất bại; chạy lại đúng backend đã đạt, không sửa logic để che lỗi đó.

Lệnh kiểm tra đọc thật sau build:
`node backend/scripts/check-tv2-tv3-integration.cjs BRANCH_UUID PERIOD_UUID`

Không dùng lệnh generate để kiểm tra đọc. Việc kiểm thử gửi lại trên cloud cần người dùng tự thao tác được phép; lượt này không tạo/sửa/xóa đăng ký chung, không chạy migration, không gọi Gemini thật, không tạo PR.

## File sửa cho tích hợp

- backend/src/registrations/tv3-source.ts
- backend/src/repositories/registration-summary.supabase.ts
- backend/src/repositories/registration-summary.types.ts
- backend/src/services/scheduling.service.ts (chỉ GET context/summary, giữ nguyên createDraft/readDraft)
- backend/tests/helpers/registration-harness.cjs
- backend/tests/registration-summary.test.cjs
- backend/tests/scheduling-read-api.test.cjs
- backend/tests/tv2-tv3-integration.test.cjs
- backend/tests/tv2-tv3-source.test.cjs
- backend/scripts/check-tv2-tv3-integration.cjs
- docs/tv2-tv3-integration.md
- docs/tv2-release/final/tv3-rpc-preflight.sql
- docs/tv2-release/final/tv3-sync-read-only.json

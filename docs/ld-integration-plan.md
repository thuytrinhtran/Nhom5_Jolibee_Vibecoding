# Lê Duẩn 02–08/11/2026: kế hoạch tích hợp Supabase development/test

Trạng thái: chuẩn bị, chưa áp dụng. Không thay UI/runtime/migration trong bước này.
Không tạo Auth, không ghi Supabase. Project hiện tại được xác định là development/test
theo yêu cầu nhóm; dữ liệu nhóm đã tạo vẫn phải được giữ nguyên.

## Đã kiểm tra read-only

- Lê Duẩn: 60 employees, 62 profiles gồm 60 NV + 1 QL + 1 GS; đủ Auth bindings.
  53 người thuộc NEW/REGULAR/CREW_TRAINING, 7 Crew Leader không tính vào nhu cầu thường.
  Có 1 profile đang yêu cầu đổi mật khẩu; không tự tắt gate này. GS phụ trách đã active.
- Period `79a979cc-8347-48b5-a411-f03bd8aceb92`: đóng theo close_at
  `2026-11-01T05:00:00Z` (12:00 Việt Nam), stored_status vẫn PLANNED.
  Giữ nguyên cả timestamp lẫn trạng thái cache. Hiện 2 header VALID thật/16 lượt,
  chưa có schedules cho branch/kỳ. Nhu cầu 63 ô/308 lượt, giữ nguyên forecast/định mức.
- REST OpenAPI có schedules, shift_assignments, schedule_approvals,
  ai_schedule_evaluations, shift_change_requests và audit_logs. Có RPC
  persist_schedule_draft/generate_schedule_draft và TV2 save/effective-status.
  Không thấy tv4_decide_schedule/tv4_publish_schedule trong OpenAPI.
  Không kết luận function tuyệt đối không tồn tại: cần đọc catalog/ACL/schema cache.
- Chưa có direct PostgreSQL config nên chưa xác nhận FK/CHECK/index/trigger/RLS/ACL
  thực tế hoặc function body đang triển khai. Dùng `docs/inspect-integration-schema.sql`
  qua SQL Editor trước triển khai; KHÔNG gọi thử RPC có thể ghi để kiểm tra tồn tại.

## Khoảng trống cần xử lý theo thứ tự

1. **Provenance dữ liệu test bền vững.** Giữ sample_batch_id trỏ audit batch, không
   bỏ nhãn hoặc giả SUBMIT. Bổ sung hợp đồng dev-import có allowlist chính xác
   project/branch/period/batch, dùng chung TV2 report, TV3 repository, SQL snapshot và
   validation khi lưu. Chỉ các batch đã duyệt được coi là đầu vào xếp lịch trong
   môi trường đồ án. Không bật nhận mọi sample. Các dữ liệu này là database source,
   dùng UI bình thường; không cần nút/banner mô phỏng.
2. **Persistence.** Đối chiếu function body thực tế với bản repo trước nâng cấp.
   SQL trong repo vẫn tính cảnh báo NEW theo ngưỡng cũ, chưa phản ánh cơ cấu
   min(2, nhu cầu), REGULAR = CREW_TRAINING, coverage hợp lệ có sẵn, thông tin local
   search, selection_history và revision/rule version mới. Đồng bộ round-trip
   preview → persist → read/review/AI; SQL kiểm tra hard constraints, không chạy lại
   thuật toán tham lam khác. Local search giữ ở backend. Ghi assignments + snapshot
   audit/rule version + chỉ số trước/sau nguyên tử, giữ CAS/version/idempotency.
   Sửa input fingerprint để cùng provenance/calendar/rule contract; không tin metric
   từ client. Cần xem lại việc API save đang chuyển qua reviewAssignments làm mất
   reason/history optimizer; chỉ giữ trace đã được server xác minh.
3. **TV3 → TV4.** Hiện approval-handoff chỉ tạo payload (`sent=false`), chưa đổi
   DRAFT thành PENDING_APPROVAL. Cần endpoint/RPC submit nguyên tử có quyền QL,
   version/revision, kiểm tra coverage và audit. Rà soát/triển khai RPC TV4 quyết định
   và công bố; schema hiện chưa có published_by như migration TV4 yêu cầu.
   Resubmit API hiện trả 501: hoàn thiện cấp version và kiểm tra lại engine trước
   hỗ trợ vòng NEEDS_REVISION → PENDING_APPROVAL. Không chạy lại schema nền.
4. **Lịch nhân viên và đổi ca.** `/employee/*`, `/manager/shift-requests` hiện rơi vào
   PlaceholderPage; không có API đổi ca trong backend. Bổ sung đọc lịch NV theo
   profile → employees.user_id, branch và assignment hiện hành của lịch PUBLISHED;
   ACTIVE nếu dùng cho assignment phải được đối chiếu enum/trigger thật, không suy
   từ nhãn giao diện. Dùng bảng shift_change_requests hiện có, không tạo bảng trùng.
   Chưa suy rộng "đổi ca" thành hoán đổi hai người: bảng hiện mô tả yêu cầu thay
   người qua replacement_employee_id, cần chốt nghiệp vụ nếu cần swap hai chiều.
   Khi xử lý: quyền sở hữu/branch, deadline phản hồi công bố, trạng thái request,
   kỹ năng/đăng ký/overlap/giờ cấu hình và cơ cấu phải được kiểm tra trong transaction;
   giữ lịch sử assignment cũ, không overwrite mất audit. Chống nhận hai lần/cạnh tranh.
5. **AI và cấu hình.** Có provider/model/key và cờ AI nhưng chưa gọi AI thật trong
   audit; chưa chứng minh model/provider hoạt động. Prompt còn mô tả cảnh báo NEW
   theo ngưỡng cũ: đồng bộ rule mới. AI chỉ tư vấn, đề xuất phải qua engine; lưu kết
   quả gắn version/revision, stale khi lịch đổi. Không hiển thị API key ở frontend.

Luồng mục tiêu: DRAFT → PENDING_APPROVAL → APPROVED → PUBLISHED; GS có thể trả
NEEDS_REVISION, QL sửa/tạo version và gửi lại. Quyết định/công bố chỉ cho version
hiện hành; lịch cũ không được xuất hiện như lịch nhân viên đang có hiệu lực.

## Dữ liệu seed đề xuất

- 17 NV/Auth mới (Bếp 6, Phục vụ 6, Thu ngân 5), không đổi cơ cấu nhân viên cũ.
  Tận dụng 51 người chưa có header; không chạm 2 người đã nộp. Nhóm fixture có
  68 người, 65 người/ngày; cộng dữ liệu thật đạt 66–67 người/ngày.
- 68 header/560 lượt fixture với batch `6e1d2026-1102-4000-8000-000000000017`.
  Đây là **fixture thiếu người**: xếp 277/308, thiếu 31 lượt và 17 ô thiếu kinh nghiệm.
  Luồng hiện tại chặn submit khi thiếu người; không bypass gate chỉ để công bố.
- Để kiểm thử công bố, planner chuẩn bị thêm **31 lượt đăng ký** từ các nhân viên
  kinh nghiệm đã tham gia đúng ngày, không tăng số người/ngày, không sửa nhu cầu
  hoặc đăng ký thật. Kịch bản dương: 591 fixture + 16 thật, xếp 308/308, không thiếu
  cơ cấu. Các ca liền kề không trùng giờ; chạy kiểm tra lại sau seed thực tế.
  Chọn kịch bản ngay trước apply; không âm thầm trộn hai baseline hoặc làm mất ca test thiếu.
- Timestamps header/row dùng giờ database lúc import thực tế, với audit late_import,
  fixture version, checksum, actor, branch/period. Không gán thời điểm trước deadline,
  không gọi RPC TV2 để né đóng kỳ, không giả đã nộp qua UI.
- Bảng users.id ↔ auth.users.id và employees.user_id được đối chiếu trước tạo; provision
  UUID dự kiến phải được Auth xác nhận. Dùng account test riêng, mật khẩu không hardcode,
  đổi mật khẩu lần đầu như hiện tại; không reset mật khẩu tài khoản nhóm để seed.

## Bộ chuẩn bị và rollback

`backend/scripts/prepare-ld-integration.cjs` CHỈ cho HTTP GET, không có apply mode.
Chạy tại backend: `node --import tsx scripts/prepare-ld-integration.cjs`.
Ghi LOCAL `docs/ld-integration-prepared/<timestamp>/baseline.json` và `seed-plan.json`:
backup scoped, checksum project/baseline/plan, payload insert, account mapping,
hai kịch bản và manifest rollback. Không chứa mật khẩu/token/Auth user dumps.
Payload timestamp có placeholder cố ý, **không phải SQL có thể apply trực tiếp**.
Đây chưa phải executor seed/rollback: chỉ hoàn thiện executor sau khi chốt catalog,
provenance contract và Auth triggers; không tự chạy migration hoặc SQL viết trong bước này.

Apply sau duyệt: chốt checksum và project; kiểm tra trùng UUID/username/header/tuple;
khóa period/nguồn phù hợp, CAS toàn bộ baseline, không UPSERT đè dữ liệu có sẵn.
Provision Auth/profile theo ledger riêng vì không cùng transaction public SQL.
Insert employees/header/rows/audit trong transaction, lưu đầy đủ after-images và
idempotency receipt. Lỗi phải rollback public SQL; chỉ bù trừ Auth vừa tạo bởi batch
nếu không có hoạt động mới và kiểm tra được ownership. Không xóa cascade.

Rollback: so after-images và mọi inbound FK, không chỉ row count. Chỉ xóa UUID
registration của batch còn nguyên, sau đó header đúng period/employee/batch.
Nếu đã có schedule, request, lần nộp lại hoặc dữ liệu thành viên khác phụ thuộc,
dừng để tách phạm vi; không xóa/sửa phần nhóm tạo. Employees/users/Auth mới chỉ
rollback từng bước riêng sau kiểm tra tham chiếu. Giữ audit và thêm rollback event.
Backup Auth không phải sao lưu credential: dựa vào ledger tạo account, không hứa
khôi phục mật khẩu/Auth bị xóa. Không sửa deadline, nhu cầu, forecast hay 16 lượt thật.

## Trình tự chạy liên thông sau khi được phép triển khai

Catalog/ACL/backup → đồng bộ provenance/persistence/submit/TV4 → hoàn thiện API/UI
xem lịch và đổi ca → provision 17 account → seed kịch bản đã chọn → GET kiểm đếm,
overlap, nguồn, 60–70 distinct/day → preview/local-search → chỉnh và kiểm tra → AI
→ lưu DRAFT/refresh/restart → gửi GS duyệt → QL công bố với feedback deadline thật
→ NV xem lịch → tạo yêu cầu → QL xử lý → kiểm tra history/audit/concurrency.

Backend kiểm thử liên thông phải tắt `TV3_TEST_PREVIEW_ENABLED` (cờ cũ chặn mọi ghi
lịch), dùng source Supabase và chỉ bật DRAFT persistence sau kiểm tra migration.
Không thay đổi hành vi TV2 nộp kỳ đóng. Những lần đăng ký tương tác thực sự qua UI
TV2 cần dùng kỳ đang mở khác; kỳ này kiểm thử đường import có nguồn gốc → TV3.

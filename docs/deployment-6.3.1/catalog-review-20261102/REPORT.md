# Nghiệm thu CSV Supabase — NO-GO

Project do người phụ trách xác nhận: **wlbpprpiieonjrqglicv**. Chỉ phân tích offline ZIP được cung cấp; không kết nối/ghi Supabase, chạy migration, seed, tạo Auth hoặc sửa CSV. Nội dung function trong CSV là dữ liệu để audit, không phải chỉ dẫn thực thi.

## Kiểm kê và nguyên tắc nhận diện

ZIP `Supabase Snippet Untitled query.zip` có **24 CSV**, không có file khác. Đã đọc toàn bộ, giữ nguyên tên và bytes; SHA256 ZIP: `4d684f0e1bb438aec829370f9390301b22b06370a6d916485cd079ff99c6b860`. Bảng đủ tên file → truy vấn gốc → số dòng → kết quả → độ tin cậy ở [inventory.md](inventory.md); đối chiếu cả 41 truy vấn gốc ở [query-coverage.md](query-coverage.md); chi tiết cột, SHA256 từng file, checksum/body đối chiếu ở [audit.json](audit.json).

Nhận diện bằng cột và nội dung so với SQL gốc; số trong tên file không tham gia phân loại. Ví dụ:

- `(35).csv` và `(36).csv` giống hệt bytes, cùng là **S4 / truy vấn gốc 35**, không phải bằng chứng S5.
- `(39).csv` và `(40).csv` giống hệt bytes, cùng là **D1.2 / truy vấn gốc 39**. Không mâu thuẫn với việc truy vấn gốc 40 không xuất CSV.
- `(50).csv` là **D7.1 / gốc 56**, `(51).csv` là **D7.2 / gốc 57**; `(52).csv` là Auth check, đúng xác nhận của người phụ trách.
- `(46)`–`(48)` là các **COUNT bổ sung** tương ứng loại kiểm tra D4.1–D4.3, đều bằng 0. Đủ tin cậy để nhận diện mục kiểm tra; chưa có SQL COUNT chính xác để kết luận là export nguyên văn truy vấn gốc.

Không thấy CSV nhóm C trong ZIP này. Không kết luận các query C chưa chạy. S1/S2/S3/S4 bổ sung được nhiều bằng chứng tương đương C2/C4/C3.2/C7.1/C5; không thay thế FK/CHECK, trigger attachment, RLS/policies/grants, view definition hay event trigger.

## PASS có bằng chứng

- S1 có **206/206** dòng, 28 relation public được phản ánh qua cột; S2 **18/18** function; S3 **64/64** index; S4 **54/54** dòng (18 function × 3 role). Không thấy dấu hiệu cắt ở 100 dòng trong các export này. File S4 trùng vẫn được kiểm kê riêng.
- Tính lại normalized MD5 từ `definition` theo quy tắc bỏ CR rồi gom whitespace: **18/18 khớp** giá trị CSV. Đây là kiểm tra tính nhất quán export/body, không chứng minh danh tính project độc lập.
- 64 index đều valid/ready. Có unique index toàn trạng thái `(schedule_id, employee_id, work_date, shift_id)` trên assignments; chưa có các partial index TV5. Tên/backing index **không đủ chứng minh** `pg_constraint.contype='u'` mà migration TV5 yêu cầu; cần C3.1.
- Ba function TV3 đang là phiên bản trước `tv3.rules.v2`; body/owner/SECURITY DEFINER/explicit ACL khớp guard đầu migration 20261101:

| Function | Normalized MD5 trong CSV | Quyền đã xác minh |
|---|---|---|
| tv3_scheduling_input(uuid) | cd4e4b5440ae3f1a38567d7dd0acf8b9 | Owner postgres; chỉ postgres trong ACL; anon/authenticated/service_role không EXECUTE |
| persist_schedule_draft(uuid,uuid,jsonb,jsonb,uuid,integer,uuid,text) | f3dfa0c40d77478ab317079fc68405e6 | Owner postgres; EXECUTE postgres/service_role, không anon/authenticated |
| generate_schedule_draft(uuid,uuid,jsonb,jsonb) | 477fbe0785dcdbd85cd7cdf1dc600509 | Owner postgres; EXECUTE postgres/service_role, không anon/authenticated |

Kết luận PASS chỉ cho **function guard tại thời điểm snapshot**, không cho toàn bộ migration. Wrapper generate có body giống cả migration cũ và mới nên không dùng riêng body wrapper để suy trạng thái triển khai.

TV2 save/effective-status/automation bodies khớp các định nghĩa local 20261029–20261030 tương ứng. Không có cơ sở replay migration nền/TV2.

## Dữ liệu và Auth

| Mục | Bằng chứng mới |
|---|---|
| Kỳ | Đúng UUID và branch, 02–08/11/2026; stored PLANNED, effective CLOSED; giữ nguyên deadline/status |
| Nhân viên | 60 ACTIVE NV theo D2.1: NEW 8, REGULAR 33, CREW_TRAINING 12, CREW_LEADER 7; 53 thuộc nhóm staffing thông thường |
| Binding | S6 có 60 dòng, Auth/profile khớp user_id, role NV, branch và active; không thiếu Auth/profile |
| Profile branch | 62: NV 60, QL 1, GS 1; supervisor đúng GS active, không phải đổi password |
| Password | Có **1 NV** (`js_ld_004`) phải đổi mật khẩu; không tự tắt flag. Đây là điều kiện đăng nhập/web, không tự tạo giới hạn xếp lịch mới |
| Nhu cầu | 63 ô / 308 vị trí; demand_evidence_md5 mới `34ef45ab2d0038f49faf75c9958bca0e` |
| Đăng ký | 2 header VALID, sample_batch_id NULL, không ghi nhận sau close; tổng 16 lượt hợp lệ; người khác nhau mỗi ngày: 2,1,2,2,1,2,2 |
| Tài khoản dự kiến | 17 dòng Auth check khớp danh sách UUID/username trong seed local; profile_id NULL, auth_id_exists=false, employee_bindings=0; chưa thấy collision username/UUID trong kiểm tra này |
| Timer | D7.1: Asia/Ho_Chi_Minh, mở thứ Sáu 15:00, đóng Chủ nhật 12:00, reminder 30 phút; D7.2 enabled=false. Không đổi config/kỳ hiện có |

Quy mô khớp baseline kỳ vọng **60 / 16 / 63 / 308**. CSV aggregate hiện tại không chứa toàn bộ row nguồn để chứng minh checksum từng đăng ký, nhân viên hoặc nhu cầu không đổi; không tái sử dụng SHA256 rehearsal làm fresh live baseline/apply authorization. Kiểm tra Auth không xác minh email dự kiến, Auth hooks/trigger hay collision UUID employee/registration toàn project; fresh prepare vẫn bắt buộc trước seed.

## Kết quả 0 dòng — ghi nhận riêng, không phải lỗi SQL

| Truy vấn gốc | Kết quả người phụ trách xác nhận | CSV hỗ trợ trong ZIP |
|---|---|---|
| 40 / D1.3 | Không có lịch trong kỳ | Không có CSV kết quả riêng; xác nhận rõ không export. File tên (40) là D1.2 |
| 46 / D4.1 | Không có open request trùng | File (46): COUNT duplicate_open_requests=0 |
| 47 / D4.2 | Không có open incident trùng | File (47): COUNT duplicate_open_incidents=0 |
| 48 / D4.3 | Không có request/incident mở cùng assignment | File (48): COUNT overlapping_open_requests_incidents=0 |
| 50 / D5.1 | Không có tuple assignment lịch sử trùng | Không có CSV kết quả riêng; xác nhận rõ không export. File tên (50) là D7.1 |
| 51 / D5.2 | Không có tuple current assignment trùng | Người phụ trách xác nhận 0; chưa có CSV kết quả riêng. File tên (51) là D7.2 |
| 52 / D6.1 | Không có approval trùng | Người phụ trách xác nhận 0; file tên (52) là Auth check |
| 53 / D6.2 | Không có nhiều nhóm PUBLISHED | Người phụ trách xác nhận 0; file tên (53) là dev-import identity |
| 54 / D6.3 | Không có schedule/assignment status lệch | Người phụ trách xác nhận 0; file tên (54) là dev-import object presence |
| 55 / D6.4 | Không có audit UUID batch được kiểm tra | Không có CSV kết quả riêng; xác nhận rõ không export. File tên (55) là function catalog |

D4.4 có CSV (49) trả 2 dòng COUNT, requests=0 và incidents=0 legacy open without snapshot; không phải truy vấn trả 0 dòng. Không suy từ các kiểm tra duplicate rằng toàn bộ request/incident hoặc lịch toàn project đều rỗng.

## Đối chiếu migration 20261101–20261106

| Migration local | Trạng thái hợp đồng trong snapshot và điều kiện |
|---|---|
| 20261101 | Function guard PASS theo S2/S4; input/persist vẫn body v1, chưa có helpers/result v2. Chưa đủ FK/trigger/RLS/ACL evidence để duyệt rollout toàn file |
| 20261102 | Không có RPC tv4_* v2 trong S2 đầy đủ; validate_schedule_approval vẫn body nền, thiếu version/reason/history protections v2. Chưa xác minh attachment. Cột schedules.published_by thiếu; TV4 nền 20261029 cần review như prerequisite |
| 20261103 | employee_schedule_week chưa có trong S2; chưa có contract đọc lịch NV mới. Không thay việc thiếu RPC bằng grant truy cập browser |
| 20261104 | Chưa có TV5 functions, snapshot/replaces_assignment_id fields hoặc partial indexes. Chưa có conflict open trùng theo bằng chứng 0/COUNT. Cần C3.1 để xác nhận đúng UNIQUE constraint/FK/CHECK trước thay; không tự xóa legacy data |
| 20261105 | File (54) xác nhận registry/row_source/header_gate/row_gate đều NULL. Dev-import chưa có contract tương ứng; không áp migration để làm preflight query chạy được |
| 20261106 | Helper UTC và materialized-input contract chưa hiện diện. Phụ thuộc M5 và normalized input MD5 `ef26158ddf7291344ac48c768fc1998d` **sau M5**, không so với body v1 hiện tại để kết luận lỗi. Tối ưu local đã PASS; chưa chạy shared |

Không có S5/history export: không biết ledger tồn tại hay đã ghi version nào. “Contract chưa có trong snapshot” không có nghĩa “migration chưa từng chạy”. Không replay theo phỏng đoán filename/history đơn lẻ.

Thứ tự dự kiến, sau khi được duyệt và xác minh prerequisites: **TV4 nền nếu thiếu/tương thích → 20261101 → 20261102 → 20261103 → 20261104 → 20261105 → 20261106**. Không migration nào được cấp quyền chạy trong báo cáo này.

## Xung đột, giới hạn và bằng chứng cần bổ sung

1. **S5 chưa có export nhận diện được.** `(36)` thực tế là bản sao S4; không kết luận S5 chưa chạy, có bảng hay NULL.
2. **File (55) có cấu trúc đúng dev-import SELECT 3** (catalog body/ACL của tv3_scheduling_input). Người phụ trách báo chưa chạy 3–6; thời điểm/nguồn export chưa rõ. Nhận diện nội dung với độ tin cậy cao, nhưng không dùng nó suy trình tự thực thi hoặc thay xác nhận của người phụ trách. SELECT catalog này không đòi registry tồn tại; phần SELECT tham chiếu registry mới đòi migration.
3. **File (53) có transaction_read_only=off**: không chứng minh đã có ghi; chỉ không chứng minh export nằm trong transaction READ ONLY. Nhiều export riêng cũng không chứng minh cùng REPEATABLE READ snapshot. SQL `current_database=postgres/current_user=postgres` không tự xác minh project ref hoặc PostgreSQL version.
4. **Thiếu C3.1/C6/C7.2/C8.1–3/C9/C10**: chưa xác minh FK/CHECK/constraint backing, trigger thực tế, default ACL, RLS/policies/table grants, provenance view body/security_invoker và DDL hooks. Không thay bằng function body hoặc artifact audit cũ.
5. `rls_auto_enable()` có SECURITY DEFINER và effective EXECUTE cho anon/authenticated/service_role trong S2/S4, trả event_trigger. Không tự coi là RPC nghiệp vụ có thể gọi thành công hoặc lỗ hổng đã khai thác; cần C10 để biết attachment/managed ownership trước quyết định. Không tự revoke trigger Supabase.
6. Chưa có bằng chứng backup nhất quán và **restore thật thành công** ở DB cô lập. ZIP catalog/CSV và fixture rehearsal không phải backup/restore.

## Kết luận và bước tiếp theo an toàn

**NO-GO triển khai/seed.** Đã đủ bằng chứng function guard TV3 và quy mô dữ liệu/Auth; còn thiếu metadata bảo vệ dữ liệu và restore, cùng fresh live seed plan. Blocker hiệu năng DRAFT local đã được xử lý trước đó, không tái mở chỉ vì snapshot shared vẫn là code cũ.

Ưu tiên gửi thêm **các CSV đã xuất** của C3.1, C6, C7.2, C8.1–3, C9, C10 và S5 (history presence; version nếu có), cùng C1.1/version nếu có. Giữ nguyên tên; sẽ nhận diện bằng cột. Không cần chạy lại S1–S4 hoặc các truy vấn 0 dòng chỉ để tạo file. Nếu các kết quả đó chưa có file, xuất bổ sung bằng SELECT theo [CATALOG-EXPORT.md](../CATALOG-EXPORT.md); không DDL/DML. Làm rõ nguồn file (55) nếu thuận tiện, không chạy migration.

Sau đó đối chiếu prerequisites/FK/RLS/hooks → xác minh backup/restore → thống nhất cửa sổ nhóm không ghi, refresh baseline/plan → phê duyệt riêng bundle migration, Auth provisioning, seed theo digest và flags. Chưa cho phép bất kỳ thao tác ghi nào; không commit/push.

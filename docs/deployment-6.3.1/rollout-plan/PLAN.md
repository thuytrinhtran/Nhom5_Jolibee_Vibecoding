# Kế hoạch triển khai JolliShift — chờ duyệt từng bước ghi

**Chốt triển khai mới:** [DEPLOY-READY.md](../DEPLOY-READY.md). Backup tối thiểu đã tạo/kiểm tra bằng client17, preflight PostgreSQL trực tiếp đã đủ; dùng bộ A chỉ nhân viên cũ (51 headers/640 rows), không tạo Auth. Operator CLI đã hỗ trợ Session pooler port5432 đúng project-user/TLS; không cần đổi sang direct host. Lệnh migration/import vẫn chờ duyệt riêng.

**Quyết định mới — phương án A:** chủ dự án chọn backup tối thiểu, không tạo project/đích restore lúc này. Dùng [MINIMAL-BACKUP-WINDOWS.md](../MINIMAL-BACKUP-WINDOWS.md). Chốt bước 1–2 hiện hành là archive public/Auth được tạo và kiểm tra + phê duyệt migration riêng; restore/rehearsal trên bản restore trong các mô tả cũ bên dưới được **hoãn**, không đánh dấu PASS giả và không bắt buộc dựng môi trường trong giai đoạn này.

**Cập nhật metadata:** đã nhận đủ 8 nhóm qua 9 CSV (56)–(64), xem [kết quả review](../metadata-review-20261102/REPORT.md). Không cần xuất lại packet SELECT bên dưới. Chốt trước migration còn backup/restore thật và rehearsal bundle trên bản restore; hướng dẫn chờ duyệt tại [BACKUP-RESTORE.md](../metadata-review-20261102/BACKUP-RESTORE.md). Readiness hiện hành ở `../readiness.json`; phần mô tả bằng chứng thiếu bên dưới ghi bối cảnh lập kế hoạch ban đầu.

Project **wlbpprpiieonjrqglicv**, Lê Duẩn, kỳ **02–08/11/2026**. Người phụ trách xác nhận toàn quyền môi trường; không còn cần phối hợp writer của thành viên khác. Điều này không thay việc bảo vệ dữ liệu, phân quyền NV/QL/GS hoặc dừng backend/cron/job có thể ghi trong cửa sổ triển khai.

Kế hoạch này thay cách phân loại blocker trong readiness cũ, không sửa kết quả audit lịch sử. Không có quyền chạy migration, tạo Auth, seed, bật persistence hay commit/push trong lần lập kế hoạch này.

## Quyết định từ bằng chứng đã có

| Hạng mục | Quyết định |
|---|---|
| Guard TV3 trước 20261101 | PASS snapshot: 3 body MD5, owner, SECURITY DEFINER và ACL đúng. Không yêu cầu xuất lại S2/S4/C5 |
| Dữ liệu | 60 NV, 16 đăng ký thật, 2 header, 63 ô/308 vị trí, kỳ effective CLOSED. Giữ nguyên; xác minh drift một lần ở thời điểm triển khai/import, không yêu cầu export lại ngay |
| Schema code mới | Contract TV3 v2, TV4 v2, employee read, TV5 và dev-import/M6 chưa hiện diện đầy đủ trên DB. Cần bundle bên dưới |
| Hiệu năng | Đã giải quyết local: 20/20 lần lưu 308 assignments PASS, median ~727 ms/p95 ~899 ms; budget 3 giây không đổi. Không bắt chạy lại benchmark chỉ để hoàn thiện giấy tờ |
| Auth | 17 UUID/profile dự kiến chưa tồn tại, không collision username trong kiểm tra đã có. Cần duyệt tạo riêng; chưa cần tạo để chạy migration |
| S1/S2/S3/S4/S6/Auth check | Đã đủ theo phạm vi xuất, không chạy lại toàn bộ |
| Các kết quả D bằng 0 | Chấp nhận xác nhận của người phụ trách; COUNT D4.1–3 hỗ trợ. Không bắt xuất CSV rỗng |
| CSV (36)/(40)/(50)/(55) | Giữ ánh xạ bằng nội dung. Không truy lại số tên file; nguồn file (55) không cần chặn vì S2/S4 đã đủ bằng chứng tương ứng |
| Migration history S5 | Nên ghi nhận để quản lý release; thiếu CSV riêng không phải blocker độc lập nếu schema/body/guards đã xác minh. Ledger không thay catalog; nếu ledger mâu thuẫn thì dừng đối chiếu, không replay mù |
| Version C1.1 | Có thể lấy từ metadata dump/restore hoặc kết nối preflight. Không cần export identity lại nếu đã xác minh tương thích khi restore/rehearsal |

### Những bằng chứng còn thực sự chặn migration

Ưu tiên gửi CSV đã xuất; chỉ chạy SELECT nếu không còn kết quả dùng được. Packet [remaining-critical-selects.sql](remaining-critical-selects.sql) chép nguyên 8 SELECT cần thiết từ SQL gốc, không có DDL/DML:

| Mục | Vì sao có thể chặn |
|---|---|
| C3.1 | TV5 cần đúng UNIQUE constraint để thay bằng partial index; FK/CHECK có thể làm migration/import thất bại hoặc ảnh hưởng dữ liệu khác |
| C6 | Phải biết trigger thật, audit protection và Auth hook; body tồn tại không chứng minh attachment, hook có thể tự tạo profile/employee |
| C7.2 | Default ACL có thể cấp quyền ngoài dự kiến cho đối tượng mới; phải đối chiếu/rehearsal và kiểm tra ACL sau migration |
| C8.1–3 | RLS/policies/table grants quyết định browser/NV có thể vượt backend hay không; một người phát triển không loại bỏ yêu cầu bảo mật |
| C9 | M5 bọc view provenance hiện có; cần đúng body/options/ACL để bảo toàn legacy sample và nguồn TV2/TV3 |
| C10 | Event trigger có thể can thiệp CREATE TABLE và quyền/RLS; không tự vô hiệu hook Supabase |

Đồng thời cần backup thật và restore thành công. Fresh seed plan, 17 Auth còn thiếu và kiểm thử AI/web **không chặn bước migration**; chúng là chốt của các bước sau. Chưa có kết nối PostgreSQL không phải một yêu cầu phải bỏ SQL Editor: có thể dùng export để review; backup/restore và executor cần công cụ/kết nối phù hợp được cấu hình riêng ngoài repo.

## Bundle cần triển khai

1. `20261029_tv4_schedule_workflow.sql`: prerequisite, snapshot thiếu published_by/RPC nền. Review rồi áp nếu trạng thái thực tế vẫn thiếu/tương thích; không chạy chỉ vì filename cũ.
2. `20261101_tv3_rule_contract_v2.sql`: đồng bộ source/result/coverage/experience/local-search/reason contract.
3. `20261102_tv4_workflow_v2.sql`: workflow, version, quyết định bất biến, reason, quyền và publish.
4. `20261103_employee_schedule_read.sql`: đọc lịch PUBLISHED đúng nhân viên/phiên bản.
5. `20261104_tv5_shift_replacement.sql`: yêu cầu/consent/thay người, lịch sử assignment và partial indexes.
6. `20261105_scoped_dev_import.sql`: registry/receipt/provenance scoped đúng project/batch/branch/kỳ; áp migration chưa tạo batch hay import.
7. `20261106_dev_import_source_materialization.sql`: loại receipt N+1, vẫn kiểm tra after-image và budget.

Không replay foundation, TV2, password-change hoặc TV3 v1. Freeze code/migration SHA256 từ manifest local; nếu catalog buộc sửa migration thì tạo bundle/rehearsal/checksum mới trước duyệt. Mỗi file có transaction riêng: thất bại file nào không có nghĩa các file đã COMMIT trước đó được rollback.

## Các bước nhỏ và chốt duyệt

| Bước / việc cần làm | Điều kiện bắt đầu | Thành công | Nếu thất bại |
|---|---|---|---|
| **0. Chốt metadata và release local**: review 8 mục còn thiếu, schema/API, freeze manifest | CSV hiện tại + kết quả thiếu hoặc metadata tương đương; không cần Auth mới | Không xung đột FK/trigger/view/quyền; bundle hash được review; runtime source/backend API đúng project | Sửa local tối thiểu/rehearsal lại phần ảnh hưởng; không ghi DB để thử |
| **1. Backup và restore**: sau duyệt, backup nhất quán schema/data public/Auth binding, owner/ACL/RLS/functions/triggers/history; lưu riêng và restore ở DB cô lập | Kết nối/công cụ được xác minh; người phụ trách duyệt phạm vi backup; xác định writer/job và cửa sổ không ghi | Checksum backup, restore không lỗi chưa xử lý; so row counts/IDs/binding, object definitions/ACL/constraints; diễn tập bundle trên bản restore và so dữ liệu cũ | NO-GO. Không dùng fixture rehearsal hoặc pg_restore --list thay restore; không restore đè project thật |
| **2. Migration**: duyệt bundle rồi chạy thứ tự trên, flags ghi OFF | Bước 0–1 PASS; baseline trước ghi; không backend writer/automation phát sinh ghi; xác nhận bundle digest | Postflight đúng body/owner/ACL/RLS/trigger; helper private; dữ liệu/cột cũ, 16 registrations và nhu cầu còn nguyên; không xóa lịch sử | Dừng tại file lỗi, giữ flags OFF. File lỗi rollback; thu catalog mới cho các file đã commit; ưu tiên forward-fix, không CASCADE/replay toàn bộ |
| **3. Auth/profile thiếu**: tạo tối đa 17 tài khoản test sau tái kiểm tra collision, dùng Auth API, liên kết đúng UUID/username/branch/NV | Schema đã PASS; C6/Auth hook rõ; danh sách email/credentials riêng, provisioning manifest/receipt được duyệt | Chỉ UUID/account thực sự mới; profile đúng role/branch; không đổi tài khoản cũ/mật khẩu cũ. Ghi từng kết quả API, before/after và ID thực trả; kiểm tra login/đổi mật khẩu | Auth API và public DB không chung transaction: dừng, lưu trạng thái partial rồi resume theo receipt. Nếu hook tự tạo employee/profile thì reconcile manifest local; không xóa hoặc tạo thêm trùng. ID API khác dự kiến phải rebind/review trước import |
| **4. Fresh prepare chỉ đọc**: tạo plan từ DB đã migration/provision, giữ nguồn 16 thật | Bước 2–3 PASS; không có schedule kỳ đích; Auth/profile đạt điều kiện executor | Fresh baseline SHA/plan SHA; global UUID/binding/header collision không có; dự kiến 17 employees mới, 68 headers, 591 registrations; engine 308/308 và cơ cấu không thiếu | Không seed. Nếu nguồn đổi, dừng/chuẩn bị lại; không sửa dữ liệu thật để đạt số lượng. Không dùng SHA synthetic |
| **5. Import dev**: duyệt đúng plan digest, chạy executor một transaction | missing_profiles=0; manifest/baseline khớp tại thời điểm khóa; xác nhận import riêng | Chỉ thêm owned IDs; submitted_at/updated_at là thời gian DB thực; sample_batch_id/batch receipt giữ nguyên. 16 thật + 591 import = 607; 66–67 người/ngày dự kiến; nhu cầu 63/308 không đổi; TS/SQL cùng nguồn | Atomic rollback khi lỗi. Nếu không rõ COMMIT, kiểm tra receipt/retry cùng plan, không tạo batch mới mù. Drift/after-image/dependency khác thì dừng |
| **6a. Rule Engine và DRAFT**: bật dev-import và TV3 persistence theo duyệt, restart backend; UI normal | Bước 5 PASS; data_source=supabase; test-preview OFF; TV4/TV5 writer chưa cần bật | Preview 308/308, shortage=0, cơ cấu thiếu=0; assignments VALID/đúng department/kỹ năng/không trùng; save/read lại DRAFT, history/coverage/source revision còn nguyên; sửa tay hợp lệ, lỗi hard bị chặn | Tắt TV3 writer sau xác nhận vận hành; giữ DB/audit để điều tra. Không xóa DRAFT để rollback seed; đã có schedule thì executor rollback chặn |
| **6b. AI trên lịch đang sửa**: đánh giá/propose/so sánh/chấp nhận hoặc bỏ | DRAFT/editor hoạt động, provider cấu hình và việc gọi external AI được duyệt | AI nhận đúng revision; không tự áp dụng/lưu/publish; chấp nhận vẫn qua backend hard validation; mất mạng/quota không mất state | Giữ lịch/state; báo lỗi provider, không coi fallback/mock là AI thật; không lưu đề xuất vi phạm |
| **7. Workflow và xem lịch**: bật TV4 theo duyệt; QL gửi, GS từ chối có reason, QL sửa thành version mới/trình lại, GS duyệt, QL publish | DRAFT hợp lệ đủ 308; đúng QL và GS branch; bước từ chối không ghi đè version/quyết định | DRAFT → PENDING_APPROVAL → NEEDS_REVISION → DRAFT version mới → PENDING_APPROVAL → APPROVED → PUBLISHED; duplicate/stale/wrong-role bị chặn. NV chỉ thấy PUBLISHED hiệu lực, không trùng phiên bản | Dừng bước kế tiếp, giữ history. Không chỉnh trực tiếp PENDING/PUBLISHED hoặc UPDATE status bằng SQL |
| **8. Đổi ca**: bật TV5 theo duyệt; NV yêu cầu/báo không thể làm, QL tìm/mời, đúng NV nhận/decline, QL quyết định | ACTIVE assignment thuộc NV trong PUBLISHED hiệu lực; thời hạn feedback/invitation hợp lệ theo workflow | Không đổi khi mới gửi/nhận lời mời; chỉ duyệt mới tạo successor và giữ old REPLACED. Cả hai lịch cập nhật; no overlap/skills/actual limits, consent, owner/branch, race/expiry/retry PASS | Giữ request/decision/audit, không overwrite/delete lịch công bố. Request hết hạn xử lý theo luồng có sẵn, không giả timestamp/đổi deadline cũ |
| **9. Nghiệm thu UI/API**: chạy checklist bên dưới, ghi evidence/version/IDs | Các bước trước PASS; credential QL/GS/NV qua đăng nhập thật | Cả browser và API round-trip dữ liệu bền vững, logout/login/reload không mất lịch; kiểm tra sai quyền độc lập backend | Đánh dấu testcase chưa PASS, sửa local/test lại đúng phần; không tuyên bố hoàn tất từ test mock/native |

Việc tạo employee mới thuộc **transaction import ở bước 5**, vì executor đã sở hữu/rollback chính xác tập 17 employees. Không tạo employee trùng ở bước 3. Nếu Auth hook tự tạo thì cần phương án adopt/rebind được review và update executor/manifest trước bước 4; hiện executor không tự adopt hoặc sửa employee đã có.

## Chuẩn bị code local và khoảng trống thật

- Backend/frontend/RPC contract cho core đã có: `draft-persistence.service.ts`, `schedule-workflow.service.ts`, employee schedule và shift-change routes/services; frontend `scheduling.service.ts`, `employee-schedule.service.ts`, `shift-change.service.ts`. Không thấy lý do viết lại engine/UI trước catalog. Mock TV4 service tồn tại nhưng không thấy import vào UI qua rà soát hiện tại; vẫn kiểm tra Network khi nghiệm thu.
- Scoped dev-import policy/executor/SQL đã đúng project. Executor mặc định inspect, prepare read-only, apply/rollback cần digest và direct TLS host; không tự tạo Auth/public users. Không đổi URL/key hoặc flags hôm nay.
- **Chưa có executor provisioning Auth/profile có receipt/idempotency/compensation được nghiệm thu.** Đây là phần code local cần chuẩn bị tiếp sau C6/metadata, trước duyệt bước 3; không tuyên bố seed executor đã làm việc này. Dùng SDK hiện có (AdminUserAttributes hỗ trợ id), nhưng phải kiểm tra response/server behavior; không INSERT trực tiếp auth.users. Không lưu password/token trong repo/manifest báo cáo. Không reset account đang có.
- Sau metadata, nếu thiếu quyền/trigger khác contract, chỉ sửa migration tăng dần/local thích hợp, không sửa schema thật bằng thử-sai. Nếu cần adopt employee từ Auth hook hoặc rebind ID, bổ sung test rollback/collision trước phát hành bundle/plan mới.

## Checklist nghiệm thu website/API

- Login QL/GS/NV và đổi password bắt buộc; NV không truy cập branch/employee khác bằng đổi ID; expired token xử lý đúng. Không đưa service key xuống browser.
- TV2 đọc 16 registrations/đúng provenance; nộp vào kỳ đích đóng bị từ chối. **Nộp TV2 thành công phải dùng kỳ khác tự nhiên OPEN**. Nếu chưa có, chờ lịch bình thường hoặc test cô lập; đánh dấu case web này chưa nghiệm thu, không mở lại kỳ Nov2 hoặc đổi deadline để đạt PASS.
- QL preview, sửa tay, chuyển tab, unsaved warning, AI revision/propose/reject/accept, save/open DRAFT; hard constraint lỗi không lưu.
- QL không tự duyệt, GS đúng branch mới quyết định; reason bắt buộc khi từ chối; version mới khi sửa/trình lại; publish chỉ sau approved. Không dùng nút handoff chỉ trả sent=false làm bằng chứng gửi duyệt.
- NV thấy lịch sau publish, đổi tuần/ngày không ca/version mới, reload/login lại; DRAFT/PENDING/NEEDS_REVISION không xuất hiện.
- Request/incident, đề xuất/tìm người, mời/accept/decline/expire, quản lý approve/reject; sai owner/branch, người nhận không đủ điều kiện, trùng request, stale assignment và hai người cùng nhận xử lý đúng. Kiểm tra lịch QL/NV đều cập nhật.
- Lỗi mạng/retry/request_id/stale version/DB timeout: không double-write, không mất audit và dữ liệu đã lưu. Có thể dùng hai tab/browser để kiểm thử cạnh tranh dù chỉ một người phụ trách.

Timer/n8n/outbound email/push và nghiệp vụ CREW_LEADER/SUPPORT riêng không chặn core 308; ghi là phần mở rộng/chưa nghiệm thu nếu chưa có implementation/provider hoặc quy tắc xác nhận. Không tự mở thêm quyền/đặt nghiệp vụ. “Toàn hệ thống hoàn tất” chỉ dùng khi checklist core và các phần mở rộng được thống nhất phạm vi đều có evidence; không đánh đồng rehearsal với website.

## Rollback và bảo toàn dữ liệu

Không ghi đè 16 registrations/2 headers thật, 60 nhân viên, nhu cầu hoặc deadline. Fixture có batch `6e1d2026-1102-4000-8000-000000000017`, provenance và receipt bất biến. Sau import ordinary context vẫn loại sample; chỉ backend dev context đã được phép nhận batch này. Không gỡ sample_batch_id hoặc giả submitted_at trước close.

Rollback seed chỉ owned UUID, đúng after-image và không dependency mới; audit/batch vẫn giữ, không CASCADE. Có schedule/request/skill/edits thì dừng rollback seed. Rollback schema không giống rollback seed; sau TV5 A→B→A không thể khôi phục UNIQUE toàn trạng thái bằng cách xóa history. Backup restore đè project thật cần quyết định phục hồi riêng và phân tích những ghi mới sẽ mất; không tự chạy. Auth/profile cleanup là kế hoạch riêng, không nằm trong rollback executor registration.

**Hiện tại: GO cho chuẩn bị local; NO-GO cho ghi Supabase.** Bước duyệt gần nhất là thu metadata còn thiếu và lập quy trình backup/restore; chưa xin duyệt seed hoặc bật writer khi chưa có artifact cụ thể của từng bước.

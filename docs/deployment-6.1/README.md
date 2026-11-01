# 6.1 — chuẩn bị database, chưa triển khai

**NO-GO cho seed và bật writer.** Có thể chuẩn bị rollout schema, nhưng catalog mới, backup có thử restore và hợp đồng dev-import vẫn là điều kiện bắt buộc. Không có thao tác ghi Supabase/Auth, chạy cron, bật cờ hoặc commit/push trong bước này.

## Bằng chứng và giới hạn

Đã đọc 10 migration và toàn bộ 14 CSV trong ZIP audit. `offline-audit.json` ghi số dòng, checksum từng CSV/migration, body/owner/EXECUTE của ba RPC TV3 và đối chiếu function TV2. Script tái tạo bằng `python backend/scripts/audit-deployment-plan.py`, không đọc .env/kết nối mạng.

- Ba body TV3 v1 khớp guard của `20261101`, owner postgres, quyền khớp phạm vi guard. Body TV2 save/effective-status/generator khớp migration `20261030`; automation khớp M2. Đây là bằng chứng trạng thái logic, không chứng minh lịch sử file migration đã chạy.
- Archive không có RPC TV4/TV5/employee-schedule mới; có body validate_schedule_approval nhưng không có trigger gắn bảng. Có trigger publish, assignment-source và audit bất biến.
- CSV columns chỉ có 100 dòng trên toàn public; không đủ kết luận published_by hoặc tất cả cột đã có/thiếu. CSV không chứa dữ liệu hiện tại của nhóm, cấu hình PostgREST, job cron thực tế hay trạng thái Auth hiện tại.
- Không có connector PostgreSQL/Supabase catalog trong phiên này. Chưa đọc lại database live; không coi archive là snapshot hiện tại. Dữ liệu 60 NV/62 profiles, 16 đăng ký thật, 63 ô/308 vị trí là baseline cũ cần kiểm tra lại.

`local-rehearsal.json` là kết quả PostgreSQL native cách ly: có một NV/QL giả lập, đăng ký VALID và DRAFT v1 trước rollout. Test áp đúng chuỗi nâng cấp, kiểm tra các dòng/cột cũ không thay đổi, 54 kiểm tra EXECUTE, SQL chỉ đọc và guard chống chạy lại. Có hash function sau rollout để đối chiếu C4/P2; không phải bằng chứng deployment lên Supabase.

## Thứ tự và mức sẵn sàng của cả 10 migration

| File | Quyết định theo archive | Phụ thuộc/tác động cần kiểm tra |
|---|---|---|
| 20261029_require_password_change | Giữ, không chạy lại mặc định | Thêm cột/gate users, thay trigger/password RLS. Fresh C2/C4/C6/C8 phải khớp; không reset mật khẩu/cờ của nhóm. |
| 20261029_employee_registration | Không chạy lại | CREATE header/config/RPC; INSERT config singleton. Sẽ lỗi nếu đã có, có thể đè logic save mới nếu chạy riêng đoạn. |
| 20261029_registration_off_schedule | Không chạy lại | CREATE lịch config/INSERT singleton, thay automation. Bản hiện hành M2 đã có trong audit. |
| 20261030_registration_effective_state | Không chạy lại | Body TV2 và hai view đã khớp audit; có UPDATE cấu hình lịch tương lai. Guard không bảo đảm chạy lại chính bản hiện hành sẽ qua. Không sửa deadline/status kỳ cũ. |
| 20261031_tv3_schedule_draft | Không chạy lại | Ba CREATE RPC đã tồn tại, body khớp v1. Chỉ dùng cho DB mới trong local, không dùng lại foundation. |
| 20261029_tv4_schedule_workflow | Chạy trước TV4 v2, chỉ nếu fresh catalog xác nhận cần | Tạo/kiểm tra published_by nullable UUID và FK users; validate orphan, hai RPC cũ. Không ghi dòng nghiệp vụ nhưng có DDL/ACL, có thể khóa bảng. Giữ writers và caller TV4 cũ dừng suốt khoảng chuyển tiếp. |
| 20261101_tv3_rule_contract_v2 | Sẵn sàng có điều kiện | C5 body/ACL phải khớp, helper mới chưa tồn tại. Thêm balance/coverage/result v2 và thay input/persist/generate; không seed hay chạy engine trong migration. |
| 20261102_tv4_workflow_v2 | Sẵn sàng có điều kiện | Sau TV4 cũ + TV3 v2; sửa allocator qua body marker, gắn trigger approval bất biến, tạo transition v2, thu hồi EXECUTE RPC TV4 cũ. Backend/frontend cũ gọi RPC cũ sẽ bị từ chối: rollout ứng dụng đồng bộ. |
| 20261103_employee_schedule_read | Sẵn sàng có điều kiện, rủi ro thấp | Sau schema/Auth gate; RPC mới STABLE chỉ đọc, không thêm policy browser. Không chạy lại CREATE nếu đã có. |
| 20261104_tv5_shift_replacement | Rủi ro cao hơn, cần duyệt DDL/rollback riêng | Sau TV3 v2 và schema giai đoạn 1–4. Thêm cột/FK/snapshot, thay UNIQUE bằng partial UNIQUE, thêm indexes toàn DB, clone metric helper theo body marker. D4/D5/C3 phải sạch hoặc có quyết định xử lý của chủ dữ liệu; tuyệt đối không auto cleanup. |

Chuỗi dự kiến trên baseline đã audit: **TV4 20261029 nếu thiếu → 20261101 → 20261102 → 20261103 → 20261104**. Không chạy `docs/Jollishift.sql`, TEST foundation, bundle Thursday, script Auth/seed hoặc toàn thư mục migrations theo tên file một cách mù quáng. Nếu fresh catalog khác archive, dừng và thiết kế forward migration tương ứng; không bỏ guard/đổi CREATE thành OR REPLACE để ép qua.

Các file mới không backfill dữ liệu nghiệp vụ hoặc đổi tài khoản; ADD COLUMN có thể làm JSON `SELECT *` thêm trường null. Trước khi bật writer phải mở lại DRAFT v1 hiện có qua editor và kiểm tra compatibility; không giả định generate legacy sẽ replay audit v1 sau nâng cấp v2. Không migrate hàng loạt lịch cũ bằng cách tạo lại. TV5 legacy request không có snapshot sẽ bị chặn duyệt và cần QL rà riêng, không tự gắn snapshot mới.

TV2 RPC không bị các migration 20261101–04 thay thế, không mở nộp kỳ đóng và không giới hạn giờ đăng ký mới. Khóa bảng lúc DDL/transaction TV3–TV5 có thể làm TV2 bận; thực hiện cửa sổ bảo trì và giữ retry. Rà consumer dùng ON CONFLICT theo UNIQUE assignment cũ trước TV5; hiện không tìm thấy consumer như vậy trong repo.

## Chạy preflight và xuất bằng chứng

1. Kiểm tra project ref trong Dashboard khớp SUPABASE_URL dự kiến và project của nhóm. `current_database() = postgres` không nhận diện được project. Không gửi key/URL chứa password.
2. Chạy `01-catalog-preflight.sql` C1 trước. Thiếu bảng nền thì dừng. Sau đó chạy từng SELECT C2–C10; chọn giới hạn đủ lớn, CSV C2 phải đủ `total_rows`, không lặp lỗi chỉ xuất 100 dòng. Export từng result, đặt tên C2-columns, C4-functions, C7-execute…; đừng chỉ lấy result cuối nếu chạy cả file.
3. Chạy từng SELECT D1–D7 của `02-data-preflight.sql`. D4/D5 là kiểm tra toàn DB vì index cũng áp dụng toàn DB. Không sửa/xóa kết quả lỗi. D1/D3 xuất hiện dữ liệu nhóm mới thì baseline seed cũ hết hiệu lực.
4. Giữ CSV/catalog/function definitions ở thư mục backup riêng, kiểm soát chia sẻ. Function bodies là mã nội bộ; CSV audit không phải backup dữ liệu.
5. Sau rollout được duyệt, chạy `03-post-migration.sql` P1–P4 và chạy lại C2–C10/D1–D7. Mọi gate P1 phải PASS; so owner, search_path, volatility, timeout và body hash với rehearsal theo đúng byte migration. C5 là guard **trước v2**, sẽ không còn MATCH sau rollout; không dùng C5 sau rollout để quyết định chạy lại.

Ba file chỉ SELECT catalog/dữ liệu và BEGIN READ ONLY/COMMIT, không gọi writer hay application RPC để dò tồn tại. Có thể chạy toàn file trên psql với ON_ERROR_STOP; SQL Editor nên chạy các nhóm riêng và xuất đủ kết quả. Test local chứng minh transaction READ ONLY từ chối UPDATE.

Trước DDL, kiểm tra event triggers C10 và Auth profile triggers C6. Bản rehearsal không đại diện mọi hook của Supabase. DDL cần lock_timeout/statement_timeout giới hạn trong transaction triển khai; các file TV4 cũ, TV4 v2, read và TV5 chưa tự đặt timeout cho phần DDL. Người thực hiện cần thêm SET LOCAL trong BEGIN hiện có của bản triển khai được duyệt hoặc dùng runner transaction đã review; không tự sửa transaction rồi chạy ngay. Timeout trong metadata RPC không thay thế timeout migration hoặc outer statement deadline của gateway.

## Blocker dev-import / seed 308

Seed-plan có 17 account mới, 68 header, 560 fixture rows; hai bản positive thêm 31 đăng ký, kết hợp 16 lượt thật từng được mô phỏng 308/308, không thiếu cơ cấu. Bản đầu không có positive scenario. Đây là artifact cũ, chưa phải script apply, chưa có baseline mới hoặc Auth provisioning hoàn chỉnh.

Hiện chưa có migration/registry/RPC dev-import bền vững. Header sample_batch_id bị loại ở:

- `tv2Availability` và TV2 reports/TV3 repository trong luồng thường;
- `tv3_scheduling_input`: cả registrations và registration_provenance yêu cầu sample_batch_id IS NULL;
- TV4 submit/approve/publish, TV5 candidates: dùng chính SQL input này.

Preview nhận fixture không chứng minh persist được. Test-preview bật còn khóa mọi writer. Bỏ sample_batch_id, giả SUBMIT/timestamp hoặc sửa close_at sẽ phá provenance/TV2, không phải cách khắc phục.

Trước seed cần một forward migration/contract **riêng, chưa được tạo ở 6.1**:

- Allowlist persisted exact project/batch/branch/period, audit batch FK và danh sách employee/row IDs được phép; browser không được bật bằng payload.
- Cùng tiêu chí được dùng bởi TV2 reads/reports, TS preview/input revision, SQL input/persist, TV4 và TV5; sample ngoài allowlist vẫn bị loại. Giữ canonical provenance/rule contract nhất quán, thử lưu/đọc/gửi duyệt trên PostgreSQL bằng batch tagged, không chỉ overlay in-memory.
- Import dùng thời gian DB hiện tại, ghi action DEV_IMPORT rõ ràng, không giả nộp TV2 đúng hạn. Không thay header thật/DRAFT/sample có sẵn; không sửa nhu cầu/forecast, max hours hoặc cấu hình tài khoản nhóm để đạt 308.
- Recompute baseline/plan từ dữ liệu mới; ghi after-images, ID trả về, hash, inbound dependencies và rollback ownership. Provision Auth là bước được duyệt riêng sau kiểm tra trigger/profile collision. Account mới phải đi qua đổi mật khẩu bình thường.

## Backup/rollback trước khi cấp quyền ghi

- Nhóm thống nhất cửa sổ không ghi: dừng các backend writer, cron/n8n/consumer/job có quyền service và thao tác của thành viên, không chỉ tắt ba cờ UI. Không tự chạy lệnh dừng job chung trong 6.1.
- Chuẩn bị backup schema + dữ liệu nhất quán bằng pg_dump/backup được hỗ trợ của project; public, auth bindings, owner/ACL/default ACL/policies/triggers/functions/indexes và trạng thái migration/config. Lưu ngoài repo, mã hóa/phân quyền. Không xuất auth.users, password hash hoặc secrets ra CSV gửi công khai. Không mặc định project có PITR.
- Ví dụ lệnh **chưa chạy**, dùng connection/PGPASSFILE riêng ngoài repo, không chèn URL có password vào command/history:

```powershell
pg_dump --format=custom --schema=public --schema=auth --file D:\JolliShift-private\backups\pre-6.1.dump
pg_restore --list D:\JolliShift-private\backups\pre-6.1.dump
```

Thử restore vào môi trường cách ly có roles/extensions phù hợp trước rollout. `--list` chỉ kiểm tra mục lục, không thay thế thử restore. Supabase Auth/project config và managed objects cần quy trình restore phù hợp; không pg_restore đè database nhóm một cách tự động. Bước backup/restore thật cần người phụ trách kiểm soát.

- Nếu migration lỗi trước COMMIT: transaction của file đó rollback; các file đã commit trước đó vẫn còn. Xuất catalog lại, không chạy lại mọi file.
- Nếu đã commit nhưng chưa có writer nghiệp vụ: giữ flags OFF, dùng definitions/ACL/trigger trước rollout và ứng dụng tương thích để forward-fix. Có thể giữ cột nullable mới thay vì DROP; không CASCADE, không xóa users/Auth, audit hoặc bảng nhóm.
- TV4 v2 làm quyết định bất biến và thu hồi RPC cũ. Rollback app cũ đơn thuần sẽ không hoạt động; phải giữ writer khóa hoặc có bản tương thích đã review, không mở lại RPC cũ bằng grant rộng.
- Sau TV5, A → B → A tạo hai hàng lịch sử cùng tuple. Khi D5 có kết quả, **không thể khôi phục UNIQUE mọi trạng thái** nếu vẫn giữ lịch sử. Giữ partial index/chain và forward-fix; không xóa REPLACED/audit để ép rollback.
- Seed rollback khác schema rollback: chỉ các ID batch có after-image còn khớp và không có dependency mới. Khi đã có schedule/request/invitation/skill/team edits, dừng để duyệt phương án riêng. Không DELETE theo ngày/chi nhánh/prefix, không phục hồi full backup làm mất việc nhóm sau backup. Audit rollback là bản ghi bổ sung, không sửa audit cũ.

## Cấu hình backend — kế hoạch, chưa bật

| Cấu hình | Giá trị/điều kiện chuẩn bị |
|---|---|
| SUPABASE_URL | Đúng ref project dev/test đã xác nhận, không dùng URL fixture/proxy khác project |
| SUPABASE_SECRET_KEY hoặc SERVICE_ROLE_KEY | Server-only, đúng quyền service; không chấp nhận fallback anon làm admin, không đưa vào VITE_* |
| SCHEDULING_DATA_SOURCE | supabase |
| TV3_TEST_PREVIEW_ENABLED | false; không chạy script dev:tv3-test cho luồng persistence |
| TV3_DRAFT_PERSISTENCE_ENABLED | false đến khi schema + tagged import contract + preview/persist rehearsal qua và có xác nhận riêng |
| TV4_WORKFLOW_PERSISTENCE_ENABLED | false đến khi TV3 lưu/đọc đúng và ACL/workflow verified |
| TV5_PERSISTENCE_ENABLED | false đến khi lịch công bố/unique/snapshot/consent được nghiệm thu |
| TV3_AI_EXTERNAL_ENABLED / provider/model/key | false ban đầu; enable Gemini riêng sau kiểm tra provider và đồng ý gửi summary giả danh. Không coi test transport là AI thật |
| REGISTRATION_AUTOMATION_TOKEN / DB enabled / cron | Giữ trạng thái cũ được xuất D7, không bật hoặc đổi trong 6.1 |
| FRONTEND_URL, VITE_API_URL, API_PROXY_TARGET | CORS đúng web, /api qua backend; VITE_TV2_DEMO=false; không có key Supabase trong browser |

Sau từng nhóm migration phải xác nhận PostgREST schema reload và quyền thực thi bằng catalog/endpoint đọc. `SET statement_timeout` bên trong function chỉ có hard deadline khi gateway hoist trước statement; cần kiểm tra cấu hình Supabase thực tế, không suy ra từ gateway local. Backend auth xác minh JWT/users/branch/ownership; không thay bằng danh tính từ payload.

## Checklist web sau khi được phép triển khai/seed

- [ ] Login NV/QL/GS, đổi mật khẩu bắt buộc, profile → employee → branch đúng; account inactive/sai role/sai chi nhánh bị chặn.
- [ ] TV2: nộp DRAFT/VALID/OFF trên **kỳ OPEN tự nhiên**, không giờ đăng ký mặc định, không ca trùng. Kỳ Lê Duẩn 02–08/11 đã đóng phải từ chối. Không thể kiểm thử nộp TV2 thành công cho chính kỳ đóng này nếu không thay nghiệp vụ; dùng kỳ OPEN riêng hoặc chờ mở, rồi kiểm thử dev-import như luồng khác.
- [ ] Dev-import được duyệt: tagged batch được cả TS/SQL nhận, mẫu khác bị loại; thực tế 60–70 người khác nhau/ngày, bảo toàn 16 lượt thật và nhu cầu 308. No overwrite/header collisions.
- [ ] Generate 308/308, kiểm tra VALID/kỹ năng/bộ phận/overlap, min(2, demand), giờ/local search/reason. Fixture âm vẫn báo shortage/experience, không được công bố thiếu coverage.
- [ ] Manual edit: invalid bị backend chặn; đổi tab/AI không mất chỉnh sửa. AI đánh giá đúng revision, đề xuất riêng, accept/reject không tự lưu/công bố; provider thật lỗi không tạo thành công giả.
- [ ] Lưu DRAFT → restart backend → đọc lại đúng version, phân công, provenance, coverage/reason/history. Retry không trùng, hai phiên sửa version cũ bị chặn.
- [ ] Submit → GS đúng scope; reject có lý do → version DRAFT mới → resubmit → approve → QL publish. Giữ quyết định cũ, khóa sửa pending/published, stale/duplicate/race rollback đúng.
- [ ] NV chỉ thấy PUBLISHED/ACTIVE hiện hành, không lộ lịch người khác/DRAFT; chuyển tuần, thiếu lịch, ca qua đêm, token hết hạn, phiên bản mới không trùng ca.
- [ ] NV tạo request trong deadline / báo incident riêng → QL mời → đúng người nhận/decline/expire → QL chọn một accepted hợp lệ. Race/nguồn thay đổi/giờ/skill/đăng ký invalid phải bị chặn.
- [ ] Sau approve, NV cũ mất ca/NV mới nhận ca/QL thấy coverage và giờ mới; thử A → B → A không xóa lịch sử. Retry sau chuyển chi nhánh/role không vượt quyền; lỗi audit rollback toàn transaction.
- [ ] Ghi ID/version/audit/outcome làm bằng chứng, không chụp token/key; không sửa dữ liệu nhóm để làm sạch kết quả test.

## Bắt buộc và mở rộng

**Bắt buộc cho nghiệm thu luồng thủ công đã chọn:** fresh preflight + backup/restore rehearsal, schema/API đúng phiên bản, dev-import tagged hoàn chỉnh, Auth scope, 308/308 từ nguồn DB thật, AI thật nếu tuyên bố nghiệm thu AI, DRAFT/workflow/công bố/NV/TV5, notification kết quả trong web, expiry hiệu lực và audit/race/rollback. Các mục chưa chứng minh vẫn để BLOCKED, không đánh PASS từ unit test.

**Mở rộng, không cản nghiệm thu thủ công REGULAR cùng chi nhánh:** cron/n8n định kỳ, delivery email/SMS/push, scheduler tự chạy EXPIRE và giám sát outbox, SUPPORT/liên chi nhánh, thay ca CREW_LEADER, swap hai chiều. Hiện có TV2 generator/automation (cần cấu hình riêng), outbox và EXPIRE thủ công; chưa có chứng cứ job/delivery hoạt động. UI/API nhận biết expiry khi đọc hoặc thao tác; không đồng nghĩa timer chạy nền. Nếu phạm vi nghiệm thu yêu cầu các mục này thì phải chuyển chúng thành blocker trước khi ký.

## Điều kiện GO cho một thao tác ghi cụ thể

Fresh C1–C10/D1–D7 đã review; đúng project/owner và hash; không dữ liệu mâu thuẫn chưa giải quyết; backup restore được; byte migration được chốt; nhóm có cửa sổ bảo trì và app tương thích; quyết định dev-import/seed được duyệt riêng; rollback không xóa dữ liệu nhóm; có người chịu trách nhiệm và **xác nhận riêng cho migration/Auth/seed/enable tương ứng**. 6.1 không cấp xác nhận nào trong số này.

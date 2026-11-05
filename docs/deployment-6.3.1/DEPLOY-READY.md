# Chốt triển khai A + kỳ đăng ký 09–15/11 — chờ duyệt ghi

## Kết quả mới, không cần thêm thao tác cài đặt từ người dùng

- Kết nối PostgreSQL đã xác minh đúng project qua **Session pooler**, TLS verify-full; mật khẩu đã lưu dùng được, không reset.
- Server **17.11**. Không chạy pg_dump16. Đã chuẩn bị **client portable 17.11** từ ZIP chính thức EDB, chỉ lấy 4 executable client/DLL cần thiết (~25 MB compressed), không installer, không PostgreSQL Server, CLI/Docker/Pro hoặc project mới. [Nguồn EDB](https://www.enterprisedb.com/download-postgresql-binaries).
- **Đã backup** tại `D:/JolliShift-private/minimal-backup/backup-ready-20261102/`: archive public/Auth/extensions + large objects, **340433 bytes**, SHA256 `6a4d9511784339108ad303af140854d2a524fe366a73dacf363b8ef813b8e919`. TOC bắt buộc có public/source và Auth users/identities; decode offline vào NUL exit=0. Chưa restore theo quyết định chủ dự án. Không gọi là full-platform backup.
- Preflight PostgreSQL trực tiếp hoàn tất **57 JSON outputs**, không truncation, transaction READ ONLY. Cả 3 body guards M1 khớp; catalog hiện có 18 public functions, không workflow v2/employee read/TV5, chưa registry/gates; history table chưa có. Output private `D:/JolliShift-private/minimal-backup/live-final-preflight-20261102/`.
- Kiểm tra bộ A trực tiếp trong transaction read-only: **0 UUID registration collision**, **0 header collision**, 16 real rows còn nguyên. [Recheck](../demo-datasets/1793634151022/final-live-recheck.json) có checksum row nguồn, không có password.
- Đã tạo JSON kết nối riêng từ service/pgpass hiện có, không yêu cầu nhập lại hoặc sửa .env: `D:/JolliShift-private/minimal-backup/deployment-connection.json`. **Không mở/in file này**, có password. CLI local nay chấp nhận Session pooler chỉ khi đúng project user, port 5432 và TLS xác minh; từ chối transaction pooler/wrong project.

Session pooler không giữ startup option default_transaction_read_only trong lần kiểm tra; không giả định nó bảo vệ mọi câu lệnh. Các collector/prepare dùng BEGIN READ ONLY rõ ràng; migration/import là thao tác ghi riêng, chưa chạy. Phương án Session pooler phù hợp khi không dùng direct IPv6 theo [Supabase backup guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

## Lệnh migration — CHỈ sau duyệt bundle

Chạy ở root repository, giữ backend writer/dev-import OFF. psql17 đã có và không cần cài server:

```powershell
$taskPgTools = 'D:/JolliShift-private/pg17-client-17.11/bin'
$env:PGSERVICEFILE = 'D:/JolliShift-private/minimal-backup/pg_service.conf'
$env:PGPASSFILE = 'D:/JolliShift-private/minimal-backup/pgpass.conf'
```

Chạy **một** file mỗi lần bằng mẫu dưới; chưa chạy mẫu này ở thời điểm chuẩn bị:

```powershell
# Chỉ gán file đã được duyệt theo bảng, không chạy vòng lặp toàn bundle.
$taskMigration = 'backend/migrations/20261029_tv4_schedule_workflow.sql'
& "$taskPgTools/psql.exe" --dbname='service=jollishift_source' --no-password -X --set=ON_ERROR_STOP=1 --command='SET default_transaction_read_only=off;' --file=$taskMigration 2>$null
if ($LASTEXITCODE -ne 0) { throw 'MIGRATION_FAILED_STOP_NO_REPLAY' }
& "$taskPgTools/psql.exe" --dbname='service=jollishift_source' --no-password -X --set=ON_ERROR_STOP=1 --file='docs/deployment-6.3.1/post-migration-facts.sql' 2>$null
if ($LASTEXITCODE -ne 0) { throw 'POSTFLIGHT_QUERY_FAILED_STOP' }
```

Đối chiếu SHA file trong bundle mới trước chạy. Kiểm `present=true` ở stage vừa chạy (stage tương lai false là bình thường), owner/ACL/body theo manifest/migration, 16 registration rows và 63/308 nhu cầu vẫn nguyên. Một query postflight exit=0 không tự nghĩa mọi check PASS; cần đọc facts/grants. Không bật flags nếu còn check sai.

| Thứ tự | taskMigration | Chốt sau file |
|---|---|---|
| 0 | backend/migrations/20261029_tv4_schedule_workflow.sql | published_by + FK/RPC prerequisite; metadata hiện thiếu nên cần file nền này |
| 1 | backend/migrations/20261101_tv3_rule_contract_v2.sql | M1 source v2, persist contract, helpers private |
| 2 | backend/migrations/20261102_tv4_workflow_v2.sql | M2 workflow + approval trigger, old RPC service revoked |
| 3 | backend/migrations/20261103_employee_schedule_read.sql | M3 read RPC service-only |
| 4 | backend/migrations/20261104_tv5_shift_replacement.sql | M4 current/successor/open indexes, snapshot/replaces fields/FKs |
| 5 | backend/migrations/20261105_scoped_dev_import.sql | M5 registry empty/RLS/private, source view giữ legacy predicates |
| 6 | backend/migrations/20261106_dev_import_source_materialization.sql | M6 materialized source/private UTC helper; budget 3 giây giữ nguyên |

Mỗi file transaction riêng; lỗi thì dừng, không replay các file đã COMMIT. Không DROP TABLE/TRUNCATE hoặc xóa dữ liệu trong bundle. TV5 DROP đúng UNIQUE constraint để thay partial index, không xóa lịch sử. Không tự sửa guard để vượt lỗi.

## Fresh prepare và import A — bước duyệt RIÊNG sau schema

Không tạo Auth/profile/employee. Dùng 60 hiện có, giữ 16 real registrations, thêm **51 headers/640 rows**, tổng 656; engine tính 308/308. Dùng seed đã rehearsal, không copy assignments hoặc dùng SHA synthetic làm quyền import.

Từ backend, **prepare chỉ đọc**, chỉ chạy sau M1–M6/postflight PASS:

```powershell
$env:NODE_ENV = 'development'
$env:DEV_IMPORT_PG_CLIENT = 'D:/JolliShift-private/tv3-postgres-tools/node-client/node_modules/pg'
node scripts/dev-import-executor.cjs prepare D:/JolliShift-private/minimal-backup/deployment-connection.json ../docs/demo-datasets/1793634151022/existing-employees-seed.json D:/JolliShift-private/minimal-backup/fresh-A-plan.json
```

Chốt: missing_profiles=0, profiles/employees insert=0, headers=51/registrations=640, global collision=0, baseline mới, assigned/required=308/308, shortage/structure thiếu=0. Nếu source đổi hoặc output path đã có, dừng/review, không ghi đè plan hay dữ liệu để khớp fixture.

Chỉ sau khi chủ dự án duyệt **plan_sha256 thực tế mới**, lệnh import là:

```powershell
$taskPlan = Get-Content -LiteralPath D:/JolliShift-private/minimal-backup/fresh-A-plan.json -Raw | ConvertFrom-Json
# Chỉ chạy sau khi chính digest này đã được duyệt; không coi dòng đọc file là approval.
$env:DEV_IMPORT_APPROVAL_SHA256 = $taskPlan.plan_sha256
node scripts/dev-import-executor.cjs apply D:/JolliShift-private/minimal-backup/deployment-connection.json D:/JolliShift-private/minimal-backup/fresh-A-plan.json D:/JolliShift-private/minimal-backup/apply-A-receipt.json
```

Sau import: private receipt/after-images đúng, 16 real rows/checksum không đổi, sample_batch_id giữ nguyên, timestamp DB thực, default context vẫn chỉ thấy nguồn thật. Approved dev context nhận 656 VALID rows; nhu cầu 63/308 không đổi. Nếu lỗi transaction rollback; nếu mất response kiểm receipt/replay cùng plan, không tạo batch khác. Có schedule/dependency hoặc after-image khác thì không rollback seed tự động.

Sau kiểm tra mới xin duyệt bật DEV_IMPORT và TV3/TV4/TV5, restart backend, dùng UI bình thường: preview → save/reopen DRAFT → gửi duyệt → GS approve → QL publish → NV xem/đổi ca. Test-preview vẫn OFF. Không bật flags trong bước chuẩn bị này.

## Kỳ 09–15/11

Đã có period `7f48f53e-d707-4a32-9f15-eb32aeb0095a`; không cần tạo kỳ mới. Thời gian DB: mở **06/11/2026 15:00**, đóng **08/11/2026 12:00**, Asia/Saigon. Hiện effective PLANNED; sau mở NV đăng ký trực tiếp trên web bằng account cũ. Không mở sớm/kéo deadline hoặc nhập A vào kỳ này. Nếu demo trước giờ mở, chỉ kiểm hiển thị/countdown và từ chối nộp sớm; không đánh dấu case nộp thành công.

## Việc chủ dự án cần làm tiếp

Không cần cài tool, nhập lại password hoặc xuất CSV. Review bundle/lệnh trên và **duyệt bước migration 7 file**. Sau schema PASS sẽ có fresh prepare/digest để duyệt import A riêng. Chưa có migration/import/Auth creation nào được thực hiện trong giai đoạn chuẩn bị.

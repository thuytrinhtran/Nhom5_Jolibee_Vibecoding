# Phương án A — backup tối thiểu trên Windows, chưa thử restore

**Cập nhật thực tế:** đã kết nối đúng project qua Session pooler, server 17.11; đã chuẩn bị client portable 17.11 và tạo/kiểm tra archive, không dùng pg_dump16. Xem [DEPLOY-READY.md](DEPLOY-READY.md) và readiness cho trạng thái mới. Không chạy lại bước tạo file kết nối hoặc thay cấu hình Session đang hoạt động bằng template direct-host bên dưới. Restore vẫn chưa thử.

Quyết định mới của chủ dự án: giữ project **wlbpprpiieonjrqglicv**, không tạo project khác hoặc dựng đích restore trong giai đoạn này. Hướng dẫn này thay yêu cầu bắt buộc restore trước migration trong kế hoạch cũ **theo phạm vi lựa chọn mới**. Không biến backup chưa restore thành “đã chứng minh phục hồi”; migration vẫn cần duyệt riêng sau khi file backup được tạo/kiểm tra.

## Công cụ đã kiểm tra thực tế

- `D:/JolliShift-private/tv3-postgres-tools/pgsql/bin/`: pg_dump, pg_restore, psql đều **16.15**; có pg_dumpall đi kèm. Không có các lệnh này trên PATH tại thời điểm kiểm tra.
- Chưa tìm thấy Supabase CLI/Docker trên PATH hoặc Docker ở vị trí cài thường dùng đã kiểm tra. Không kết luận chúng không tồn tại ở mọi vị trí. Phương án này **không cần CLI/Docker**.
- Ổ D còn khoảng **211,71 GB**, C khoảng **2,15 GB** lúc kiểm tra; chọn D, kiểm tra lại trước dump.
- Chưa có `D:/JolliShift-private/pg_service.conf` hoặc `pgpass.conf`; chưa có kết nối PostgreSQL nguồn được xác minh và chưa tạo backup.

**Phải kiểm tra server major trước dump.** psql 16 có thể dùng để đọc version; pg_dump không được cũ hơn major server. Không đoán server=16 từ phiên bản công cụ local. Nếu server 17/18, chuẩn bị command-line tools tương ứng/mới hơn rồi đổi `$taskPgTools`; chưa cài gì trong lượt này. [PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html).

## 1. Tạo chỗ lưu riêng và file kết nối

Chạy PowerShell, không bật transcript hoặc in file password. Các thao tác dưới tạo file local, không thay Supabase. Không ghi đè thư mục/file cấu hình riêng đã có.

```powershell
$taskPrivate = 'D:/JolliShift-private/minimal-backup'
if (Test-Path -LiteralPath $taskPrivate) { throw 'Thu muc da co: chon ten moi hoac kiem tra truoc' }
New-Item -ItemType Directory -Path $taskPrivate | Out-Null
$taskIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
icacls $taskPrivate /inheritance:r /grant:r "$($taskIdentity):(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'PRIVATE_FOLDER_ACL_FAILED' }
notepad "$taskPrivate/pg_service.conf"
```

Trong file service mới, nhập (không có password):

```ini
[jollishift_source]
host=db.wlbpprpiieonjrqglicv.supabase.co
port=5432
dbname=postgres
user=postgres
sslmode=verify-full
sslrootcert=D:/JolliShift-private/minimal-backup/supabase-ca.crt
options=-c default_transaction_read_only=on
connect_timeout=15
```

Lấy CA/kết nối đúng project từ Dashboard **Connect**, lưu CA tại đường dẫn trên. Không đổi backend/.env hoặc dùng API key thay database password. Nếu direct host không kết nối được, dừng để kiểm tra IPv6/kết nối Session pooler đúng project; không tự đổi host hoặc tắt TLS. Supabase có hướng dẫn direct/Session pooler trong [backup CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

Mở file password riêng:

```powershell
notepad "$taskPrivate/pgpass.conf"
```

Tự nhập một dòng, thay placeholder **trong Notepad**, không trong chat/command:

```text
db.wlbpprpiieonjrqglicv.supabase.co:5432:postgres:postgres:<database-password>
```

Nếu password có `:` hoặc `\`, escape bằng `\`. Lưu UTF-8 không BOM; không gửi file này. Windows không tự kiểm tra permission pgpass, nên ACL thư mục riêng ở trên là cần thiết. [PostgreSQL password file](https://www.postgresql.org/docs/current/libpq-pgpass.html).

## 2. Kiểm tra kết nối/version/dung lượng — chỉ SELECT

```powershell
$taskPgTools = 'D:/JolliShift-private/tv3-postgres-tools/pgsql/bin'
$env:PGSERVICEFILE = "$taskPrivate/pg_service.conf"
$env:PGPASSFILE = "$taskPrivate/pgpass.conf"
& "$taskPgTools/psql.exe" --dbname='service=jollishift_source' --no-password -X -A -t --set=ON_ERROR_STOP=1 --command="SELECT json_build_object('server_version',current_setting('server_version'),'server_version_num',current_setting('server_version_num'),'read_only',current_setting('transaction_read_only'),'scope_bytes',(SELECT coalesce(sum(pg_total_relation_size(c.oid)),0) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth','extensions') AND c.relkind IN ('r','m')),'auth_users',(SELECT count(*) FROM auth.users),'auth_identities',(SELECT count(*) FROM auth.identities));" 2>$null |
  Set-Variable -Name taskPreflightJson
if ($LASTEXITCODE -ne 0) { throw 'READ_ONLY_CONNECTION_PREFLIGHT_FAILED' }
$taskPreflight = ($taskPreflightJson -join "`n") | ConvertFrom-Json
if ($taskPreflight.read_only -ne 'on') { throw 'SOURCE_NOT_READ_ONLY' }
$taskPreflight | Select-Object server_version,read_only,scope_bytes,auth_users,auth_identities
```

Chỉ in version/count/size, không Auth rows. Không tiếp tục nếu không xác minh được đúng host/project trong file service. psql không chứng minh project qua tên database postgres.

Sau khi chọn đúng tools theo server version:

```powershell
# Nếu cần tools mới, đổi duy nhất biến taskPgTools sang folder đã chuẩn bị.
$taskDumpVersion = (& "$taskPgTools/pg_dump.exe" --version)
if ($taskDumpVersion -notmatch 'PostgreSQL\) (\d+)') { throw 'UNKNOWN_DUMP_VERSION' }
$taskDumpMajor = [int]$Matches[1]
$taskServerMajor = [int][math]::Floor([double]$taskPreflight.server_version_num / 10000)
if ($taskDumpMajor -lt $taskServerMajor) { throw 'PG_DUMP_TOO_OLD' }
$taskRequiredFree = [math]::Max(1GB, 3 * [double]$taskPreflight.scope_bytes)
if ((Get-PSDrive D).Free -lt $taskRequiredFree) { throw 'INSUFFICIENT_DISK_SPACE' }
```

Đây là dự phòng dung lượng kỹ thuật, không phải dự đoán chính xác kích thước file nén. Chưa cần xuất lại catalog CSV. Không tạo role/đổi quyền nếu SELECT/dump bị từ chối.

## 3. Backup một archive tối thiểu

Phạm vi rõ ràng: **schema + data public, toàn bộ schema Auth (users, identities và dữ liệu liên quan), schema extensions và large objects nếu có**. Lấy cả Auth schema thay vì chỉ UUID để không bỏ identities/password hash. Hash/secret bên trong dump là dữ liệu nhạy cảm: chỉ nằm trong thư mục private, không log nội dung.

Đây là checkpoint ứng dụng, **không phải bản sao toàn bộ Supabase platform**: schema khác, Storage object files, Vault root key và cấu hình Auth/SMTP/Edge Functions ngoài DB không được bảo đảm bởi archive chọn schema. Nếu có dữ liệu sử dụng các phần đó, ghi rõ và bảo toàn riêng trước thao tác ảnh hưởng chúng; không gọi đây là full-project backup. Schema-selective dump không tự gom mọi dependency ngoài phạm vi, cần giữ inventory metadata đã có. [PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html).

Trong cửa sổ không sửa dữ liệu trên web và không có job ghi:

```powershell
$taskBackupDir = Join-Path $taskPrivate ('backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
if (Test-Path -LiteralPath $taskBackupDir) { throw 'OUTPUT_ALREADY_EXISTS' }
New-Item -ItemType Directory -Path $taskBackupDir | Out-Null
$taskDumpFile = Join-Path $taskBackupDir 'jollishift-public-auth.dump'
# Không --verbose, không URL/password trong command/log. Native stderr không ghi log.
& "$taskPgTools/pg_dump.exe" --dbname='service=jollishift_source' --no-password --format=custom --schema=public --schema=auth --schema=extensions --strict-names -b --lock-wait-timeout=5000 --file=$taskDumpFile 2>$null
if ($LASTEXITCODE -ne 0) { throw 'BACKUP_FAILED_FILE_NOT_VALIDATED' }
if ((Get-Item -LiteralPath $taskDumpFile).Length -eq 0) { throw 'EMPTY_BACKUP' }
```

Không thêm `--no-owner`/`--no-acl` hoặc loại Auth table để che lỗi. Không coi file tồn tại khi dump lỗi là backup thành công. Nếu lỗi, dừng; không bật ghi để thử hoặc chạy restore. Thông tin lỗi có thể xem riêng sau khi review, không bật transcript/in connection string.

## 4. Kiểm tra archive offline, không restore

```powershell
$taskTocFile = Join-Path $taskBackupDir 'contents.txt'
& "$taskPgTools/pg_restore.exe" --list --file=$taskTocFile $taskDumpFile 2>$null
if ($LASTEXITCODE -ne 0) { throw 'ARCHIVE_TOC_FAILED' }
$taskToc = Get-Content -LiteralPath $taskTocFile -Raw
foreach ($taskPattern in @('TABLE DATA auth users ', 'TABLE DATA auth identities ', 'TABLE DATA public users ', 'TABLE DATA public employees ', 'TABLE DATA public shift_registrations ', 'TABLE DATA public registration_submissions ', 'TABLE DATA public staffing_requirements ')) {
  if (-not $taskToc.Contains($taskPattern)) { throw 'REQUIRED_TABLE_DATA_MISSING' }
}
# Không --dbname: chỉ giải mã archive thành SQL và bỏ vào thiết bị NUL Windows.
# Không kết nối DB, không thực thi SQL và không ghi raw Auth rows ra log/file SQL.
& "$taskPgTools/pg_restore.exe" --exit-on-error --file=NUL $taskDumpFile 2>$null
if ($LASTEXITCODE -ne 0) { throw 'ARCHIVE_DECODE_FAILED' }
$taskDigest = (Get-FileHash -Algorithm SHA256 -LiteralPath $taskDumpFile).Hash.ToLowerInvariant()
$taskDigest | Set-Content -LiteralPath (Join-Path $taskBackupDir 'SHA256.txt') -Encoding ASCII
```

Mở `contents.txt` **riêng trên máy**, không mở/raw dump ra terminal. Đối chiếu tất cả 26 bảng public đã audit có TABLE/TABLE DATA phù hợp, hai view, functions, policy/ACL/default ACL, constraints/indexes và row triggers; kiểm tra toàn bộ bảng Auth trong scope so với catalog lúc backup. Không chỉ dựa vào 7 bảng bắt buộc được tự kiểm ở trên. Dump selected schemas có thể không chứa global roles/event triggers: giữ bản sao CSV metadata đã có, đặc biệt (58), (64), cùng SHA256 bên cạnh; không xuất lại query chỉ để làm việc này.

`--list` chỉ kiểm mục lục; decode toàn stream phát hiện lỗi đọc/giải nén, **không chứng minh SQL restore được, FK hợp lệ khi nạp hoặc account đăng nhập phục hồi được**. [PostgreSQL pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html).

## 5. Ghi receipt và phân biệt trạng thái

Chỉ chạy sau khi các kiểm tra mục 4 đều xong và nội dung scope đã đối chiếu:

```powershell
$taskReceipt = [ordered]@{
  project_ref = 'wlbpprpiieonjrqglicv'
  created_at = (Get-Date).ToUniversalTime().ToString('o')
  scope = @('public','auth','extensions','large_objects')
  server_version = $taskPreflight.server_version
  pg_dump_version = $taskDumpVersion
  file = 'jollishift-public-auth.dump'
  bytes = (Get-Item -LiteralPath $taskDumpFile).Length
  sha256 = $taskDigest
  backup_created = $true
  archive_toc_checked = $true
  archive_decoded_offline = $true
  scope_inventory_reviewed = $true
  restore_tested = $false
  restore_status = 'DEFERRED_BY_OWNER_FOR_THIS_STAGE'
  migration_approved = $false
}
$taskReceipt | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $taskBackupDir 'receipt.json') -Encoding UTF8
```

| Mức | Bằng chứng | Ý nghĩa |
|---|---|---|
| Backup đã tạo | pg_dump exit=0, file không rỗng | Có archive, chưa chắc đủ scope |
| Backup đã kiểm tra | SHA256 + TOC + decode + đối chiếu scope | File đọc được, có đối tượng cần giữ; chưa thực thi SQL |
| Backup đã thử restore | Nạp thành công vào DB và đối chiếu dữ liệu/quyền | **Chưa thực hiện và không yêu cầu dựng đích trong giai đoạn này** |

Nếu gửi receipt để review, chỉ gửi trạng thái/count/size/hash; không gửi dump, pgpass, connection string hoặc dữ liệu Auth. Nên giữ thêm một bản sao archive/hash trên nơi riêng được kiểm soát, không phải repository.

## 6. Checklist trước và sau từng migration — không chạy trong bước backup

Sau backup được kiểm tra, xin duyệt bundle SHA riêng. Việc hoãn restore theo lựa chọn mới được ghi rõ, không tiếp tục coi nó là yêu cầu phải tạo project/restore ngay.

1. Kiểm tra source project, backup mới/checksum còn khớp, writer/automation không gây drift, flags persistence/dev-import giữ OFF. Xác nhận 60 employees, 16 real rows/2 headers, 63 ô/308 nhu cầu và không schedule kỳ đích tại cửa sổ triển khai; không sửa nguồn nếu số liệu đổi.
2. TV4 nền `20261029_tv4_schedule_workflow.sql` nếu còn thiếu/tương thích: nullable published_by/FK và RPC prerequisite đúng; không replay foundation/TV2.
3. `20261101`: guard MD5/owner/ACL trước chạy; sau chạy contract tv3.rules.v2 và helpers đúng, RPC public chỉ service; dữ liệu cũ không đổi.
4. `20261102`: approval trigger gắn INSERT/UPDATE/DELETE; RPC workflow/version/ACL đúng, old RPC service EXECUTE bị thu hồi; không backfill status.
5. `20261103`: employee_schedule_week service-only; không mở browser table policies.
6. `20261104`: đúng constraint cũ/không conflicting open rows; partial UNIQUE + successor + FK đúng; không xóa history/requests.
7. `20261105`: registry private/RLS bật, nguồn view còn legacy predicates; chưa có batch/import; không sửa sample_batch_id/TV2 validation.
8. `20261106`: input sau M5 đúng checksum guard, helper UTC private, source M6 đúng; budget 3 giây không đổi.
9. Mỗi file kiểm postflight và so projection cột cũ/row IDs; file lỗi rollback transaction của nó, giữ flags OFF và dừng. Các file đã COMMIT trước đó vẫn còn; không replay toàn bundle hoặc tự restore đè nguồn.
10. Chỉ sau schema PASS mới duyệt Auth/profile, fresh prepare/import digest và bật writer từng giai đoạn. Không seed hoặc gọi RPC ghi để thử trong backup.

**Trạng thái hiện tại:** mới kiểm tra tools/disk và chuẩn bị hướng dẫn. Chưa có backup_created/checked/restore_tested thực tế; chưa có phê duyệt migration.

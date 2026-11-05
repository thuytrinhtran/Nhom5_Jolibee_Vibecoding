# Backup/restore trước migration — hướng dẫn chờ duyệt

**Phương án đầy đủ trước đây, giữ làm tham khảo.** Chủ dự án đã chọn phương án A, chưa dựng đích restore: hướng dẫn hiện hành ở [MINIMAL-BACKUP-WINDOWS.md](../MINIMAL-BACKUP-WINDOWS.md). Không chạy phần restore bên dưới trong giai đoạn này; readiness ghi restore_tested=false và deferred_by_owner.

Nguồn duy nhất: **wlbpprpiieonjrqglicv**. Các lệnh dưới **chưa chạy**. Backup chỉ đọc nguồn; tạo file local và restore đều cần được duyệt phạm vi trước thực hiện. Không dùng nút Restore vào project nguồn để “thử”. Không gửi database password, token, dump Auth hoặc root encryption key vào chat/repository.

## 1. Chuẩn bị và phê duyệt

1. Duyệt một lần đọc/backup nguồn và một đích restore cô lập cụ thể. Ưu tiên DB/Supabase-compatible local có extension/role tương thích và network không cho job/webhook gọi ra hệ thống thật; chưa tạo đích trong bước review này.
2. Đích phải mới/trống dành riêng cho restore, không phải `wlbpprpiieonjrqglicv`, không có dữ liệu cần giữ. Chuẩn bị role/extension/platform dependency theo inventory backup. PostgreSQL trống với vài mock table Auth không đủ nếu dump có managed extension. Không tự loại đối tượng lỗi để tuyên bố restore PASS.
3. Người phụ trách dừng writer backend và job/cron/automation nếu có trong cửa sổ checkpoint; không cần phối hợp thành viên khác. Việc dừng/chỉnh job cũng cần duyệt riêng. Không đổi deadline/status dữ liệu.
4. Đặt connection config, password file, CA, dump và logs trong thư mục riêng ngoài repo, ví dụ `D:/JolliShift-private/backups/ld-pre-rollout-<timestamp>/`; giới hạn ACL NTFS. Không dùng ổ C đang thiếu dung lượng nếu tình trạng đó vẫn còn; kiểm tra dung lượng trước.
5. Lấy kết nối từ **Connect** của Dashboard đúng project, dùng TLS xác minh CA/hostname. Không đổi backend/.env. Cấu hình libpq service `jollishift_source` ngoài repo: direct host `db.wlbpprpiieonjrqglicv.supabase.co`, database postgres, user được cấp quyền, port đúng, `sslmode=verify-full`, CA phù hợp và `options=-c default_transaction_read_only=on`. Password nằm trong PGPASSFILE riêng, không nằm trong command/history.

Nếu direct IPv6 không truy cập được, dừng để review lựa chọn Session pooler được Dashboard cung cấp/CLI chính thức, không tắt TLS hoặc âm thầm sửa guard executor. Supabase hướng dẫn dùng direct hoặc Session pooler cho logical backup; không dùng transaction pooler thay thế tùy ý. [Hướng dẫn chính thức](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

## 2. Xác minh công cụ/kết nối chỉ đọc

Điền đường dẫn công cụ **đã cài**, giữ service/password/CA ngoài repo. Ví dụ PowerShell, chưa thực hiện:

```powershell
$taskPgTools = 'D:/JolliShift-private/tv3-postgres-tools/pgsql/bin'
$taskBackupDir = 'D:/JolliShift-private/backups/ld-pre-rollout-<timestamp>'
$env:PGSERVICEFILE = 'D:/JolliShift-private/pg_service.conf'
$env:PGPASSFILE = 'D:/JolliShift-private/pgpass.conf'
& "$taskPgTools/pg_dump.exe" --version
& "$taskPgTools/pg_restore.exe" --version
& "$taskPgTools/psql.exe" --dbname='service=jollishift_source' --no-password -X --set=ON_ERROR_STOP=1 --command="SELECT version(), current_database(), current_user, current_setting('transaction_read_only');"
if ($LASTEXITCODE -ne 0) { throw 'SOURCE_PREFLIGHT_FAILED' }
```

Xác minh host/service đúng project trong private config; `current_database=postgres` không chứng minh project. Read-only phải on cho service backup. Chọn pg_dump tương thích major nguồn, không dùng client cũ hơn server. Chuẩn bị target tương thích phiên bản/extension; không suy major chỉ từ quyền MAINTAIN trong CSV. [PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html).

Đây là bước lấy server version phục vụ backup, không cần một vòng CSV C1.1 mới. Ghi lại version và trạng thái, không in secret.

## 3. Tạo backup và receipt — chỉ sau duyệt

Phương án native bên dưới là **dump database**, không chỉ public và không phải REST/CSV export. Lưu role inventory không kèm role password; không bỏ owner/ACL trong archive. Thư mục output phải mới, không ghi đè backup cũ.

```powershell
if (Test-Path -LiteralPath $taskBackupDir) { throw 'BACKUP_DIRECTORY_ALREADY_EXISTS' }
New-Item -ItemType Directory -Path $taskBackupDir | Out-Null
& "$taskPgTools/pg_dump.exe" --dbname='service=jollishift_source' --no-password --format=custom --verbose --lock-wait-timeout=5000 --file="$taskBackupDir/database.dump" 2> "$taskBackupDir/dump.stderr.log"
if ($LASTEXITCODE -ne 0) { throw 'DUMP_FAILED_STOP' }
& "$taskPgTools/pg_dumpall.exe" --dbname='service=jollishift_source' --no-password --roles-only --no-role-passwords --file="$taskBackupDir/roles-inventory.sql" 2> "$taskBackupDir/roles.stderr.log"
if ($LASTEXITCODE -ne 0) { throw 'ROLE_INVENTORY_FAILED_STOP' }
Get-FileHash -Algorithm SHA256 -LiteralPath "$taskBackupDir/database.dump"
Get-FileHash -Algorithm SHA256 -LiteralPath "$taskBackupDir/roles-inventory.sql"
& "$taskPgTools/pg_restore.exe" --list "$taskBackupDir/database.dump" > "$taskBackupDir/toc.txt"
if ($LASTEXITCODE -ne 0) { throw 'ARCHIVE_LIST_FAILED_STOP' }
```

Xem logs trong thư mục private; không dump nội dung Auth vào terminal/chat. Dump phải chứa public dữ liệu/schema/functions/views/RLS/grants/triggers/indexes/default ACL, Auth users/bindings và các dependency thực dùng. Xác minh TOC và role/settings/extensions; nếu migration-history schema tồn tại thì giữ cả nó, nếu không ghi ABSENT. Role file chỉ là inventory/bootstrap input cần review, **không chạy mù lên managed Supabase hoặc source**.

Nếu quyền managed schema khiến native dump lỗi, trạng thái là FAILED; không thêm exclude/no-ACL/no-owner để che lỗi. Dùng phương án Supabase CLI/backup được hỗ trợ sau khi review commands/version và đích theo [quy trình chính thức](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore). Các lần dump riêng cần cùng cửa sổ không ghi; không coi nhiều export rời là một snapshot nhất quán.

Database dump không giữ toàn bộ cấu hình Supabase ngoài DB; đặc biệt Storage object files không nằm trong database backup. Nếu app có Storage thì backup file riêng; nếu không dùng ghi N/A. Kiểm tra Auth config/SMTP/redirects/keys/Edge Functions và Vault/pgsodium root key bằng cơ chế bảo mật riêng trước kết luận phục hồi toàn project. [Supabase Database Backups](https://supabase.com/docs/guides/platform/backups).

**Lựa chọn managed thay thế:** nếu Dashboard/gói hiện tại có “Restore to a new project”, có thể duyệt đích mới và chi phí rồi dùng tính năng đó, không restore tại chỗ. Supabase mô tả clone này gồm database/Auth/roles và encryption root key, nhưng vẫn cần cấu hình dịch vụ ngoài DB riêng. Chưa xác minh tài khoản hiện có hỗ trợ tính năng; không tự nâng plan/tạo project. [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project).

## 4. Restore thật vào đích được duyệt

Chỉ tiếp tục khi đã review TOC, chuẩn bị role/extension tương thích và **đích mới, riêng biệt**; network/job không thể gọi source hoặc hệ thống ngoài. Tên service đích là `jollishift_restore`, trỏ host/port/database cô lập đã kiểm tra, không dùng source credentials/config. Nếu dùng local, database ví dụ `jollishift_restore`; đối chiếu endpoint ngoài SQL, không dựa tên database đơn lẻ.

```powershell
& "$taskPgTools/psql.exe" --dbname='service=jollishift_restore' --no-password -X --set=ON_ERROR_STOP=1 --command="SELECT version(), current_database(), inet_server_addr(), inet_server_port();"
if ($LASTEXITCODE -ne 0) { throw 'RESTORE_TARGET_PREFLIGHT_FAILED' }
# DỪNG tại đây cho đến khi endpoint/DB trống/role/extensions đã được duyệt.
# Lệnh tiếp theo GHI vào đích cô lập, tuyệt đối không dùng jollishift_source.
& "$taskPgTools/pg_restore.exe" --dbname='service=jollishift_restore' --no-password --single-transaction --exit-on-error --verbose "$taskBackupDir/database.dump" 2> "$taskBackupDir/restore.stderr.log"
if ($LASTEXITCODE -ne 0) { throw 'RESTORE_FAILED_NO_GO' }
```

Không có `--clean`, DROP/CASCADE hoặc bỏ owner/ACL. Nếu đích là local Supabase đã có sẵn managed schema, không chạy nguyên restore gây trùng đối tượng; dùng quy trình CLI chính thức/TOC được review cho đích đó, hoặc chuẩn bị đích tương thích khác. Lỗi role/extension/managed object phải giải quyết ở **đích cô lập**, không sửa nguồn. `pg_restore --list` chỉ đọc mục lục, không phải restore. Không tự chạy file roles toàn bộ hoặc tắt trigger/RLS ở source.

## 5. Bằng chứng để đánh dấu PASS

Lưu receipt không chứa secret: source ref, thời điểm checkpoint, phương pháp dump/restore, target identity, phiên bản PG/tools/extensions, SHA256, exit codes, log lỗi đã xử lý, kết quả dưới đây:

- Restore thực sự hoàn tất; không chấp nhận exit code 0 của lệnh cuối che lỗi lệnh trước, không bỏ lỗi permission/extension/owner/ACL.
- So **mọi bảng dữ liệu ứng dụng** và Auth IDs/bindings với snapshot backup; hashes/before-images lưu private. Kiểm tra tối thiểu Lê Duẩn 60 employees, 2 headers/16 real registrations, 63 demand cells/308 positions, kỳ/deadline và trạng thái cũ nguyên vẹn. Không chỉ kiểm tra 4 số tổng.
- So function body MD5, owner/search_path/SECURITY DEFINER, mọi grant/default ACL, 95 constraints, index definitions, 7 trigger attachments, RLS/policies, views và event hooks theo inventory. Với managed target khác, ghi rõ sai khác hệ thống được review; không bỏ qua sai khác ở public nghiệp vụ.
- Sau restore, roles/claims/RLS đúng và không có outbound job/cron/webhook/SMTP/AI phát sinh tác động thật. Không in Auth password hash/root key để kiểm tra.
- Diễn tập bundle TV4 nền + 20261101–06 **trên bản restore được duyệt**, giữ mọi giá trị cột cũ không đổi; sau thêm cột nullable so projection cột cũ, không coi thêm trường NULL là mất dữ liệu.
- Kiểm tra postflight: approvals trigger gắn, public RPC chỉ service, helpers private, registry không có browser/service table grants; RLS còn bật, provenance view còn legacy predicates, M6 budget không đổi. Giữ log/metadata trước-sau.

Chỉ khi các mục trên PASS mới xin duyệt migration **riêng** cho nguồn bằng đúng bundle SHA. Test dữ liệu fixture 308 và 20 mẫu hiệu năng trước đó hỗ trợ code, không thay restore từ dữ liệu thật. Nếu có khác biệt, giữ NO-GO; không cần sửa project nguồn để “làm restore xanh”.

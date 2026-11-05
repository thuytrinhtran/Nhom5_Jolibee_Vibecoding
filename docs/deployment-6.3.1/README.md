# Báo cáo cũ — được thay thế bởi TARGET-UPDATE.md

**Project đích đã được người phụ trách xác nhận là wlbpprpiieonjrqglicv. Đọc [TARGET-UPDATE.md](TARGET-UPDATE.md) và readiness.json cho kết quả mới. Không chạy collector PostgreSQL khóa wimik bên dưới cho project hiện tại.** Nội dung dưới giữ lại làm lịch sử, không phải hướng dẫn triển khai hiện hành.

Kiểm tra local ngày 02/11/2026 (Asia/Saigon). Không có truy vấn Supabase, backup, migration, Auth sign-in, seed hoặc thay đổi cờ nào được thực hiện trong bước này.

## Kết quả

| Mục | Trạng thái | Bằng chứng / giới hạn |
|---|---|---|
| Project cấu hình | FAIL | `backend/.env`: `wlbpprpiieonjrqglicv.supabase.co`; hợp đồng dev-import/executor/rehearsal: `wimikwyuzhltpjciafod.supabase.co`. Không gửi khóa của project này tới project kia. |
| Môi trường | Chỉ xác minh local | NODE_ENV=development; chưa có bằng chứng project đích là môi trường test được nhóm chấp thuận. |
| Kết nối PostgreSQL | BLOCKED | Không có DATABASE_URL/PG* trong process, không có cấu hình PostgreSQL được cung cấp. Không có connector Supabase/PostgreSQL trong phiên. Không tìm kiếm credential ngoài các nguồn đã khai báo. |
| Quyền chỉ đọc | Chưa xác minh trên server | Collector mới luôn bắt đầu REPEATABLE READ READ ONLY, direct host cố định và TLS xác minh; chưa chạy kết nối. |
| Cờ backend | PASS một phần | DRAFT persistence=false; AI external=true. Các cờ không có trong .env chưa đủ chứng minh cấu hình process đang chạy. Không bật/tắt cờ nào. |
| Catalog, RLS, trigger, ACL, RPC, migration đã áp dụng | NOT VERIFIED | 14 CSV cũ không thay thế snapshot mới; chưa có checksum function thật mới. |
| TV5 duplicate/index/legacy requests/race prerequisites | NOT VERIFIED | Đã có truy vấn D4–D6; chưa có kết quả server hiện tại. |
| 60 nhân viên / 16 đăng ký / 63 ô / 308 vị trí | NOT VERIFIED | Đây là baseline cũ và kết quả rehearsal, không phải số liệu live đã xác nhận. |
| Auth/profile cần bổ sung | NOT VERIFIED | Danh sách 17 tài khoản là dự kiến cũ; chưa thể xác nhận cần tạo chính xác 17. Phải đối chiếu UUID, username, Auth binding, email dự kiến và trigger trước khi tạo. |
| Backup và restore thật | NO-GO | Chưa có backup nhất quán từ project đích và bằng chứng restore thành công vào môi trường cô lập. Rehearsal fixture không phải restore backup thật. |
| Fresh seed plan có thể apply | BLOCKED | Chưa có baseline live; không phát hành plan/checksum cho phép apply. `readiness.json` chỉ là kế hoạch kiểm tra bị chặn. |

## Cách cung cấp quyền truy cập còn thiếu

Trước tiên xác nhận project nhóm muốn triển khai: project đã khóa trong hợp đồng (`wimikwyuzhltpjciafod`) hay project đang nằm trong .env (`wlbpprpiieonjrqglicv`). Nếu chọn project khác hợp đồng, cần rà soát/rebind scope và rehearsal lại; không thay ref bằng tìm/thay hàng loạt hoặc bỏ guard.

Nếu đúng project đã rehearsal, lấy thông tin kết nối PostgreSQL từ **Connect** trong Dashboard đúng project. Đặt connection JSON ở thư mục riêng ngoài repository, ví dụ `D:/JolliShift-private/connection.json`, tự điền host, port, database, user, password và TLS/CA. Không gửi password/token vào chat hoặc commit file. Chưa cần sửa `.env`, bật flag hay tạo role mới.

Collector yêu cầu direct host `db.wimikwyuzhltpjciafod.supabase.co`, database `postgres`, port 5432 và `ssl.rejectUnauthorized=true`; không nhận connectionString/options/pooler/alias. Dùng user hiện có có quyền đọc catalog, các bảng liên quan và Auth IDs. Nếu không có quyền đó hoặc direct host không truy cập được, dừng và xuất bằng SQL Editor thay vì tắt TLS hoặc tạo RPC SQL tùy ý.

Lệnh dưới đây **chưa được chạy tới Supabase**; chỉ dùng sau khi có cấu hình đúng:

```powershell
# Chạy ở thư mục backend, không nạp .env ứng dụng.
$env:DEV_IMPORT_PG_CLIENT = 'D:/JolliShift-private/tv3-postgres-tools/node-client/node_modules/pg'
node scripts/collect-live-preflight.cjs D:/JolliShift-private/connection.json D:/JolliShift-private/live-preflight-NEW
```

Collector chạy toàn bộ SELECT của preflight 6.1/6.2 trong cùng snapshot chỉ đọc, bỏ qua riêng truy vấn sau migration nếu registry/gate chưa tồn tại. Bổ sung tất cả cột public, index, constraint, function body/checksum, EXECUTE hiệu lực, ACL, Auth/profile collision và baseline đích. Không gọi RPC nghiệp vụ để thử quyền. Kết quả lưu riêng từng JSON với row_count/SHA256 trong manifest, không LIMIT 100, không in credential hoặc dữ liệu cá nhân ra console. `complete=false` là snapshot thất bại, không được dùng để triển khai. File JSON có thể chứa dữ liệu nhân viên/function body; giữ riêng, giới hạn ACL Windows và chỉ chia sẻ qua kênh được nhóm chấp thuận. Đây không phải backup có thể restore.

Nếu dùng SQL Editor: chạy từng nhóm của `../deployment-6.1/01-catalog-preflight.sql`, sau đó `02-data-preflight.sql`, rồi phần catalog của `../deployment-6.2/preflight.sql`. Không chạy phần tham chiếu registry/dev_import_allowed khi catalog báo chúng chưa tồn tại. Chọn **No limit**, xuất/download CSV đầy đủ từng SELECT; ghi lại tổng dòng, thời gian, project ref. Không coi 100 dòng hiển thị là toàn bộ kết quả. Không xuất Auth password/hash/token; chỉ Auth IDs và liên kết cần thiết. Export SQL Editor không bảo đảm snapshot nhất quán giữa nhiều lần chạy: cần cửa sổ nhóm không ghi và xác minh lại baseline trước triển khai.

## Thứ tự dự kiến và chốt trước khi ghi

1. Xác nhận đúng project, quyền đọc, branch/kỳ; thu đủ snapshot mới và đối chiếu archive/migration bằng function definitions/checksum, không chỉ tên RPC hoặc migration history.
2. Xử lý dữ liệu legacy trùng/xung đột theo quyết định chủ sở hữu. Không tự xóa request, assignment hoặc dữ liệu nhóm.
3. Có backup nhất quán và restore thực sự thành công ở DB cô lập, kiểm tra owner/ACL/RLS/trigger/functions, Auth bindings và dữ liệu. Cần phương án riêng cho managed objects/config; `pg_restore --list` không đủ.
4. Phê duyệt bundle migration có SHA256 cụ thể. Thứ tự có điều kiện: `20261029_tv4_schedule_workflow.sql` **chỉ nếu thiếu và schema tương thích** → `20261101` → `20261102` → `20261103` → `20261104` → `20261105`. Không replay migration nền/TV2 hoặc migration đã áp dụng. Hiện **chưa migration nào được xác nhận đủ điều kiện trên DB live**.
5. Sau deployment được duyệt, chạy postflight trước khi bật writer. Đối chiếu Auth/profile mới và phê duyệt provisioning riêng; đổi baseline thì prepare lại.
6. Fresh prepare chỉ đọc từ DB đích → kiểm tra engine 308/308, provenance, UUID collision, checksum; phê duyệt đúng plan digest mới rồi mới seed. Không dùng checksum rehearsal làm quyền apply.
7. Phê duyệt riêng các thay đổi cấu hình backend và bật dev-import/TV3/TV4/TV5 theo thứ tự nghiệm thu; kiểm soát AI external riêng. Không bật test-preview cho luồng lưu thật.

Các bước 2–7 có ghi/thay đổi trạng thái phải được người phụ trách xác nhận trước. User hiện chỉ cấp phép đọc Supabase; việc dừng tại đây do thiếu kết nối đúng project và bằng chứng restore, không phải yêu cầu xin lại quyền đọc.

# TV3 — kiểm tra triển khai nhiều kết nối

## Phạm vi

Repository D:/Project/Nhom5_Jolibee_Vibecoding, branch feature/ui-ux-improvements. Không gọi Supabase, không áp migration lên database chung, không commit/push. Bộ test tạo cluster native PostgreSQL riêng trên loopback; schema và fixture chỉ được ghi trong cluster đó.

## Đã kiểm chứng

Native PostgreSQL **16.15**, ba kết nối với ba backend PID khác nhau; gateway **PostgREST 12.2.12** chạy thật trên cổng loopback riêng. Các executable và thư viện `pg` nằm ngoài repository ở D:/JolliShift-private/tv3-postgres-tools; không đổi dependency/lockfile dự án. Harness tự khởi tạo cluster mới, bind 127.0.0.1, không nhận URL database hoặc đọc .env; tắt PostgreSQL/gateway khi kết thúc. Cluster/log fixture được giữ trong thư mục run-* riêng để xem lại, không phải database sử dụng chung.

| Trường hợp | Kết quả được kiểm tra |
| --- | --- |
| Hai connection cùng tạo lịch | Session giữ transaction chưa commit; session khác bị 55P03 ngay. Sau commit chỉ một lịch/audit; retry cùng request trả cùng ID, request khác bị chặn. |
| Hai connection sửa cùng DRAFT/version | Một version mới; session còn lại bị NOWAIT, retry với version cũ trả 40001. Group giữ nguyên, phân công cũ REPLACED. |
| TV2 đang ghi nguồn | TV3 nhường khóa 55P03; sau TV2 commit, snapshot cũ bị 40001. Tải nguồn mới và lưu lại được; không tự cấp lại revision/version. |
| TV4 đang chuyển trạng thái | TV3 nhường khóa; sau commit PENDING_APPROVAL, chỉnh sửa bị DRAFT_LOCKED; không tạo version mới. |
| TV3 giữ khóa, cron tạo kỳ | Generator TV2 thật trong repository tạo được kỳ khác; không khóa toàn bảng periods. |
| TV3 giữ khóa, TV2 ghi registrations | Writer TV2 vẫn có thể bị chặn vì khóa nguồn còn lại. Statement timeout của writer hủy an toàn; sau TV3 commit, retry thành công. Không tuyên bố đã loại bỏ toàn bộ ảnh hưởng liên chi nhánh. |
| Timeout native đặt trước câu lệnh | Trigger cố sleep 10 giây, câu lệnh bị hủy bằng timeout 700ms; không tạo version dở dang, phân công cũ còn DRAFT, kết nối khác ghi lại được, retry thành công. |
| Timeout gateway thật | Cả persist_schedule_draft và generate_schedule_draft bị hủy khoảng 5 giây với 57014 khi trigger cố sleep 10 giây. Không lưu schedule/assignment; khóa được giải phóng. Sau bỏ trigger local, retry qua HTTP thành công và gọi lại không tạo trùng. |
| SQL catalog | tv3-deployment-preflight.sql thực thi thành công trong transaction READ ONLY trên PostgreSQL native. Chưa chạy script trên Supabase chung. |

Đây là kiểm tra transaction/khóa/gateway bằng fixture và tác vụ writer SQL đại diện TV2/TV4; không phải E2E JWT NV/QL/GS hoặc toàn bộ UI TV4. Generator cron là function thật, không phải pg_cron chạy theo lịch. Chưa đo tải lớn trên hạ tầng Supabase.

## Lỗi tối thiểu đã sửa

Kết quả lần chạy cuối: native suite 9/9 (gồm 8 tình huống và test cha), regression liên quan 7/7. Gateway hủy persist_schedule_draft sau 5031ms và generate_schedule_draft sau 5019ms; cả hai SQLSTATE 57014, rollback và retry đã xác minh. Không chạy lại frontend hoặc toàn bộ regression vì không đổi TypeScript/UI/Rule Engine ở đợt này.

Migration trước đây chỉ đặt statement_timeout 30s cho lúc chạy DDL và lock_timeout cho RPC; các checkpoint 3s không ngắt được một SQL/trigger đang chạy dài. Bổ sung `SET statement_timeout='5s'` vào metadata **cả hai RPC public**. Gateway hoist setting trước câu lệnh RPC mới tạo hard statement deadline; chỉ đặt SET trong function không đủ với gọi SQL trực tiếp.

Tham chiếu chính thức: [PostgREST — function settings](https://docs.postgrest.org/en/v12/references/transactions.html#function-settings), [PostgreSQL — statement_timeout](https://www.postgresql.org/docs/16/runtime-config-client.html). Phải kiểm tra db-hoisted-tx-settings có statement_timeout; test local đặt cấu hình này rõ ràng. Không suy ra Supabase có cùng version/config từ kết quả local.

## Chạy lại khi cần

Không cần chạy lại toàn bộ regression cho riêng kiểm tra triển khai này. Tại backend:

```powershell
$env:TV3_NATIVE_PG_ROOT = 'D:/JolliShift-private/tv3-postgres-tools'
$env:TV3_NATIVE_PG_BIN = 'D:/JolliShift-private/tv3-postgres-tools/pgsql/bin'
$env:TV3_NATIVE_PG_CLIENT = 'D:/JolliShift-private/tv3-postgres-tools/node-client/node_modules/pg'
$env:TV3_NATIVE_POSTGREST = 'D:/JolliShift-private/tv3-postgres-tools/postgrest/postgrest.exe'
node --test tests/tv3-native-concurrency.test.cjs
```

Các biến này chỉ chỉ định công cụ local, không có credential hoặc URL Supabase. Thiếu native tools thì bộ test SKIP rõ ràng; thiếu gateway thì riêng phần HTTP SKIP. Không đặt SCHEDULING_TEST_DATABASE_URL để trỏ project dùng chung. Không cần chỉnh .env hoặc bật cờ ghi ứng dụng thật.

## SQL Editor Supabase và điều kiện GO

Chạy **docs/tv3-deployment-preflight.sql** bằng postgres trong đúng project. File chỉ SELECT catalog, không gọi application RPC. Đối chiếu:

1. Đủ bảng/cột/kiểu/default, view nguồn VALID/submitted_at/sample provenance và function registration_effective_status/auth.role.
2. PK/FK/UNIQUE/CHECK validated; đặc biệt composite employee/department, group/version, assignment tuple, period branch/week; CHECK chấp nhận DRAFT/REPLACED/REGULAR và MANUAL/SYSTEM.
3. Trigger không thêm side effect hoặc từ chối các thao tác hợp lệ; audit immutability vẫn giữ. RLS/GRANT phù hợp backend trung gian.
4. Trước triển khai: chưa có ba function TV3 trùng tên/chữ ký. Có sẵn thì dừng đối chiếu, không chạy lại CREATE hoặc tự DROP/REPLACE.
5. Sau triển khai được duyệt: owner postgres, SECURITY DEFINER/search_path đúng; RPC EXECUTE chỉ service_role, helper không cấp cho các API role; cả hai RPC có statement_timeout=5s. Body khớp bản migration đang duyệt.
6. Timeout SQL Editor không phải timeout pool PostgREST. Catalog role settings chỉ là một phần; người vận hành phải xác nhận gateway version và effective db-hoisted-tx-settings/override qua cấu hình được cấp quyền. Không in toàn bộ role settings hoặc secret.
7. Backup và cửa sổ triển khai được nhóm duyệt; flag ghi mặc định false trên mọi instance, legacy endpoint cũng khóa. Sau triển khai, chỉ bật khi catalog/timeout được xác minh và có phê duyệt smoke test ghi đúng một DRAFT ở kỳ/branch thống nhất.

**NO-GO cho Supabase chung cho đến khi các điều kiện catalog/gateway/backup và phê duyệt trên được hoàn tất.** Các điều kiện concurrency native và timeout gateway local đã có bằng chứng; không còn coi PGlite là bằng chứng nhiều kết nối. Không tự tạo smoke-test DRAFT hoặc sửa kỳ để vượt điều kiện CLOSED.

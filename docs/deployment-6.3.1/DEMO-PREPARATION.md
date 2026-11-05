# Chuẩn bị demo JolliShift — Supabase hiện tại, web local

## Đã kiểm tra trực tiếp trong lượt chuẩn bị

- Backend `npm run dev` khởi động trên port 5000; frontend Vite trên 5173.
- `GET /api/health` và `GET /api/db-health`: HTTP 200, Supabase connected.
- Frontend `/`, `/src/main.tsx` và proxy `/api/health`: HTTP 200. Đây là smoke test HTTP/module, chưa phải kiểm thử React bằng browser đăng nhập.
- GET không token tới schedules/employee-schedule/shift-changes đều 401, không gọi writer RPC hoặc đăng nhập làm thay đổi Auth.
- GET source/OpenAPI/Auth IDs đúng project `wlbpprpiieonjrqglicv`: 18 requests chỉ đọc, không lỗi. Evidence: `target-rest-1793633173491.json`.
- Lê Duẩn vẫn 60 employees, 16 registrations của kỳ đích, 63 cells/308 positions; schedules/assignments/requests toàn project hiện được API trả 0 dòng. Không có kỳ naturally OPEN ở Lê Duẩn tại thời điểm GET.
- Hai dev server được khởi động với TV3/TV4/TV5 persistence và dev-import **tắt ở process backend**, không sửa .env. Không bật writer để thử schema cũ.

Mở `http://localhost:5173`; health ở `http://localhost:5000/api/health`. Nếu cần chạy lại: `cd backend; npm run dev`, terminal khác `cd frontend; npm run dev`. Không dùng `dev:tv3-test` cho demo lưu dữ liệu thật. Các override tạm của process hiện tại không tồn tại khi mở terminal mới; cấu hình persistence chỉ bật sau migration được duyệt.

## Migration cần triển khai sau duyệt

CSV function body/metadata đã xác minh và OpenAPI mới vẫn phù hợp schema cũ. Chưa có contract mới cần cho web. M1/M6 body chỉ được xác minh trực tiếp qua CSV trước đó; GET OpenAPI không đọc function body hoặc chứng minh migration history. Không gọi writer RPC để “thử xem đã migrate chưa”. Trước apply vẫn chạy guard của file, nếu nguồn đã đổi thì dừng.

| Thứ tự / file | Thiếu gì trên DB hiện được chứng minh | Thay đổi/rủi ro và kiểm tra sau file |
|---|---|---|
| 0. 20261029_tv4_schedule_workflow.sql nếu thiếu/tương thích | published_by và RPC TV4 nền chưa có trong evidence | Thêm nullable field/FK/functions. Kiểm tra field đúng type/FK và dữ liệu/cột cũ không đổi; không replay foundation/TV2 |
| 1. 20261101_tv3_rule_contract_v2.sql | Input/persist v1 trong CSV; helpers v2 chưa có trong catalog đã export | Thay function/ACL, không xóa row. Kiểm tra guard/checksum, tv3.rules.v2, helper private và public RPC service-only |
| 2. 20261102_tv4_workflow_v2.sql | Chưa thấy workflow v2 RPC; approval trigger hiện chưa gắn | Thay logic workflow, thay/gắn trigger và thu hồi RPC cũ. Kiểm tra role/branch/version/reason và attachment, giữ history |
| 3. 20261103_employee_schedule_read.sql | employee_schedule_week chưa expose trong API và chưa có ở CSV S2 đầy đủ | Thêm read RPC service-only; không mở browser policy |
| 4. 20261104_tv5_shift_replacement.sql | Thiếu snapshot/successor fields, TV5 RPC và partial indexes | Thêm nullable fields/FKs; DROP đúng UNIQUE constraint cũ rồi tạo partial UNIQUE, không DROP TABLE. Kiểm tra indexes/constraints và legacy conflicts; không xóa assignment/request |
| 5. 20261105_scoped_dev_import.sql | Không có registry/source-row view/gates trong CSV; sourced-view API vẫn không có dev_import_allowed | Tạo registry rỗng, functions/view/ACL. Giữ nguyên provenance/legacy predicates, registry private; không tự import/bật batch |
| 6. 20261106_dev_import_source_materialization.sql | Contract M5 chưa có nên contract phụ thuộc M6 chưa thể coi là sẵn | Chỉ đổi SQL source + helper UTC private. Kiểm tra guard sau M5, budget 3 giây và source shape giữ nguyên |

Đã đọc lại cả 7 file và đối chiếu checksum bundle. Không có DROP TABLE/TRUNCATE; không có backfill xóa/ghi đè dữ liệu cũ ở top-level. UPDATE/INSERT trong function body chỉ chạy khi RPC được gọi sau này. DDL vẫn có rủi ro lock, sai guard/schema, default grants rộng và thay hành vi ghi tương lai; không gọi là không rủi ro. TV5 cần giữ lịch sử A→B→A, không khôi phục UNIQUE cũ bằng cách xóa history.

### Quy trình apply — chuẩn bị, chưa thực hiện

1. Có checkpoint tối thiểu, xác minh project/bundle SHA, writer tắt và các counts/IDs nguồn không drift. Không bắt xuất lại 8 nhóm catalog đã đủ.
2. Người phụ trách duyệt bundle. Chạy từng file theo bảng; mỗi file transaction riêng. Không gộp chạy lại mọi file khi gặp lỗi.
3. Sau từng file: đối chiếu function/ACL/trigger/index tương ứng, giữ flags OFF và kiểm tra cột/row cũ. Chỉ sang file sau nếu PASS.
4. Nếu lỗi: dừng, file đó rollback; các file trước đã COMMIT vẫn còn. Review catalog/forward-fix; không tự restore đè source hoặc DELETE/CASCADE.
5. Sau schema PASS mới chuẩn bị Auth/profile và fresh seed plan, xin duyệt từng bước dữ liệu rồi mới bật TV3/TV4/TV5. Không gọi RPC ghi ở preflight.

## Backup tối thiểu, không thêm hạ tầng

Dùng **PostgreSQL command-line client pg_dump**, không cần cài PostgreSQL Server, Supabase CLI, Docker, Pro hoặc project khác. Công cụ hiện biết là 16.15; kiểm tra server version rồi chỉ thay client nếu cần, không khẳng định 16 đủ cho server mới hơn.

Làm theo [MINIMAL-BACKUP-WINDOWS.md](MINIMAL-BACKUP-WINDOWS.md): một custom archive public/Auth/extensions trong thư mục private ngoài repo, kiểm tra exit code, scope/TOC, SHA256 và decode offline. Giữ các metadata CSV đã xuất cho global roles/hooks; đừng coi selective dump là full-platform backup. Không đưa password/Auth data vào log. REST/CSV public hoặc service API key không thay backup Auth/schema.

Chưa có archive/receipt được xác minh trong trạng thái hiện tại. Việc kết nối API thành công không chứng minh database password dùng được. Nếu password đã lưu đúng trong pgpass có thể dùng; nếu cần reset thì phải được chủ dự án thực hiện/duyệt, không tự reset. Không dựng restore trong giai đoạn này theo quyết định đã có, ghi rõ `restore_tested=false`.

## Checklist web/API sau schema và dữ liệu được duyệt

| Ưu tiên | Test | Điều kiện PASS |
|---|---|---|
| P0 | Login QL/GS/NV, expired token, password-change bắt buộc | Đúng role/branch; không mở quyền bằng sửa employee_id/branch_id; API độc lập chặn sai quyền |
| P0 | TV2 hiển thị đăng ký/kỳ và validation | Kỳ đóng bị chặn; kỳ naturally OPEN nộp thành công, header/rows VALID, không overlap. Hiện không có kỳ OPEN nên case nộp web còn pending; không sửa deadline/kỳ đóng |
| P0 | QL preview từ source thực | Đúng nhu cầu/đăng ký/skills, coverage và cảnh báo; khi đã duyệt positive dev-import dự kiến 308/308, shortage/composition thiếu=0 |
| P0 | Sửa tay, chuyển tab, lưu/mở DRAFT | Hard violations bị chặn, state/revision/reasons/history không mất, reload đọc DB thật |
| P0 | Gửi duyệt, GS từ chối có lý do, QL sửa/trình lại | PENDING/NEEDS_REVISION/version mới đúng; không overwrite quyết định hoặc sửa trực tiếp lịch pending |
| P0 | GS approve, QL publish | Chỉ đúng quyền/version; published assignment ACTIVE; retry không duplicate; không chỉnh trực tiếp lịch công bố |
| P0 | NV xem lịch | Chỉ own ACTIVE trong PUBLISHED hiệu lực; đổi tuần/ngày không ca; bản DRAFT mới không che published cũ |
| P0 | Request/incident, tìm/mời người, accept/decline, QL approve/reject | Consent/expiry/ownership/skills/overlap đúng; không đổi assignment khi mới gửi request hoặc nhận lời mời; lịch hai phía cập nhật, giữ old REPLACED/history |
| P0 | Hai tab và retry/network error | Stale version, double-submit và hai người nhận ca không gây double-write; rollback lỗi không để half-state |
| P1 | AI đánh giá/propose/accept/reject | Đúng revision, không tự apply/save/publish; đề xuất vi phạm hard bị chặn, provider lỗi không mất state. Cần provider thật để nhận là AI đã nghiệm thu |
| P1 | Tài liệu nộp bài | README chạy local, accounts hướng dẫn riêng không plaintext trong repo, kịch bản/ảnh/video và báo cáo test thật |

Kỳ 02–08/11 đã đóng: positive dev-import dùng cho workflow 308. Demo TV2 nộp ở kỳ khác OPEN là case riêng, **không gọi là E2E cùng kỳ**. Nếu chưa có kỳ OPEN, để pending hoặc dùng bài test local đã có minh họa phần validation; không tuyên bố web toàn chuỗi PASS. Timer/n8n/outbound notifications và nghiệp vụ SUPPORT/CREW_LEADER riêng hoãn nếu không thuộc yêu cầu chấm bài đã thống nhất.

## Phần còn vướng

- Cần phê duyệt migration/source writes; không thiếu vòng CSV metadata mới.
- Backup client/version/password kết nối chưa được xác minh, archive chưa có evidence; không yêu cầu Pro/server/restore.
- Provisioner Auth/profile có receipt/idempotency và fresh live import plan vẫn cần chuẩn bị trước tạo dữ liệu. Không dùng checksum rehearsal để apply.
- Website chưa được đăng nhập/kiểm thử E2E; smoke test HTTP và tests local không thay phần này. Không cần viết lại code lõi trước các bước trên.

# Project xác nhận và preflight live — 02/11/2026, Asia/Saigon

**Cập nhật hiệu năng:** xem `performance/README.md`; migration 20261106 bổ sung sau 20261105, không thay đổi dữ liệu shared DB. Kết luận triển khai hiện hành ở readiness.json; nội dung lịch sử bên dưới không thay thế postflight mới.

**Cập nhật tiếp:** scope trong bốn file hoạt động đã được rebind local sang project đích; xem `REBOUND-RESULT.md` và `rebound/` cho test/checksum mới. Phần "chưa sửa" bên dưới ghi nhận thời điểm kiểm tra GET trước rebind. Dùng `CATALOG-EXPORT.md` làm hướng dẫn xuất hiện hành. Không thay artifact lịch sử hoặc cấu hình kết nối.

Project đích do người phụ trách xác nhận: **wlbpprpiieonjrqglicv**. Backend hiện đúng project; `config/supabase.ts` đã loại suffix `/rest/v1/`, không cần đổi URL/key. Báo cáo này thay phần xác định project trong README cũ.

Đã chạy 36 GET đúng project (hai lượt, lượt sau bổ sung trường để so baseline). Không Auth sign-in, gọi RPC, sửa cấu hình hoặc ghi Supabase. Evidence mới nhất: `target-rest-1793588514539.json`; checksum/kết quả trong `readiness.json`. Không xuất password, token, email hoặc Auth metadata; Auth chỉ lưu UUID.

| Kiểm tra live | Kết quả |
|---|---|
| Chi nhánh/kỳ | Đúng UUID Lê Duẩn, ACTIVE; đúng tuần 02–08/11/2026 |
| Nhân viên | 60: NEW 8, REGULAR 33, CREW_TRAINING 12, CREW_LEADER 7 |
| Đăng ký thật | 2 header, 16 lượt; status/provenance/timestamp khớp baseline |
| Nhu cầu | 63 ô, 308 vị trí; toàn bộ 11 trường nhu cầu khớp baseline |
| Profile Lê Duẩn | 62, khớp baseline trên các trường đã thu thập |
| Auth/profile | Toàn project 74 Auth IDs, 74 profile; 60 nhân viên Lê Duẩn có Auth/profile và cùng branch |
| Tài khoản dự kiến | Cả 17 UUID Auth/profile chưa tồn tại, không trùng username không phân biệt hoa thường; chưa kiểm tra email dự kiến/trigger Auth |
| Dữ liệu TV5/lịch | Schedules, assignments, approvals, requests, incidents, invitations đều 0 dòng qua API |
| Phân trang | Count=exact khớp số dòng xuất của 16 bảng/view; 494 đăng ký toàn project, không cắt ở 100 dòng |

Stored status kỳ vẫn PLANNED nhưng close_at đã qua; không coi là OPEN và không sửa deadline/status. Đối chiếu nhân viên gồm ID/user/branch/department/skill/status/max_weekly_hours, không lấy full_name. REST nhiều GET không phải snapshot PostgreSQL nhất quán hoặc baseline checksum đủ cho apply.

OpenAPI có RPC DRAFT/input TV3 cũ. Chưa thấy RPC workflow mới hoặc registry dev-import; schedules expose 10 cột, assignments 10, requests 9, chưa có cột hợp đồng mới. Đây là dấu hiệu chưa triển khai, **không chứng minh function body, ACL hoặc migration history**. Chưa có kết nối PostgreSQL hợp lệ được cung cấp.

## Tham chiếu sai cho luồng dev-import hiện tại

- `backend/src/registrations/dev-import-policy.ts`: project và URL guard.
- `backend/scripts/dev-import-executor.cjs`: SCOPE, direct-host guard và manifest.
- `backend/migrations/20261105_scoped_dev_import.sql`: CHECK project_ref.
- `backend/scripts/collect-live-preflight.cjs`: khóa project wimik; chưa dùng collector này cho project mới.
- `docs/deployment-6.2/README.md`: hướng dẫn project/connection cũ; manifest/checksum/rehearsal/seed plan liên quan cần phát hành lại sau rebind.

Danh sách đầy đủ trong `readiness.json`. Artifact `docs/tv2-test/wimikwyuzhltpjciafod/` và script/test dành riêng project test đó là lịch sử/môi trường riêng, không phải tất cả đều sai. TV2 official đã ghi project wlbp đúng. Không tìm/thay project trên toàn repository.

Phương án tối thiểu: giữ URL/key hiện tại và writer/dev-import tắt; sau catalog review, đồng bộ policy/executor/migration chưa áp dụng/collector và tests sang project đã xác nhận. Giữ sample_batch_id, dữ liệu thật, deadline, timestamp, nhu cầu. Chạy lại rehearsal và phát hành manifest/fingerprint/checksum mới từ nguồn live. Không copy DB, replay foundation, bỏ guard hoặc tái sử dụng checksum rehearsal để apply. Chưa thực hiện các sửa đổi cấu hình/scope này.

## Xuất bằng SQL Editor

1. Mở Dashboard đúng ref **wlbpprpiieonjrqglicv**, chọn SQL Editor **No limit** trước khi chạy.
2. Chạy từng nhóm C1–C10 của `../deployment-6.1/01-catalog-preflight.sql`. Download CSV riêng cho từng SELECT/result. Không gọi writer RPC để thử quyền.
3. Chạy từng SELECT S1–S6 của `sql-editor-complete-catalog.sql`. S1–S4 có total_rows để kiểm tra đủ dòng. Nếu S5 báo có bảng history, chạy SELECT version ghi chú; nếu thiếu, ghi ABSENT, không tạo bảng.
4. Sau khi C1 xác nhận bảng tồn tại, chạy từng SELECT D1–D7 của `../deployment-6.1/02-data-preflight.sql`.
5. Chạy `sql-editor-auth-check.sql` để kiểm tra 17 UUID/username dự kiến; chỉ Auth IDs, không password/hash/token/email/metadata.
6. Chạy ba SELECT đầu (catalog) của `../deployment-6.2/preflight.sql`. Nếu chưa có registry/dev_import_allowed, không chạy phần còn lại tham chiếu chúng; ghi ABSENT.
7. Ghi project ref, thời điểm, số dòng, tên nhóm/query cho từng CSV; giữ nguyên function definition. Không lấy ảnh hoặc 100 dòng hiển thị thay export. Chia sẻ qua kênh được nhóm chấp thuận, không gửi credential trong chat.

Export SQL Editor qua nhiều lượt không cùng snapshot; cần cửa sổ nhóm không ghi và xác minh baseline lại trước triển khai. Khi nhận export mới đối chiếu checksum, owner, ACL, trigger và migration; không suy đoán từ tên RPC/OpenAPI. REST không đủ xác minh FK/CHECK/index/RLS/function body. Không tạo RPC SQL tùy ý để vượt hạn chế.

## NO-GO và các xác nhận trước ghi

NO-GO: dev-import khóa project cũ; thiếu catalog/function/ACL/RLS mới; chưa có backup thật và bằng chứng restore thành công ở DB cô lập; chưa có fresh seed plan đủ điều kiện apply. Chưa migration nào được xác nhận đủ điều kiện triển khai live.

Thứ tự dự kiến có điều kiện: TV4 nền `20261029_tv4_schedule_workflow.sql` nếu thiếu và tương thích → 20261101 → 20261102 → 20261103 → 20261104 → 20261105 đã rebind/test. Không replay migration nền/TV2 hoặc migration đã có. TV5 vẫn cần kiểm tra partial index/FK/khóa dù bảng hiện rỗng.

Cần xác nhận riêng trước: bundle migration/checksum sau catalog review và rebind; backup nhất quán/restore thành công; Auth/profile sau kiểm tra email/trigger; seed theo fresh plan digest; bật dev-import/TV3/TV4/TV5 theo nghiệm thu. AI external đang true trong `.env` local, cần kiểm soát riêng; chưa đổi cờ nào. Chưa backup, migration, Auth creation, seed, ghi DB hoặc commit/push.

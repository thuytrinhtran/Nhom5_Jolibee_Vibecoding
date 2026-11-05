# Metadata bổ sung đã đủ — chờ backup/restore trước migration

Đã đọc **toàn bộ 9 CSV (56)–(64)** từ Downloads, xác minh cột/nội dung đúng 8 SELECT cần thiết. Không chỉ dựa vào số tên file hoặc số dòng. File (62)/(63) trùng **cả bytes/SHA256**. Không sửa/đổi tên CSV. [Inventory](inventory.md) và [audit.json](audit.json) lưu tên gốc, hash, số dòng và kết quả phân tích.

Đối chiếu với 24 CSV trước và rollout PLAN. Project `wlbpprpiieonjrqglicv` theo xác nhận chủ dự án và GET trước đó; bản CSV không tự chứng minh project hoặc cùng thời điểm snapshot. Không có truy vấn Supabase hay thao tác ghi trong lượt review này.

## Kết quả theo nội dung

| CSV / query | Kết quả đã xác minh | Tác động triển khai |
|---|---|---|
| 56 / C3.1 / 95 dòng | 95 constraint đều validated. `shift_assignments_unique` là **contype=u**, đúng `UNIQUE (schedule_id, employee_id, work_date, shift_id)`. Có composite FK assignment→employee/department, Auth→profile, source sample→audit; CHECK/status đúng các trạng thái code dùng | Đủ bằng chứng cho guard UNIQUE của TV5, không còn suy từ index. Không thấy cần sửa schema trước bundle |
| 57 / C6 / 7 dòng | Cả 7 trigger enabled=O; body MD5 khớp function export trước. Audit UPDATE/DELETE bị chặn. Trigger chặn tạo lịch đã duyệt và kiểm tra publish đang gắn | Không thấy trigger lạ gây xung đột. **Chưa có trigger validate_schedule_approval gắn vào approvals**; 20261102 tạo đúng attachment này, phải kiểm tra sau migration |
| 57 / Auth hooks | Query C6 bao gồm non-internal trigger trên auth.users, nhưng không có dòng auth.users trong 7 kết quả | Không thấy custom DB trigger tự tạo profile/employee ở phạm vi kiểm tra này. Không suy ra Auth service hooks/config bên ngoài DB đã được kiểm tra |
| 58 / C7.2 / 96 dòng | Default ACL public của postgres/supabase_admin cấp quyền rộng cho anon/authenticated/service_role trên table/function/sequence. Không thấy grantee custom ngoài các role trong audit | **Cần kiểm tra grants cuối migration**, không coi default ACL là quyền hiện tại. Các REVOKE của M1–M6 xử lý các role này; M5 registry và M6 helper phải private. Không thay default ACL toàn project trong bước này |
| 59 / C8.1 / 26 dòng | 26 bảng public đều RLS=true, FORCE=false, owner postgres | Phù hợp owner/SECURITY DEFINER backend hiện tại; không tự bật FORCE RLS, có thể phá RPC |
| 60 / C8.2 / 22 dòng | Toàn bộ policy là RESTRICTIVE password_change_gate cho authenticated, ALL, dùng jollishift_business_access() cả USING/WITH CHECK; không có policy PERMISSIVE trong export | Các policy này không tự cấp quyền đọc/ghi. Phù hợp kiến trúc đi qua backend; không mở browser policy để làm UI chạy. Theo [PostgreSQL CREATE POLICY](https://www.postgresql.org/docs/16/sql-createpolicy.html), cần permissive policy để cấp truy cập trước khi restrictive thu hẹp |
| 61 / C8.3 / 15 dòng | 5 bảng lịch/assignment/request/incident/invitation: anon và authenticated đều không có SELECT/INSERT/UPDATE/DELETE; service_role có đủ | Không thấy đường browser ghi trực tiếp 5 bảng đã kiểm tra. Backend vẫn phải kiểm tra token, role, branch, owner và không dùng service client để sign-in |
| 62–63 / C9 / 2 dòng mỗi file | Hai view đều security_invoker=true, ACL chỉ postgres/service_role; sourced view giữ sample_batch_id, stored_sample_batch_id và toàn bộ điều kiện legacy audit seed | Tương thích cách M5 bọc nguyên definition hiện tại. Không xóa predicate legacy/field provenance. Service có thể giữ quyền view rộng hơn SELECT do ACL có sẵn/default; không diễn giải GRANT SELECT là đã thu hồi quyền service khác |
| 64 / C10 / 7 dòng | ensure_rls của postgres enabled cho CREATE TABLE/AS/SELECT INTO; 6 hook extensions do supabase_admin quản lý cho extension/schema cache | Không tắt/drop các managed hook. ensure_rls chỉ thêm RLS cho bảng mới, M5 vẫn có ALTER ENABLE RLS rõ ràng; verify grants/RLS sau schema reload |

Không thấy xung đột schema bắt buộc sửa bundle local 20261101–20261106 trong phạm vi metadata đã nhận. Đây **không phải xác nhận đã deploy**, đã restore hoặc grant quyền chạy migration.

## Rủi ro dữ liệu và biện pháp

- `users.id → auth.users.id ON DELETE CASCADE` và `employee_skills.employee_id → employees.id ON DELETE CASCADE` đang có thật. Không dùng xóa Auth/employee để “reset test”; rollback phải kiểm tra ownership/dependencies và giữ account cũ.
- `employees.user_id UNIQUE` và profile UUID FK yêu cầu tạo Auth → profile đúng ID, rồi tạo employee theo manifest. Không thấy custom Auth DB trigger trong C6, nhưng vẫn xác minh kết quả API/hook trước tạo hàng loạt.
- TV5 thay UNIQUE toàn trạng thái bằng partial UNIQUE cho current rows, đồng thời giữ lịch sử A→B→A. Sau phát sinh lịch sử này không thể phục hồi constraint cũ bằng cách xóa history. M4 không tự xóa request cũ hoặc backfill snapshot.
- Default ACL rộng không phải xung đột chưa xử lý tại 5 bảng hiện tại, vì grants đã thu hồi/RLS bật. Nó là rủi ro cho **đối tượng mới**: postflight phải kiểm tra mọi grantee, helper internal không EXECUTE qua anon/authenticated/service_role, public RPC chỉ service_role, registry không có browser/server table access.
- Header CHECK buộc VALID phải có submitted_at; sample_batch_id tham chiếu audit. Executor tạo batch audit rồi import trong transaction, dùng thời gian DB thực và giữ 16 real rows; không mở kỳ đã đóng.
- Metadata/COUNT được thu qua nhiều lượt. Trước ghi cần baseline mới trong cửa sổ không writer/job; không cần xuất lại CSV đầy đủ bây giờ.

## Migration và chốt duyệt

Thứ tự vẫn: **TV4 nền 20261029 nếu thiếu/tương thích → 20261101 → 20261102 → 20261103 → 20261104 → 20261105 → 20261106**. Snapshot thiếu published_by/RPC nền nên prerequisite TV4 vẫn cần trong bundle. Không replay foundation/TV2/TV3 v1.

Các guard function M1 đã PASS từ export trước; constraint TV5, view provenance, RLS/ACL và hooks nay có đủ bằng chứng review. M5/M6 chỉ so guard tương ứng **sau** các predecessor, không so MD5 sau nâng cấp với body v1 hiện tại.

**Gỡ blocker thiếu 8 nhóm metadata. Không yêu cầu chạy lại các SELECT đã đủ.** Migration history và version có thể được thu trong bước backup, không phải lý do yêu cầu thêm một vòng CSV. Nếu snapshot mới khác evidence đã review thì dừng đối chiếu.

**NO-GO cho migration/ghi nguồn hiện tại** vì chưa có backup thật và bằng chứng restore thành công. Đã đủ điều kiện chuẩn bị bước backup/restore cụ thể tại [BACKUP-RESTORE.md](BACKUP-RESTORE.md). Chưa có phê duyệt thực thi bước đó; restore luôn ghi vào đích cô lập và phải được duyệt. Sau restore cần rehearsal bundle trên bản dữ liệu khôi phục để xác nhận default ACL/hooks thực tế, rồi mới duyệt migration vào nguồn.

Blocker các bước sau vẫn là provisioning Auth/profile có receipt/idempotency, fresh live seed plan/digest và nghiệm thu web/API. Chúng không bắt buộc phải hoàn thành trước migration. Code backend/frontend không được sửa trong lượt này.

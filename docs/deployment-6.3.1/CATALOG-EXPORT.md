# Xuất catalog mới — project wlbpprpiieonjrqglicv

Chỉ SELECT; không gọi RPC nghiệp vụ, migration hoặc chức năng thay đổi dữ liệu. Không cần gửi credential.

1. Mở SQL Editor trong Dashboard đúng project ref **wlbpprpiieonjrqglicv**. Chọn **No limit**. Kiểm tra ref trên URL Dashboard; `current_database() = postgres` không chứng minh đúng project.
2. Chạy từng SELECT của [01-catalog-preflight.sql](../deployment-6.1/01-catalog-preflight.sql), nhóm C1–C10. Xuất CSV riêng từng kết quả, ví dụ `C3-constraints.csv`, `C3-indexes.csv`, `C4-functions.csv`, `C7-execute.csv`. Nếu chạy trọn transaction READ ONLY, vẫn phải xuất tất cả result, không chỉ result cuối.
3. Chạy S1–S6 trong [sql-editor-complete-catalog.sql](sql-editor-complete-catalog.sql), xuất riêng từng SELECT. S1–S4 có `total_rows`: số dòng CSV phải bằng giá trị này. S2 phải giữ nguyên toàn bộ `definition` và checksum, không dùng ảnh. S5: nếu history tồn tại, chạy riêng SELECT version được chú thích; nếu không, ghi ABSENT, không tạo bảng.
4. Khi C1 xác nhận bảng có đủ, chạy từng SELECT D1–D7 của [02-data-preflight.sql](../deployment-6.1/02-data-preflight.sql); xuất từng result, kể cả kết quả rỗng (ghi tên query và 0 dòng).
5. Chạy [sql-editor-auth-check.sql](sql-editor-auth-check.sql). Chỉ đối chiếu UUID/username/binding; không xuất password/hash/token, email hoặc Auth metadata.
6. Chạy **ba SELECT đầu** của [preflight 6.2](../deployment-6.2/preflight.sql). Nếu registry hoặc cột dev_import_allowed chưa tồn tại, ghi ABSENT và bỏ các SELECT còn lại tham chiếu chúng. Không chạy migration để làm query thành công.

Đặt các CSV cùng file ghi chú project ref, thời gian Asia/Saigon, tên query, số dòng, query lỗi/thiếu quyền và các đối tượng ABSENT. Gửi toàn bộ qua kênh nhóm cho phép. Không copy riêng 100 dòng preview. Nếu UI vẫn cắt kết quả, báo số dòng kỳ vọng/thực xuất; không coi catalog đó đầy đủ.

Nhóm cần nghiệm thu từ export: function body/normalized MD5/owner/search_path; FK/CHECK/UNIQUE/partial index; trigger và attachment; RLS/policies/table grants/effective EXECUTE; migration history; TV5 duplicate/open request/snapshot/publication inconsistencies. Chưa có export thì các mục này vẫn NOT VERIFIED. Nhiều lượt SQL Editor không tạo cùng snapshot: phải kiểm tra lại nguồn trong cửa sổ nhóm không ghi trước deployment.

Backup/restore: cần backup nhất quán từ project thật được người phụ trách quản lý, checksum và log restore **thành công** ở môi trường cô lập với owner/ACL/RLS/functions/triggers/Auth bindings phù hợp. REST export, fixture rehearsal và `pg_restore --list` không thay bằng chứng restore. Chưa đủ bằng chứng thì NO-GO; không tự thay đổi cấu hình backup project.

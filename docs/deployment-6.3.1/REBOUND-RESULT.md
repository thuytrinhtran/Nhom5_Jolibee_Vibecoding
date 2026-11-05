# Rebind local sang wlbpprpiieonjrqglicv

**Kết quả hiệu năng đã được cập nhật:** xem [performance/README.md](performance/README.md). Migration local 20261106 xử lý N+1 nguồn; bản lỗi ở dưới được giữ làm lịch sử. Readiness mới là nguồn kết luận hiện hành.

Đã đổi project trong đúng bốn file hoạt động: `dev-import-policy.ts`, `dev-import-executor.cjs`, migration `20261105_scoped_dev_import.sql` chưa áp dụng và `collect-live-preflight.cjs`. Không đổi `.env`/URL/key, batch/branch/period/UUID, quy tắc xếp lịch hoặc ngưỡng thời gian SQL. Không sửa artifact lịch sử 6.2 hay project TV2 riêng.

Test bổ sung khóa project đích, từ chối project cũ và batch lạ; kiểm tra policy/executor/SQL CHECK/collector cùng project. Fixture test lưu kết quả mới tại `rebound/`, không ghi đè 6.2. UUID có thể giữ nguyên vì vẫn là cùng kịch bản; plan SHA256 và bundle được tạo mới, không dùng checksum cũ làm quyền triển khai.

## Kết quả và giới hạn

Backend/frontend test thường, typecheck và build đã PASS. Native rehearsal đầu tiên và lần chạy riêng đều dừng với `DRAFT_SAVE_BUDGET_EXCEEDED` (SQLSTATE 57014) tại RPC persist DRAFT. Không tăng hoặc vô hiệu hóa budget 3 giây. Các bước chạy trước điểm lỗi đã kiểm chứng seed idempotent trên DB cô lập, ordinary input 16 rows, approved context 607 rows, TS/SQL source parity, receipt failure rollback và engine 308/308.

Kết quả lần chạy có checkpoint được lưu ở `rebound/local-rehearsal.json`: phải đọc `full_rehearsal_pass` và `failure`, không suy PASS toàn lifecycle từ số phân công 308. `uuid-manifest.json` là plan synthetic cho cluster cô lập, không phải fresh seed plan được phép apply vào Supabase. Bundle checksum bao gồm file/code/evidence mới. Các phép rollback ownership sau điểm RPC lỗi và workflow/TV5 chưa được nghiệm thu lại nếu full_rehearsal_pass=false.

Đây là blocker hiệu năng local có thể tái hiện; chưa đủ dữ liệu để quy nguyên nhân cho Supabase. Cần đo đường SQL source/receipt/manifest và persist trong môi trường cô lập, tối ưu mà vẫn giữ toàn bộ kiểm tra và budget; không coi việc đổi project là đã xử lý hiệu năng. Không chỉnh migration 20261101 hoặc bỏ guard trong bước rebind này.

## NO-GO

- Native lifecycle chưa PASS ổn định với contract mới.
- Chưa nhận catalog mới để kiểm tra RPC body/checksum, FK/CHECK/UNIQUE/partial indexes, trigger, RLS, effective EXECUTE và migration history; OpenAPI không thay thế catalog.
- Chưa có backup thật và log restore thành công ở môi trường cô lập. Fixture rehearsal không phải restore backup thật.
- Chưa có fresh live seed plan, kiểm tra email/Auth trigger và phê duyệt tài khoản.

Người phụ trách cần thực hiện thủ công hướng dẫn [CATALOG-EXPORT.md](CATALOG-EXPORT.md), gửi đủ CSV và bằng chứng backup/restore qua kênh nhóm cho phép. Không gửi password/token vào chat. Giữ writer/dev-import/persistence tắt; chưa chạy migration/Auth/seed hoặc commit/push. Thứ tự migration dự kiến vẫn TV4 nền nếu thiếu → 20261101 → 20261102 → 20261103 → 20261104 → 20261105; chưa file nào được cho phép áp dụng live.

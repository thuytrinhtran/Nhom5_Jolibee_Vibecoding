# Backend local đã bật lưu DRAFT

Ngày 03/11/2026, theo xác nhận chủ dự án. Không chạy lại import/preflight import; không tạo lịch, Auth hoặc sửa đăng ký/nhu cầu.

## Cấu hình thực tế

Trong `backend/.env` (không đổi URL/key):

```ini
NODE_ENV=development
SCHEDULING_DATA_SOURCE=supabase
TV3_DRAFT_PERSISTENCE_ENABLED=true
TV3_TEST_PREVIEW_ENABLED=false
DEV_IMPORT_ENABLED=true
DEV_IMPORT_PROJECT_REF=wlbpprpiieonjrqglicv
DEV_IMPORT_BATCH_ID=6e1d2026-1102-4000-8000-000000000017
TV3_WRITE_SCOPE_ENABLED=true
TV3_WRITE_PROJECT_REF=wlbpprpiieonjrqglicv
TV3_WRITE_BRANCH_ID=11111111-1111-1111-1111-111111111111
TV3_WRITE_PERIOD_ID=79a979cc-8347-48b5-a411-f03bd8aceb92
TV4_WORKFLOW_PERSISTENCE_ENABLED=false
TV5_PERSISTENCE_ENABLED=false
```

DEV_IMPORT_ENABLED ở đây chỉ bật đọc nguồn batch đã import, không chạy executor hoặc thêm đăng ký. Không bật test-preview. Bước này bật TV3 lưu/chỉnh DRAFT; workflow phê duyệt/công bố và đổi ca vẫn tắt.

Thêm guard backend `draft-write-scope.ts`, gọi ở cả `persistPreview` và legacy `createDraft` trước mọi truy cập lưu lịch. Chỉ nhận đúng project/branch/period được xác nhận; project URL phải khớp. Branch lấy từ tài khoản đã xác thực. Backend hiện nguyên kiểm tra quyền/branch, VALID, hard constraints, version, input revision và idempotency. Preview ngoài scope nhận persistence.enabled=false. Guard opt-in, không đổi hành vi cài đặt không bật scope.

## Trạng thái chạy và kiểm tra

- Backend đã khởi động bằng `node dist/server.js`, `http://localhost:5000`; frontend Vite `http://localhost:5173`.
- GET health 200, db-health 200/connected, frontend 200. Module frontend được Vite phục vụ dùng `http://localhost:5000/api`, nguồn backend supabase; không dùng mock.
- API schedules không token trả 401; router vẫn bắt role QL. Kiểm tra SELECT tìm được 1 tài khoản QL active, đúng chi nhánh, liên kết Auth tồn tại và không bắt đổi mật khẩu. Service role có EXECUTE RPC lưu DRAFT; authenticated không có EXECUTE trực tiếp. Chưa thử HTTP bằng token phiên trình duyệt của người dùng, chưa gửi yêu cầu lưu thử.
- Runtime policy đọc đúng các flags: draft=true, context batch=true, đúng scope=true, kỳ khác=false, workflow=false, replacement=false, test-preview=false.
- Backend build và typecheck PASS; regression chọn lọc 10 PASS/1 SKIP (PostgreSQL cô lập không chạy). Hai lần chạy đầu chịu ảnh hưởng .env local đã bật; lần cuối cô lập cờ trong process test, PASS. Runtime backend không nhận các override dùng cho test.
- Lượt kiểm tra quyền PostgreSQL đầu gặp DNS ENOTFOUND; lần kiểm tra chỉ đọc tiếp theo PASS. API Supabase thật db-health vẫn PASS.

## Thao tác trên web

1. Mở `http://localhost:5173/manager/schedule`, dùng tài khoản Quản lý Lê Duẩn. Tải lại trang sau khi backend khởi động; nếu hết phiên thì đăng nhập lại.
2. Trong **Lập lịch làm việc**, chọn tuần **02–08/11/2026**.
3. Bấm **Tạo lịch dự kiến**. Đây là preview từ dữ liệu Supabase hiện có, chưa lưu lịch.
4. Xem coverage, thiếu người/kinh nghiệm, giờ và lý do. Nếu sửa nhân viên, bấm **Kiểm tra lại phương án**.
5. Bấm **Lưu bản nháp**. Sau khi API xác nhận, tải lại tuần để kiểm tra DRAFT mở lại được.

Không bấm nút test-preview; không cần nhập lại nhu cầu hoặc import. Người vận hành tự bấm tạo/lưu; trong bước cấu hình này không chạy Rule Engine trên nguồn Supabase, không gọi RPC ghi lịch, không phê duyệt/công bố. Có test Rule Engine trên fixture giả trong regression local.

Các file chính: `backend/.env`, `backend/src/services/draft-write-scope.ts`, `draft-persistence.service.ts`, `scheduling.service.ts`, `schedule-preview.service.ts`, `backend/tests/draft-write-scope.test.cjs`. Không migration, commit/push hoặc thay đổi frontend.

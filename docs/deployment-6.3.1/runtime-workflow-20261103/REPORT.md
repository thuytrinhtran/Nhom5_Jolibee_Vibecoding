# Workflow thực tế: sẵn sàng thao tác trên web

Hoàn thiện ngày 03/11/2026 cho project `wlbpprpiieonjrqglicv`, Lê Duẩn, kỳ 02–08/11/2026. Không migration/import/Auth creation; không sửa đăng ký hoặc nhu cầu; không commit/push.

## Nguyên nhân và thay đổi

- Frontend/backend đã có submit/decision/publish và API lịch cá nhân. Nút gửi duyệt ở cuối trang, dưới toàn bộ bảng lịch; TV4 persistence vẫn tắt từ bước trước. Nút gửi chỉ sẵn sàng sau khi quản lý kiểm tra/chuẩn bị bàn giao.
- Đưa component ScheduleReviewPanel hiện có lên ngay dưới thanh chọn tuần, trước thống kê đăng ký/bảng lịch. Tiêu đề **Gửi lịch phê duyệt**; hướng dẫn rõ thứ tự chuẩn bị rồi gửi. Trước khi chuẩn bị không hiển thị thông báo nhầm rằng API chưa kết nối. Chỉ hiển thị panel gửi với DRAFT đã lưu, không với preview chưa lưu.
- Sau khi gửi, trang lập lịch thể hiện PENDING_APPROVAL và chưa công bố. Có liên kết sang trang công bố cho APPROVED/PUBLISHED/NEEDS_REVISION; luồng chỉnh sửa và lưu phiên bản mới khi bị từ chối giữ nguyên.
- `backend/.env`: bật `TV4_WORKFLOW_PERSISTENCE_ENABLED=true`. TV3 DRAFT/dev-import đúng batch tiếp tục bật; TV3 test-preview tắt; TV5 vẫn tắt. Không đổi URL/key.
- Mở rộng guard phạm vi hiện có cho workflow: backend đọc period_id/branch_id từ schedule trong DB trước RPC ghi; chỉ nhận Lê Duẩn/kỳ đã cho phép. Không tin scope frontend. SQL vẫn kiểm tra role, supervisor phụ trách, trạng thái, version, hard constraints và audit nguyên tử. Quyền thao tác hiển thị theo scope từng lịch.
- Backend khởi động lại với build mới; frontend Vite đang chạy, nhận thay đổi source. Các trang/health/db-health HTTP 200. Module workflow frontend đang gọi `http://localhost:5000/api`, không fallback mock.

## Xác minh chỉ đọc trên Supabase

- DRAFT v1: `969c3446-9357-40ef-a40e-1296cca573b8`, **308 phân công trạng thái DRAFT**. Không được nhầm phân công DRAFT với ACTIVE: chỉ công bố mới chuyển thành ACTIVE.
- Kiểm tra bàn giao thực tế: configured=true, can_submit=true, hard_constraints=PASS, coverage_complete=true, issues rỗng.
- Giám sát phụ trách chi nhánh: `gs_jollibee`, active, có Auth, không bắt đổi mật khẩu.
- Hai tài khoản `nv_jollibee`, `nv_jollibee_02`: active, có Auth và employee ACTIVE, không bắt đổi mật khẩu; **mỗi người 5 ca trong DRAFT**. Tài khoản `js_ld_003` cũng sẵn có và có 4 ca. Không tạo tài khoản mới, không đọc/in password/email/token.
- Không có quyền truy cập phiên đăng nhập trình duyệt để xác định người dùng đang chọn tài khoản nào; thông tin trên đối chiếu theo username có sẵn. Nếu người dùng đăng nhập bằng một trong hai tài khoản nv_jollibee thì đã có ca để nghiệm thu sau công bố.
- Gọi SELECT employee_schedule_week cho hai tài khoản nv_jollibee/nv_jollibee_02: 0 lịch công bố, 0 ca hiển thị. Các ca DRAFT chưa lộ ra lịch chính thức.
- Quy tắc employee RPC: actor từ token backend, liên kết users→employees, đúng branch; chỉ phiên bản PUBLISHED có published_at, phân công ACTIVE của chính employee; không nhận employee_id/branch_id từ browser.
- Quy tắc transition SQL: DRAFT→PENDING_APPROVAL; GS quyết định APPROVED hoặc NEEDS_REVISION; riêng QL mới PUBLISH từ APPROVED có quyết định duyệt. Duyệt không tự công bố. Từ chối bắt buộc lý do; bản bị từ chối sửa/lưu DRAFT phiên bản mới trước khi gửi lại.
- Chỉ đọc dữ liệu và chuẩn bị handoff/validation; **không gọi transition RPC**, không tự gửi duyệt/duyệt/công bố. Chưa nghiệm thu HTTP bằng token phiên trình duyệt thật hoặc vòng đời ghi đầy đủ: chủ dự án sẽ tự thực hiện.

## Cách kiểm thử theo vai trò

1. Quản lý: `http://localhost:5173/manager/schedule`, tải lại trang, chọn 02–08/11/2026. Ngay dưới thanh chọn tuần có **Gửi lịch phê duyệt**. Bấm **Chuẩn bị dữ liệu gửi phê duyệt** → xem kiểm tra → **Gửi Giám sát khu vực phê duyệt** → xác nhận. Trạng thái phải thành PENDING_APPROVAL, không chỉnh sửa trực tiếp được.
2. Giám sát `gs_jollibee`: `http://localhost:5173/supervisor/approvals`, **Làm mới**, mở thẻ Lê Duẩn v1 để xem phân công/coverage/kinh nghiệm → **Phê duyệt** → xác nhận. Hoặc nhập lý do rồi **Từ chối**. Sau duyệt chỉ là APPROVED; lịch nhân viên vẫn chưa hiện.
3. Quản lý: `http://localhost:5173/manager/publish`, **Làm mới**, mở lịch APPROVED → nhập **Thời hạn phản hồi** trong tương lai → **Công bố lịch** → xác nhận. Backend không cho công bố DRAFT/PENDING hoặc chưa có quyết định duyệt.
4. Nhân viên `nv_jollibee` hoặc `nv_jollibee_02`: `http://localhost:5173/employee/schedule`, chọn tuần 02–08/11/2026 nếu đang ở tuần khác, bấm **Tải lại**. Trước công bố: chưa có lịch công bố; sau công bố: chỉ ca của người đăng nhập (dự kiến 5 ca nếu không thay đổi phân công). Không dùng trang lịch quản lý để đánh giá quyền xem của nhân viên.

Nên đăng xuất rồi đổi vai trò hoặc dùng cửa sổ trình duyệt riêng; không dùng chung token giữa các tài khoản. Không cần tạo lại lịch/import. Ghi nhớ mật khẩu tài khoản đã có; không tự reset mật khẩu hoặc tạo tài khoản thay thế.

## Kiểm thử local

- Backend typecheck/build PASS; regression **12 PASS, 2 SKIP**. Bao gồm quyền/identity, workflow version/idempotency, rejection, publication, employee read và guard phạm vi mới. Hai SKIP cần PostgreSQL cô lập, không chạy trên Supabase.
- Frontend typecheck/build PASS; regression **18 PASS**, gồm handoff, xác nhận trước gửi, retry giữ request ID, queue API thật/không mock fallback, employee PUBLISHED view, loading/network/expired session và đổi tuần.
- Các lần đầu kiểm tra catalog gặp DNS ENOTFOUND và một lỗi cú pháp BEGIN READ ONLY; đã sửa/lặp truy vấn chỉ đọc thành công, không có DDL/DML.
- Bằng chứng: `read-only-state.json`, `read-only-handoff-check.json`. Các file này không chứa password/API key/token/email.

## File thay đổi trong bước này

`backend/.env`; `backend/src/services/schedule-workflow.service.ts`; `backend/src/routes/schedule-workflow.routes.ts`; `backend/src/services/schedule-review.service.ts`; `backend/tests/workflow-v2.test.cjs`; `frontend/src/pages/manager/ManagerSchedule.tsx`; `frontend/src/pages/manager/ScheduleReviewPanel.tsx`; `frontend/tests/schedule-review.test.cjs`; báo cáo/readiness local.

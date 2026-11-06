# Sửa luồng gửi phê duyệt TV3–TV4

Ngày báo cáo: 06/11/2026 (Asia/Saigon). Workspace: `C:\Users\admin\Downloads\Nhom5_Jolibee_Vibecoding`. Nhánh: `feature/tri-auto-scheduling`.

Đã sửa mã local và kiểm thử. Chưa gửi lịch DRAFT phiên bản 5 lên Supabase. Các con số 30 vị trí thiếu, 17 ca cần chú ý, 19 vị trí thiếu kinh nghiệm là hiện trạng do người dùng cung cấp; màn hình xác nhận lấy số liệu kiểm tra mới từ API, không hard-code các con số này.

## Lỗi gốc và luồng request

1. `ScheduleWorkflow.tsx` dùng `<a href="/manager/schedule?period_id=...">` cho nút “Mở bản nháp và gửi phê duyệt”. Không có handler gọi API gửi duyệt. Trang đích còn mặc định tab “Phân công nhân viên”, trong khi `ScheduleReviewPanel` nằm ở tab “Tạo lịch”; điều hướng không tự mở bước gửi.
2. `schedule-review.service.ts` đưa `STAFFING_SHORTAGE` vào `issues` và buộc `coverage_complete` để `can_submit=true`. `schedule-workflow.service.ts` cũng buộc đủ coverage để `ready=true`. Engine kiểm tra tay từ chối phân công vượt số người cần. Trong PostgreSQL, `tv4_assert_schedule_v2` đòi số người đúng bằng nhu cầu; allocator và `tv3_result_v2` chặn dư người. Các lớp này chưa thống nhất với chính sách warning.
3. `schedulingService.submitApproval` dùng bộ đọc phản hồi TV3, đòi `{status:'ok'}`. RPC TV4 trả `{schedule,reused}`. Vì vậy một lần ghi hợp lệ có thể bị frontend báo phản hồi không hợp lệ. Đã dùng đúng envelope và xác minh ID, phiên bản, `PENDING_APPROVAL`, cùng cờ `reused` trước khi báo thành công.
4. Trang schedule trước đây đợi context rồi mới đọc DRAFT, với timeout từng request mặc định 60 giây và không có thời hạn tổng cho trạng thái loading. Một nguồn đọc chậm khiến cả bước chờ lâu; lỗi DRAFT không được biết cho tới khi context xong. Đã tải hai nguồn đồng thời và đặt giới hạn UI 20 giây cho danh sách tuần và dữ liệu tuần/DRAFT, kết thúc loading với lỗi và cho tải lại.
5. Test tái hiện lỗi tải lại đúng tuần: effect danh sách xóa context/saved, nhưng effect đọc tuần chỉ phụ thuộc ID tuần và loading. Nếu API trả nhanh và React gộp cập nhật state, các giá trị này có thể không đổi nên không đọc lại dữ liệu. Đã thêm dependency `reload` và phạm vi tài khoản/chi nhánh; test xác nhận retry thật và bỏ phản hồi cũ.

Không đo latency trên Supabase chung hoặc tái hiện bằng phiên đăng nhập QL thật. Chưa thể quy một truy vấn cloud cụ thể là nguyên nhân chậm. Test cô lập đã tái hiện lỗi retry cùng tuần và nguồn đọc bị treo.

Luồng sau sửa, ngay trên `/manager/publish`:

```text
GET /api/schedules/workflow?view=publishable
→ mở chi tiết DRAFT mới nhất
→ bấm “Mở bản nháp và gửi phê duyệt” (giữ nguyên trang)
→ GET /api/schedules/:id
→ xác minh ID / version / branch / period / group / DRAFT
→ POST /api/schedules/:id/approval-handoff {expected_version,note}
→ inspectSchedule: đọc lịch + nguồn hiện tại + phiên bản; tính lỗi và warning
→ hiển thị tổng thiếu/dư/thiếu kinh nghiệm và lý do chưa được ghi nếu có
→ QL bấm gửi và xác nhận rõ phiên bản, cảnh báo, việc khóa chỉnh sửa
→ POST /api/schedules/workflow/:id/submit {expected_version,note,request_id}
→ authenticate / requireRole / requireWorkflowWrites / write scope
→ RPC tv4_transition_schedule_v2(..., p_action='SUBMIT', ...)
→ xác minh phản hồi thật → PENDING_APPROVAL → tải lại hàng chờ
```

Nút “Kiểm tra lịch” vẫn gọi `POST /api/schedules/:id/validate` với `expected_version`. GS dùng `GET /api/schedules/workflow/:id/review` để đọc kiểm tra, và `POST .../:id/decision` → cùng RPC với `APPROVED` hoặc `NEEDS_REVISION`. Không thêm API ghi trực tiếp hoặc đường tắt qua RPC. Không tự gửi khi mở DRAFT hay chuẩn bị handoff.

Request gửi giữ nguyên `request_id` khi retry cùng nội dung. Danh sách không tự refresh/unmount bước xác nhận trong lúc kiểm tra hoặc gửi. GET có AbortSignal riêng không dùng chung request đang bị hủy bởi effect khác.

## Chính sách và migration

`STAFFING_SHORTAGE`, `STAFFING_EXCESS`, `EXPERIENCE_SHORTAGE` là warning. `coverage_complete` vẫn được trả về như thông tin định biên; không còn là điều kiện bắt buộc để gửi hoặc duyệt.

Giữ các kiểm tra bắt buộc: xác thực/vai trò, chi nhánh, nguồn thực, kỳ đóng, metadata, phiên bản mới nhất và DRAFT, CAS, snapshot khi lưu, input thay đổi, request fingerprint/replay, workflow status, nhân viên hợp lệ, đăng ký VALID, bộ phận, kỹ năng bắt buộc, ca hợp lệ, trùng phân công, trùng thời gian và giới hạn giờ. Audit/snapshot gốc không bị sửa bởi gửi/duyệt/công bố.

Đã soát các migration TV3/TV4 từ `20261031_tv3_schedule_draft.sql`, `20261101_tv3_rule_contract_v2.sql`, `20261102_tv4_workflow_v2.sql`, và chuẩn bị migration cộng thêm `backend/migrations/20261107_tv3_tv4_staffing_warnings.sql`. Migration mới chỉ sửa các đoạn chặn số lượng và thêm warning dư người trong ba function: `persist_schedule_draft`, `tv3_result_v2`, `tv4_assert_schedule_v2`. Không sửa migration lịch sử, data, grant, flag hoặc hàm chuyển trạng thái. Migration kiểm tra mẫu function trước khi thay và rollback nếu khác bản đã duyệt; chuẩn hóa CRLF/LF trước khi so khớp. Chỉ chạy trong database PGlite dùng một lần phục vụ test; chưa chạy trên Supabase chung.

## Cấu hình và điều kiện để gửi thật

- File `backend/.env` đang có `NODE_ENV=development`, không khai báo `TV4_WORKFLOW_PERSISTENCE_ENABLED`. Theo mã hiện tại, workflow chỉ cho ghi khi cờ bằng chính xác `true`; thiếu cờ trả `WORKFLOW_PERSISTENCE_DISABLED`. Không sửa `.env` hoặc tự bật cờ.
- Các khóa `TV3_WRITE_SCOPE_ENABLED`, `TV3_WRITE_SCOPE_MODE`, project/branch/period không được khai báo trong file `.env` đã kiểm tra. Chính sách hiện có cho phép phạm vi thông thường khi không bật restriction; không đổi mặc định này. Nếu launcher/runtime bật scope, vẫn phải khớp project, môi trường, chi nhánh và kỳ theo `draft-write-scope.ts`. Chế độ `manual-test`/`integration-test` vẫn bắt buộc scope; không thể vô hiệu bằng cách đặt flag false.
- Cấu hình môi trường runtime có thể do shell/launcher cung cấp. Handoff/review giờ trả lý do dựa trên chính cấu hình runtime: cờ workflow tắt, test preview chỉ đọc, nguồn mock, hoặc ngoài write scope. UI hiển thị lý do đó; lỗi gửi từ API/RPC vẫn được hiển thị nguyên thông điệp an toàn.
- Người vận hành cần nghiệm thu và triển khai RPC/migration đúng chính sách warning, sau đó cho phép workflow ở Backend thật. Cần tài khoản QL đúng chi nhánh, kỳ đăng ký đã đóng, DRAFT mới nhất vẫn hợp lệ và nằm trong write scope runtime. Nếu RPC còn chính sách cũ, nó vẫn từ chối; ứng dụng không giả thành công hoặc bỏ qua RPC.
- Chưa xác minh deployment/ACL của RPC trên Supabase chung, chưa xác nhận phiên đăng nhập QL thật hoặc trạng thái DRAFT 5 hiện tại. Không thể khẳng định đã đủ điều kiện ghi thực tế chỉ từ test local.

## File đã sửa / tạo

Mã Backend:

- `backend/src/services/schedule-review.service.ts`: tách warning, điều kiện can_submit, lý do cấu hình; bỏ lượt generate dư trước review (review vẫn kiểm tra đầu vào).
- `backend/src/services/scheduling.engine.ts`: cảnh báo dư người, giữ các ràng buộc phân công.
- `backend/src/services/schedule-workflow.service.ts`: readiness không chặn warning, trả blocker rõ ràng.
- `backend/src/services/workflow-write-policy.ts` (mới): giải thích các gate ghi, dùng chung cho handoff/review.
- `backend/src/services/scheduling.service.ts`: ánh xạ lỗi nghiệp vụ RPC bằng allowlist, không lộ chi tiết nội bộ.
- `backend/migrations/20261107_tv3_tv4_staffing_warnings.sql` (mới): bản sửa SQL local để nghiệm thu.

Mã Frontend:

- `frontend/src/pages/schedules/ScheduleWorkflow.tsx`: mở review inline, khóa refresh khi đang gửi, hiển thị blocker.
- `frontend/src/pages/schedules/PublishDraftReview.tsx` (mới): đọc đúng DRAFT, timeout, retry và kiểm tra metadata.
- `frontend/src/pages/manager/ScheduleReviewPanel.tsx`: xác nhận phiên bản/cảnh báo, tổng thiếu/dư/kinh nghiệm, trạng thái busy/sent.
- `frontend/src/pages/manager/ManagerSchedule.tsx`: đọc đồng thời, timeout, hủy/bỏ phản hồi cũ, sửa retry cùng tuần.
- `frontend/src/services/scheduling.service.ts`: envelope TV4, kiểm tra phản hồi và AbortSignal đọc riêng.
- `frontend/src/types/scheduling.ts`, `frontend/src/pages/schedules/scheduleWorkflow.types.ts`: metadata/blocker tương ứng.

Test Backend:

- Mới: `staffing-workflow-policy.test.cjs`, `staffing-workflow-sql.test.cjs`.
- Cập nhật trong `backend/tests/`: `tv3-handoff.test.cjs`, `tv3-journey.test.cjs`, `schedule-ai.test.cjs`, `schedule-preview.test.cjs`, `scheduling-business-scenarios.test.cjs`, `scheduling-confirmed-rules.test.cjs`, `planner-preview-candidates.test.cjs`, `workflow-v2-lifecycle.test.cjs`.
- Sửa dấu merge conflict có sẵn và đồng bộ fixture đọc hiện tại: `registration-summary.test.cjs`, `scheduling-read-api.test.cjs`. Những file backup có sẵn không thay đổi.

Test Frontend:

- Mới: `frontend/tests/publish-draft-review.test.cjs`.
- Cập nhật: `frontend/tests/schedule-review.test.cjs`, `frontend/tests/scheduling.test.cjs`, `frontend/tests/schedule-workflow-mock.test.cjs`, `frontend/tests/critical-flow-regressions.test.cjs`.

Tài liệu: file báo cáo này. Các file untracked tồn tại trước phiên làm việc, bao gồm `.worktrees/`, migration/backup/báo cáo TV3 cũ, không bị xóa hoặc ghi đè.

## Kết quả kiểm tra cuối

| Kiểm tra | Kết quả |
| --- | --- |
| Backend `npm.cmd run build` (nằm trong `npm.cmd test`) | PASS |
| Backend toàn bộ `npm.cmd test` | PASS: 309, FAIL: 0, SKIP: 11 (tổng 320) |
| Frontend `npm.cmd run build` | PASS: TypeScript + Vite production build |
| Frontend toàn bộ `npm.cmd test` | PASS: 263, FAIL: 0, SKIP: 0 |
| `git diff --check` | PASS |

Backend chạy với URL loopback/credential fixture và `REGISTRATION_PGLITE_PATH` trỏ package test có sẵn trong TEMP. Flag writer dùng trong tiến trình test cô lập không thay đổi Backend đang chạy hoặc file cấu hình. Không cung cấp URL database dùng chung cho các test native.

Test mới phủ thiếu/đủ/dư người kèm thiếu kinh nghiệm, can_submit/ready, boundary service→RPC, cấu hình tắt/scope/mock/preview, lỗi RPC, tải DRAFT lỗi/timeout/đổi version/đổi scope, retry, xác nhận trước gửi, request ID không đổi khi retry, envelope sai và response không hợp lệ. Test PostgreSQL/PGlite thực thi allocator/RPC thật trên schema dùng một lần, kiểm tra snapshot lệch, trùng phân công, sai bộ phận, đăng ký mất hiệu lực, sai quyền/phiên bản, receipt replay, snapshot audit bất biến, ACL và toàn bộ gửi→duyệt→công bố cho ba mức định biên.

11 test SKIP là những suite cần PostgreSQL native/multi-session/PostgREST hoặc database kiểm thử ngoài chưa được cấu hình. PGlite không chứng minh cạnh tranh nhiều session hoặc deployment thật trên cloud. Không chạy kiểm thử bằng trình duyệt/phiên đăng nhập thật. Lượt build/test Frontend cuối chạy ngoài sandbox sau khi esbuild bị hạn chế đọc thư mục cha ở lượt đầu; không thay cấu hình dự án để né lỗi này.

Không commit, push, deploy, chạy migration thật hoặc thay đổi dữ liệu Supabase chung.

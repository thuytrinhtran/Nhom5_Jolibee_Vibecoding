# TV3 — Hoàn thiện Mock Mode và chuẩn bị bàn giao TV4

## Sửa đúng nguyên nhân khóa nút

Code trước chỉ cho tạo/chỉnh lịch khi `SCHEDULING_MOCK_SCENARIO=tv3-flow`; mock mặc định `summary` bị khóa. Đã bỏ điều kiện khóa theo kịch bản ở backend và frontend. **Mọi Mock Mode hợp lệ trong development đều tạo/chỉnh được DRAFT trong bộ nhớ**, từ đúng đăng ký VALID và nhu cầu hiện tại của repository.

Không tự đổi dữ liệu `summary` sang bộ tám người `tv3-flow`. Kho lịch được tách theo chi nhánh, đợt và kịch bản; đổi kịch bản không đọc nhầm lịch hoặc dùng nhầm nhu cầu. Không dùng bảng phân công cố định hoặc fallback Supabase → mock.

## Chạy và kiểm thử bằng giao diện

Giữ nguyên kịch bản mock bạn đang dùng. Nếu backend chưa được nạp code mới, dừng backend cũ rồi chạy trong terminal backend:

```powershell
cd backend
$env:NODE_ENV = 'development'
$env:SCHEDULING_DATA_SOURCE = 'mock'
npm.cmd run dev
```

Không cần đặt `tv3-flow` để mở khóa. Nếu biến `SCHEDULING_MOCK_SCENARIO` đang có giá trị hợp lệ, kịch bản đó được giữ; nếu chưa có thì dùng `summary`. Lệnh `npm.cmd run dev:tv3-test` vẫn là lựa chọn rõ ràng để thử bộ tám người của yêu cầu trước.

Giữ frontend hiện tại hoặc chạy `npm.cmd run dev` tại `frontend`. Đăng nhập QL và mở `/manager/schedule`:

1. Chọn tuần có nhu cầu đã nhập tại `/manager/demand`.
2. Bấm **Tạo lịch dự kiến**. Backend lấy snapshot hiện tại, chạy Rule Engine rồi lưu vào memory; frontend GET đọc lại để hiển thị.
3. Xem ngày/ca/bộ phận, tên nhân viên, số cần/đã xếp/còn thiếu và cảnh báo.
4. Chỉnh trong **Chỉnh sửa lịch dự kiến thử nghiệm**, rồi **Kiểm tra và lưu dự kiến thử nghiệm**. Backend kiểm tra lại, trả lỗi cụ thể hoặc tạo phiên bản DRAFT mới. Không sửa đè phiên bản cũ.
5. Bấm **Kiểm tra lịch** để xem kiểm tra mới nhất theo đúng phiên bản.
6. Bấm **Chuẩn bị dữ liệu gửi phê duyệt** để kiểm tra điều kiện bàn giao và xem payload TV4 nếu đủ điều kiện.

Mock vẫn chỉ lưu trong một tiến trình backend; restart hoặc `tsx watch` restart làm mất nhu cầu/lịch mock đã nhập. Đây là giới hạn bộ nhớ đã có, không phải lưu bền. Không sửa `.env`, không bỏ qua xác thực và không ghi dữ liệu mock vào Supabase.

## Luật kiểm tra

Đã tách `assignmentIssue` dùng chung cho sinh lịch và kiểm tra chỉnh sửa, giữ `generateSchedule`/`reviewAssignments` là nguồn kiểm tra xác định. Không dùng AI để tính số lượng hoặc xác nhận hợp lệ.

Các lỗi có mã riêng: `DEPARTMENT_MISMATCH`, `SKILL_MISMATCH`, `REGISTRATION_REQUIRED`, `SHIFT_OVERLAP`, `DAILY_LIMIT_EXCEEDED`, `WEEKLY_LIMIT_EXCEEDED`, `DUPLICATE_ASSIGNMENT`, `DEMAND_EXCEEDED` và dữ liệu thiếu. Giới hạn một ca/ngày chỉ áp dụng nếu fixture `tv3-flow` cấp `test_rules`; mock `summary` và nguồn thật không tự được gán giới hạn đó.

Không dùng bảng lịch mẫu: test sửa nhu cầu trước khi tạo xác minh số yêu cầu thay đổi tương ứng. Replay giữ cùng bản nếu đầu vào không đổi; nhu cầu đổi phải tạo lại rõ ràng. `expected_version` ngăn ghi đè phiên bản mới; fingerprint đầu vào ngăn áp chỉnh sửa lên lịch dùng dữ liệu cũ.

Bộ tám người trước vẫn chạy ra 8/9 lượt, thiếu một Phục vụ chiều 02/11/2026. Mock `summary` cho kết quả theo dữ liệu/nhu cầu riêng của nó, không bị ép thành kết quả của bộ tám người.

## API TV3 bổ sung

- `POST /api/schedules/:id/validate`, body `{expected_version}`: đọc lại lịch và dữ liệu đầu vào, kiểm tra ràng buộc/thiếu người/dữ liệu và phiên bản.
- `POST /api/schedules/:id/approval-handoff`, body `{expected_version,note?}`: **chỉ chuẩn bị dữ liệu**, không gửi, không đổi trạng thái.

Tái sử dụng `POST /generate`, `GET /:id`, `PATCH /:id/draft-assignments`, APIs tuần/nhu cầu/tổng hợp hiện có. Tất cả giữ middleware QL và chi nhánh phía backend. Mock luôn đi qua memory; luồng dữ liệu thật giữ adapter/RPC hiện có.

`ScheduleValidation` gồm:

- ID/version, thời điểm kiểm tra, hash `input_revision`.
- `hard_constraints=PASS/FAIL/UNKNOWN`.
- `data_complete`, `coverage_complete`, `input_current`.
- `can_submit`, lỗi/cảnh báo và coverage theo từng nhu cầu.
- `scope=DECLARED_REQUIREMENTS_AND_VALID_REGISTRATIONS`: kiểm tra nhu cầu đã khai báo và các nhóm có đăng ký VALID. Không tự suy ra rằng ngày/ca/bộ phận chưa khai báo bắt buộc cần 0 người.

Nhóm có đăng ký nhưng thiếu nhu cầu hoặc dữ liệu bắt buộc bị chặn bàn giao. Ngưỡng NEW chưa cấu hình là cảnh báo mềm riêng, không được dùng để thay kiểm tra điều kiện cứng. Crew Leader/nhân sự hỗ trợ chưa có bộ kiểm tra riêng đầy đủ sẽ được báo cần kiểm tra bổ sung, không tự xác nhận hợp lệ.

## Ranh giới với TV4

Đã đối chiếu enum schema: `DRAFT`, `PENDING_APPROVAL`, `NEEDS_REVISION`, `APPROVED`, `PUBLISHED`. TV3 chỉ chuẩn bị từ `DRAFT` hoặc `NEEDS_REVISION`, yêu cầu trạng thái đích `PENDING_APPROVAL`.

Payload đề xuất `tv3-tv4.v1` gồm: mã lịch/nhóm/version, chi nhánh/đợt/tuần, trạng thái hiện tại và yêu cầu, người/thời điểm tạo, người/thời điểm chuẩn bị, phân công, nhu cầu/coverage, kết quả validation, ghi chú và cờ nguồn `source`/`is_mock`. Không có token hoặc secret.

Chỉ trả payload khi ràng buộc đạt, đủ người, dữ liệu đủ, đầu vào còn hiện hành và đang kiểm tra phiên bản mới nhất. Lịch thiếu người vẫn được lưu DRAFT nhưng `can_submit=false` và payload=null. Đầu vào/phiên bản cũ được chặn hoặc yêu cầu tải lại.

Có interface `ScheduleApprovalGateway` và `UnconfiguredScheduleApprovalGateway`; adapter mặc định không gửi được và trả rõ `TV4_NOT_CONFIGURED`. **Không gọi adapter submit trong luồng chuẩn bị.** UI có nút Gửi Giám sát khu vực phê duyệt bị khóa cùng lý do chưa kết nối API TV4. Response luôn `delivery.configured=false`, `delivery.sent=false`. Trạng thái lịch thật và mock không đổi sau khi chuẩn bị, kể cả khi payload đạt kiểm tra.

TV4 cần xác nhận contract/endpoint tiếp nhận và tự kiểm tra lại ID/version/hash đầu vào trong transaction khi thực sự nhận gửi. Mock payload có `is_mock=true`, không được coi là dữ liệu lịch thật trong production. Không thêm endpoint phê duyệt/từ chối/công bố hoặc sửa module TV4/TV5.

## Kiểm thử thực tế

- Backend typecheck và build đạt; **79 pass, 0 fail, 1 skip**.
- Frontend typecheck và build production đạt; **42 pass, 0 fail**.
- Test mới xác minh mock mặc định không còn khóa; dùng nhu cầu đã lưu; hai kịch bản không đọc chéo; lỗi luật cụ thể; lịch thiếu/cũ/thiếu dữ liệu không bàn giao; lịch đạt chuẩn bị được payload nhưng vẫn DRAFT/chưa gửi; quyền QL/chi nhánh; không gọi RPC hoặc business tables Supabase trong mock.
- UI test xác minh tạo/tạo lại, editor, bảng, validation, preview payload chưa gửi, nút gửi disabled và lỗi không tạo thành công giả.
- Test cũ kỳ vọng khóa mock đã được cập nhật theo hành vi mới được người dùng yêu cầu, vẫn xác nhận source=mock, DRAFT và không chạm database chung.
- PostgreSQL integration cũ vẫn skip khi không có database thử nghiệm. Không chạy migration hoặc ghi fixture vào Supabase chung. Chưa kiểm thử trực quan bằng browser hoặc bàn giao đến API TV4 thật.

## File tạo/sửa trong lượt này

Tạo:

- `backend/src/services/scheduling-input.ts`
- `backend/src/services/schedule-review.service.ts`
- `backend/tests/tv3-handoff.test.cjs`
- `frontend/src/pages/manager/ScheduleReviewPanel.tsx`
- `frontend/tests/schedule-review.test.cjs`
- `docs/tv3-mock-and-handoff.md`

Mở rộng:

- `backend/src/repositories/mock-schedule.store.ts`
- `backend/src/repositories/registration-summary.mock.ts`
- `backend/src/repositories/registration-summary.repository.ts`
- `backend/src/repositories/registration-summary.types.ts`
- `backend/src/services/mock-scheduling.service.ts`
- `backend/src/services/scheduling.engine.ts`
- `backend/src/routes/scheduling.routes.ts`
- `backend/tests/registration-summary-api.test.cjs`
- `backend/tests/registration-summary.test.cjs`
- `backend/tests/tv3-flow.test.cjs`
- `frontend/src/types/scheduling.ts`
- `frontend/src/services/scheduling.service.ts`
- `frontend/src/pages/manager/ManagerSchedule.tsx/.css`
- `frontend/src/pages/manager/MockDraftEditor.tsx`
- `frontend/tests/scheduling.test.cjs`
- `frontend/tests/tv3-flow.test.cjs`
- `docs/tv3-test-flow.md` — đính chính giới hạn mock cũ.

Không thay đổi nhánh, `.env`, schema/migrations, auth TV1, đăng ký TV2, phê duyệt TV4 hoặc đổi ca TV5. Không commit/push/merge.

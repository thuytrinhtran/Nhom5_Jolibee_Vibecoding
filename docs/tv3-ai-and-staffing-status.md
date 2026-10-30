# TV3 — Đánh giá AI và tình trạng nhân sự từng ca

## Trạng thái thực tế

Đã triển khai UI, API đánh giá lịch đã lưu, interface `SchedulingAIAdvisor`, adapter Gemini gọi HTTP thật, kiểm tra kết quả, kiểm tra phương án bằng Rule Engine và lưu/đọc qua repository. **Chưa bật hoặc gọi nhà cung cấp AI thật trong lần triển khai này.** Không chọn model hay gói trả phí. Các kiểm thử provider sử dụng transport/test double biệt lập, không hiển thị dữ liệu đó như AI thật trên website.

Mặc định `TV3_AI_EXTERNAL_ENABLED` không phải `true`, hoặc thiếu provider/model/key hợp lệ, trả **AI chưa được cấu hình**. Có API key riêng lẻ không bật AI. Không có fallback sang AI giả. Mock nhân sự cũng không tự bật AI.

Đã đọc tài liệu Design/Intent `.docx`, BPMN To-be trong `docs`, Rule Engine, luồng kiểm tra/bàn giao và DDL hiện có. Design/Intent giữ AI ở vai trò tư vấn, luật kiểm tra bắt buộc và quyết định do con người. Bảng `ai_schedule_evaluations` có SUCCESS/FAILED, JSON evaluation, model và thời điểm; `ai_schedule_suggestions` chỉ chứa đề xuất, không tự áp dụng. Kiểm tra **HEAD chỉ đọc** trên Supabase cho các cột hiện có của cả hai bảng trả HTTP 200. Không chạy migration hoặc thử ghi lên Supabase chung.

## Những gì đã triển khai

- `/manager/schedule`: khu vực **AI đánh giá và đề xuất lịch làm việc**, nút **AI đánh giá lịch** trên DRAFT đã lưu. Nút khóa nếu chưa cấu hình hoặc luật chưa xác nhận hợp lệ. Chỉ POST khi người dùng bấm; tải trang, chuyển tab và thăm dò không gọi provider.
- Backend lấy dữ liệu từ repository TV3 và phiên bản đã lưu, không nhận lịch/PII/model/key do frontend gửi lên. Xác thực/QL/chi nhánh dùng middleware hiện có.
- Tóm tắt cho provider chỉ có mã E/D/S/K, tuần, giờ ca, nhu cầu/đã xếp/đăng ký VALID/đủ điều kiện, cấp độ, quan hệ kỹ năng, đăng ký đã gộp trùng, số ca/giờ và cấu hình liên quan. Không gửi họ tên, UUID nội bộ, chi nhánh, email, điện thoại, ghi chú forecast hoặc ghi chú tự do. Mã và nhãn được giải nghĩa tại ứng dụng; tên trong bảng phương án chỉ tra tại frontend đã được cấp quyền.
- Kết quả gồm kết luận Phù hợp / Cần điều chỉnh / Chưa đủ dữ liệu; điểm tốt; vấn đề; gợi ý kèm lý do; tiêu chí chưa đánh giá. Chưa có ưu tiên nguyện vọng ngoài đăng ký VALID hoặc ngưỡng cân bằng được duyệt thì phải nêu giới hạn, không đặt luật mới.
- Rule Engine kiểm tra trước khi gọi AI. FAIL/UNKNOWN hoặc đầu vào đã lỗi thời chặn gọi. JSON sai hợp đồng hoặc kết luận trái thiếu người/cảnh báo cơ cấu/dữ liệu thiếu bị từ chối; không tạo nội dung thành công thay thế.
- Gợi ý bằng lời được ghi rõ chưa có phương án để kiểm tra. Gợi ý có phương án phải chứa **toàn bộ danh sách phân công thay thế**, được đổi mã và kiểm tra bằng `reviewAssignments`; sai kỹ năng, bộ phận, trùng ca, vượt ca/giờ hoặc mã lạ được đánh dấu REJECTED. PASS chỉ xác nhận luật cứng trên dữ liệu hiện tại, có thể vẫn thiếu người. **Không có nút tự áp dụng hoặc API ghi phân công AI.** Quản lý điều chỉnh bằng luồng hiện có; luồng đó tiếp tục kiểm tra luật trước khi lưu phiên bản mới.
- Sau thời gian chờ AI, Backend kiểm tra lại phiên bản và hash dữ liệu/phân công trước khi lưu. Thay đổi trong lúc đánh giá trả 409. GET sau đó kiểm tra hiệu lực; đổi dữ liệu/model/trạng thái làm kết quả STALE, phiên bản lịch cũ bị từ chối 409. Giao diện giữ báo cáo cũ đang hiển thị và gắn **Hết hiệu lực** khi phiên bản đổi. Khi quay lại tab và mỗi 30 giây, chỉ GET kiểm tra hiệu lực, không tự đánh giá lại. Không có WebSocket báo thay đổi tức thì giữa hai trình duyệt.
- Kết quả/ lỗi có kiểm soát lưu vào `ai_schedule_evaluations` hiện có, JSON chứa phiên bản/hash và đề xuất đã kiểm tra. Chưa ghi `ai_schedule_suggestions` vì không có thao tác lựa chọn/áp dụng trong phạm vi lần này. Mock dùng memory store riêng; không ghi bất kỳ kết quả mock nào vào Supabase. Nếu bảng/quyền ghi chưa sẵn sàng, báo lỗi, không sửa DB hoặc fallback.
- Adapter có timeout, giới hạn dữ liệu/token đầu ra, giới hạn đọc response, không tự retry, không cho redirect, không công cụ ghi lịch. Chặn hai yêu cầu đánh giá đồng thời cùng lịch trong một tiến trình. Không log raw provider response/error hoặc key. Khi triển khai nhiều tiến trình, cần cơ chế điều phối/hạn mức dùng chung do nhóm thống nhất; không thêm schema cho việc đó trong lần này.

## API

| API | Hợp đồng |
| --- | --- |
| `GET /api/schedules/:id/ai-evaluation?expected_version=1` | Chỉ đọc cấu hình/đánh giá và kiểm tra hiệu lực; không gọi provider |
| `POST /api/schedules/:id/ai-evaluation` | Body chỉ `{ "expected_version": 1 }`; chỉ DRAFT hiện hành trong chi nhánh QL |

Response `result` gồm `status`, `message`, `schedule_id`, `version`, `configured`, `model`, `rule_check`, `evaluation`. Status: NOT_CONFIGURED, NOT_EVALUATED, AVAILABLE, STALE, BLOCKED, FAILED. Evaluation chứa `contract_version=tv3-ai.v1`, hash/phiên bản, báo cáo, mã giả danh/nhãn nội bộ, tiêu chí thiếu; từng gợi ý có `rule_check` PASS / REJECTED / NOT_APPLICABLE. Schema JSON được định nghĩa tại `schedule-ai.report.ts`. SUCCESS/FAILED trong bảng DB khác trạng thái hiệu lực tính lại khi đọc; không đổi schema để thêm STALE.

## Cấu hình AI an toàn sau khi được cho phép

Các biến có mẫu trong `backend/.env.example`. Không sửa `.env` thay người dùng. Chỉ cấu hình **Backend** qua môi trường tiến trình hoặc secret manager của môi trường triển khai:

```dotenv
TV3_AI_EXTERNAL_ENABLED=false
TV3_AI_PROVIDER=none
TV3_AI_MODEL=
GEMINI_API_KEY=
```

Khi người phụ trách đã cho phép gửi bản tóm tắt ra ngoài và duyệt model/hạn mức/billing: chọn `TV3_AI_PROVIDER=gemini`, đặt `TV3_AI_MODEL` bằng **tên model Gemini được nhóm duyệt có hỗ trợ structured output**, cấp `GEMINI_API_KEY` bằng secret của Backend, rồi mới bật `TV3_AI_EXTERNAL_ENABLED=true` và khởi động lại Backend. Không có model mặc định. Không nhập key qua UI, không dùng biến `VITE_*`, không ghi key trong mã nguồn, test fixture, lệnh shell có literal key, file example hoặc Git. Tắt lại bằng `TV3_AI_EXTERNAL_ENABLED=false` và restart.

Adapter dùng REST `generateContent` và JSON schema theo [tài liệu structured output chính thức của Gemini](https://ai.google.dev/gemini-api/docs/generate-content/structured-output). Việc chọn model, xác nhận quyền sử dụng/billing, hạn mức, chính sách lưu dữ liệu của provider và kiểm thử live còn cần người phụ trách duyệt. Một API key không bảo đảm tài khoản/model đủ quyền. Nếu lỗi provider/model/quota/định dạng thì hiển thị lỗi, giữ nguyên lịch và không tự đổi provider/model.

## Ma trận tình trạng nhân sự

`/manager/demand` vẫn giữ nguyên bảng nhập nhanh 63 ô/tuần, dữ liệu đã lưu và API nhu cầu. Phần dưới là **Tình trạng nhân sự từng ca**:

- Mặc định ngày đầu tuần; có chọn ngày khác hoặc Cả tuần. Mỗi ngày ba ca và ba cột Bếp / Thu ngân / Phục vụ khi danh mục Backend đã có đủ ba ca. Mock hiện có 08:00–12:00, 12:00–17:00, 17:00–22:00. Dữ liệu thật dùng ID/giờ ca đang cấu hình; không tự tạo/đổi ca trên DB.
- Ô hiển thị **đủ điều kiện trước xếp lịch / nhu cầu**, dùng nguyên `eligible_count`, `required_count`, `status`, `shortage_count`, `surplus_count` từ Backend. Không lấy `registered_count` thay số đủ điều kiện hoặc coi số đó là số đã phân công. Trống chưa xác định khác 0.
- Đủ người / Thiếu X / Dư X / Chưa nhập nhu cầu / Chưa thể đánh giá. Nhấn ô xem số đăng ký VALID, đủ điều kiện, cần, thiếu/thừa, kỹ năng và nguyên nhân loại trừ. Ứng viên được đánh giá độc lập từng ca, không bảo đảm một người nhận được mọi ca họ đủ điều kiện.
- Cảnh báo chung gộp theo mã trong **Thông tin bổ sung**, ngưỡng NEW chỉ hiện một lần. Không sửa service/formula/Business Rules cung–cầu Backend.

## Chạy và kiểm thử Mock Mode

1. Giữ nhánh `feature/tri-auto-scheduling`. Trong terminal Backend cũ, Ctrl+C nếu cần để tránh tranh cổng. Chạy `npm.cmd run dev:tv3-test` trong `backend`; `npm.cmd run dev` trong `frontend`. Không bật cờ AI ngoài khi chỉ kiểm thử offline.
2. Đăng nhập QL có chi nhánh. Vào `/manager/demand`, tuần 02–08/11/2026: kiểm tra 63 ô, lưu 0/ô trống, sao chép, tải lại; ma trận mặc định một ngày, mở chi tiết rồi đổi ngày/Cả tuần. Ca chiều Phục vụ có 2 người đủ điều kiện trước phân công nhưng lịch thực tế vẫn có thể thiếu do cap 1 ca/ngày của fixture.
3. Mở `/manager/schedule`, tạo DRAFT: fixture gốc cần 9, xếp 8, thiếu 1 Phục vụ chiều. AI hiển thị **AI chưa được cấu hình**, nút khóa. Không tạo nhận xét mẫu rồi gọi là AI.
4. Kiểm thử adapter/đủ người/thiếu người/cơ cấu/dữ liệu thiếu/JSON lỗi/vi phạm luật/stale bằng test suite bên dưới: test double chỉ tồn tại trong tests, không có env test-provider trên website.
5. Sau khi provider được duyệt và cấu hình thật, bấm **AI đánh giá lịch**; kiểm tra các mục, mã giả danh, verdict luật cho đề xuất, lịch không đổi; sửa DRAFT bằng luồng hiện có/tạo lại rồi kiểm tra đánh giá cũ hết hiệu lực. Kiểm tra hai tab: thay nhu cầu ở tab kia, quay lại tab lịch để GET phát hiện stale; nếu đã có phiên bản mới hơn thì tải lại tuần. Chưa chạy các bước provider live này trong lần triển khai hiện tại.

## File tạo/sửa trong lần nâng cấp

Backend:

- `backend/src/services/scheduling-ai-advisor.ts`: mở rộng interface, giữ compatibility unconfigured review/compare/suggest.
- `backend/src/services/schedule-ai.types.ts` (mới): contract dữ liệu AI và kết quả.
- `backend/src/services/schedule-ai.summary.ts` (mới): tóm tắt, giả danh, metadata giải mã giữ nội bộ.
- `backend/src/services/schedule-ai.report.ts` (mới): JSON schema và kiểm tra runtime.
- `backend/src/services/schedule-ai.gemini.ts` (mới): adapter HTTP và factory cấu hình mặc định tắt.
- `backend/src/services/schedule-ai.service.ts` (mới): điều phối kiểm tra luật/phiên bản/đề xuất và đọc/lưu đánh giá.
- `backend/src/repositories/schedule-ai.repository.ts` (mới): Mock/Supabase theo bảng AI có sẵn.
- `backend/src/services/schedule-review.service.ts`: trả thêm snapshot đã loại phân công của chính lịch để tái sử dụng; giữ nguyên kiểm tra/bàn giao TV4.
- `backend/src/routes/scheduling.routes.ts`: hai API AI trong router QL hiện có.
- `backend/.env.example`: các biến không chứa key thật, mặc định tắt.

Frontend:

- `frontend/src/pages/manager/ScheduleAIPanel.tsx`, `ScheduleAIPanel.css` (mới): trạng thái/đánh giá, đề xuất, cảnh báo hết hiệu lực.
- `frontend/src/pages/manager/StaffingStatusMatrix.tsx`, `StaffingStatusMatrix.css` (mới): ma trận ngày và chi tiết.
- `frontend/src/services/staffing-status.view.ts` (mới): trình bày đúng số liệu và trạng thái Backend.
- `frontend/src/pages/manager/ManagerSchedule.tsx`, `ManagerDemand.tsx`: tích hợp các khu vực mới, giữ lịch và bảng nhập nhanh.
- `frontend/src/services/scheduling.service.ts`, `frontend/src/types/scheduling.ts`: client API, DTO AI.

Tests và tài liệu:

- Mới: `backend/tests/schedule-ai.test.cjs`, `backend/tests/schedule-ai-api.test.cjs`, `frontend/tests/schedule-ai.test.cjs`, `frontend/tests/staffing-status.test.cjs`.
- Cập nhật: `frontend/tests/scheduling.test.cjs`, `frontend/tests/tv3-flow.test.cjs`, `frontend/tests/staffing-demand.test.cjs`, `frontend/tests/staffing-demand-grid.test.cjs` để kiểm tra phần tích hợp và giữ các kiểm thử trước.
- Tài liệu này và `docs/tv3-demand-grid.md`.

## Kết quả và phụ thuộc

- Backend: **93 pass, 1 skipped** / 94 bài. Bài RPC PostgreSQL cần disposable DB + psql, không chạy lên Supabase chung. Typecheck/build đạt.
- Frontend: **60/60 pass**, typecheck/build đạt. Kiểm thử React SSR/hook/event harness, chưa có E2E trình duyệt thật; cần xác nhận trực quan và bàn phím trên website.
- Chưa có live AI evaluation hoặc ghi AI thật lên Supabase. Chỉ HEAD schema hai bảng AI thành công; quyền INSERT thực tế chưa được kiểm chứng. Các kiểm thử AI dùng HTTP transport giả và mock store, không gọi dịch vụ ngoài.
- Còn phụ thuộc nhóm: cấp/duyệt provider + model + secret + billing/quyền dữ liệu, quyền INSERT bảng AI; TV2 đợt/đăng ký/nguyện vọng ưu tiên thật; cấu hình NEW/kỹ năng/ngưỡng cân bằng nếu nghiệp vụ yêu cầu. Không tự suy diễn phần chưa chốt. TV4/TV5 và xác thực TV1 giữ nguyên.
- Không migration, không sửa `.env`, không commit/push/merge, không ghi mock lên Supabase chung.

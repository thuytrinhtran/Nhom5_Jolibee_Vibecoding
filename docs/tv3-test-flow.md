# TV3 — Thử nghiệm nhu cầu → lịch dự kiến, không chờ TV2

## Nguyên nhân dropdown trống đã kiểm tra

Kiểm tra chỉ đọc trên Supabase cấu hình sẵn trả **0 dòng registration_periods**; có một chi nhánh của tài khoản QL và chi nhánh này cũng chưa có đợt. Nguồn đang chọn là `supabase`. API đang lọc theo `req.user.branch_id` đúng phạm vi; giao diện hiển thị empty state thay vì tự sinh tuần. Không kết luận đây là lỗi API khi dữ liệu thật chưa có.

Bổ sung kịch bản `tv3-flow` tách biệt với fixture `summary` trước đây. Không có fallback từ Supabase lỗi sang mock.

## Bật chế độ thử toàn luồng

Dừng backend cũ ở terminal đang chạy để tránh hai server tranh cổng, rồi chạy:

```powershell
cd backend
npm.cmd run dev:tv3-test
```

Lệnh này chỉ đặt cấu hình trên tiến trình con:

- `NODE_ENV=development`
- `SCHEDULING_DATA_SOURCE=mock`
- `SCHEDULING_MOCK_SCENARIO=tv3-flow`

Không sửa `.env`, không seed database, không bỏ qua đăng nhập. Giữ frontend đang chạy tại `http://localhost:5173`; nếu chưa chạy thì `cd frontend` và `npm.cmd run dev` trong terminal khác.

Đăng nhập bằng **QL đã đổi mật khẩu, có chi nhánh**. Dữ liệu nghiệp vụ được mô phỏng nhưng xác thực/RBAC vẫn dùng TV1/Supabase thật.

1. Mở `/manager/demand`.
2. Chọn tuần **02/11/2026–08/11/2026**, có nhãn **Dữ liệu thử nghiệm**.
3. Xem/sửa/lưu nhu cầu mẫu. Nhu cầu đã lưu trong memory được dùng thật cho lần tạo lịch tiếp theo.
4. Mở `/manager/schedule`, chọn cùng tuần, bấm **Tạo lịch dự kiến**.
5. Xem tên nhân viên, nhu cầu/đã xếp/còn thiếu và trạng thái `DRAFT`.
6. Có thể chỉnh người, bỏ/thêm phân công trong **Chỉnh sửa lịch dự kiến thử nghiệm**; bấm **Kiểm tra và lưu dự kiến thử nghiệm**. Backend từ chối phân công vi phạm; lưu hợp lệ tạo phiên bản mới.
7. Nếu sửa nhu cầu sau khi đã tạo lịch, tải lại tuần trên trang schedule rồi bấm **Tạo lại lịch dự kiến**. Bản cũ vẫn được giữ trong memory, không bị ghi đè.

Muốn tắt: Ctrl+C dừng backend thử nghiệm, sau đó chạy backend bình thường:

```powershell
$env:SCHEDULING_DATA_SOURCE = 'supabase'
npm.cmd run dev
```

`SCHEDULING_MOCK_SCENARIO` bị bỏ qua khi nguồn là Supabase. Từ bản hoàn thiện TV3, bật `mock` là tạo/chỉnh được lịch ở cả `summary` và `tv3-flow`; không bắt buộc chọn `tv3-flow` để mở nút. Hai bộ dữ liệu được tách biệt. Không tự chuyển sang nguồn khác khi lỗi.

## Dữ liệu thử nghiệm

Tất cả nhân viên hoạt động, role NV, cấp độ REGULAR, có kỹ năng tương ứng và đăng ký VALID ngày 02/11/2026:

| Nhân viên | Bộ phận | Đăng ký |
| --- | --- | --- |
| NV01 An | Bếp | Sáng |
| NV02 Bình | Bếp | Sáng, chiều |
| NV03 Cường | Bếp | Chiều |
| NV04 Dung | Thu ngân | Sáng |
| NV05 Hà | Thu ngân | Chiều |
| NV06 Lan | Phục vụ | Sáng |
| NV07 Minh | Phục vụ | Sáng, chiều |
| NV08 Phúc | Phục vụ | Chiều |

Fixture hiện có ba ca theo yêu cầu kiểm thử bảng tuần: sáng 08:00–12:00, chiều 12:00–17:00, ca 3 17:00–22:00. Ca 3 chưa có nhu cầu/đăng ký mẫu, được để trống thay vì tự gán 0. Không thay đổi danh mục ca trên Supabase chung. Giới hạn **1 ca/ngày** nằm trong `test_rules` của fixture, không lấy từ request client và không được thêm vào nguồn Supabase thật. Không tự đặt giới hạn giờ tuần khi chưa cấu hình.

Nhu cầu mẫu được nạp sẵn để có thể thử ngay, vẫn sửa/lưu được qua bảng tuần và PUT hiện có (xem [hướng dẫn bảng nhập tuần](tv3-demand-grid.md)):

| Ca | Bếp | Thu ngân | Phục vụ |
| --- | --- | --- | --- |
| Sáng 02/11/2026 | 2 | 1 | 2 |
| Chiều 02/11/2026 | 1 | 1 | 2 |

Đây là số thử nghiệm, không phải định mức Jollibee. Các ngày còn lại chưa khai báo nhu cầu được thể hiện thiếu dữ liệu, không tự coi là 0. Không quy đổi Sales Forecast thành số người.

## Kết quả Rule Engine đã thực thi

| Ca | Bộ phận | Cần | Đã xếp | Nhân viên | Thiếu |
| --- | --- | --- | --- | --- | --- |
| Sáng | Bếp | 2 | 2 | NV01 An, NV02 Bình | 0 |
| Sáng | Thu ngân | 1 | 1 | NV04 Dung | 0 |
| Sáng | Phục vụ | 2 | 2 | NV06 Lan, NV07 Minh | 0 |
| Chiều | Bếp | 1 | 1 | NV03 Cường | 0 |
| Chiều | Thu ngân | 1 | 1 | NV05 Hà | 0 |
| Chiều | Phục vụ | 2 | 1 | NV08 Phúc | **1** |

Tổng **9 lượt cần, 8 được phân công**. Thiếu chiều do Minh đã làm sáng theo giới hạn thử nghiệm. Không gán cứng thiếu người trong code: test bỏ giới hạn một ca/ngày xếp được 9/9; test giảm nhu cầu Phục vụ chiều xuống 1 xếp đủ 8/8. Các phương án chỉnh sửa hợp lệ khác vẫn được phép; ví dụ chuyển Minh sang chiều sẽ chuyển một vị trí thiếu sang sáng, không tự bịa thêm nhân viên.

## API và bảo vệ dữ liệu

Tái sử dụng cùng endpoint phía frontend:

- `GET /api/schedules/periods`
- `GET /api/schedules/periods/:id/requirements`
- `PUT /api/schedules/periods/:id/requirements`
- `GET /api/schedules/periods/:id/registrations-summary`
- `GET /api/schedules/periods/:id`
- `POST /api/schedules/generate` — trong `tv3-flow` lưu DRAFT vào memory, trong nguồn thật giữ luồng RPC hiện có.
- `GET /api/schedules/:id` — đọc theo nguồn đang bật; không fallback giữa memory và Supabase.
- `PATCH /api/schedules/:id/draft-assignments` — **chỉ trong tv3-flow**, body gồm `expected_version`, danh sách `assignments` với employee_id/work_date/shift_id/department_id và ghi chú tùy chọn.

Tạo lại trong mock gửi `regenerate=true`, `expected_version` hiện tại và `period_id`. Replay tạo ban đầu trả bản hiện có nếu dữ liệu không đổi. Nếu nhu cầu đã đổi, yêu cầu tạo lại rõ ràng; không âm thầm thay kết quả đang xem.

Mỗi phiên bản mock có UUID, schedule_group_id, version, actor và created_at; trạng thái luôn DRAFT. Đọc/sửa theo chi nhánh của tài khoản. Các phiên bản trước giữ nguyên. CAS theo `expected_version` ngăn hai thao tác cùng ghi đè. Dữ liệu đầu vào lấy lại từ repository và kiểm tra fingerprint; thay đổi nhu cầu làm bản cũ được đánh dấu `demand_changed` và chặn sửa cho tới khi tạo lại.

Rule Engine là nơi kiểm tra điều kiện cho cả sinh và chỉnh lịch. Kiểm tra đăng ký, trạng thái, kỹ năng/bộ phận, overlap, giờ cấu hình, giới hạn test, nhu cầu và phân công trùng. Nháp thiếu người vẫn được lưu nhưng không có chức năng phê duyệt/công bố trong luồng này.

Nhu cầu, lịch và mọi phiên bản test chỉ tồn tại trong **một tiến trình backend**; mất khi restart. Không dùng cho nhiều worker hoặc lưu bền production. Mock có phân tách chi nhánh và kịch bản để không trộn với fixture summary cũ. Toàn bộ nghiệp vụ mock không gọi Supabase business table/RPC; chỉ authentication/RBAC tiếp tục gọi dịch vụ thật.

## AI

Thêm interface `SchedulingAIAdvisor` với `review`, `compare`, `suggest` và adapter `UnconfiguredSchedulingAIAdvisor`. Đầu ra hiện tại chỉ là `NOT_CONFIGURED`, **AI chưa được cấu hình**, gắn với version. Không có nhận xét/đề xuất viết sẵn được trình bày như kết quả mô hình thật. Không chọn nhà cung cấp, không dùng khóa AI, không gửi dữ liệu ra ngoài.

UI hiển thị đúng trạng thái này. Khi tích hợp sau, đề xuất chỉ là dữ liệu để QL xem xét; phải kiểm tra lại bằng `reviewAssignments` và xác nhận trước khi lưu. Interface không được cấp quyền ghi DB hay phê duyệt/công bố.

## Kết quả kiểm thử và giới hạn

- Backend typecheck/build đạt; **73 test pass, 0 fail, 1 skip**.
- Frontend typecheck/production build đạt; **38 test pass, 0 fail**.
- Test HTTP thật trên Express với Supabase auth stub đi qua nhu cầu → PUT lưu → POST tạo → GET đọc → PATCH chỉnh; assertion cấm chạm Supabase business tables/RPC trong mock.
- Test nhu cầu chỉnh lại ảnh hưởng kết quả, replay, tạo lại, phiên bản cũ bất biến, giới hạn 1 ca/ngày, phân công sai kỹ năng/bộ phận, trùng, thiếu nguyện vọng, đồng thời và AI không cấu hình.
- Test frontend kiểm tra bật nút tạo/tạo lại, nhãn, tên/thiếu người, API payload, chỉnh nháp đọc phiên bản mới và lỗi luật không giả thành công.
- Test launcher kiểm tra ba biến được đặt trên child process; không sửa `.env`.
- PostgreSQL integration cũ skip vì chưa có database thử nghiệm được cấu hình. Không chạy migration hoặc ghi dữ liệu thử vào Supabase chung.
- Chưa kiểm thử trực quan bằng trình duyệt hoặc đăng nhập QL thật trong lượt này. Người dùng cần dừng backend cũ và chạy lệnh mới để browser chuyển sang dữ liệu thử nghiệm; không tự dừng tiến trình backend đang có của người dùng.

Khi chạy bộ test mặc định trong terminal từng đặt flag thủ công, dùng nguồn Supabase và bỏ scenario của terminal trước để không trộn cấu hình fixture test:

```powershell
$env:SCHEDULING_DATA_SOURCE = 'supabase'
Remove-Item Env:SCHEDULING_MOCK_SCENARIO -ErrorAction SilentlyContinue
npm.cmd test
```

## File tạo/sửa trong lượt này

Tạo:

- `backend/scripts/dev-tv3-test.cjs`
- `backend/src/repositories/tv3-flow.fixture.ts`
- `backend/src/repositories/mock-schedule.store.ts`
- `backend/src/services/mock-scheduling.service.ts`
- `backend/src/services/scheduling-ai-advisor.ts`
- `backend/tests/tv3-flow.test.cjs`
- `frontend/src/pages/manager/MockDraftEditor.tsx`
- `frontend/tests/tv3-flow.test.cjs`
- `docs/tv3-test-flow.md`

Mở rộng:

- `backend/package.json`
- `backend/src/repositories/registration-summary.mock.ts`
- `backend/src/repositories/registration-summary.repository.ts`
- `backend/src/repositories/registration-summary.types.ts`
- `backend/src/services/scheduling.engine.ts`
- `backend/src/services/scheduling.service.ts`
- `backend/src/services/registration-summary.service.ts`
- `backend/src/routes/scheduling.routes.ts`
- `frontend/src/types/scheduling.ts`
- `frontend/src/services/scheduling.service.ts`
- `frontend/src/pages/manager/ManagerSchedule.tsx/.css`
- `frontend/src/pages/manager/ManagerDemand.tsx`
- `frontend/src/pages/manager/RegistrationSummaryPanel.tsx`
- `frontend/tests/scheduling.test.cjs` — test lịch cũ cô lập component editor mới; các ca cũ vẫn được giữ.

Không sửa schema/migration, `.env`, server registration, App route, auth TV1 hay nghiệp vụ TV2/TV4/TV5 trong lượt này. Không commit/push/merge.

## Dữ liệu thật và phụ thuộc

Nguồn Supabase vẫn giữ các adapter đọc tổng hợp/nhu cầu và ghi nhu cầu đã có. Chức năng tạo lịch thật vẫn dùng RPC đã thiết kế; sửa lịch mới trong lượt này chỉ mở cho mock, chưa áp dụng lên lịch thật. Không nhận đã kiểm thử ghi thật hoặc triển khai RPC trên database chung.

TV2 cần cung cấp đợt/đăng ký thật đúng schema. TV4 tiếp tục sở hữu trình duyệt, phê duyệt và công bố; không có thao tác đó trong test flow. AI thật cần nhà cung cấp/chính sách dữ liệu được nhóm thống nhất. Bộ dữ liệu thử nghiệm cho phép demo TV3 ngay mà không phải chờ các phần này.


Cập nhật mới nhất: xem [Hoàn thiện Mock Mode và chuẩn bị bàn giao TV4](tv3-mock-and-handoff.md). Mọi mock đều được tạo/chỉnh lịch trong bộ nhớ; bước bàn giao hiện chỉ chuẩn bị payload, chưa gửi hoặc đổi trạng thái.

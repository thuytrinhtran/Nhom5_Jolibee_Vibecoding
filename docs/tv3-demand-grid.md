# TV3 — Bảng nhập nhu cầu cả tuần

Trang: `http://localhost:5173/manager/demand`. Giữ sidebar, header, xác thực TV1 và quyền QL theo chi nhánh. Không đổi schema, không chạy migration/seed, không commit/push/merge, không sửa `.env`.

## Cách chạy

Dừng backend cũ bằng Ctrl+C trong terminal của nó, rồi chạy trong `backend`:

```powershell
npm.cmd run dev:tv3-test
```

Script hiện có đặt `NODE_ENV=development`, `SCHEDULING_DATA_SOURCE=mock`, `SCHEDULING_MOCK_SCENARIO=tv3-flow` trên tiến trình con. Không sửa file môi trường. Mock chỉ hoạt động khi được bật rõ trong development; lỗi Supabase không chuyển sang mock.

Trong terminal `frontend`:

```powershell
npm.cmd run dev
```

Đăng nhập QL có chi nhánh và đã đổi mật khẩu. Xác thực vẫn dùng TV1 thật. Chọn tuần 02/11/2026–08/11/2026. Nhãn **Dữ liệu thử nghiệm · MOCK** phải xuất hiện. Nhu cầu và lịch mock chỉ nằm trong bộ nhớ Backend, mất khi khởi động lại. Tải lại trình duyệt không xóa mock store.

Tắt mock: dừng backend thử nghiệm, đặt `$env:SCHEDULING_DATA_SOURCE = 'supabase'` và chạy `npm.cmd run dev` trong `backend`. Không tự đổi cấu hình hoặc tạo đợt TV2 trên database chung.

## Cách sử dụng và kiểm thử trên website

1. Bảng gồm 21 dòng, ba cột Bếp / Thu ngân / Phục vụ. Fixture có ca sáng 08:00–12:00, chiều 12:00–17:00, ca 3 17:00–22:00; ID được lấy từ API. Dữ liệu thật dùng đúng danh mục ca đang cấu hình, không tự tạo ID hoặc thay giờ trên Supabase.
2. Nhấp ô đầu, nhập số và dùng **Tab** sang bộ phận tiếp theo, **Shift+Tab** quay lại. **Enter / Shift+Enter** xuống/lên cùng cột. Có thể sao chép vùng ba cột số trong Excel và dán vào ô Bếp; nội dung sai hoặc vùng vượt bảng bị từ chối. Dán/sao chép không gửi API lưu.
3. Nhập `0`: nhu cầu bằng 0. Để trống: chưa xác định. Số âm, thập phân, ký tự hoặc số vượt giới hạn integer bị báo lỗi tại ô. Không bắt nhập forecast.
4. **Sao chép thứ Hai cho cả tuần** sao chép số lượng, kể cả ô trống, đến sáu ngày còn lại. Kỹ năng và nguồn forecast của ô đích được giữ nguyên khi sao chép; nếu lưu ô về trống thì bản ghi và metadata của ô đó được xóa theo xác nhận riêng. Thao tác làm thay đổi ô đã lưu phải xác nhận. Bấm Hủy để kiểm tra dữ liệu không đổi.
5. **Sao chép ngày trước** áp dụng cho ngày đang lọc; khi xem cả tuần, áp dụng cho ngày của ô được chọn gần nhất. Thứ Hai không có ngày trước trong tuần này nên nút bị khóa.
6. Lọc một ngày rồi quay về cả tuần: các ô đang nhập vẫn giữ nguyên. **Lưu tất cả** luôn lưu các thay đổi của toàn tuần, kể cả ngày đang ẩn. Chỉ các ô đã sửa được gửi lên API. Theo dõi số ô đang lưu ở đầu trang.
7. Bấm **Lưu tất cả**, chờ thông báo đã lưu **và đọc lại**, sau đó tải lại trang. Số 0 và các số đã nhập phải còn nguyên; ô trống vẫn là dấu `—`. Xóa số đã lưu rồi lưu sẽ có xác nhận đưa về chưa xác định, bao gồm xóa nguồn forecast/kỹ năng của bản ghi đó. Không biến ô trống thành 0.
8. Thử lỗi lưu bằng DevTools Network request blocking cho URL requirements sau khi đã tải trang, hoặc sửa cùng ô trong hai tab rồi lưu tab giữ phiên bản cũ. Các ô thất bại có lỗi riêng và giữ nội dung; các ô thành công đã được lưu. Không có thông báo thành công đọc lại nếu GET thất bại. Với xung đột phiên bản, ghi lại nội dung cần giữ, tải lại tuần có xác nhận rồi nhập lại. Không tự dùng phiên bản mới để ghi đè thay đổi người khác.
9. Nhập chưa lưu rồi đổi tuần, tải lại tuần, nhấp sidebar / **Mở lịch dự kiến**, Back/Forward hoặc đóng/tải lại trang: phải có cảnh báo. Chọn Hủy giữ tuần và nội dung. Thông báo đóng/tải lại do trình duyệt hiển thị, có thể dùng văn bản mặc định.
10. Mở **Nguồn & ghi chú Sales Forecast** nếu cần: chọn ô hoặc tập trung ô trong bảng, sửa ghi chú rồi lưu cùng số lượng. Kỹ năng đã lưu được bảo toàn. Không có công thức tự đổi doanh thu thành số nhân viên. Khu vực cung–cầu đã được nâng cấp thành **Tình trạng nhân sự từng ca**, mặc định xem một ngày và nhấn ô để mở chi tiết; cảnh báo chung nằm trong **Thông tin bổ sung**. Xem [nâng cấp AI và ma trận](tv3-ai-and-staffing-status.md). Số liệu phản ánh dữ liệu đã lưu, không phải các số đang nhập.
11. Sau khi lưu, mở `/manager/schedule`, chọn cùng tuần và tạo lịch. Nếu đã có lịch cũ, tải lại tuần và **Tạo lại lịch dự kiến** để dùng nhu cầu mới. Lịch cũ giữ nguyên ảnh chụp nhu cầu của phiên bản đó; không âm thầm sửa lịch cũ, không phê duyệt/công bố.
12. Thu cửa sổ về kích thước điện thoại: bảng cuộn ngang, tiêu đề cố định trong vùng cuộn, ô nhập cao 44px. Kiểm tra sidebar/header vẫn hoạt động. Không có kiểm thử trình duyệt tự động trong môi trường hiện tại; các thao tác này là bước xác nhận trực quan cần thực hiện trên website.

## API và quy tắc lưu

| API | Sử dụng |
| --- | --- |
| `GET /api/schedules/periods` | Tuần của chi nhánh QL |
| `GET /api/schedules/periods/:id/requirements` | Đọc nhu cầu, danh mục ca/bộ phận và cung–cầu |
| `PUT /api/schedules/periods/:id/requirements` | API hiện có: lưu mỗi ô số, giữ kỹ năng/forecast, kiểm tra `expected_updated_at` |
| `DELETE /api/schedules/periods/:id/requirements` | Bổ sung: đưa một ô đã lưu về chưa xác định, body gồm ngày/ca/bộ phận/`expected_updated_at`; xóa có điều kiện theo chi nhánh và phiên bản |

Không có transaction cả tuần: giao diện phối hợp API từng ô, hiển thị tiến độ và lỗi từng ô, giữ các lần lưu thành công. Backend kiểm tra quyền QL, chi nhánh, tuần và phiên bản. Adapter Supabase cập nhật/xóa có điều kiện; không tự nâng quyền nếu DB từ chối ghi. Bảng `staffing_requirements.required_count` hiện là integer NOT NULL nên trạng thái chưa xác định được biểu diễn bằng việc không có bản ghi, không sửa schema.

`/manager/schedule` tiếp tục dùng `POST /api/schedules/generate` và `GET /api/schedules/:id` hiện có. Mock và Supabase cùng contract; không ghi fixture lên Supabase.

## File tạo/sửa trong lần này

- `frontend/src/pages/manager/ManagerDemand.tsx`: thay form một ô bằng bảng tuần, lọc/sao chép, vùng forecast/cung–cầu thu gọn, trạng thái lưu, xác nhận chuyển/tải lại tuần.
- `frontend/src/pages/manager/ManagerDemand.css`: bảng, ô nhập, cuối tuần, sticky header và responsive; shell giữ nguyên.
- `frontend/src/services/staffing-demand.grid.ts` (mới): trạng thái từng ô, kiểm tra số, sao chép/dán vùng, phối hợp lưu, giữ lỗi và revision.
- `frontend/src/services/staffing-demand.guard.ts` (mới): cảnh báo link nội bộ, unload và Back/Forward khi chưa lưu.
- `frontend/src/services/scheduling.service.ts`: thêm client DELETE; tái sử dụng xác thực/API hiện có.
- `backend/src/routes/scheduling.routes.ts`: đăng ký DELETE trong router QL hiện có.
- `backend/src/services/staffing-demand.service.ts`: kiểm tra yêu cầu đưa ô về chưa xác định.
- `backend/src/repositories/registration-summary.types.ts`: mở rộng interface clear một bản ghi có phiên bản.
- `backend/src/repositories/registration-summary.mock.ts`: clear trong mock store, danh mục ba ca mock.
- `backend/src/repositories/registration-summary.supabase.ts`: conditional DELETE đúng chi nhánh/id/updated_at.
- `backend/src/repositories/tv3-flow.fixture.ts`: ba ca test; giữ tám nhân viên/đăng ký và nhu cầu ban đầu.
- `frontend/tests/staffing-demand.test.cjs`, `frontend/tests/staffing-demand-grid.test.cjs` (mới): kiểm thử UI, API client, nhập/dán/sao chép, 0/trống, lỗi từng ô, cảnh báo điều hướng và đổi tuần.
- `backend/tests/staffing-demand-api.test.cjs`, `backend/tests/staffing-demand-grid.test.cjs` (mới), `backend/tests/tv3-flow.test.cjs`: quyền, concurrency, adapter, lưu/đọc lại và tích hợp với lịch dự kiến.
- `docs/tv3-test-flow.md`: cập nhật mô tả fixture; tài liệu này: cách dùng và kết quả.

## Kết quả thực tế

- Backend `npm.cmd test`: **81 pass, 1 skipped** (82 tổng). Bài PostgreSQL RPC cần disposable database + psql; không chạy lên Supabase chung.
- Frontend `npm.cmd test`: **51/51 pass** (React SSR/hook harness và logic/event handler, chưa phải kiểm thử E2E trên trình duyệt thật).
- Backend/frontend `npm.cmd run typecheck`: đạt. Build Backend (`npm.cmd test` chạy build) và Frontend `npm.cmd run build`: đạt.
- HTTP smoke trên tiến trình đang chạy: `/manager/demand` và module TSX mới trả 200 từ Vite; Backend `/api/health` cổng 5000 trả 200. Không đăng nhập hoặc ghi dữ liệu thật để kiểm tra.
- Kiểm thử tích hợp dùng chính bộ phối hợp lưu Frontend gọi service Backend/mock store rồi `createDraft`/`readDraft`: nhu cầu gốc **9**, xếp **8**, thiếu **1 Phục vụ ca chiều 02/11**. Sửa nhu cầu Phục vụ ca chiều xuống **1**, thêm một ô nhu cầu **0**, lưu/đọc lại rồi tạo phiên bản lịch mới: **cần 8 / xếp 8 / thiếu 0**, trạng thái `DRAFT`. Xóa ô 0 trả về trống; lịch cũ báo nhu cầu đã thay đổi.

Chưa kiểm chứng thao tác ghi/xóa trên database thật; nếu quyền/schema thực tế chưa cho phép, API báo lỗi thay vì tự thay DB. TV2 vẫn cung cấp đợt/đăng ký thật, nhóm quản trị cung cấp ca/bộ phận/kỹ năng. TV4 tiếp nhận phê duyệt theo hợp đồng hiện có; lần này không sửa TV4/TV5 hoặc thêm AI.

# TV3 — Giữ đủ ba ca trên giao diện

## Nguyên nhân và dữ liệu đã kiểm tra

1. `scheduleRows` trước đây chỉ dựng bảng từ `generation_snapshot.coverage` hoặc `context.requirements`. Khi chỉ có nhu cầu Ca 1, bảng không có dòng Ca 2/Ca 3 dù API đã trả đủ danh mục ca.
2. `RegistrationSummaryPanel` cũng dựng bộ lọc ca/ngày từ `summary.rows`, là những tổ hợp đã có nhu cầu hoặc đăng ký. Với fixture `summary`, nhu cầu và đăng ký mẫu đều ở Ca 1; bộ lọc và bảng vì thế không hiển thị hai ca còn lại.
3. Cả `mockSummarySnapshot` và `tv3FlowSnapshot` hiện đã có ba ID riêng biệt, với giờ 08:00–12:00, 12:00–17:00, 17:00–22:00. Không sửa hoặc tạo lại các ID/fixture này trong lần sửa.
4. Bảng nhập nhanh và ma trận `/manager/demand` đã duyệt danh mục ca hoạt động từ API, không có bộ lọc tự động chỉ giữ Ca 1. Đã bổ sung kiểm thử xác nhận 21 dòng nhập ca/tuần và 63 ô nhu cầu.
5. Kiểm tra chỉ đọc trên Supabase cấu hình sẵn trả HTTP 200 với **0 dòng `shifts`**, đồng thời hai chi nhánh được đọc đều có **0 đợt đăng ký**. Đây là thiếu dữ liệu nền, không phải bằng chứng API lọc sai. Cấu hình được nạp trong tiến trình kiểm tra dùng nguồn `supabase`; Backend đang chạy qua script có thể có biến môi trường ghi đè, nên không đồng nhất kết quả này với nguồn phiên đăng nhập của người dùng. Không seed ca/đợt hoặc tạo UUID thay cho dữ liệu thật.

## Bản sửa

- Bảng lịch dùng `scheduleCalendarRows`: ghép ngày trong tuần × ID ca từ API × bộ phận. Các dòng lịch sử và phân công đã lưu vẫn được giữ nếu danh mục/nhu cầu hiện tại đổi. Đây chỉ là dòng hiển thị, không ghi thành `staffing_requirements`, không đưa vào Rule Engine.
- Chưa nhập nhu cầu có `required_count=null`, `missing_count=null`, hiện **Chưa nhập nhu cầu / Chưa thể đánh giá**. Nhu cầu đã lưu bằng **0** vẫn là 0. Không biến các ô trống thành 0 hoặc tự kết luận đủ người.
- Chỉ số nhu cầu/đã xếp/còn thiếu tiếp tục tính từ dữ liệu nhu cầu/phân công gốc, không lấy các dòng hiển thị trống để tính. Giữ ảnh chụp nhu cầu của lịch cũ; nếu nhu cầu mới xuất hiện sau khi lưu DRAFT, hiển thị riêng “Nhu cầu hiện tại”, yêu cầu tạo phiên bản mới để sử dụng.
- Bảng tổng hợp và bộ lọc trên trang schedule được bổ sung danh mục từ context cùng tuần/chi nhánh/nguồn. Chọn Ca 2 hoặc Ca 3 vẫn thấy dòng ngay cả khi không có đăng ký/nhu cầu.
- Dữ liệu đăng ký trên bảng lịch lấy từ API tổng hợp hiện có qua callback của panel, không gọi API ghi hoặc tạo phân công. Chưa đọc thành công tổng hợp thì không tự kết luận số đăng ký bằng 0.
- Ma trận tình trạng và bảng lịch hiển thị **Chưa có nhân viên đăng ký** khi dữ liệu tổng hợp hợp lệ không có đăng ký cho ngày/ca. Bảng tổng hợp cũng thể hiện trường hợp không có đăng ký cho từng bộ phận. Các số đăng ký vẫn là đăng ký VALID theo Backend.
- Footer bảng nhập xác nhận **21 ca / tuần · 63 ô nhu cầu** khi danh mục đủ ba ca. Giữ nhập Tab/Enter/dán/sao chép, lưu từng ô, forecast, AI, Rule Engine, RBAC và chức năng bàn giao hiện có.

Không sửa Backend runtime, không khởi động lại tiến trình Backend đang chạy, không đổi `.env`, không sửa schema/migration hoặc ghi dữ liệu trên Supabase chung. Mock store của phiên đang chạy không bị reset bởi bản sửa. Mock vốn chỉ lưu trong bộ nhớ; khởi động lại Backend bằng tay vẫn sẽ mất dữ liệu thử nghiệm theo thiết kế hiện có.

## Kiểm thử thực tế

- Backend `npm.cmd test`: **94 pass, 1 skipped** / 95 bài. Bài PostgreSQL RPC cần database thử nghiệm riêng nên không chạy trên Supabase chung. Typecheck/build đạt.
- Frontend `npm.cmd test`: **66/66 pass**. Typecheck/build đạt.
- Kiểm thử HTTP chạy trên server biệt lập với auth fixture: cả `summary` và `tv3-flow` trả đủ ba ID ca trên API context/requirements; bảy ngày tương ứng 21 ca. Thêm nhu cầu Ca 3 bằng PUT vào mock store, tạo/đọc DRAFT và xác nhận Ca 3 cần 2, xếp 0, thiếu 2. Nhu cầu cũ, phân công, snapshot và DRAFT được giữ. Test chặn truy cập bảng nghiệp vụ Supabase.
- Kiểm thử Frontend: 63 ô nhập, ba ca/ngày và 21 ca/tuần kể cả khi chỉ Ca 1 có dữ liệu; bộ lọc đủ ba ca; ma trận mặc định một ngày/cả tuần; không đăng ký; chưa nhập nhu cầu; nhu cầu 0; giữ snapshot cũ, ca đã ngừng hoạt động có lịch sử và phân công thiếu nhu cầu đối chiếu.
- UI được kiểm tra bằng React SSR/hook/event harness, chưa chạy E2E trình duyệt thật.

## Cách kiểm tra trên website

1. Nếu đang dùng Mock Mode và có dữ liệu muốn giữ, **không khởi động lại Backend**; tải lại Frontend sau khi lưu xong thay đổi đang nhập.
2. Mở `/manager/demand`, chọn Cả tuần trong bảng nhập: đủ 21 dòng ca, 63 ô nhu cầu. Các ID và số đã lưu giữ nguyên. Ở “Tình trạng nhân sự từng ca”, ngày được chọn có ba dòng; Ca 2/Ca 3 không biến mất khi trống.
3. Mở `/manager/schedule`, chọn cùng tuần. Trong Tổng hợp đăng ký, dropdown Ca làm có đủ ba ca; thử Ca 3. Bảng lịch bên dưới cũng giữ Ca 3 và hiện trạng thái chưa có đăng ký/chưa nhập nhu cầu tương ứng. Cuộn vùng bảng để xem cả tuần.
4. Nếu đang dùng fixture `summary`, chỉ Ca 1 có dữ liệu mẫu là bình thường; hai ca còn lại vẫn phải xuất hiện. `tv3-flow` có đăng ký Ca 1/Ca 2, Ca 3 trống; không tự thêm đăng ký.
5. Lưu nhu cầu Ca 3 ở `/manager/demand`, đọc lại rồi tạo/tạo lại DRAFT theo luồng hiện có: không có đăng ký thì báo thiếu, không ẩn ca. Lịch cũ không tự bị ghi đè. Không phê duyệt/công bố tự động.
6. Nếu nguồn là Supabase thật và chưa có danh mục ca/đợt như kết quả đọc hiện tại, cần nhóm cung cấp dữ liệu nền đúng chi nhánh. Giao diện không tạo ca giả hoặc tự chuyển sang Mock. Nếu một API đang chạy thực sự chỉ trả một ca, đối chiếu nguồn/instance và danh mục được trả về; không tự bù hai UUID mới ở Frontend.

## File tạo/sửa trong lần này

Frontend:

- `frontend/src/services/scheduling.view.ts`: thêm lịch hiển thị đầy đủ, giữ helper số liệu gốc.
- `frontend/src/services/staffing-demand.view.ts`: thu hẹp kiểu tham số để dùng lại hàm hoàn thiện lịch tuần từ catalog, không đổi cách tính.
- `frontend/src/types/scheduling.ts`: cho phép metadata `is_active` tùy chọn trên ca trong context, tương thích API cũ.
- `frontend/src/pages/manager/ManagerSchedule.tsx`: dùng lịch đầy đủ, dữ liệu đăng ký từ panel và trạng thái ca trống.
- `frontend/src/pages/manager/ManagerSchedule.css`: vùng cuộn và cố định tiêu đề bảng lịch.
- `frontend/src/pages/manager/RegistrationSummaryPanel.tsx`: bộ lọc/bảng lấy đủ danh mục ca, callback tổng hợp và thông báo trống.
- `frontend/src/pages/manager/StaffingStatusMatrix.tsx`: thông báo ca chưa có đăng ký.
- `frontend/src/pages/manager/ManagerDemand.tsx`: chỉ số 21 ca/63 ô ở footer.

Tests:

- Mới: `backend/tests/shift-catalog-api.test.cjs`.
- Cập nhật: `frontend/tests/scheduling.test.cjs`, `frontend/tests/registration-summary.test.cjs`, `frontend/tests/staffing-status.test.cjs`, `frontend/tests/staffing-demand-grid.test.cjs`, `frontend/tests/staffing-demand.test.cjs`.

Tài liệu: `docs/tv3-three-shifts-fix.md`. Giữ nhánh `feature/tri-auto-scheduling`, không commit/push/merge.

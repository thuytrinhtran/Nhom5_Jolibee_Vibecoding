# Hiệu năng JolliShift — 03/11/2026

## Phạm vi và độ tin cậy

Đọc Supabase thật `wlbpprpiieonjrqglicv`, Lê Duẩn, tuần 02–08/11/2026. Không ghi dữ liệu nghiệp vụ, không chạy migration/index, không tạo yêu cầu đổi ca hoặc công bố lịch. PostgreSQL integration dùng cluster loopback riêng, dữ liệu tổng hợp.

**Chưa phải số đo thời gian tải trang trên trình duyệt đã đăng nhập.** `before.json` và `after.json` đo wall time của service/dependency bằng SDK thật, loại trừ HTTP xác thực Express và render React. Mỗi tác vụ chạy 3 lần; “lần đầu” là lần đầu trong process đo, “sau” là trung bình 2 lần tiếp theo, không phải browser cold/warm cache và không đủ mẫu để kết luận p95. Không sử dụng các con số này như Lighthouse/FCP hoặc cam kết SLA.

`registration_dependencies` chỉ đo 4 nguồn phụ thuộc, chưa đo toàn bộ API đăng ký. `publication` chỉ đo danh sách lịch, chưa gồm các request lịch sử/chi tiết. `shift_changes` đo luồng đọc của nhân viên, chưa phải toàn bộ danh sách quản lý. Trace thực tế của 3 vai trò, số API mỗi lần mở trang và render commits tại 1366×768 còn cần thu thập theo hướng dẫn cuối báo cáo. Không kết luận có render thừa hay polling API từ các số đo service.

## Kết quả đo (ms)

| Tác vụ đọc | Đầu trước | Đầu sau | Sau trước | Sau sau | HTTP Supabase trước → sau, lần đầu |
|---|---:|---:|---:|---:|---:|
| Dashboard quản lý | 5.591 | 1.403 | 5.460 | 910 | 13 → 8 |
| Phụ thuộc đăng ký ca | 256 | 364 | 256 | 206 | 4 → 4 |
| Nhu cầu nhân sự | 5.381 | 5.153 | 4.936 | 1.485 | 14 → 14* |
| Mở xếp lịch và bản đã lưu | 8.513 | 3.467 | 8.371 | 2.314 | 31 → 14 |
| Danh sách công bố | 307 | 304 | 301 | 304 | 1 → 1 |
| Lịch chính thức | 5.030 | 987 | 3.895 | 1.094 | 11 → 7 |
| Đọc đổi ca + lịch nhân viên | 207 | 585 | 1.390 | 495 | 1 → 1 + PostgreSQL |
| Lịch cá nhân | 201 | 166 | 247 | 185 | 1 → 1 |

*Lần đầu nhu cầu rơi về nguồn API cũ vì fast read không sẵn sàng; không bỏ mẫu chậm. Hai lần sau còn 10 HTTP. Không đủ bằng chứng xác định nguyên nhân transport của lần đầu. Lịch chính thức trước tải toàn bộ, sau chỉ tải trang 20 dòng + danh mục; đối chiếu toàn bộ các trang được thực hiện riêng. Các số đếm trên là subrequest từ backend đến Supabase, **không phải số API browser gọi**. Chi tiết từng request/status/thời gian tới response headers trong JSON; wall time bao gồm xử lý kết quả. Kết nối PostgreSQL không nằm trong HTTP spans.

## Nguyên nhân có bằng chứng và thay đổi

1. Dashboard trước lấy cả calendar/nguồn đăng ký để tính KPI. Đổi thành các truy vấn trường cần thiết và header đăng ký đã xác minh provenance; không tải 656 dòng đăng ký chỉ để đếm nhân viên.
2. Các request context/summary độc lập tải lại cùng snapshot. Gộp **chỉ request đang chạy**, khóa gồm project/context nhập mẫu/chi nhánh/kỳ. Không giữ completed cache. Mutation vô hiệu hóa ở đầu và khi finish/close; validation thao tác ghi vẫn đọc mới.
3. Nguồn `shift_registrations_sourced` là điểm chậm nhất lặp lại: baseline 30 HTTP, trung bình khoảng 2.256 ms, lớn nhất 3.549 ms. `EXPLAIN (ANALYZE, BUFFERS)` chỉ đọc của 500 dòng: execution 1.581,637 ms, 24.411 shared hits, đã dùng `shift_registrations_pkey`, không có disk read. Đã kiểm tra 16 index hiện hữu (`catalog-plan.json`); chưa có căn cứ tạo index mới.
4. Fast read **chỉ development, đúng project/batch/kỳ đã duyệt**: xác minh receipt một lần trong snapshot read-only, materialize header/after-image, join UUID trước kiểm tra toàn bộ row image. Giữ nguyên đối chiếu receipt, header, dòng, batch; không thay Rule Engine hay eligibility. Có fallback nguồn API đã kiểm chứng khi kết nối riêng không sẵn sàng. `TV2_LOCAL_SOURCE_READ_ENABLED` mặc định tắt trong code, đã bật trong backend local. Production và kỳ khác giữ nguồn cũ. Vẫn sử dụng cấu hình TLS/project riêng có sẵn, không chép credential vào repository.
5. Lịch chính thức thêm endpoint phân trang DB, lọc tuần/ngày/ca/bộ phận/nhân viên. Chỉ PUBLISHED có published_at, phiên bản hiệu lực, ACTIVE; backend xác minh vai trò/chi nhánh và từ chối trường lạ. 20 dòng/trang, tối đa 100. Danh mục không tải lại khi đổi trang/bộ lọc; đổi tuần/đổi tài khoản/tải lại làm mới danh mục.
6. Frontend lazy load 12 trang, giữ layout/loading khi tải chunk. JS ban đầu 407.293 → 233.859 bytes; gzip 119.868 → 74.233 bytes (giảm khoảng 38%). Đây là initial bundle; không có nghĩa tổng dung lượng mọi chunk cùng giảm.
7. Bỏ `/auth/me` thừa trước từng request scheduling: vẫn refresh phiên khi cần; middleware backend vẫn xác minh token, tài khoản, vai trò, chi nhánh từng API. Gộp GET đồng thời theo phiên/token/URL, response body độc lập, không TTL. Không tái sử dụng kết quả đọc đã hoàn tất sau công bố/đổi ca/đăng ký.
8. Tái sử dụng pool PostgreSQL local tối đa 3 kết nối thay vì mở mới từng RPC. Giữ nguyên transaction-local headers, timeout và RPC kiểm tra quyền/lock/audit; trả kết nối lỗi rollback bằng destroy. Không cache profile/phân quyền.

Không tìm thấy vòng truy vấn mỗi nhân viên trong các luồng đã đo để kết luận N+1; vấn đề chính là snapshot/kiểm chứng provenance lặp lại và tải quá rộng. Không thay thuật toán xếp lịch, workflow hay ràng buộc đổi ca.

## Kiểm chứng dữ liệu và kiểm thử

- `source-parity.json`: 53 header/656 dòng, canonical SHA-256 nguồn cũ và mới giống nhau: `114388ac20a01fdddd1bae6ba2b9a4818e24458de30bced22f1c2bd8c9868b6e`.
- `result-parity.json`: Dashboard mới khớp đối chiếu cũ; 60 nhân viên, 53 đã đăng ký, PUBLISHED 308 phân công, 1 yêu cầu đang chờ, 0 vị trí thiếu tại thời điểm đo. Toàn bộ ID phân công chính thức sau phân trang khớp 308 ID cũ. Các số này là evidence snapshot, không hardcode UI.
- Backend typecheck/build PASS; regression 257 PASS, 26 SKIP (nhóm integration cần opt-in). Frontend typecheck/build PASS; 192 PASS trong `frontend-tests.txt`.
- `native-source-tests.txt`: PostgreSQL cô lập kiểm chứng nguồn mới/cũ và ngăn header/row bị sửa sau import, thiếu context; 2 PASS. Lỗi ban đầu của fixture là UPDATE trên timestamp NULL không thay đổi giá trị; đã sửa fixture dùng coalesce, không sửa nghiệp vụ.
- `native-tv4-tests.txt`: 1 PASS, vòng đời DRAFT/gửi/từ chối/trình lại/duyệt/công bố, rollback và khóa. `native-tv5-tests.txt`: 1 PASS, quyền sở hữu/đồng ý, hai người cùng nhận, rollback, từ chối và lịch nhân viên sau đổi. Lần chạy gộp ban đầu (`native-workflow-tests.txt`) chưa được cách ly đầy đủ các flag local và bị dừng; không dùng làm bằng chứng PASS. Chạy lại riêng với các flag scope/dev-import/local transport tắt trong process test đều đạt. Không sửa `.env` đang chạy để test, không thực hiện các bước nghiệp vụ ghi trên Supabase chung.

## File liên quan thay đổi hiệu năng

- Backend: `src/services/read-coalescing.ts`, `repositories/read-summary.ts`, `services/{scheduling,staffing-demand,manager-overview,official-calendar}.service.ts`, `registrations/{tv3-source,local-source-read}.ts`, `services/tv5-local-rpc.ts`, `middleware/auth.middleware.ts`, `utils/profile-details.ts`, `routes/scheduling.routes.ts`, `server.ts`.
- Frontend: `App.tsx`, `components/layout/AppLayout.tsx`, `services/{auth,scheduling}.service.ts`, `pages/schedules/scheduleWorkflow.api.service.ts`, `pages/manager/OfficialSchedule.tsx`, `types/manager-calendar.ts`, `services/performance-diagnostics.ts`, `main.tsx`.
- Tests: backend `read-coalescing`, `official-calendar-api`, `local-source-read`; frontend `auth.test.cjs`. Script đo `backend/scripts/benchmark-read-performance.cjs`.
- `.env` local: chỉ thêm flag đọc nhanh và diagnostics, không đổi Supabase URL/key/persistence. Các file dirty từ các giai đoạn trước không phải toàn bộ thay đổi của đợt hiệu năng này.

## Phần còn chậm / cần nghiệm thu trình duyệt

Xếp lịch vẫn cần đọc và xác minh nguồn thật; lần đầu 3,47 s. Nhu cầu có mẫu fallback 5,15 s; không che lỗi bằng dữ liệu cũ. Danh sách công bố gần như không đổi. Lần đầu đăng ký/đổi ca trong mẫu sau không nhanh hơn mẫu trước; chưa đủ mẫu để kết luận cải thiện mọi trang. Chưa có số đo render để biện minh thêm memo hoặc đổi layout.

Diagnostics local đã bật bằng `VITE_PERFORMANCE_DIAGNOSTICS=true`, không thêm request, không thu body/header/token. Để đo UI thực tế:

1. Đăng nhập lần lượt NV, QL, GS trên website local; DevTools responsive 1366×768. Reload từng trang để đo navigation đầu, sau chuyển route và quay lại cùng tuần để đo các lần sau. Giữ cấu hình cache DevTools giống nhau giữa các lần; không so Vite dev với production build.
2. Mở đủ 8 trang; chờ loading kết thúc, không tự bấm thao tác ghi. GS mở danh sách chờ duyệt/lịch sử. Ghi lại lúc nội dung chính xuất hiện bằng Performance recording; FCP/LCP chỉ áp dụng document navigation, không tự coi là thời gian dữ liệu SPA sẵn sàng.
3. Console chạy `window.__jolliShiftPerformance.snapshot()` hoặc `.download()`. JSON chứa viewport, paint, API duration/path đã ẩn UUID và render commits của layout. ResourceTiming cross-origin có thể không trả đủ chi tiết timing/bytes nếu thiếu Timing-Allow-Origin; dùng Network Duration để đối chiếu. Không xuất HAR chứa token.
4. So request count và commit duration trong cùng thao tác; chỉ kết luận request/render thừa khi trace chứng minh. Không có bản baseline browser trước chỉnh sửa nên không thể dựng lại số liệu đó từ service benchmark.
5. Muốn nghiệm thu cache sau thao tác ghi, người dùng tự thực hiện đăng ký/công bố/chấp thuận đổi ca rồi tải lịch bằng tài khoản liên quan; kiểm tra ACTIVE assignments mới và không còn ca cũ. Test cô lập kiểm tra quyền và rollback; không thay thế hoàn toàn nghiệm thu tài khoản thật.

Không cần migration hoặc thao tác Supabase nào để dùng các tối ưu local này. Có thể tắt fast read bằng `TV2_LOCAL_SOURCE_READ_ENABLED=false`; tắt diagnostics bằng `VITE_PERFORMANCE_DIAGNOSTICS=false` và khởi động lại dịch vụ tương ứng.

# Báo cáo QA TV4 — phê duyệt và công bố lịch

Ngày kiểm tra: 29-10-2026

Phạm vi: mock workflow TV4 trong frontend. Không áp dụng migration, không gọi API ghi nghiệp vụ, không kết nối Supabase để ghi dữ liệu, không deploy và không commit.

## Môi trường và phương pháp

- Node.js `v26.13.0`, npm `11.20.0`.
- Frontend dùng Vite/React. Cổng frontend `5173`, backend `5000`; tại thời điểm khảo sát không có tiến trình lắng nghe ở các cổng này.
- Không tìm thấy Playwright, Puppeteer, jsdom/happy-dom hoặc browser automation runner trong dự án/môi trường. Không có Chrome, Edge hoặc Chromium khả dụng.
- Vì vậy các ca tự động bên dưới chạy bằng test Node hiện có; các test giao diện dùng harness React giả lập để kích hoạt callback và kiểm tra state. Đây không phải kiểm thử trình duyệt thực tế.
- Dữ liệu TV4 được cung cấp bởi singleton mock service trong bộ nhớ. Không có TV4 localStorage/sessionStorage/API persistence. Tải lại toàn bộ trang khởi tạo lại module và khôi phục seed; nút tải lại trong giao diện chỉ đọc lại trạng thái singleton hiện hành, không reset seed.

## Kết quả kiểm tra tự động

| Kiểm tra | Kết quả thực tế |
|---|---|
| `npm test` (baseline trước mọi thay đổi trong lượt QA) | PASS — 50/50, 0 lỗi, 0 bỏ qua |
| `npm run typecheck` | PASS |
| `npm run build` | PASS — Vite 6.4.5, 1607 modules transformed |
| `git diff --check` | PASS — không có whitespace error trong diff hiện hữu |
| Test PostgreSQL/Supabase | NOT RUN — không cần thiết cho mock workflow; không truy cập database |
| Kiểm thử trình duyệt thật | BLOCKED — không có frontend/backend đang chạy hoặc browser runner/binary |

Phân loại trong 50 test: 36 test mock workflow/UI harness TV4; 2 test cấu trúc route/menu; 12 test hồi quy nền tảng auth, password, proxy và platform. Test component mô phỏng tương tác, không chứng minh rendering hoặc CSS trên trình duyệt.

## Ma trận ca kiểm thử

`PASS (automated)` là kết quả từ test tự động hiện có hoặc kiểm tra mã nguồn; `BLOCKED` là chưa thể xác nhận trong runtime trình duyệt/tài khoản thật.

| ID | Ca kiểm thử | Trạng thái | Ghi chú |
|---|---|---|---|
| TV4-01 | Seed có đủ trạng thái lịch và thông tin lịch sử nhất quán | PASS (automated) | Có DRAFT, PENDING_APPROVAL, NEEDS_REVISION, APPROVED, PUBLISHED; refusal/publication metadata được kiểm tra trong mock tests. |
| TV4-02 | GS duyệt lịch đang chờ và trạng thái/decision được cập nhật | PASS (automated) | Service chỉ nhận quyết định khi phiên bản đang PENDING_APPROVAL. |
| TV4-03 | GS từ chối yêu cầu lý do; lưu NEEDS_REVISION và lịch sử | PASS (automated) | Không tạo trạng thái REJECTED. |
| TV4-04 | QL điều chỉnh, gửi lại nhiều phiên bản; giữ nguyên lý do/lịch sử các phiên bản cũ | PASS (automated) | Có kiểm tra chuỗi từ chối và gửi lại nhiều lần. |
| TV4-05 | Không duyệt hoặc công bố phiên bản cũ | PASS (automated) | Service kiểm tra phiên bản mới nhất trước thao tác. |
| TV4-06 | Chỉ QL đúng chi nhánh được điều chỉnh/gửi lại/công bố | PASS (automated) | Kiểm tra role và branch scope ở service; không bỏ lọc branch_id. |
| TV4-07 | Chỉ APPROVED mới công bố; sau công bố là PUBLISHED và có publisher/time | PASS (automated) | Trạng thái và lịch sử công bố được kiểm tra. |
| TV4-08 | Reset seed và khởi tạo lại không sinh bản ghi trùng | PASS (automated) | Test tải lại module mock xác nhận seed xác định; reset ở đây là reload ứng dụng, không phải thao tác xóa dữ liệu. |
| TV4-09 | Mỗi ngày có ba ca 08:00–12:00, 12:00–17:00, 17:00–22:00 | PASS (automated/source) | Seed và validation dùng ba ca; có 21 assignment mỗi lịch tuần. Dữ liệu nhân viên là fixture demo, không tạo tài khoản đăng nhập. |
| TV4-10 | Điều chỉnh ca không để hai assignment trùng slot; validation giữ đúng cấu hình ca | PASS (automated) | Chọn slot đang có người được xử lý bằng hoán đổi trong cùng ngày; service vẫn validate payload. |
| TV4-11 | UI “Điều chỉnh” xác nhận callback, gửi payload đã sửa, đóng hộp thoại và cập nhật danh sách khi service thành công | PASS (component harness) | Harness tương tác xác nhận callback, dữ liệu gửi, reload list và success modal. Chưa xác nhận bằng browser. |
| TV4-12 | Service lỗi/validation lỗi hiển thị lỗi; không hiện success và giữ nội dung đang chỉnh | PASS (component harness) | Không dùng alert/confirm mặc định trong component TV4. |
| TV4-13 | Chuyển GS ↔ QL trên cùng phiên mock | PASS (service tests) | Cùng module singleton được dùng; phiên đăng nhập thật chưa được kiểm tra. |
| TV4-14 | GS xem và xử lý Hải Châu/Thanh Khê theo fixture scope | PASS (service tests) | Chỉ các scope cấu hình rõ ràng trong fixture được xác nhận. |
| TV4-15 | GS có quyền trên chi nhánh Jollibee Lê Duẩn | BLOCKED | Fixture hiện gán Lê Duẩn vào scope demo GS, nhưng cấu hình quyền thật chưa được xác nhận. Không mở rộng hoặc chỉnh quyền trong QA này. |
| TV4-16 | Profile QL thực tế ánh xạ đúng chi nhánh và thấy lịch sau đăng nhập | BLOCKED | Không chạy ứng dụng với tài khoản thật; không đọc token/profile hoặc gọi API. Branch fixture hiện có test nhưng không xác nhận profile runtime. |
| TV4-17 | Bố cục, modal responsive, màu sắc, thông báo và danh sách trên desktop/mobile browser | BLOCKED | Chỉ source/CSS được rà soát; không có browser để render. |
| TV4-18 | Hoạt động với PostgreSQL/Supabase và route backend thật | NOT RUN | Migration chưa áp dụng; QA này chỉ đánh giá mock. Không được xem kết quả mock là tích hợp database. |

## Nhận xét và kết luận

- Baseline tự động không có test thất bại. Trong lượt QA này không sửa mã nguồn TV4; chỉ tạo báo cáo này.
- Luồng “Điều chỉnh” hiện dùng service result: khi thành công, component đóng confirm, tải lại danh sách và hiện success modal; khi service ném lỗi, component hiện inline error và giữ dữ liệu nhập. Đây là kết quả test harness và rà soát mã, chưa phải quan sát trên trình duyệt.
- Phiên bản mới được tạo thành PENDING_APPROVAL; phiên bản bị từ chối vẫn giữ NEEDS_REVISION, lý do và lịch sử. Công bố bị giới hạn ở phiên bản APPROVED mới nhất.
- Mock dùng ba ca mỗi ngày và lịch mẫu có đủ 21 vị trí assignment cho tuần. Hai fixture nhân viên mock được tái sử dụng giữa các ca không trùng thời gian; đây không phải bằng chứng rằng tài khoản nhân viên thật đã được phân ca.
- Kết quả đủ để trình diễn các quy tắc nghiệp vụ bằng bộ test mock hiện có, nhưng chưa đủ để tuyên bố giao diện đã được kiểm thử end-to-end trên browser hoặc quyền GS tại Lê Duẩn đã đúng. Cần xác nhận cấu hình supervisor scope trước khi demo quyền GS cho chi nhánh này.
- Trước khi xác nhận runtime thủ công: khởi động backend và frontend theo hướng dẫn của dự án, đăng nhập bằng tài khoản thử nghiệm phù hợp, chạy lại luồng duyệt/từ chối/điều chỉnh/gửi lại/công bố trên giao diện; tránh nhầm dữ liệu singleton trong cùng runtime với dữ liệu lưu bền vững.

## Tình trạng working tree

Các thay đổi source và artifact đã có trước lượt QA được giữ nguyên. Không commit/push và không sửa các file đó. Báo cáo này là file mới được tạo trong lượt QA.

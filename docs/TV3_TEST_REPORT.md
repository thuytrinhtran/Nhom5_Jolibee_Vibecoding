# Báo cáo kiểm thử TV3 JolliShift

Ngày kiểm thử: 30/10/2026 (Asia/Saigon). Nhánh: `feature/tri-auto-scheduling`.

## Kế hoạch và giới hạn

Kiểm tra Git và code trước khi sửa; chạy baseline, bổ sung test các khoảng trống,
tái hiện lỗi trước khi sửa rồi chạy lại toàn bộ build/test/typecheck.
Chỉ dùng fixture tổng hợp, kho MOCK trong bộ nhớ, Supabase client stub và Gemini
transport stub. Vô hiệu hóa `SCHEDULING_TEST_DATABASE_URL`; chặn external fetch bằng
preload `backend/tests/helpers/offline-only.cjs`. Không migration, không ghi DB chung,
không gọi Gemini thật, không commit/push/merge và không đọc giá trị khóa trong `.env`.

## Kết quả chạy lệnh

| Lần chạy | Backend PASS / FAIL / SKIP | Frontend PASS / FAIL / SKIP |
| --- | --- | --- |
| Baseline trước sửa nghiệp vụ | 102 / 0 / 1 | 68 / 0 / 0 |
| Tái hiện lỗi mới, chỉ chạy 2 regression | 0 / 2 / 0 | Không chạy |
| Sau sửa, chạy test Engine và hành trình mới | 26 / 0 / 0 | Client Frontend được thực thi trong test hành trình |
| Toàn bộ sau sửa | **105 / 0 / 1** | **68 / 0 / 0** |

Tổng cuối cùng: **173 PASS, 0 FAIL, 1 SKIP**, 174 test được liệt kê.
Hai FAIL ở lần tái hiện đã được sửa; không cộng các lần chạy lặp vào tổng cuối.
Tổng này gồm cả test auth/password hiện hữu để phát hiện regression, không phải
174 ca nghiệp vụ TV3 riêng biệt. Backend build (`tsc`) và `npm.cmd run typecheck`
đạt; Frontend build production (`tsc -b && vite build`) và typecheck đạt, không có
TypeScript error. Frontend build chuyển đổi 1620 module thành công.

SKIP duy nhất: `PostgreSQL RPC persistence, retry, RBAC and atomic rollback` trong
`backend/tests/scheduling-database.test.cjs`. Cố ý không cung cấp database thử nghiệm,
không chạy `psql`, file SQL hoặc migration. Test adapter Supabase khác dùng object
stub, không xác minh schema/RLS/transaction trên database thật.

## Cấu trúc và trạng thái Git

Đã kiểm tra trước sửa: đúng nhánh `feature/tri-auto-scheduling`; không đổi nhánh.
Bốn file tracked có thay đổi sẵn: `backend/.env.example`, `backend/package.json`,
`backend/src/server.ts`, `frontend/src/App.tsx`. Giữ nguyên các thay đổi đó.
Phần lớn TV3 vẫn là **untracked**, gồm:

- Backend: `src/routes/scheduling.routes.ts`; toàn bộ `src/repositories/` của TV3;
  các service `registration-summary`, `staffing-demand`, `scheduling`,
  `mock-scheduling`, `scheduling-input`, `schedule-review`, `schedule-ai*`;
  các test cùng tên, `tv3-flow`, `tv3-handoff`, `shift-catalog` và các tài liệu TV3.
- Frontend: `ManagerDemand`, `ManagerSchedule`, `RegistrationSummaryPanel`,
  `StaffingStatusMatrix`, `MockDraftEditor`, `ScheduleAIPanel`, `ScheduleReviewPanel`,
  CSS; các service `scheduling*`, `staffing-demand*`, `staffing-status*`,
  `types/scheduling.ts` và các test tương ứng.
- `backend/scripts/dev-tv3-test.cjs` và
  `backend/migrations/20261029_automatic_scheduling.sql` cũng chưa được theo dõi.
  Migration chỉ được đọc để nhận diện phụ thuộc, không chỉnh sửa/chạy.

Vì các file này chưa được theo dõi, `git diff --stat` một mình không phản ánh đầy
đủ công việc TV3. Cần xem thêm `git status --short` và
`git ls-files --others --exclude-standard`. Không stage/commit trong đợt kiểm thử.

Các API được mount dưới `/api/schedules`, đều dùng xác thực và vai trò `QL`:
`GET /periods`, `GET /periods/:id`, `GET /periods/:id/registrations-summary`,
`GET/PUT/DELETE /periods/:id/requirements`, `POST /generate`, `GET /:id`,
`PATCH /:id/draft-assignments`, `GET/POST /:id/ai-evaluation`,
`POST /:id/validate`, `POST /:id/approval-handoff`.
Frontend dùng `/manager/demand` và `/manager/schedule`.

MOCK chỉ bật với `NODE_ENV=development`, `SCHEDULING_DATA_SOURCE=mock`;
`SCHEDULING_MOCK_SCENARIO=summary` hoặc `tv3-flow`. Không fallback từ Supabase lỗi
sang MOCK. Nhu cầu/lịch/AI MOCK ở trong bộ nhớ, tách theo chi nhánh và kịch bản;
không lưu bền qua restart hoặc chia sẻ giữa nhiều tiến trình. Trong ứng dụng bình
thường, xác thực/RBAC vẫn phụ thuộc TV1; trong test đã thay bằng stub độc lập.

## Ma trận kiểm thử

Trong bảng, PASS chỉ áp dụng cho fixture/test nêu trong cột bằng chứng. BE =
`backend/tests/`, FE = `frontend/tests/`. P1: cần trước tích hợp/phát hành;
P2: giới hạn thuật toán/kiểm thử cần theo dõi. Dấu “—” nghĩa không phát hiện lỗi
trong ca đã chạy, không phải cam kết không có lỗi với mọi dữ liệu.

| STT | Chức năng | Test case | Kết quả PASS/FAIL/BLOCKED/NOT TESTED | Bằng chứng | Lỗi còn lại | Mức độ ưu tiên |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Chế độ dữ liệu | MOCK chỉ trong development, cấu hình sai bị chặn, không fallback | PASS | BE `registration-summary.test.cjs`, `tv3-flow.test.cjs` | — | P1 |
| 2 | Cách ly dữ liệu | Luồng MOCK không chạm business tables/RPC Supabase | PASS | BE `tv3-flow.test.cjs`, `tv3-journey.test.cjs`: RPC fail ngay; chỉ cho phép auth table stub | Không chứng minh RLS thật | P1 |
| 3 | Đăng ký | VALID được tính; DRAFT/INVALID bị loại | PASS | BE `registration-summary.test.cjs`, `scheduling.test.cjs` | — | P1 |
| 4 | Đăng ký | Trùng nhân viên/ngày/ca chỉ đếm một | PASS | BE `deduplicates VALID registrations...`, `duplicate registrations do not duplicate assignments` | — | P1 |
| 5 | Đăng ký | Khác chi nhánh, sai đợt/ngày bị loại | PASS | BE `out-of-branch employees and wrong-period/date records...` | — | P1 |
| 6 | Đăng ký | Sai kỹ năng/bộ phận, không có đăng ký, thiếu hồ sơ | PASS | BE `registration-summary.test.cjs`, `scheduling.test.cjs` | Thiếu dữ liệu được báo UNKNOWN | P1 |
| 7 | Danh mục ca | 08–12, 12–17, 17–22; 21 ca/tuần kể cả ca trống | PASS | BE `shift-catalog-api.test.cjs`, `tv3-journey.test.cjs`; FE `scheduling.test.cjs`, `staffing-demand-grid.test.cjs` | Browser thật chưa thử | P1 |
| 8 | Nhu cầu | 7 ngày × 3 ca × 3 bộ phận = 63 ô | PASS | FE `63 accessible uniform inputs...`; BE journey xác nhận `gridCells=63`, lưu đủ 63 requirement | — | P1 |
| 9 | Nhu cầu | Nhập/sửa/lưu rồi đọc lại trong cùng tiến trình | PASS | BE `staffing-demand-grid.test.cjs`, `staffing-demand-api.test.cjs`, journey | Restart MOCK mất dữ liệu theo thiết kế | P1 |
| 10 | Nhu cầu | Chưa xác định khác 0; xóa có revision, không tự PUT 0 | PASS | FE/BE `staffing-demand-grid.test.cjs` | null là không có row; DB count không nullable | P1 |
| 11 | Nhu cầu | Chặn âm/thập phân/không phải số/overflow/field giả mạo | PASS | FE grid `validation distinguishes blank/zero...`; BE `staffing-demand.test.cjs`, API | — | P1 |
| 12 | Nhu cầu | Sao chép thứ Hai/cả tuần, ngày trước; hủy ghi đè; paste lỗi không đổi draft | PASS | FE `copy Monday, previous day and Excel paste...` | Chưa thao tác clipboard browser thật | P1 |
| 13 | Forecast | Lưu/giữ kỹ năng và tham chiếu forecast; không quy đổi doanh thu | PASS | FE `workspace shows manual demand...`, grid save; BE `staffing-demand.test.cjs` | Chưa có công thức nhân sự; chỉ reference/ghi chú | P1 |
| 14 | Nhu cầu | Lưu một phần lỗi giữ ô lỗi; retry giữ revision, không vượt conflict | PASS | FE `save only edited cells; keep per-cell failures...`; BE concurrent demand tests | Không có transaction cho toàn bộ 63 ô | P1 |
| 15 | Cung cầu | Đủ/thiếu/dư/UNKNOWN; không đăng ký VALID | PASS | BE `registration-summary.test.cjs`; FE `registration-summary.test.cjs`, `staffing-status.test.cjs` | — | P1 |
| 16 | Cung cầu | Có đăng ký nhưng không đủ điều kiện; không nhầm eligible và assigned | PASS | BE eligibility tests; journey xác nhận eligible=2 nhưng assigned=1 do cap/ngày | Cung độc lập theo ca không phải lời hứa xếp đủ mọi ca | P1 |
| 17 | Cung cầu | Hiển thị/lọc ngày, đủ 3 ca/3 bộ phận, ngày/ca trống | PASS | FE `staffing-status.test.cjs`, `registration-summary.test.cjs` | SSR/hook tests, chưa browser thật | P1 |
| 18 | Engine | Đủ khi fixture đủ nguồn; thiếu vẫn trả shortage, không tạo người giả | PASS | BE `fills demand...`, `shortages are retained...`, `tv3-flow.test.cjs` | Thuật toán tham lam không bảo đảm tối ưu mọi đầu vào | P2 |
| 19 | Engine | Không xếp người sai đăng ký/kỹ năng/bộ phận/account/role | PASS | BE `scheduling.test.cjs` với các mutation tương ứng | — | P1 |
| 20 | Engine | Không trùng giờ, kể cả shift ID khác; biên hai ca liền nhau | PASS | BE `overlapping shifts...`, `previous-day overnight commitment...` | — | P1 |
| 21 | Engine | Giới hạn giờ tuần, tính lịch đã có, cap ca/ngày chỉ khi cấu hình | PASS | BE `weekly cap...`, `tv3-flow.test.cjs` | Cap 1 ca/ngày trong tv3-flow là TEST_ONLY | P1 |
| 22 | Engine | Ca qua ngày, cuối tuần và phần giờ tuần kế tiếp | PASS | BE `overnight duration...`, `Sunday overnight assignment...` | — | P1 |
| 23 | Engine | Không vượt nhu cầu, không xếp Crew Leader như NV | PASS | BE `fills demand...`, `Crew Leader excluded...`, review tests | Crew Leader/support cần quy trình riêng | P1 |
| 24 | Engine | CREW_TRAINING → REGULAR → NEW; ít ca trước rồi stable ID; ngưỡng NEW | PASS | BE `level priority precedes fairness...`, `warning requires configured threshold...` | Đúng rule code hiện tại; cần nhóm xác nhận chính sách thực tế | P1 |
| 25 | Engine | Đếm khan hiếm phải loại người vượt giờ hoặc đã bận | PASS | Hai test `scarcity counts...` đều FAIL trước sửa vì chỉ xếp 1/2 vị trí; nay cả hai PASS | Đã sửa một lỗi; chưa phải solver tối ưu toàn cục | P1 |
| 26 | DRAFT | Tạo từ nhu cầu đã lưu; tạo lại khi nhu cầu đổi | PASS | BE `tv3-flow.test.cjs`, `staffing-demand-grid.test.cjs`, journey | Tạo lại thật chưa hỗ trợ trong luồng này | P1 |
| 27 | DRAFT | Thay người, xóa và thêm phân công hợp lệ | PASS | BE `draft edits validate...`; journey v1 → v2 xóa → v3 thêm lại; FE `tv3-flow.test.cjs` | Chỉnh sửa hiện chỉ MOCK | P1 |
| 28 | DRAFT | Chặn sai kỹ năng/đăng ký/trùng/vượt nhu cầu; kiểm tra Rule Engine khi lưu | PASS | BE `tv3-handoff.test.cjs`, `tv3-flow.test.cjs`, journey duplicate rejection | — | P1 |
| 29 | DRAFT | Phiên bản mới, bản cũ bất biến; hai request chỉ một thành công | PASS | BE `manual demand changes...`, `concurrent edits...`; journey đọc lại v1 | CAS trong bộ nhớ, chưa chứng minh DB transaction | P1 |
| 30 | DRAFT | Ghi thành công nhưng đọc lại lỗi không báo thành công giả | PASS | FE `successful write followed by failed read...`; client tests | Browser thật chưa thử | P1 |
| 31 | AI | Client → POST Express → Gemini stub → lưu/GET evaluation | PASS | BE `schedule-ai-api.test.cjs`, journey; FE `schedule-ai.test.cjs` | Không gọi Gemini thật | P1 |
| 32 | AI | Đủ người SUITABLE, thiếu người NEEDS_ADJUSTMENT, thiếu dữ liệu INSUFFICIENT_DATA | PASS | BE `fully staffed schedule...`, `actual summary fixture missing demand...`; journey | Chỉ test double, không xác minh chất lượng nhận xét model thật | P1 |
| 33 | AI | Không cần đủ 63 ô; DRAFT chưa phân công người vẫn đánh giá | PASS | BE `configured HTTP flow accepts partial-week shortage...`, `DRAFT with no assigned staff...`; FE shortage test | Hard constraints/data hiện hành vẫn bắt buộc | P1 |
| 34 | AI | Schema gửi chỉ gợi ý văn bản, candidate_assignments=null; parser chặt | PASS | BE `Gemini outbound subset...`, `Gemini evaluation accepts text advice...`, invalid JSON test | Tương thích máy chủ Gemini thật chưa xác minh | P1 |
| 35 | AI | HTTP 400/401/403/404/429/500, timeout/mạng/stream, JSON sai | PASS | BE `provider HTTP failures...`, `safe diagnostics...`, `network failures...` | HTTP provider giữ mã chung AI_PROVIDER_UNAVAILABLE, message phân loại; invalid response là 502 | P1 |
| 36 | AI | Schema quá phức tạp khác unsupported field/model; không lộ raw error/key | PASS | BE `safe diagnostics classify provider evidence...` | Chưa có lỗi Gemini thật để xác minh nguyên nhân HTTP 400 trước đây | P1 |
| 37 | AI | Không gọi khi mở trang/focus; không tự áp dụng/phê duyệt/công bố | PASS | FE `unconfigured AI...`, `explicit action POSTs...`; BE assignments/status unchanged | — | P1 |
| 38 | AI | Đề xuất phân công được Rule Engine kiểm tra, sai luật bị REJECTED | PASS | BE `AI proposal violating skills...`; FE unsafe suggestion display | Adapter đánh giá hiện chỉ trả văn bản; chưa có bước đề xuất phân công Gemini riêng | P1 |
| 39 | AI | Báo cáo cũ STALE khi nhu cầu/version/inputs thay đổi; chặn concurrent | PASS | BE `saved evaluation becomes STALE...`, `same-version data mutation...`; FE invalidation; journey | — | P1 |
| 40 | TV4 | Kiểm tra lịch; chặn thiếu người/thiếu dữ liệu/stale/version cũ | PASS | BE `tv3-handoff.test.cjs`; FE `schedule-review.test.cjs` | — | P1 |
| 41 | TV4 | Payload đúng schedule ID/version/hash; giữ DRAFT và delivery.sent=false | PASS | BE `validation/handoff block...`, journey version=4; FE preview chưa gửi | Chưa có API nhận TV4 | P1 |
| 42 | Quyền | Chưa đăng nhập 401; NV/GS 403; khác chi nhánh 404; không nhận branch giả | PASS | BE `*-api.test.cjs`, `tv3-flow.test.cjs`, `tv3-handoff.test.cjs` | Identity/profile dùng stub; RLS thật chưa thử | P1 |
| 43 | Lỗi | Missing/invalid input; backend mất kết nối; API HTML/non-JSON/503 | PASS | BE API tests; FE `scheduling.test.cjs`, `proxy.test.mjs`, `staffing-demand.test.cjs` | — | P1 |
| 44 | Navigation | Mở lại tuần đọc bản đã lưu; đổi tuần có guard bỏ thay đổi; hủy giữ draft | PASS | FE `reopening a week...`, `changing week asks...`, grid guard tests; BE journey | Chưa xác minh history/focus trên browser thật | P1 |
| 45 | Đồng thời | Hai request nhu cầu/lịch cùng revision chỉ một ghi thành công | PASS | BE `two concurrent mock updates...`, `concurrent edits...`, clear concurrency | Chỉ tiến trình MOCK; DB chưa thử | P1 |
| 46 | Hành trình tích hợp | Fixture VALID → nhập/lưu → cung cầu → generate → sửa → validate → AI stub → handoff | PASS | BE `tv3-journey.test.cjs`, test `complete TV3 journey...`, hơn 75 HTTP request localhost | Không gồm thao tác đăng ký TV2 hoặc browser thật | P1 |
| 47 | UI thật | Click, focus, copy/paste clipboard, back/reload, responsive và phiên đăng nhập | NOT TESTED | Không có browser tool; `playwright`, `@playwright/test`, `puppeteer` không cài | Cần checklist thủ công dưới đây | P1 |
| 48 | TV1 database | Schema/enum/FK, RLS, grants/RPC, rollback/idempotency và lưu qua restart | NOT TESTED | Test PostgreSQL chủ động SKIP; các adapter chỉ stub | Cần database riêng có schema đúng đã được TV1 xác nhận | P1 |
| 49 | Gemini thật | HTTP 400 đã hết? Model/key/quota/latency/nhận xét thật | NOT TESTED | Không gửi request Gemini thật trong đợt audit | Chưa thể tuyên bố hoạt động | P1 |
| 50 | TV4 gửi thực tế | Tiếp nhận/phê duyệt đúng phiên bản | BLOCKED | Gateway `configured=false`, UI nút gửi disabled | Thiếu API/contract tiếp nhận TV4 | P1 |
| 51 | Lịch thật | Chỉnh sửa/tạo lại DRAFT trong Supabase | BLOCKED | `mock-scheduling.service.ts` chặn khi không phải MOCK; real regenerate trả MOCK_FLOW_REQUIRED | Chức năng chưa triển khai cho nguồn Supabase | P1 |
| 52 | Nguồn TV2 | Đăng ký qua UI/API TV2 rồi TV3 đọc DB thật | NOT TESTED | Hành trình bắt đầu bằng fixture VALID có sẵn | Cần TV2/TV1 thống nhất trạng thái/đợt/chi nhánh | P1 |
| 53 | Tối ưu/tải lớn | Mọi tập ràng buộc khả thi đều được xếp đủ; thời gian với dữ liệu lớn | NOT TESTED | Engine tự ghi chú không bảo đảm tối ưu toàn cục; chưa benchmark | Không suy rộng từ fixture nhỏ | P2 |

## Lỗi đã tái hiện và sửa

**TV3-001 — Đếm sai nguồn ứng viên khi chọn ca khan hiếm (P1).**
Hai nhân viên A/B cùng kỹ năng, đều đăng ký VALID cho ca 4 giờ và ca 5 giờ.
A có trần 5 giờ/tuần; B có trần 4 giờ/tuần. Nhu cầu mỗi ca một người. Trước sửa,
hai ca đều được đếm có 2 ứng viên, ca 4 giờ được xử lý trước và chọn A; ca 5 giờ
không còn ai nhận được: chỉ 1/2. Có phương án hợp lệ B → 4 giờ, A → 5 giờ.
Ca thứ hai tái hiện thêm việc B đã có phân công trùng ca 5 giờ, A chỉ còn đủ giờ
cho một ca. Cả hai test mới thất bại trước khi sửa code (`1 !== 2`).

Sửa trong `backend/src/services/scheduling.engine.ts`: tính số ứng viên ban đầu
cho từng nhu cầu bằng `assignmentIssue(input, employee, requirement, existing)`
trước khi sắp ca khan hiếm; cache phép đếm này. Vẫn kiểm tra lại với cả phân công
mới ở từng bước. Giữ thứ tự cấp độ/ít ca/stable ID cho người đủ điều kiện.
Sau sửa hai regression đạt và mọi test hiện hữu đạt. Không thay định mức,
giới hạn giờ, ngưỡng NEW hoặc bỏ hard constraint để làm test qua.

Đây là cải thiện phép tính khan hiếm của thuật toán tham lam, **không biến nó
thành bộ giải tối ưu toàn cục**. Các trường hợp khả thi phức tạp ngoài fixture
vẫn cần nghiệm thu riêng; không cam kết mọi đầu vào đều xếp đủ.

File thay đổi/tạo trong đợt audit này:

- Sửa `backend/src/services/scheduling.engine.ts`.
- Thêm hai regression vào `backend/tests/scheduling.test.cjs`.
- Tạo `backend/tests/tv3-journey.test.cjs`: chạy frontend client/grid thật qua HTTP
  Express, auth Supabase stub, lưu MOCK, Gemini transport stub; kiểm tra phiên bản
  1 → 2 → 3 → 4, báo cáo AI STALE, payload TV4 chưa gửi và lịch không bị AI sửa.
- Tạo `backend/tests/helpers/offline-only.cjs`: placeholder cấu hình, chặn external
  fetch và vô hiệu hóa DB test. Các test Gemini tự thay transport bằng stub.
- Tạo báo cáo này. Không chỉnh mã Frontend hoặc module TV1/TV2/TV4/TV5.

## Phạm vi còn thiếu và phụ thuộc tích hợp

**Chỉ kiểm thử MOCK/stub:** tất cả nghiệp vụ lưu nhu cầu, lịch, đánh giá AI,
quyền, lỗi adapter và handoff trong lần chạy này. Một số test dùng adapter
Supabase với client stub để kiểm tra tham số query/branch/revision, không có
database/network Supabase thật. Giá trị forecast là tham chiếu, không có công
thức quy đổi doanh thu thành số người. Các gợi ý AI là test double nằm trong
test, không được thêm vào UI hay provider sản phẩm làm kết quả giả.

**UI thực tế:** chưa có thao tác nào trong trình duyệt thật. Frontend có test
render React thành HTML và gọi event/hook mô phỏng, test proxy Vite qua HTTP,
test client thật qua Express. Những bằng chứng đó không tương đương nghiệm thu
DOM/focus/clipboard/route trong browser.

**Gemini thật:** chưa xác minh hoạt động và chưa xác định nguyên nhân HTTP 400
cũ từ một phản hồi live. Schema/parser/diagnostic chỉ được kiểm tra bằng stub;
không đổi model/API version hoặc cấu hình `.env` trong audit này.

**TV1:** cần schema, enum, quan hệ join, branch/account mapping, kỹ năng, giờ làm,
ngưỡng NEW, quyền/RLS, `generate_schedule_draft`, audit metadata và bảng lưu AI
phù hợp các adapter. Chưa kiểm chứng migration/RPC đã có trên DB nhóm. Cần DB
riêng và test transaction/CAS/idempotency/rollback trước khi cho ghi dữ liệu chung.

**TV2:** cần đăng ký đúng `period_id`, `work_date`, `shift_id`, trạng thái `VALID`
và nhân viên thuộc đúng chi nhánh; period phải `CLOSED` trước generate. Chưa
kiểm thử tạo đăng ký từ UI/API TV2 hoặc đồng thời TV2 đổi nguồn trong DB thật.

**TV4:** cần endpoint, xác thực/quyền, contract tiếp nhận `tv3-tv4.v1`, cơ chế
kiểm tra lại version/input revision trong transaction và xử lý nhận trùng.
Hiện TV3 chỉ chuẩn bị payload; chưa gửi, phê duyệt hoặc công bố.

**Giới hạn còn lại:** editor/regenerate Supabase chưa triển khai; dữ liệu MOCK
mất khi restart; lưu grid là từng ô có phản hồi partial failure, không phải một
transaction 63 ô. Đây là giới hạn phải ghi nhận khi nghiệm thu, không được báo
“không mất dữ liệu trong mọi trường hợp”. Các kiểm tra ưu tiên xác nhận đúng
rule đang được cài, chưa thay thế sự chấp thuận nghiệp vụ của nhóm.

## Chạy lại kiểm thử tự động an toàn

PowerShell từ thư mục dự án, giữ preload chỉ trong terminal kiểm thử:

```powershell
cd backend
$previousNodeOptions = $env:NODE_OPTIONS
try {
  $env:NODE_OPTIONS = '--require=./tests/helpers/offline-only.cjs'
  npm.cmd test
  if ($LASTEXITCODE -ne 0) { throw 'Backend tests failed' }
  npm.cmd run typecheck
  if ($LASTEXITCODE -ne 0) { throw 'Backend typecheck failed' }
} finally {
  $env:NODE_OPTIONS = $previousNodeOptions
}
```

Sau đó từ `frontend`:

```powershell
cd ../frontend
$previousNodeOptions = $env:NODE_OPTIONS
try {
  $env:NODE_OPTIONS = '--require=../backend/tests/helpers/offline-only.cjs'
  npm.cmd test
  if ($LASTEXITCODE -ne 0) { throw 'Frontend tests failed' }
} finally {
  $env:NODE_OPTIONS = $previousNodeOptions
}
npm.cmd run build
npm.cmd run typecheck
```

Các lệnh build/typecheck đã được chạy; `npm.cmd` tránh lỗi ExecutionPolicy của
`npm.ps1`. Trong sandbox Windows, Vite/esbuild cần quyền đọc thư mục cha; test
và build Frontend đã chạy thành công với quyền phù hợp. Không bật
`SCHEDULING_TEST_DATABASE_URL` trong đợt kiểm thử MOCK.

## Checklist browser cần người kiểm thử thực hiện

Không đánh dấu các mục dưới đây PASS trước khi có thao tác và bằng chứng thực tế.

1. Terminal development riêng: đặt `$env:TV3_AI_EXTERNAL_ENABLED='false'` rồi
   `npm.cmd run dev:tv3-test` trong Backend; `npm.cmd run dev` trong Frontend.
   Không dùng preload test trong server development, vì nó chặn xác thực TV1.
   Đăng nhập vẫn dùng TV1, cần tài khoản quản lý được phép; không sửa DB nhóm.
2. Mở `/manager/demand`: kiểm tra 63 ô, đúng giờ ca và cuối tuần; ô trống khác 0;
   nhập/lưu/đọc lại, ghi chú forecast, sao chép ngày/cả tuần, hủy cảnh báo và paste.
3. Thử âm/thập phân, đổi tuần/đi trang khác khi chưa lưu; thử hai tab cùng sửa
   một ô để thấy conflict. Ghi rõ MOCK không giữ sau restart Backend.
4. Mở `/manager/schedule`: tạo DRAFT từ nhu cầu đã lưu; fixture tv3-flow ban đầu
   xếp 8/9, thiếu một lượt. Kiểm tra 21 ca và không nhầm eligible với assigned.
5. Thay người/bỏ/thêm; thử sai luật; lưu hợp lệ tạo phiên bản mới; mở lại tuần
   vẫn thấy bản mới nhất, bản cũ không bị ghi đè. Ngắt Backend để xem lỗi rồi hồi phục.
6. Nhấn “Kiểm tra lịch”; lịch thiếu không đủ điều kiện chuẩn bị payload. Giảm
   nhu cầu ô Phục vụ ca chiều thứ Hai từ 2 xuống 1, lưu, tạo lại DRAFT và kiểm tra
   payload đúng phiên bản, `delivery.sent=false`, trạng thái vẫn DRAFT.
7. Kiểm thử Gemini thật chỉ khi người dùng chủ động cho phép: bỏ cấu hình tắt AI
   trong terminal development, khởi động lại với cấu hình Gemini được người dùng
   cung cấp, nhấn “AI đánh giá lịch” **một lần**. Việc đổi biến môi trường terminal
   chỉ là hướng dẫn, chưa được thực hiện. Nếu lỗi, lưu nhãn chẩn đoán an toàn;
   không chụp/in key hoặc request chứa dữ liệu cá nhân. Reload/focus không được
   gọi POST đánh giá tự động. Muốn thử UI AI offline phải dùng harness riêng;
   không thêm mock provider vào luồng sản phẩm để giả là kết quả Gemini thật.

## Kết luận tích hợp

**Chưa đủ bằng chứng để kết luận TV3 sẵn sàng dùng Supabase chung thật.**
Các ca MOCK/stub đã chạy đạt sau khi sửa TV3-001, bao gồm hành trình Frontend
client → Backend xuyên suốt. Có thể chuyển sang bước tích hợp có kiểm soát trên
database thử nghiệm riêng khi TV1/TV2 xác nhận contract. Trước dữ liệu chung cần
nghiệm thu browser, kiểm chứng schema/RLS/RPC/transaction trên DB riêng, xác định
phạm vi editor/regenerate thật và hoàn tất API TV4. Gemini thật được báo riêng,
chưa hoạt động được xác nhận trong đợt này.

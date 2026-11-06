# TV3–TV4: triển khai kiểm thử riêng và báo cáo thay đổi

Ngày 06/11/2026. Nhánh `feature/tri-scheduling-test`. Chưa commit/push/deploy.
Không sửa `.env` thật, migration hoặc quyền DB; không gọi RPC ghi trên Supabase chung.

Cập nhật nghiệp vụ sau đợt kiểm thử isolated: thiếu nhân lực/dư ứng viên không chặn gửi
duyệt. Xem [báo cáo staffing mới](tv3-staffing-warning-policy.md) và migration mới còn chờ
review. Số test bên dưới là kết quả lịch sử của riêng đợt isolated.

## Nguyên nhân và thay đổi

Thông báo “Chưa bật lưu DRAFT…” là cổng cấu hình, không phải kết quả truy vấn migration:
`TV3_DRAFT_PERSISTENCE_ENABLED === 'true'` và `TV3_TEST_PREVIEW_ENABLED !== 'true'`.
Preview còn kiểm tra nguồn Supabase, kỳ CLOSED và scope. RPC/ACL/contract được kiểm tra
khi gọi lưu; bật cờ không triển khai hay chứng nhận database.

Policy cũ ghim project dùng chung và NODE_ENV=development. Mode mới `isolated-test`
cho phép production nhưng bắt buộc project được TV1 phê duyệt độc lập, URL khớp chính
xác, một branch UUID, một period UUID và tuần 09–15/11/2026. Project dùng chung
`wlbpprpiieonjrqglicv` luôn bị từ chối trong mode mới, kể cả khi các biến khác khớp.

TV3_TEST_PROJECT_REF là mục allowlist do người vận hành xác nhận trong Dashboard;
nó phải khớp TV3_WRITE_PROJECT_REF và hostname SUPABASE_URL. Code không có khả năng
tự chứng minh tài khoản/project khác là staging. TV1 vẫn phải xác nhận quyền sở hữu,
project riêng và server credential tương ứng trước khi cấu hình. Không chỉ dựa vào NODE_ENV.

Thiếu từng biến hoặc có cấu hình isolated dở dang không được fallback về policy cũ.
Production không có isolated scope hợp lệ bị chặn ghi TV3/TV4. Policy development cũ
được giữ cho tương thích; không dùng nó để nghiệm thu môi trường production.

| File | Lý do thay đổi |
|---|---|
| `backend/src/services/draft-write-scope.ts` | Mode isolated, đối chiếu project/branch/period/ngày, từ chối khi thiếu cấu hình |
| `backend/src/services/stored-write-scope.ts` | Đọc metadata kỳ từ DB trước RPC, gồm cả retry và đường legacy |
| `backend/src/services/draft-write-policy.ts` | Trả code/reason phân biệt mock, read-only, kỳ mở, scope và cờ ghi |
| `backend/src/services/schedule-preview.service.ts` | Dùng cùng kết quả availability cho UI |
| `backend/src/services/draft-persistence.service.ts` | Scope trên DB, snapshot và input RPC; giữ version/revision/idempotency |
| `backend/src/services/scheduling.service.ts` | Bảo vệ đường legacy và kiểm tra v2 khi isolated |
| `backend/src/services/schedule-workflow.service.ts` | Xác minh scope/ngày của lịch từ DB trước submit/decision/publish |
| `backend/src/routes/schedule-workflow.routes.ts` | workflow_enabled theo metadata kỳ của từng lịch |
| `backend/src/services/schedule-review.service.ts` | Handoff dùng cùng scope đầy đủ |
| `backend/src/routes/registration.routes.ts` | NV trong scope test phải khớp ngày kỳ đọc từ DB |
| `backend/src/services/staffing-demand.service.ts` | Chặn sửa/xóa/batch nhu cầu khi ngày kỳ không khớp |
| `backend/.env.example` | Mẫu cấu hình có chú thích, không bật ghi mặc định |
| `backend/tests/isolated-write-scope.test.cjs` | 10 test mới, có API HTTP và RPC giả lập |
| `backend/tests/tv3-journey.test.cjs` | Kiểm tra batch payload/API thật thay ngưỡng request cũ không còn đúng |
| Hai tài liệu `tv3-tv4-isolated-*` | Preflight chỉ SELECT và hướng dẫn nghiệm thu |

Giữ nguyên engine, schema/migration, RPC SQL và RBAC hiện có. Frontend không cần đổi:
các trạng thái DRAFT/PENDING_APPROVAL/APPROVED/NEEDS_REVISION/PUBLISHED và role đã được
kiểm tra trong 254 test frontend. Lý do disabled nhận từ backend được hiển thị sẵn.

## Hợp đồng và quyền phải xác nhận trước khi bật

- `POST /api/schedules/drafts` → `persistPreview` → `persist_schedule_draft`.
- PATCH draft-assignments dùng cùng persistence; đường generate cũ dùng `generate_schedule_draft`.
- Submit/decision/publish → `transitionSchedule` → `tv4_transition_schedule_v2`.
- Snapshot SQL và TypeScript phải cùng `tv3.rules.v2`; giữ input revision, expected_version,
  request_id/fingerprint, khóa dữ liệu, audit và kiểm tra lại ràng buộc trong SQL.
- QL active/đã đổi mật khẩu/đúng branch: lưu DRAFT, gửi duyệt, công bố.
- GS active/đã đổi mật khẩu và branches.supervisor_id đúng tài khoản: phê duyệt/từ chối.
- NV không quản trị lịch. Actor lấy từ JWT, không nhận actor/branch giả từ body.
- RPC ghi SECURITY DEFINER với owner/search_path đã review. service_role EXECUTE RPC cần thiết;
  anon/authenticated không EXECUTE RPC ghi trực tiếp. Helpers và TV4 legacy không được mở
  đường ghi thay thế. Không GRANT ALL ON TABLES/SCHEMA hoặc đưa server key vào VITE_*.
- Scope ứng dụng không phải ACL gắn vào server key. Ai giữ server key vẫn có quyền của role đó;
  project riêng và bảo vệ credential là ranh giới với dữ liệu chung. Không cấp thêm quyền DB
  trong thay đổi này. Nếu cần scope kỳ tại SQL cho các client dùng server key trực tiếp, phải
  thiết kế/review wrapper hoặc role riêng; chưa triển khai phần đó.

TV1 chạy [preflight chỉ đọc](tv3-tv4-isolated-preflight.sql) trong project riêng, đối chiếu
function body/ACL/trigger với migration TV3 20261031, contract 20261101, workflow 20261102
và các sửa đổi đã duyệt về sau. Không chạy lại nguyên thư mục migrations. Không gọi RPC ghi
để dò tồn tại; OpenAPI không đủ chứng minh body/ACL. Thay đổi này không yêu cầu migration mới.

| Mã lỗi | Phân loại |
|---|---|
| DRAFT_PERSISTENCE_DISABLED | Cờ lưu chưa bật đúng chuỗi true |
| TEST_PREVIEW_READ_ONLY | Backend chỉ preview; chặn cả workflow |
| DRAFT_WRITE_SCOPE_FORBIDDEN / WORKFLOW_SCOPE_FORBIDDEN | Sai/thiếu phạm vi hoặc ngày kỳ |
| DRAFT_WRITE_SCOPE_UNAVAILABLE / WORKFLOW_SCOPE_UNAVAILABLE | Không đọc được metadata scope; không ghi |
| PERIOD_NOT_CLOSED / PERIOD_LOCKED / DRAFT_LOCKED | Trạng thái kỳ/lịch không cho ghi |
| PERSISTENCE_CONTRACT_MISMATCH | RPC input không khớp tv3.rules.v2 |
| PGRST202 / 42883 | RPC/chữ ký/schema cache chưa khả dụng |
| 42501 / FORBIDDEN | Quyền DB hoặc actor/branch không hợp lệ; xem catalog để phân biệt |
| PREVIEW_STALE / INPUT_CHANGED / SCHEDULE_VERSION_CHANGED | Dữ liệu hoặc version thay đổi |

## Cấu hình Backend kiểm thử riêng

Các giá trị `<...>` là placeholder; scope từ chối cho đến khi thay bằng cấu hình đã xác nhận.
Không đưa khối này vào Backend Render chung. Khởi đầu hai cổng persistence vẫn false.

```ini
NODE_ENV=production
SUPABASE_URL=https://<approved-test-project-ref>.supabase.co
SUPABASE_SECRET_KEY=<server-credential-cua-project-test>
SCHEDULING_DATA_SOURCE=supabase
TV3_WRITE_SCOPE_MODE=isolated-test
TV3_WRITE_SCOPE_ENABLED=true
TV3_TEST_PROJECT_REF=<approved-test-project-ref>
TV3_WRITE_PROJECT_REF=<approved-test-project-ref>
TV3_WRITE_BRANCH_ID=11111111-1111-1111-1111-111111111111
TV3_WRITE_PERIOD_ID=7f48f53e-d707-4a32-9f15-eb32aeb0095a
TV3_WRITE_START_DATE=2026-11-09
TV3_WRITE_END_DATE=2026-11-15
TV3_TEST_PREVIEW_ENABLED=false
TV3_DRAFT_PERSISTENCE_ENABLED=false
TV4_WORKFLOW_PERSISTENCE_ENABLED=false
REGISTRATION_DEV_TEST_MODE=false
TV3_OPEN_REGISTRATION_PREVIEW_ENABLED=false
DEV_IMPORT_ENABLED=false
TV5_PERSISTENCE_ENABLED=false
TV5_LOCAL_PG_RPC_ENABLED=false
FRONTEND_URL=https://<frontend-test-origin>
```

Nếu fixture project riêng có UUID mới, thay đúng hai UUID đã duyệt; ngày vẫn bắt buộc
09–15/11. Không giả submitted_at hoặc gỡ sample_batch_id để vượt lọc nguồn. Chuẩn bị
nhân viên/Auth/QL/GS test, ca, nhu cầu và nguồn VALID được chấp nhận theo provenance hiện hành.
DEV_IMPORT hiện ghim project/batch cũ nên không bật trong production test này.

Frontend test: `VITE_API_URL=https://<backend-test-origin>/api`; server secrets chỉ ở Backend.
TV1 đối chiếu branch/commit deploy. Sau preflight và phê duyệt bật ghi, đổi riêng cổng
TV3_DRAFT_PERSISTENCE_ENABLED=true, deploy Backend test, nghiệm thu DRAFT; sau đó mới bật
TV4_WORKFLOW_PERSISTENCE_ENABLED=true để nghiệm thu workflow. Không tự bật TV5.

## Kiểm thử đã chạy

| Lệnh | Kết quả |
|---|---|
| Backend `npm.cmd test` | 293 test: 267 PASS, 0 FAIL, 26 SKIP |
| Frontend `npm.cmd test` | 254 PASS, 0 FAIL, 0 SKIP |
| Frontend `npm.cmd run build` | SUCCESS |

Backend test build TypeScript trước khi chạy. Mọi test mới dùng SDK/RPC giả lập và
loopback; không dùng Supabase thật. 26 test database bị SKIP vì không có PostgreSQL/PGlite
cô lập được cấu hình. Chưa chứng nhận E2E trên PostgreSQL/Supabase hoặc trình duyệt thực.
Frontend esbuild ban đầu bị sandbox Windows chặn đọc thư mục cha; chạy lại cùng lệnh
với quyền đọc phù hợp thành công, không sửa code frontend để né lỗi môi trường.

Test TV3 journey cũ thất bại cả với code HEAD được transpile trong bộ nhớ: chỉ 31 HTTP
request trong khi assertion cũ đòi >75. Giữ tất cả assertions nghiệp vụ, bổ sung kiểm tra
batch đúng từng ô (không thiếu/trùng, số lượng, count=0 và revision), cùng số lần gọi
generate/edit/validate/handoff. Không thay engine hoặc tạo request thừa để làm test xanh.

Các ca yêu cầu được bao phủ bởi test mới và bộ hiện có: scope hợp lệ/sai/mất cấu hình;
production chặn scope không hợp lệ; cờ persistence/read-only; date ở DB và retry;
snapshot/v2 mismatch; version; RBAC HTTP; phản hồi lỗi từ RPC; trùng giờ/vượt giờ/sai bộ phận;
cảnh báo kinh nghiệm; DRAFT bị khóa sau công bố; nhánh reject → revise → submit → approve → publish.
Quyền GS thực sự trong SQL, SQL rollback/locks và toàn vòng đời DB vẫn cần các test native
đã SKIP và nghiệm thu project riêng. Mock không thay thế bằng chứng đó.

## Hướng dẫn nghiệm thu sau khi được phép ghi ở project riêng

1. TV1 xác nhận project/credential/UUID/ngày và baseline; chưa có lịch PUBLISHED cho kỳ test.
   Mở TV2 bằng NV test trong cửa sổ OPEN, chọn ca, lưu nháp, gửi, F5/đăng nhập lại kiểm tra.
   Nếu fixture đã CLOSED, không sửa deadline chung: chuẩn bị riêng bước OPEN và đóng kỳ
   trên fixture project test theo phê duyệt của TV1, hoặc nghiệm thu TV2 bằng test clock cô lập.
   Không dùng REGISTRATION_DEV_TEST_MODE để bỏ qua gate trong bài nghiệm thu production test.
2. Khi kỳ test CLOSED, QL mở `/manager/schedule`, chọn tuần 09–15/11, tạo lịch dự kiến.
   Xem số đã xếp/cần, cảnh báo kinh nghiệm; chỉnh sửa nếu cần và bấm Kiểm tra lại phương án.
3. QL Lưu DRAFT. Kiểm tra ID/version/assignments/audit, F5 và mở lại đúng bản lưu. Retry cùng
   request không sinh bản trùng. Đây là lịch nháp, NV chưa thấy lịch chính thức.
4. QL chuẩn bị dữ liệu và gửi GS duyệt khi dữ liệu đầy đủ và hard constraints PASS; thiếu
   nhân lực/dư ứng viên là cảnh báo, không chặn. Migration staffing mới phải được review
   và triển khai ở project test trước nghiệm thu. Lịch phải thành
   PENDING_APPROVAL. Handoff chuẩn bị dữ liệu riêng lẻ không phải thao tác gửi duyệt.
5. GS phụ trách mở `/supervisor/approvals`, xem coverage/cảnh báo. Thử từ chối có lý do:
   lịch thành NEEDS_REVISION. QL xem lý do, sửa trong editor, kiểm tra, lưu DRAFT version mới,
   gửi lại. Lịch/decision cũ phải được giữ. GS phê duyệt version hiện hành thành APPROVED.
6. QL mở `/manager/publish`, nhập hạn phản hồi tương lai và xác nhận công bố. Chỉ được
   APPROVED → PUBLISHED, assignments trở thành ACTIVE. GS/NV không được công bố.
7. NV test mở `/employee/schedule`, xem đúng lịch chính thức của mình. Lịch PUBLISHED
   chỉ xem trong TV3/TV4, không thể chỉnh trực tiếp hoặc tạo mới đè cùng kỳ.
8. Thử role sai/GS không phụ trách/branch hoặc period ngoài scope/request trùng/version cũ
   trên project test. So baseline để xác nhận không có thay đổi ngoài scope. Không thử phá
   dữ liệu ở project chung. Lưu bằng chứng ID/version/status/audit từng bước.

## Trạng thái bàn giao

Code và unit/HTTP integration với mock đã PASS. Frontend hiện có đáp ứng trạng thái/role,
không thiết kế lại UI. Không thay thuật toán, SQL, quyền, `.env` thật hoặc dữ liệu chung.
TV1 còn phải cung cấp/xác nhận project test, đọc catalog/ACL, chuẩn bị fixture/Auth, duyệt
cấu hình ghi và nghiệm thu database/browser. Chưa có các điều kiện này nên không báo E2E PASS.

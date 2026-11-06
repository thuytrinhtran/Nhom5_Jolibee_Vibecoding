# TV3–TV4: thiếu nhân lực và dư ứng viên là cảnh báo

Ngày 06/11/2026, nhánh `feature/tri-scheduling-test`.
Tệp `docs/tv4-shortage-policy-coordination.md` không tồn tại khi bắt đầu kiểm tra.
Thay đổi này áp dụng quy tắc do người dùng cung cấp, không suy đoán nội dung tài liệu TV4.
Giữ nguyên các thay đổi isolated-test chưa commit từ đợt trước.

## Phân loại nghiệp vụ

| Trường hợp | Kết quả |
|---|---|
| Thiếu phân công so với nhu cầu đã khai báo | Cảnh báo STAFFING_SHORTAGE; QL vẫn gửi được nếu kiểm tra bắt buộc đạt |
| Phân công đủ nhu cầu | Được gửi duyệt |
| Dư ứng viên đủ điều kiện so với nhu cầu từng ca | Cảnh báo CANDIDATE_SURPLUS; không ép xếp hết ứng viên |
| Thiếu người có kinh nghiệm so với mục tiêu | Cảnh báo EXPERIENCE_SHORTAGE như trước |
| Số người thực sự được phân công vượt nhu cầu đã khai báo | Vi phạm cứng DEMAND_EXCEEDED; vẫn từ chối |
| Không khai báo nhu cầu hoặc thiếu dữ liệu bắt buộc | Vẫn chặn; không đồng nhất với thiếu người |

Số ứng viên được tổng hợp độc lập theo từng ca, không phải số người có thể phân công
đồng thời. Lịch thiếu người vẫn cần GS xem xét; không tự động được phê duyệt/công bố.

## Truy vết các vị trí kiểm tra

| Vị trí | Trước thay đổi | Sau thay đổi |
|---|---|---|
| `schedule-review.service.ts::inspectSchedule` | Đưa thiếu người vào issues, yêu cầu coverage_complete để can_submit | Chuyển thiếu người vào warnings, thêm cảnh báo dư ứng viên; bỏ coverage_complete khỏi điều kiện gửi |
| `schedule-workflow.service.ts::workflowReview` | ready yêu cầu coverage_complete | ready dựa trên ràng buộc cứng, dữ liệu, revision và issues |
| `scheduling.engine.ts::reviewAssignments` | Không bắt buộc lấp đầy nhu cầu; chặn phân công vượt nhu cầu | Giữ nguyên toàn bộ engine |
| `persist_schedule_draft`, `tv3_result_v2` | Cho lưu thiếu; chặn vượt nhu cầu và kiểm tra snapshot/version/idempotency | Giữ nguyên |
| `tv4_assert_schedule_v2` | Số đã xếp phải bằng nhu cầu; dùng trong SUBMIT, APPROVED và PUBLISH | Migration mới chỉ bỏ cận dưới; giữ cận trên và mọi validation khác |
| `ScheduleReviewPanel.tsx` | Nút gửi theo can_submit của server | Giữ gate; thêm giải thích cảnh báo không chặn gửi |
| `ScheduleWorkflow.tsx::WorkflowInspection` | Thông báo ready=false yêu cầu xử lý cảnh báo | Thông báo yêu cầu xử lý vi phạm/dữ liệu; cảnh báo vẫn hiển thị cho GS |
| `ManagerSchedule.tsx`, workflow API/client | Lưu/gửi theo kết quả backend và version, không tự kiểm đủ người | Không cần sửa |
| `schedule-ai.service.ts::assertAIConclusion` | AI không được kết luận SUITABLE trái với cảnh báo coverage | Giữ nguyên; AI tư vấn, không phải gate gửi/duyệt |
| Trigger công bố, approval và TV4 legacy | Yêu cầu APPROVED/GS hợp lệ; đường legacy bị thu hồi quyền ở v2 | Giữ nguyên |

`coverage_complete` tiếp tục phản ánh số phân công còn thiếu, phục vụ hiển thị và tư vấn.
Nó không còn quyết định `can_submit` hoặc `ready`. Khi existing coverage đã vượt nhu cầu,
review cũng trả DEMAND_EXCEEDED để thống nhất với ràng buộc SQL hiện có.

Giữ nguyên: nhân viên/tài khoản hợp lệ, đăng ký VALID, bộ phận, kỹ năng bắt buộc,
trùng giờ, giới hạn giờ, QL/GS và supervisor được phân công, scope, CLOSED, version,
snapshot/input revision, idempotency/audit và bảo vệ PUBLISHED. GS từ chối vẫn cần lý do;
QL sửa rồi lưu DRAFT version mới và gửi lại. QL không tự phê duyệt; GS không tự công bố.

## Migration cần TV1/TV4 review

Tệp mới: `backend/migrations/20261106_tv4_staffing_warnings.sql`.
Không sửa bất kỳ migration lịch sử nào và chưa chạy tệp mới trên database.

Migration đọc definition của `public.tv4_assert_schedule_v2(uuid)` và chỉ thay:

```sql
-- Cũ: từ chối cả thiếu và vượt nhu cầu
r.required_count <> (SELECT count(*) ...)
-- Mới: chỉ từ chối vượt nhu cầu
r.required_count < (SELECT count(*) ...)
```

Lỗi vượt nhu cầu đổi từ COVERAGE_INCOMPLETE sang DEMAND_EXCEEDED. Không sửa transition
RPC, dữ liệu, ACL hoặc schema bảng. CREATE OR REPLACE giữ metadata/quyền helper hiện có.
Guard bắt buộc trusted postgres owner và body fingerprint đã review:

- Cũ: `67c725836fb9b441d34fa56e60eead74`.
- Mới: `7d27134c34212ad0920647934fe0a5ea`.
- Thiếu/khác function: dừng với TV4_STAFFING_POLICY_REVIEW_REQUIRED, không bỏ guard.
- Chạy lại khi đã đúng body mới: không thay đổi function.

TV1 đọc catalog trước, trong đúng project đã được phép:

```sql
SELECT p.oid::regprocedure,pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef,p.proacl,p.proconfig,
       md5(regexp_replace(replace(p.prosrc,chr(13),''),'\s+',' ','g')) AS body_md5,
       pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN ('tv4_assert_schedule_v2','tv4_transition_schedule_v2');
```

TV1/TV4 đối chiếu helper/ACL, thử migration trên PostgreSQL/project test cô lập, sau đó
mới duyệt rollout phối hợp. Không tự cấp quyền mới, không gọi RPC ghi để dò tồn tại.
Nếu body đã có chỉnh sửa riêng của TV4, cần review/rebase migration thay vì ghi đè.
Helper vẫn private; RPC ghi chỉ cho server role cần thiết, không mở anon/authenticated.

Backend mới gặp lỗi COVERAGE_INCOMPLETE từ SQL cũ sẽ trả HTTP 503 với code
WORKFLOW_STAFFING_POLICY_NOT_MIGRATED và thông báo cần xác minh migration. Không xem
đó là lỗi nghiệp vụ của lịch thiếu người. Chưa triển khai migration thì chưa bảo đảm
luồng gửi/duyệt/công bố lịch thiếu người trên Supabase thật hoạt động.

## File thay đổi trong đợt này

- `backend/src/services/schedule-review.service.ts`: warnings và điều kiện gửi.
- `backend/src/services/schedule-workflow.service.ts`: ready và phân biệt lỗi SQL cũ.
- `frontend/src/pages/manager/ScheduleReviewPanel.tsx`: giải thích cảnh báo.
- `frontend/src/pages/schedules/ScheduleWorkflow.tsx`: thông báo kết quả kiểm tra.
- Migration mới nêu trên.
- `backend/tests/staffing-review-policy.test.cjs`: thiếu/đủ/dư, existing excess và hard rules.
- `backend/tests/staffing-policy-migration.test.cjs`: fingerprint/phạm vi SQL, test PostgreSQL có điều kiện.
- `backend/tests/tv3-handoff.test.cjs`, `tv3-journey.test.cjs`, `schedule-ai.test.cjs`:
  cập nhật kỳ vọng thiếu người theo quy tắc mới, giữ kiểm tra lỗi cứng/revision/quyền.
- `backend/tests/workflow-v2-lifecycle.test.cjs`: dùng migration mới; source drift vi phạm
  kỹ năng vẫn chặn công bố, shortage không còn chặn.
- `frontend/tests/schedule-review.test.cjs`: gửi được ba tình huống và retry có xác nhận;
  vi phạm kỹ năng vẫn khóa nút.
- Tài liệu này và ghi chú cập nhật hướng dẫn isolated acceptance.

Không thay engine, cờ ghi, `.env`, scope hoặc dữ liệu Supabase. Các diff khác trong working
tree đã có từ đợt trước, được giữ nguyên.

## Kết quả kiểm thử

| Lệnh | Kết quả |
|---|---|
| Backend `npm.cmd test` (gồm build TypeScript) | 309 test: 282 PASS, 0 FAIL, 27 SKIP |
| Frontend `npm.cmd test` | 257 PASS, 0 FAIL, 0 SKIP |
| Frontend `npm.cmd run build` | SUCCESS |
| `git diff --check` | PASS |

15 test backend mới chạy thành công; một test PostgreSQL mới bị SKIP. Thêm ba test frontend
cho thiếu, đủ và dư ứng viên. Các test hiện có về snapshot/version, role/branch, published,
revision và hard rules vẫn chạy, không bỏ điều kiện bảo mật để đạt PASS.

Chưa có native PostgreSQL/PGlite cô lập được cấu hình, nên 27 test database bị SKIP.
Test native mới đã chuẩn bị để chạy thực: submit → approve → publish cho thiếu/đủ/dư,
giữ ACL/owner/search_path, replay migration, chặn over-assignment và từ chối body lạ.
Hiện chỉ xác minh migration bằng kiểm tra cấu trúc/fingerprint; chưa chứng minh SQL runtime,
rollback, lock contention hoặc E2E browser/Supabase của chính sách mới.

## Nghiệm thu sau review và triển khai được phép

1. Giữ cờ/scope hiện hành, chuẩn bị ba fixture ở project riêng: thiếu phân công, đủ,
   dư ứng viên nhưng không phân công vượt nhu cầu. Không thay giờ/dữ liệu project chung.
2. QL lưu DRAFT, kiểm tra lại: warnings hiển thị, can_submit=true nếu dữ liệu và hard rules
   đạt. coverage_complete có thể false. Bấm chuẩn bị rồi gửi GS, lịch thành PENDING_APPROVAL.
3. GS đọc cảnh báo, thử từ chối có lý do; QL sửa, lưu version mới, gửi lại. GS được phép
   APPROVED ngay cả khi còn thiếu người. Không có phê duyệt tự động.
4. QL công bố lịch APPROVED với deadline hợp lệ; giữ cảnh báo, NV xem lịch chính thức.
5. Thử phân công vượt nhu cầu, sai kỹ năng/bộ phận/đăng ký, trùng/vượt giờ, role hoặc
   branch sai, version cũ và chỉnh PUBLISHED: đều phải bị chặn. Kiểm tra audit và baseline.

Chưa commit/push/deploy; chưa chạy migration hoặc ghi dữ liệu Supabase chung.

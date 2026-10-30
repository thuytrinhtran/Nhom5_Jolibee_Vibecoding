# Backend đổi ca — TV5

## Bổ sung frontend và danh sách ứng viên

Đã bổ sung mã frontend NV `/employee/shift-requests` và QL `/manager/shift-requests`.
Frontend dùng API thật qua phiên đăng nhập hiện có, không có chế độ mock nghiệp vụ.

API mới: `GET /api/shift-change-requests/assignments/:id/candidates` (chỉ NV).
Không nhận body/query; actor lấy từ middleware. Response:
`{status:'ok',result:{assignment_id,request_deadline_at,candidates:[{employee_id,full_name}]}}`.
Không có ứng viên trả mảng rỗng. Không trả email, tài khoản, kỹ năng hay lịch của ứng viên.
RPC `tv5_shift_change_candidates(uuid,uuid)` kiểm tra lại tài khoản NV, sở hữu phân công,
chi nhánh, lịch công bố hiện hành, lineage, yêu cầu mở và hạn strict T-60 trước khi đọc danh sách.
Phân công không tồn tại/không thuộc mình/ngoài chi nhánh cùng trả NOT_FOUND.
Danh sách tái sử dụng `tv5_candidate_eligible`, chỉ service_role có quyền gọi RPC.
Danh sách chỉ là trạng thái lúc đọc, không giữ chỗ; create/approval vẫn kiểm tra lại SQL như cũ.

Migration tiếp theo cần review và áp dụng thủ công riêng trên Supabase TEST:
`backend/migrations/20261031_shift_change_candidates.sql`, sau migration TV5 đã cài.
Không chạy lại `20261030_shift_change_workflow.sql`. Migration mới chỉ tạo RPC và quyền,
không đổi bảng, không seed, không kích hoạt Cron. Việc chuẩn bị mã không áp dụng SQL.
Chưa chứng nhận chạy RPC, cách ly chi nhánh hoặc luồng frontend với database thật.
Chuông notification chung chưa tích hợp; trang đổi ca hiển thị warning từ API.
Lý do quyết định chỉ ở audit, không được API danh sách đọc lại.

Các ghi chú “chưa có frontend/chưa triển khai Supabase” bên dưới là báo cáo lịch sử;
người dùng xác nhận migration TV5 đã cài trên TEST, chưa được kiểm chứng qua kết nối trong lần bổ sung này.

Kiểm chứng mã bổ sung (không đọc file môi trường, không kết nối database):
- TypeScript frontend và backend: `node node_modules/typescript/bin/tsc --noEmit` đều đạt.
- 26 test backend TV5 (service/API mock/SQL tĩnh) đạt.
- 28 test frontend: 12 test TV5 và 16 test hồi quy auth/context/route TV4 đạt.
- Build frontend trong bộ nhớ đạt, dùng Vite `configFile:false`, `envFile:false`,
  `build.write:false` để không đọc `.env` hay ghi artifact ngoài danh sách cho phép.
- Chưa kiểm thử browser tương tác/responsive thực tế, RPC trên PostgreSQL/Supabase,
  dữ liệu ứng viên thật, tranh chấp đồng thời, notification Cron và luồng cập nhật lịch đầu cuối.

Phạm vi: rule-based, không AI; NV yêu cầu thay người cho một phân công, người nhận xác nhận,
QL quyết định, sau đó mới cập nhật lịch. Không hoán đổi hai ca. Chưa có frontend.

## Trạng thái triển khai

Chỉ chuẩn bị mã và SQL. Chưa chạy migration, seed hoặc SQL; chưa kết nối database.
Chỉ đối chiếu schema trong repository, chưa chứng nhận schema cloud thực tế.
Không sửa schema nền, migration cũ, auth, TV2/TV3/TV4 hoặc cấu hình môi trường.

## Quy tắc đã chốt

- Phân công của người yêu cầu phải ACTIVE, thuộc phiên bản PUBLISHED gần nhất trong
  schedule_group_id cho chi nhánh/tuần. DRAFT mới hơn không thay thế bản PUBLISHED đang hiệu lực.
  Nếu có nhiều nhóm đã công bố cho cùng chi nhánh/tuần, trả AMBIGUOUS_PUBLISHED_SCHEDULE (409),
  không tự chọn theo created_at/id. Bản PUBLISHED cũ trong cùng nhóm trả STALE_PUBLISHED_SCHEDULE.
  Nhóm chỉ có DRAFT không tham gia lựa chọn bản chính thức. Chi nhánh/nhân viên hoạt động;
  ca hoạt động, thuộc đúng tuần/chi nhánh. GET assignments trả thêm schedule_issues khi cần.
- Chỉ tạo yêu cầu trước giờ bắt đầu ca ít nhất 60 phút theo quy tắc strict: now < starts_at - 60 phút.
  Ca 14:00: 12:59:59 được gửi, đúng 13:00 bị từ chối. Không dùng feedback_deadline_at làm hạn gửi.
  Các thao tác xác nhận/duyệt tiếp tục đến trước giờ bắt đầu ca.
- Đề xuất người thay: kiểm tra ngay và chỉ mời người đó; chưa coi là đã đồng ý. Đề xuất không hợp lệ
  trả lỗi, không âm thầm thay bằng ứng viên khác. Khi người đó từ chối, mở tìm kiếm tự động.
- Không đề xuất: mời đồng thời TẤT CẢ ứng viên hợp lệ, không xếp hạng bằng AI.
- Mỗi ứng viên chỉ được mời một lần trong mỗi yêu cầu. Từ chối/refresh có thể mời thêm ứng viên
  mới đủ điều kiện, không gửi lại cho người đã từ chối hoặc đã hết hạn.
- Hạn lời mời là giờ bắt đầu ca, múi giờ Asia/Ho_Chi_Minh. Đồng ý không thay đổi phân công.
- QL chọn một người có ACCEPTED, còn hạn và vẫn đủ điều kiện khi duyệt.
- Không có ứng viên/lời mời khả dụng: API trả warning NO_AVAILABLE_REPLACEMENT; chưa cảnh báo QL
  trước T-60. Yêu cầu giữ SEARCHING để QL xử lý, không tự phê duyệt/từ chối.
- Từ T-60 đến trước giờ bắt đầu ca: nếu yêu cầu còn hiệu lực và chưa có lời mời ACCEPTED còn hạn,
  tự động cảnh báo QL cùng chi nhánh kể cả vẫn còn lời mời PENDING. Có ACCEPTED thì không cảnh báo
  T-60, dù người nhận có thể cần kiểm tra lại điều kiện khi QL duyệt.
- Ca đã đổi thành công không đổi lần hai, kể cả người mới nhận ca. replacement_assignment_id
  trên yêu cầu lưu FK tới phân công mới; RPC kiểm tra cả hai đầu của lần đổi. Nếu đã có dữ liệu
  APPROVED từ bản cũ thiếu lineage, migration dừng để review, không tự suy đoán/backfill.

Ứng viên: khác người yêu cầu, user NV hoạt động và đã hoàn tất đổi mật khẩu; employee ACTIVE;
cùng chi nhánh/bộ phận với ca; nguồn CREW_LEADER chỉ dùng người cùng cấp loại tương ứng;
kiểm tra ngày nghỉ Crew Leader, kỹ năng required_skill_name nếu có, max_weekly_hours nếu có.
Không tự đặt ngưỡng proficiency, giờ tối đa mặc định hay số ca/ngày.

Xung đột dùng khoảng nửa mở [bắt đầu,kết thúc), kể cả qua đêm. Hai ca tiếp giáp không trùng.
Theo cách đọc bảo thủ hiện có của TV3, mọi phân công chưa REPLACED (kể cả DRAFT/phiên bản cũ)
đều chiếm thời gian và giờ làm. Giờ tuần được tính theo phần giao với từng tuần thứ Hai–Chủ nhật,
kể cả ca đi qua biên tuần. Không xóa phân công REPLACED để vượt unique constraint hiện có;
ứng viên đã có cùng khóa phân công sẽ bị loại.

## API

Prefix: `/api/shift-change-requests`. Bearer session dùng middleware auth hiện có.
Phản hồi: `{status:'ok', result:{...}}`; lỗi `{status:'error', code, message}`.
Không nhận user_id, employee_id, branch_id hoặc clock từ client. Không hỗ trợ query filter lúc này.

| Method/path | Quyền | Nội dung |
|---|---|---|
| GET `/assignments` | NV | Phân công của mình còn đủ điều kiện tạo yêu cầu |
| GET `/` | NV/QL | Yêu cầu của mình hoặc toàn bộ yêu cầu trong chi nhánh QL |
| GET `/invitations` | NV | Lời mời đổi ca của mình, không trộn lời mời sự cố |
| POST `/` | NV | Tạo yêu cầu và lời mời; HTTP 201 |
| POST `/invitations/:id/response` | NV | ACCEPTED hoặc DECLINED cho lời mời của mình |
| POST `/:id/decision` | QL | APPROVED/REJECTED trong chi nhánh |
| POST `/:id/refresh` | QL | Đối soát hết hạn, tìm thêm ứng viên và cảnh báo; body `{}` |

Body tạo (bỏ proposed_employee_id để tìm tự động):

```json
{
  "original_assignment_id": "UUID_PHAN_CONG",
  "reason": "Bận lịch học",
  "proposed_employee_id": "UUID_NHAN_VIEN_DE_XUAT"
}
```

Body phản hồi: `{"response":"ACCEPTED"}` hoặc `{"response":"DECLINED"}`.
Body duyệt: `{"decision":"APPROVED","replacement_employee_id":"UUID_DA_DONG_Y"}`.
Body từ chối: `{"decision":"REJECTED","reason":"Lý do tùy chọn"}`.
Lý do quyết định nằm trong audit, không thêm cột vào bảng yêu cầu.

`invitations_created` là số lời mời mới, `accepted_count`/`pending_count` chỉ tính người còn đủ
điều kiện và lời mời còn hạn. Có thể có nhiều người ACCEPTED; QL phải chọn rõ một người.
`replacement_employee_id` và `replacement_assignment_id` trên yêu cầu chỉ được đặt khi APPROVED.
Phản hồi lời mời PENDING đã hết hạn trả HTTP 200 với `expired:true,response_recorded:false`;
đồng thời commit đối soát và cảnh báo. Client phải kiểm tra result, không coi HTTP 200 là đã đồng ý.
Phản hồi lại lời mời đã xử lý hoặc quyết định lại yêu cầu đã đóng trả 409.

## Transaction, quyền và audit

Repository chỉ gọi RPC `tv5_shift_change(text,uuid,jsonb)`, truyền actor từ middleware đã xác thực.
RPC chỉ được service_role gọi; helpers nội bộ thu hồi EXECUTE của PUBLIC/anon/authenticated/service_role.
Mỗi RPC kiểm tra lại user, vai trò, tài khoản, chủ sở hữu/phạm vi trong database. Service role
vẫn là backend tin cậy: không bao giờ công khai khóa hoặc cho browser tự chọn actor.

Mutations khóa các bảng dữ liệu điều kiện trong SHARE ROW EXCLUSIVE trước khi khóa hàng:
ngăn thay đổi điều kiện đồng thời, kể cả từ các module khác. Đây là lựa chọn bảo thủ cho đồ án,
có thể khiến ghi dữ liệu chi nhánh khác chờ; lock timeout 5 giây, cần đánh giá tải trước tích hợp.
Không thay đổi mã/nghiệp vụ các module khác. Không tự retry mutation khi lỗi/kết quả chưa rõ.

**Còn chặn triển khai: thu hẹp khóa.** Chưa thay khóa bảng bằng advisory/khóa hàng đơn lẻ vì các
writer khác chưa có hợp đồng khóa chung, và schema chỉ UNIQUE theo shift_id, không chống trùng
khoảng thời gian giữa hai shift khác nhau. Khóa các hàng phân công hiện có không tự ngăn phantom
INSERT. Cần thiết kế/kiểm chứng hợp đồng writer hoặc ràng buộc database chung trước khi bỏ khóa
bảo vệ hiện tại; chưa được phép sửa module khác. Lượt cập nhật này hoàn tất chọn lịch/thời hạn,
không tuyên bố đã giải quyết mục giảm phạm vi khóa. Chưa triển khai Supabase.

Duyệt cùng transaction: kiểm tra → phân công cũ REPLACED → phân công mới ACTIVE (giữ ca/ngày,
bộ phận, chi nhánh và nguồn phân công) → yêu cầu APPROVED → đóng lời mời PENDING → notification
→ audit. Bất kỳ lỗi nào rollback cả lời gọi, kể cả lỗi chèn audit/notification.
Từ chối giữ nguyên lịch, ghi REJECTED, người xử lý/thời điểm và audit.
Tạo yêu cầu, phản hồi, refresh cũng có audit. Lịch sử phân công cũ không bị xóa.
Phản hồi so sánh min(expires_at, giờ bắt đầu ca hiện tại). Sau kiểm tra ứng viên, UPDATE phản hồi
có predicate thời hạn ngay trong câu ghi; không có hàng được ghi thì trả DEADLINE_PASSED.
Hai câu ghi phân công khi duyệt cũng kiểm tra giờ ca và hạn ACCEPTED, có kiểm tra số hàng;
lỗi sau khi đổi phân công gốc rollback toàn bộ. Hiện khóa bảng giữ giờ ca/điều kiện ổn định trong RPC.

## Hết hạn và thông báo

GET không ghi dữ liệu; trả effective_status của lời mời và warning hiện tại. POST response/refresh
lưu trạng thái EXPIRED và đối soát tìm người. Cron mỗi phút gọi function cảnh báo độc lập với
backend/laptop, không cần người dùng thao tác; job chỉ INSERT notifications, không cập nhật lịch,
không tự duyệt/từ chối và không lưu EXPIRED vào lời mời.
QL có thể refresh để xử lý mọi lời mời từ chối/hết hạn/người nhận không còn hợp lệ.
Trường hợp chỉ có lời mời đề xuất đã hết hạn, refresh sẽ mở tìm kiếm tự động nếu ca chưa bắt đầu
(hạn bằng giờ bắt đầu ca nên thường lúc hết hạn sẽ chỉ còn warning trên API, không cảnh báo T-60 mới).

Thông báo chỉ INSERT vào notifications (PENDING), và lời mời có thể đọc qua API.
Không gửi email/Zalo, không thực thi hệ thống phân phối thông báo. Cảnh báo T-60 có khóa
idempotency theo yêu cầu/mốc T-60/QL; Cron và refresh dùng cùng function và cùng khóa. GET vẫn trả warning
hiện tại dù thông báo cũ đã đọc. Request APPROVED/REJECTED, lịch lỗi thời, phân công không ACTIVE,
ca đã bắt đầu hoặc chi nhánh/người yêu cầu không hoạt động đều không tạo cảnh báo.
Nếu không có QL hoạt động trong chi nhánh thì không có người nhận notification; warning vẫn trả về.

Scheduler không bảo đảm đúng từng giây: bình thường kiểm tra mỗi phút, có thể chậm thêm do khóa,
lỗi job, database pause hoặc gián đoạn dịch vụ. Một tick lỗi rollback, tick sau thử lại trong cửa sổ
[T-60, starts_at); không gửi bù sau ca đã bắt đầu. Cần theo dõi Cron History.
Helper cảnh báo dùng advisory lock và SHARE lock ngắn trên nguồn dữ liệu để tránh race với duyệt;
lock_timeout 1 giây. Không khóa bảng kỹ năng/nhu cầu vì không cần kiểm tra lại ứng viên cho cảnh báo.

## Migration và kiểm thử

Migration mới: `backend/migrations/20261030_shift_change_workflow.sql`.
Chỉ áp dụng sau khi bạn duyệt, trên Supabase test riêng, role postgres. Cần schema nền và migration
password-state; để tương thích phần còn lại giữ chuỗi TV2/TV4 đã chuẩn bị. Không cần RPC TV3 bị thiếu
để xử lý lịch/phân công test đã tồn tại. Migration không seed, không tạo lịch và không tự gọi RPC.
Apply một lần; nếu tên function/index đã tồn tại thì dừng kiểm tra, không xóa để chạy lại.
Nếu đã có yêu cầu mở/lời mời trùng, unique index sẽ từ chối; không tự dọn dữ liệu.

### Các bước tiếp theo trên Supabase TEST (chưa thực hiện)

1. Kiểm tra đúng project `jolibee test man`, SQL Editor role postgres. Không dùng project nhóm.
2. Nếu chưa áp dụng TV5: review và chạy toàn bộ `20261030_shift_change_workflow.sql` phiên bản mới.
   Bản này thêm một cột lineage, constraint và index trên bảng yêu cầu đổi ca; không sửa file schema nền.
   Nếu đã chạy bản TV5 cũ, dừng: bản mới là apply-once, cần forward migration riêng được duyệt.
3. Bật `pg_cron` trong Integrations → Cron trên TEST. Có thể kiểm tra chỉ đọc sau này:

   ```sql
   SELECT name, default_version, installed_version
   FROM pg_available_extensions WHERE name='pg_cron';
   SELECT extname, extversion FROM pg_extension WHERE extname='pg_cron';
   ```

4. Review và chạy `backend/migrations/20261031_shift_change_alert_scheduler.sql` sau TV5.
   File kiểm tra role, khả năng hỗ trợ/đã cài pg_cron, helper và tên job; không tự bật extension.
   Áp dụng file này sẽ kích hoạt job `tv5-shift-change-t60-alerts`, lịch `* * * * *`, gọi
   `SELECT public.tv5_run_shift_change_alerts();`. Không có bootstrap gọi function ngay trong migration.
5. Kiểm tra chỉ đọc job và lịch sử; không dùng SELECT * tránh lộ command của job khác:

   ```sql
   SELECT jobid, jobname, schedule, active, username
   FROM cron.job WHERE jobname='tv5-shift-change-t60-alerts';
   SELECT d.jobid, d.status, d.start_time, d.end_time, d.return_message
   FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid
   WHERE j.jobname='tv5-shift-change-t60-alerts'
   ORDER BY d.start_time DESC LIMIT 10;
   ```

6. Sau khi được phép tạo fixture TEST: kiểm tra trước/đúng/sau T-60; PENDING vẫn cảnh báo,
   ACCEPTED không cảnh báo; APPROVED/REJECTED/lịch cũ/ca đã bắt đầu không cảnh báo; hai QL đúng
   chi nhánh mỗi người nhận một thông báo; tick lặp và refresh không tạo trùng. Kiểm tra ca qua đêm.
   Duyệt thành công rồi dùng phân công mới gửi yêu cầu phải nhận ALREADY_CHANGED; kiểm tra rollback
   và hai quyết định đồng thời. Không giả lập bằng đổi đồng hồ hoặc sửa tài khoản/dữ liệu nhóm.
7. Nếu cần tạm dừng, dùng Active/Inactive của riêng job TV5 trong Dashboard. Không tắt/drop
   extension pg_cron vì có thể xóa job của module khác.

Tài liệu chính thức đã đối chiếu, không kết nối database:
- https://supabase.com/docs/guides/cron
- https://supabase.com/docs/guides/cron/install
- https://supabase.com/docs/guides/cron/quickstart

Kiểm tra không tạo file build và không tải cấu hình runtime:

```text
node node_modules/typescript/bin/tsc --noEmit
node --test tests/shift-change-service.test.cjs tests/shift-change-api.test.cjs tests/shift-change-migration.test.cjs
```

Chạy từ backend. Test transpile TypeScript trong bộ nhớ, thay config Supabase bằng SDK giả,
không import dotenv/server, không đọc environment file. Test API dùng loopback HTTP với auth/RBAC thật,
SDK/database mock. Test SQL chỉ kiểm tra tĩnh nội dung file, không thực thi SQL.

Giới hạn xác minh: chưa chạy SQL trên PostgreSQL, chưa chứng minh cú pháp/thực thi RPC, rollback,
ca qua đêm, giới hạn tuần và tranh chấp đồng thời trên DB thật. Các test mock không chứng minh
database transaction. Sau khi được phép áp dụng trên TEST, phải kiểm thử các trường hợp này,
thêm lỗi cố ý khi chèn audit để xác minh rollback và hai QL duyệt cùng lúc. Đọc lại phân công sau
duyệt/từ chối và kiểm tra màn hình của module khác không tính REPLACED như ca đang làm.

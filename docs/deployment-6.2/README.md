# Dev-import Lê Duẩn — sẵn sàng ở local, chưa triển khai

Bổ sung cho kế hoạch 6.1. Không chạy migration/seed/Auth/enable lên Supabase. Không sửa deadline hoặc nhu cầu. Không commit/push. Schema 20261104 TV5 giữ nguyên; chỉ có migration tăng dần 20261105.

## Hợp đồng nguồn dùng chung

`DEV_IMPORT_ENABLED` mặc định false. Backend chỉ cho bật nếu NODE_ENV là development/test, đúng SUPABASE_URL `https://wimikwyuzhltpjciafod.supabase.co`, project ref và batch ID được khai báo. Production hoặc sai cấu hình dừng ngay; không nhận cấu hình từ payload/header browser.

SDK server gắn `x-jollishift-dev-import=<environment>/<project>/<batch>` lên request đến PostgREST. Cần restart backend sau khi đổi cấu hình. SQL đòi cùng context và registry đã được operator seed, đúng branch/kỳ cố định. Không có header thì SQL giữ hành vi thường dù registry đã có dữ liệu. Các helper chỉ đọc; anon/authenticated không được EXECUTE hay đọc/ghi registry.

Registry phải khớp receipt audit bất biến. Header và **từng row đăng ký** phải còn nguyên after-image trong manifest. Không thể thêm row lạ dưới một header được duyệt để được đọc theo batch. Giữ nguyên sample_batch_id/legacy provenance; không giả SUBMIT, không ép timestamp trước hạn. Ghi submitted_at/updated_at bằng thời gian DB lúc import, audit DEV_IMPORT rõ ràng.

TV2 report, readTv2Source/tv2Availability, repository Rule Engine và provenance cùng tiêu chí. Migration thay SQL input v2 theo checksum đã rehearsal; persist/TV4/TV5 tái sử dụng input này nên cùng nguồn. Không sửa validation nộp TV2: kỳ đóng vẫn từ chối. UI dùng nguồn Supabase bình thường, không cần test-preview; không bật TV3_TEST_PREVIEW_ENABLED vì chế độ đó khóa writers.

## Quy mô đã rehearsal

Nguồn từ artifact positive đã chuẩn bị được dựng thành dữ liệu PostgreSQL cách ly (tên nhân viên được thay bằng tên synthetic). Không đọc/ghi Supabase để chạy rehearsal.

| Hạng mục | Kết quả |
|---|---:|
| Nhân viên hiện có tái sử dụng | 60, trong đó 7 CREW_LEADER không tính nhu cầu thường |
| Nhân viên cần bổ sung theo baseline cũ | 17; Auth/profile là điều kiện ngoài executor |
| Header import mới | 68, không chạm 2 header thật |
| Đăng ký import | 560 fixture + 31 completion = 591 |
| Đăng ký thật giữ nguyên | 16; tổng nguồn nhận 607 |
| Người khác nhau mỗi ngày 02–08/11 | 67, 66, 67, 67, 66, 67, 67 |
| Phân công / nhu cầu | 308 / 308 |
| Shortage / ô thiếu kinh nghiệm | 0 / 0 |

Xem `local-rehearsal.json` và `uuid-manifest.json`. UUID manifest là minh họa rehearsal, **không phải xác nhận apply lên DB nhóm**. Baseline checksum được tạo từ dữ liệu synthetic nên không thể dùng để apply vào nguồn thật. Chuẩn bị lại trên DB thật bằng mode prepare chỉ đọc sau khi các điều kiện bên dưới được xác nhận. Nếu có đăng ký thật mới, header, nhân viên hoặc nhu cầu thay đổi, dừng và điều chỉnh kế hoạch; không xóa/sửa dữ liệu nhóm để giữ con số 308.

Rehearsal kiểm tra TS/SQL cùng 607 rows; persistence 308 → submit → GS approve → publish → NV xem → TV5 mời/nhận/phê duyệt thay người. Transaction lifecycle trong test được rollback riêng để kiểm thử rollback seed; không có schedule thật được tạo ngoài cluster cách ly.

## Executor và các chốt an toàn

`backend/scripts/dev-import-executor.cjs` mặc định inspect, không kết nối hay ghi. Không đọc .env, không tạo Auth, không tạo/sửa public.users. Apply cần toàn bộ Auth/profile được provision riêng, role/username/branch/is_active khớp; thiếu thì báo missing_profiles và bắt prepare lại sau provision. Không tự tắt must_change_password.

Prepare dùng REPEATABLE READ READ ONLY, kiểm tra baseline, collision và engine. Không có lịch ở kỳ đích, không có header của người được import, không có UUID employee/registration trùng. Ràng buộc người/ngày, ca trùng, kỹ năng, nhu cầu 308 và cơ cấu được kiểm tra lại bằng engine hiện hành. Không giới hạn giờ đăng ký; chỉ giữ giới hạn làm việc thực sự có trong dữ liệu.

Apply cần SHA-256 của chính plan được phê chuẩn, NODE_ENV khớp, kết nối TLS xác minh đến **direct host của đúng project**. Không nhận URL database tùy ý hoặc tự chấp nhận pooler/alias. Local test chỉ dùng loopback khi NODE_ENV=test và DEV_IMPORT_LOCAL_REHEARSAL=true. Giao diện web không có API import/enable registry.

Transaction giữ khóa NOWAIT các bảng nguồn/writer để kiểm tra lại checksum baseline, đọc lại engine, chèn đúng UUID mới, lưu after-images và receipt, kiểm tra SQL round-trip 308 trước commit. Retry cùng plan trả receipt cũ nếu after-images và receipt còn đúng; không nhân đôi rows. Plan khác/sai checksum/dữ liệu thay đổi đều dừng. Nếu lỗi receipt/audit, toàn bộ seed rollback.

Rollback cần cùng plan/checksum/connection/environment, đối chiếu receipt bất biến và after-images. Chặn khi đã có schedule kỳ đích. Tự đọc tất cả FK tham chiếu employees/headers/registrations, kể cả composite/cross-schema; khóa bảng con trước khi kiểm tra để tránh race insert-then-cascade. Bất kỳ dependency ngoài tập owned rows đều làm transaction dừng. Xóa từng tập UUID/khóa header chính xác theo thứ tự, kiểm tra số dòng; không có CASCADE. Giữ batch/receipt/audit và thêm audit rollback; không xóa Auth/profile. Batch đã rollback là terminal, không tự seed lại cùng batch. Nếu đã có lịch/đổi ca/skills của nhóm, cần phương án xử lý riêng, không cố rollback.

Backend không có quyền ghi registry; chỉ trusted operator thực thi executor. Project binding dựa trên URL/host đã xác minh và registry scoped, không suy ra project từ `current_database() = postgres`.

## Cách dùng trong bước triển khai được duyệt (chưa chạy)

Từ backend, sau build. Connection JSON, client pg, plan/receipt đầy đủ để ngoài repository và phân quyền; không đặt password vào command/URL/log. CLI từ chối ghi output trong workspace hoặc ghi đè file cũ. File connection cần host đúng project, database postgres, user đủ quyền và ssl.rejectUnauthorized=true cùng CA thích hợp.

```powershell
node scripts/dev-import-executor.cjs
# Sau khi được duyệt dùng kết nối read-only để prepare:
$env:NODE_ENV = 'development'
$env:DEV_IMPORT_PG_CLIENT = 'D:/JolliShift-private/tv3-postgres-tools/node-client/node_modules/pg'
node scripts/dev-import-executor.cjs prepare D:/JolliShift-private/connection.json ../docs/ld-integration-prepared/1793514872833/seed-plan.json D:/JolliShift-private/fresh-plan.json
# Chỉ khi có xác nhận apply riêng cho đúng checksum:
$env:DEV_IMPORT_APPROVAL_SHA256 = '<plan_sha256 đã được xác nhận>'
node scripts/dev-import-executor.cjs apply D:/JolliShift-private/connection.json D:/JolliShift-private/fresh-plan.json D:/JolliShift-private/apply-receipt.json
# Rollback cũng cần xác nhận riêng và output mới; không tự chạy:
node scripts/dev-import-executor.cjs rollback D:/JolliShift-private/connection.json D:/JolliShift-private/fresh-plan.json D:/JolliShift-private/rollback-receipt.json
```

Nếu response/output bị mất sau COMMIT, giữ nguyên plan và retry với output path mới; receipt DB là nguồn xác nhận. Không tạo plan khác để vượt baseline lỗi. Chuỗi connection/output ở trên chỉ là đường dẫn minh họa, chưa có credential thật được tạo trong bước này.

## Rà TV5 20261104

Không cần sửa nghiệp vụ hoặc trạng thái TV5. Giữ preflight D4/D5 của 6.1 cho **toàn DB**: duplicate open request/incident, FK inbound tới UNIQUE, dữ liệu lịch công bố mâu thuẫn và request cũ thiếu snapshot. Không auto cleanup hay gắn snapshot giả cho yêu cầu cũ; QL/chủ dữ liệu phải quyết định.

Partial UNIQUE chỉ loại REPLACED để giữ chain A → B → A; UNIQUE successor ngăn hai dòng kế thừa cùng ca cũ. RPC khóa cạnh tranh, kiểm tra source snapshot, consent và điều kiện ngay trước approve. Body clone metrics có guard; không bỏ guard để triển khai. Sau khi có duplicate lịch sử, không restore UNIQUE cũ bằng cách xóa lịch sử; ưu tiên forward-fix và giữ writer tắt. Khóa bảng có thể ảnh hưởng TV2, cần cửa sổ bảo trì.

Executor rollback mới đặc biệt khóa và kiểm tra cả employee_skills có FK ON DELETE CASCADE sẵn trong schema. Không lợi dụng FK đó để xóa việc nhóm thêm sau seed; rehearsal chứng minh thao tác bị chặn.

## Thứ tự triển khai và GO/NO-GO mới

1. Fresh catalog/data preflight 6.1, đúng project, backup/restore thử, đối chiếu hooks Auth/DDL, kiểm tra nhóm không có dữ liệu xung đột. Chốt byte/code đang triển khai và cửa sổ bảo trì.
2. Nếu thiếu: TV4 20261029 → TV3 20261101 → TV4 20261102 → employee read 20261103 → TV5 20261104 → **scoped dev-import 20261105**. Không chạy lại foundation/TV2/v1 đã có. 20261105 cần checksum input v2 đúng `80ec1098f661c668d89acda7a2dfbb25`; sai thì dừng review, không ép overwrite.
3. Registry ban đầu rỗng, không seed và không bật cờ do migration. Kiểm tra view/helper/ACL bằng `preflight.sql`, giữ toàn bộ writer flags OFF.
4. Fresh prepare chỉ đọc; xác minh Auth/profile dự kiến và số thực tế cần thêm. Provision Auth/profile là thao tác được duyệt riêng; kiểm tra trigger không tự tạo employee trùng. Sau đó prepare lại baseline/plan, review 308/308, daily distinct, UUID và SHA-256.
5. Xác nhận seed chính xác plan, chạy apply một lần; lưu receipt riêng; kiểm tra 16 real rows/nhu cầu/period/tài khoản nhóm không đổi. Sai baseline, thiếu profile, timeout, thiếu direct TLS hoặc mẫu khác không được tự nới kiểm tra.
6. Sau xác nhận riêng, restart backend với DEV_IMPORT_ENABLED=true, NODE_ENV đúng registry, DEV_IMPORT_PROJECT_REF và DEV_IMPORT_BATCH_ID đúng, source supabase/test-preview=false. Kiểm tra TV2 report → TS preview → SQL cùng nguồn. Không bật writer cùng lúc để dò lỗi.
7. Lần lượt xác nhận enable TV3 DRAFT, TV4 workflow, TV5; nghiệm thu web và gateway thật, AI provider thật nếu nằm trong phạm vi. Không mở hạn TV2: nộp thành công cần kỳ OPEN tự nhiên riêng; kỳ lịch sử dùng dev-import rõ nguồn.

**Đã đóng blocker ở local:** tagged dev-import nguồn chung, positive 308, executor/checksum/receipt/idempotency/dependency rollback và integration SQL đầy đủ.

**Còn NO-GO cho Supabase ngay lúc này:** chưa có catalog/data mới, chưa có backup restore thật, chưa provision/đối chiếu Auth, chưa có fresh plan/checksum thật được duyệt, chưa áp migration, chưa kiểm tra PostgREST view-FK inference/header forwarding/outer timeout hoặc web/AI thật. Cần đo tải full batch qua gateway; thời gian test native gồm setup/teardown và không phải latency API. Direct PostgreSQL/TLS chưa truy cập được thì dừng, không tự chuyển sang executor REST thiếu transaction.

**Ngoài phạm vi đã chốt:** timer/n8n và delivery thông báo ra ngoài, SUPPORT/liên chi nhánh/CREW_LEADER replacement, swap hai chiều. Chúng vẫn cần nghiệp vụ/triển khai riêng nếu được đưa vào nghiệm thu.

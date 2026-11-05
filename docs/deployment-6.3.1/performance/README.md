# DRAFT 308 — profiling và tối ưu local

Chỉ PostgreSQL loopback cô lập, không đọc/ghi Supabase. Evidence: `draft-profile-run1.json`, `draft-profile.json` (lượt xác nhận), tổng hợp `performance-summary.json`; kết quả seed/workflow: `../rebound/local-rehearsal.json`. Budget vẫn 3 giây, không giảm 308 phân công hoặc bỏ validation.

## Nguyên nhân

Điểm nghẽn ở `tv3_scheduling_input`, trước vòng ghi assignment. Trong mẫu instrumented trước sửa, quyền/khóa khoảng 2,6 ms nhưng source khoảng 4.528 ms, sau đó RPC bị budget chặn. `pg_stat_user_functions` của hai lượt dựng nguồn ghi nhận khoảng 2.500 lần gọi `dev_import_header_allowed`/`dev_import_context_matches` và 1.182 lần gọi row gate. Đây là N+1 **bên trong PostgreSQL**, không phải 2.500 HTTP request. Receipt so toàn bộ manifest lặp theo từng header/registration; thêm index không loại được công việc JSON này.

Migration tăng dần `20261106_dev_import_source_materialization.sql`, sau 20261105, chỉ thay phần dựng nguồn: CTE MATERIALIZED cho batch, header hợp lệ và row hợp lệ. Mỗi snapshot xác minh context/receipt một lần, vẫn so toàn bộ after-image của từng header/row. Helper private `dev_import_utc_image(anyelement)` chỉ chuẩn hóa JSON giá trị đầu vào ở UTC, không đọc bảng; API giữ nguyên timezone hiển thị và source trước/sau phải deepEqual. Không cache giữa transaction/request.

`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` đã lưu cho source và CTE nội bộ. Plan nội bộ: batch 1 dòng/1 loop, headers 68, registrations 591; dùng `registration_submissions_pkey` và `shift_registrations_unique`. Không thêm index. Các node/index scan lặp theo header vẫn có nhưng không lặp receipt/manifest integrity toàn batch. SQL private helper thêm một function, không thêm cột/bảng và không UPDATE/DELETE dữ liệu.

## Thời gian

Đo RPC trực tiếp với full 308 assignments, BEGIN/ROLLBACK riêng từng mẫu, không chạy build/test cạnh benchmark. Mẫu chấp nhận dùng function gốc không instrument; NOTICE profiling chỉ dùng cho chẩn đoán. Baseline lỗi là thời gian tới lỗi, không phải thời gian lưu thành công.

| Nhóm | Số mẫu | PASS / FAIL | Trung vị RPC | p95 RPC (nearest rank) |
|---|---:|---:|---:|---:|
| Trước, hai cohort | 6 | 0 / 6 | 3.138 ms | 4.201 ms |
| Sau, hai cohort | 20 | 20 / 0 | 727 ms | 899 ms |

Trong mẫu instrumented sau sửa của cohort 1: quyền/khóa 2 ms; source 262 ms; snapshot validation + tạo schedule 3 ms; kiểm tra/ghi assignments 341 ms (INSERT riêng ~69 ms); metrics/coverage/experience/history + chuẩn bị response 140 ms; audit 29 ms. RPC ~798 ms, BEGIN ~0,3 ms, ROLLBACK ~1,8 ms, reserialize response ~2 ms. Timestamp checkpoints là cộng dồn; các delta/subset không được cộng trùng. Tất cả 20 mẫu sau sửa nằm trong 620–930 ms.

Đã đo canonicalInput và serverVerifiedPlan thật ở Node (khoảng 27 ms và 292 ms trong lần chạy này); xem giá trị chính xác JSON. Normalization/serialization payload ghi riêng. Các số này ngoài budget SQL; không loại bỏ lần generate/review nào ở backend để đạt kết quả. Một RPC benchmark là một query client; API hiện hành còn các lần đọc snapshot/replay/input và RPC input/save, không đổi số lần HTTP/database của backend trong bản sửa này.

Không coi p95 của 20 mẫu là cam kết production. Benchmark chưa đo JWT qua web, rendering, gateway/TLS Supabase hoặc COMMIT/fsync: mẫu benchmark rollback để tái lập cùng trạng thái. Rehearsal riêng có lưu DRAFT và kiểm tra workflow/audit/rollback; vẫn cần nghiệm thu gateway/web và backup/restore thật trước GO.

## Cách chạy lại

Từ backend, sau build, dùng private native tool paths như các rehearsal trước; không cần `.env`/database URL:

```powershell
$env:REGISTRATION_USE_NATIVE = 'true'
$env:TV3_NATIVE_PG_ROOT = 'D:/JolliShift-private/stage631-perf'
$env:TV3_NATIVE_PG_BIN = 'D:/JolliShift-private/tv3-postgres-tools/pgsql/bin'
$env:TV3_NATIVE_PG_CLIENT = 'D:/JolliShift-private/tv3-postgres-tools/node-client/node_modules/pg'
$env:TV3_DRAFT_PROFILE = 'true'
node --require ./tests/helpers/offline-only.cjs --test tests/dev-import.test.cjs
```

Profile dựng toàn bộ fixture native, đo baseline M5, áp M6 **chỉ cluster cô lập**, xác minh source ngang bằng, đo sau sửa rồi tiếp tục test lifecycle. Khi không có TV3_DRAFT_PROFILE, test áp M6 ngay và kiểm tra regression (bao gồm tamper header/row/context). Không chạy đồng thời workload khác để so số hiệu năng.

## Deployment và rollback

Thứ tự mới: TV4 nền nếu thiếu → 20261101 → 20261102 → 20261103 → 20261104 → 20261105 → **20261106**. M6 kiểm tra normalized MD5 input M5 `ef26158ddf7291344ac48c768fc1998d`, owner postgres, SECURITY DEFINER; khác thì dừng. Giữ nguyên signature/ACL/input contract và RPC persist, locks, version/idempotency/hard constraints/audit. Helper UTC owner postgres, revoke EXECUTE PUBLIC/anon/authenticated/service_role.

Migration một transaction, không có backfill, index build hay thay đổi dữ liệu/tài khoản. DDL cần cửa sổ triển khai và catalog review; không chạy trên shared DB ở bước này. Nếu migration lỗi trước COMMIT thì toàn file rollback. Nếu cần phục hồi sau COMMIT, giữ writers tắt và dùng definition source M5 đã backup, review trước khi thay; helper private có thể giữ để tránh DROP dependency. Phục hồi M5 cũng phục hồi lỗi hiệu năng, nên ưu tiên forward fix. Không CASCADE hoặc rollback dữ liệu lịch sử.

NO-GO triển khai thật vẫn giữ đến khi có catalog mới, backup/restore thành công và fresh live plan được phê duyệt. Báo cáo REBOUND-RESULT trước đó ghi lỗi đã được thay thế về mặt kết quả hiệu năng bởi thư mục này.

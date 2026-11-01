# Giai đoạn 1 — hợp đồng DRAFT / Rule Engine v2

Chỉ thay đổi local. Chưa chạy migration, tạo Auth, seed hoặc bật persistence trên
Supabase. Chưa triển khai workflow TV4/UI quản lý và đổi ca của các giai đoạn sau.

## Hợp đồng

- `rule_version=tv3.rules.v2` nằm trong input/result. Preview revision phụ thuộc
  rule version; canonical input còn gồm mã nhân viên, lịch lễ và provenance header
  (employee/batch/submitted_at/updated_at). Không coi header sửa lại là nguồn cũ.
- RPC v2 giữ chữ ký cũ, kiểm tra quyền, snapshot, khóa, CAS/version/idempotency.
  Migration kiểm tra owner và checksum prosrc của cả ba function từ bản đã audit;
  gặp implementation khác thì dừng. Không chạy lại migration nền, không backfill.
- SQL tự tính coverage từ phân công mới + phân công có sẵn hợp lệ, gộp trùng và
  kiểm tra quá nhu cầu. REGULAR/CREW_TRAINING đều tính kinh nghiệm; mục tiêu
  min(2, nhu cầu). Thiếu kinh nghiệm là cảnh báo, không trở thành giới hạn mới.
- SQL tính lại giờ và tổng bình phương độ lệch theo cùng tập nhân viên; trước/sau
  optimizer được đối chiếu, không tin số liệu từ browser. Không chạy local search
  lần hai trong SQL; TypeScript vẫn là nơi chọn người.
- Browser chỉ gửi bốn field phân công. Nếu khớp engine server tính lại, backend
  giữ reason/history/optimization của engine. Lựa chọn khác phải qua review, ghi
  MANAGER_REVIEWED và history manual; không gán trace optimizer cho lựa chọn tay.
- Trace/history và chỉ số được lưu trong audit AUTO_GENERATE bất biến, không thêm
  cột trace vào bảng assignments. `readDraft` phục hồi metadata theo đúng tuple
  employee/date/shift/department từ audit. Dữ liệu cũ vẫn đọc được, không bịa history.
- Đăng ký sample vẫn bị loại ở luồng thật. Giai đoạn 6 sẽ bổ sung dev-import được
  allowlist riêng, không tận dụng giai đoạn 1 để cho phép mọi sample ghi lịch.
- Lịch lễ được bind vào fingerprint; SQL snapshot hiện trả mảng rỗng vì database
  chưa có nguồn lịch lễ được duyệt. Không tự đoán ngày lễ hoặc thêm bảng lịch lễ.

## File migration local

`backend/migrations/20261101_tv3_rule_contract_v2.sql` chỉ thay function và ACL.
Các helper mới chỉ owner gọi; client anon/authenticated không được gọi RPC lưu,
service_role không được gọi helper snapshot/result/balance trực tiếp.

Backend mới từ chối lưu nếu RPC snapshot chưa có rule_version v2. Trước triển khai
thật: backup definitions/ACL, đối chiếu lại catalog, duyệt nguyên file migration,
chạy trong transaction, kiểm tra ACL và round-trip rồi mới bật cờ persistence.
Không tái chạy file sau khi đã thành v2: checksum guard cố ý dừng thay đổi không rõ.
Rollback triển khai phải khôi phục đúng function bodies/ACL đã backup và deploy
backend tương ứng; không xóa schedules/audit hoặc chạy lại schema nền.

## Kiểm thử

Unit/backend HTTP: chạy với preload `tests/helpers/offline-only.cjs`.
Native PostgreSQL: harness tạo cluster disposable loopback riêng, không nhận URL
Supabase. Cấu hình private `TV3_NATIVE_PG_ROOT`, `TV3_NATIVE_PG_BIN`,
`TV3_NATIVE_PG_CLIENT`, rồi chạy `tests/draft-contract-v2-sql.test.cjs`.
Chạy lifecycle qua cùng native cluster bằng `REGISTRATION_USE_NATIVE=true`;
không dùng PGlite để nghiệm thu RowShareLock hoặc cạnh tranh nhiều session.

Bao phủ migration guard, private ACL, coverage/statistics parity, actual local-search
history/score round-trip, manual plan, version/edit/replay, provenance stale,
forged metric/history rollback và mẫu bị loại. Không phải bằng chứng migration
đã triển khai lên Supabase hay RPC TV4 đã hoạt động.

Giai đoạn tiếp theo: hoàn thiện mở/chỉnh sửa DRAFT và trải nghiệm AI trên web,
sau đó triển khai submit/decision/resubmit/publish ở giai đoạn 3; chưa seed 308/308.

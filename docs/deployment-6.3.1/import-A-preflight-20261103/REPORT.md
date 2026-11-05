# Bộ A — kiểm tra trước import

**PASS, chờ chủ dự án duyệt digest.** Kiểm tra ngày 03/11/2026 bằng PostgreSQL REPEATABLE READ READ ONLY; không DDL/DML, không Auth, không bật persistence.

- Project `wlbpprpiieonjrqglicv`, Session pooler đúng project, TLS xác minh chứng chỉ.
- Chi nhánh Jollibee Lê Duẩn `11111111-1111-1111-1111-111111111111`; kỳ `79a979cc-8347-48b5-a411-f03bd8aceb92`, 02–08/11/2026. Giữ nguyên deadline và trạng thái lưu trong DB.
- Nguồn hiện tại: 60 nhân viên, 2 hồ sơ/16 lượt đăng ký thật, 63 ô nhu cầu/308 vị trí, 0 lịch cho kỳ, 0 registry cho batch này.
- Bổ sung đúng 51 hồ sơ/640 lượt đăng ký; không bổ sung employee/profile/Auth. Sau import dự kiến 53 hồ sơ/656 lượt đăng ký. Không trùng UUID hoặc khóa đăng ký; không trùng hồ sơ hiện có, không trùng thời gian đăng ký của cùng nhân viên.
- Mô phỏng Rule Engine trong bộ nhớ từ nguồn mới: 308/308, thiếu người 0, thiếu cơ cấu kinh nghiệm 0. Không lưu phân công. Người khác nhau mỗi ngày: **53, 52, 53, 53, 52, 53, 53**; đây là bộ A đã chọn dùng nhân viên hiện hữu.
- Local search thực hiện 8 thay thế; chỉ số cân bằng 350.55167055167055 → 90.55167055167055, hội tụ. Kết quả được tính lại, không import lịch kết quả.
- SHA-256 16 dòng thật vẫn khớp baseline trước triển khai: `421243c8c29a18866485093a2adbceb9b7837ac5b2f29a80ae789d3cbea82ea0`.

## Plan được xin duyệt

Private file: `D:/JolliShift-private/minimal-backup/fresh-A-plan-20261103.json`. Không ghi đè plan cũ.

**plan_sha256 (digest cần duyệt):**

```text
b9dcd9fbb121b39816458ae6ef82d28c84c5b93fb12c4e82dd5830a029850979
```

- File SHA-256: `91e6bee41f11c9f7a06d95866395d8f4d937ff9b7d6f4ec2eef79e32ad4e80da`.
- Baseline SHA-256: `d95acd8c63376789b8b947432815cccd4c007ee3baf107632cee9e292ca03467`.
- Batch: `6e1d2026-1102-4000-8000-000000000017`.
- Apply sẽ khóa bảng, kiểm tra lại baseline/digest trước ghi; nếu nguồn thay đổi sẽ dừng và cần prepare/duyệt lại. Không tự dùng digest khác.
- Timestamp import là thời điểm transaction thực; giữ sample_batch_id, provenance/audit và receipt. Không sửa deadline hoặc giả ngày nộp.

## Rollback

Đã rà soát executor hiện tại: kiểm digest, immutable receipt và after-image; kiểm lịch phụ thuộc và FK; khóa dữ liệu, không dùng cascade. Chỉ xóa đúng 640 UUID đăng ký và 51 hồ sơ thuộc batch; danh sách employee thêm mới rỗng. Registry bị vô hiệu hóa, lịch sử audit được giữ. Nếu dữ liệu đã thay đổi hoặc có lịch/phụ thuộc thì dừng rollback để xử lý riêng, không xóa dây chuyền.

Đã có bằng chứng rehearsal PostgreSQL cô lập cho bộ existing-employees: `docs/demo-datasets/1793634151022/postgres/local-rehearsal.json`, gồm rollback có guard, bảo toàn 16 dòng thật và idempotency PASS. Lần này **không chạy rollback trên Supabase**. Backend build PASS; test fail-closed dev-import PASS (1 test); test PostgreSQL tích hợp không chạy lại lần này, được skip đúng cấu hình.

## Điểm dừng

Chưa import. Chỉ tiến hành sau khi chủ dự án duyệt đúng plan_sha256 trên. Duyệt import không bao gồm bật writer, tạo/lưu lịch hoặc Auth.


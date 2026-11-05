# Import bộ A — PASS

Project `wlbpprpiieonjrqglicv`, chi nhánh Jollibee Lê Duẩn, kỳ **02–08/11/2026**. Postflight hoàn tất **03/11/2026 14:39:54 Asia/Saigon**. Chỉ thực hiện import đã được chủ dự án phê duyệt; không bật writer lịch.

## Phạm vi được duyệt

- Plan digest: `b9dcd9fbb121b39816458ae6ef82d28c84c5b93fb12c4e82dd5830a029850979`.
- Baseline: `d95acd8c63376789b8b947432815cccd4c007ee3baf107632cee9e292ca03467`.
- Batch: `6e1d2026-1102-4000-8000-000000000017`.
- Trước import, prepare chỉ đọc tính lại đúng digest/baseline đã duyệt; executor khớp checksum bundle. Apply kiểm tra lại baseline dưới khóa bảng trước khi ghi và COMMIT transaction thành công. Không dùng plan thay thế.

## Dữ liệu thực tế sau import

| Dữ liệu trong phạm vi chi nhánh/kỳ | Trước | Bổ sung | Sau |
|---|---:|---:|---:|
| Nhân viên | 60 | 0 | 60 |
| Hồ sơ đăng ký | 2 | 51 | 53 |
| Lượt đăng ký | 16 | 640 | 656 |
| Ô nhu cầu | 63 | 0 | 63 |
| Vị trí nhu cầu | 308 | 0 | 308 |
| Lịch trong kỳ | 0 | 0 | 0 |

Không tạo Auth/profile/employee. Toàn bộ dữ liệu gốc thuộc 27 bảng public và Auth users/identities vẫn có nguyên after-image/hash ban đầu. Chênh lệch duy nhất: 51 hồ sơ, 640 đăng ký, 1 registry batch, 2 audit (import và receipt); không có thay đổi bảng khác.

16 đăng ký thật giữ nguyên SHA-256 `421243c8c29a18866485093a2adbceb9b7837ac5b2f29a80ae789d3cbea82ea0`. Không sửa deadline/trạng thái kỳ, nhân viên, kỹ năng hoặc nhu cầu.

640 đăng ký khớp từng UUID/employee/ngày/ca/period của plan và có trạng thái VALID; 51 hồ sơ đúng batch và VALID. Timestamp sử dụng transaction_timestamp() thực tế, không giả thời điểm nộp. Sample batch/provenance và lịch sử audit được giữ.

## Receipt và nguồn dữ liệu

- Receipt local đầy đủ (chứa after-images, giữ ngoài repository): `D:/JolliShift-private/minimal-backup/apply-A-receipt-20261103.json`.
- Registry manifest và immutable receipt trong audit đã đối chiếu khớp, after-images thực tế khớp cả receipt và registry.
- After-image SHA-256: `a97373a985e0892adb745f6f07a29850c2277ef5ccf40b630e75ec066e3892fc`.
- SQL source mặc định chỉ nhận **16** đăng ký thật. Context dev-import đúng batch nhận **656** đăng ký. Context kiểm tra chỉ set LOCAL trong transaction READ ONLY, không bật cấu hình backend.
- Apply chạy Rule Engine trong bộ nhớ để kiểm tra SQL roundtrip đạt 308/308, không shortage/cơ cấu thiếu; **không INSERT schedules/assignments**, không gọi RPC lưu lịch.

## Rollback

Kiểm tra SELECT tại thời điểm postflight: đủ điều kiện rollback riêng batch — receipt/after-image đúng, chưa có lịch phụ thuộc, kiểm tra 12 FK không thấy dữ liệu ngoài batch phụ thuộc. Rollback thực tế chưa chạy; nếu sau này cần rollback, executor phải kiểm tra lại dưới khóa. Không cascade, không xóa audit; dữ liệu đã sửa hoặc có lịch/phụ thuộc sẽ chặn rollback.

## Lỗi kết nối và điểm dừng

Một lượt preflight chỉ đọc không hoàn tất; các lượt kiểm tra sau tính lại đúng digest/baseline. Apply chạy **một lần**, thành công. Lượt postflight đầu gặp lỗi DNS ENOTFOUND trước truy vấn; đã dừng ghi, chỉ thử lại SELECT và PASS. Không replay import, không sửa dữ liệu để vượt kiểm tra.

Chứng cứ: `before.json` (row hashes), `after.json` (kết quả SELECT). Runner `backend/scripts/verify-approved-A-20261103.cjs` chỉ kiểm tra, không apply/rollback.

Chưa bật DEV_IMPORT runtime hoặc TV3/TV4/TV5 persistence, không tạo lịch, không tạo Auth, không commit/push. Bước tiếp theo cần duyệt riêng: bật backend đúng batch và writer cần thiết để nghiệm thu web DRAFT → phê duyệt → công bố → xem lịch → đổi ca.

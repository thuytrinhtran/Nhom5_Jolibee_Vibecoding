# Kết quả triển khai Supabase

Hoàn tất **03/11/2026 khoảng 00:03 Asia/Saigon** (receipt lưu UTC 02/11). Project `wlbpprpiieonjrqglicv`. Chủ dự án đã duyệt bảy migration; chưa duyệt import/Auth/bật writer.

## Trước triển khai

- Session pooler đúng project, PostgreSQL 17.11, TLS xác minh chứng chỉ, role postgres.
- Bundle SHA-256 `80010867af3ec434e5d159b598c08bb05552d0a7f74d43945fb71fb0a4893d8a`; toàn bộ 54 file khớp. Giữ nguyên bundle đã duyệt, không sửa cờ approval lịch sử bên trong bundle.
- Backup ngoài repository: `D:/JolliShift-private/minimal-backup/backup-ready-20261102/jollishift-public-auth.dump`, 340433 bytes; SHA-256 `6a4d9511784339108ad303af140854d2a524fe366a73dacf363b8ef813b8e919` khớp. Đã kiểm tra TOC/decode offline; **chưa thử restore**, theo phương án chủ dự án chọn. Không phải backup toàn bộ nền tảng Supabase.
- Chụp checksum/count dữ liệu 26 bảng public và Auth users/identities. So sánh theo các cột gốc, để cột mới được thêm không gây sai lệch giả.

## Migration

| Thứ tự | File | Kết quả |
|---|---|---|
| 0 | 20261029_tv4_schedule_workflow.sql | PASS |
| 1 | 20261101_tv3_rule_contract_v2.sql | PASS |
| 2 | 20261102_tv4_workflow_v2.sql | PASS |
| 3 | 20261103_employee_schedule_read.sql | PASS |
| 4 | 20261104_tv5_shift_replacement.sql | PASS |
| 5 | 20261105_scoped_dev_import.sql | PASS |
| 6 | 20261106_dev_import_source_materialization.sql | PASS |

Mỗi file chạy transaction riêng; chỉ chuyển bước khi kiểm tra stage và checksum dữ liệu cũ PASS. Receipt `stage-0.json` đến `stage-6.json` lưu thời điểm, checksum bundle, xác nhận COMMIT và dữ liệu giữ nguyên. Không có lỗi migration/postflight. Preflight đầu gặp lỗi parse name[] trong runner local, đã sửa thành text[] và chạy lại thành công trước bất kỳ migration nào.

## Postflight

- 54/54 kiểm tra owner/EXECUTE RPC chính PASS; 12/12 kiểm tra quyền helper dev-import PASS. RPC backend không cấp EXECUTE cho anon/authenticated.
- 27/27 bảng public bật RLS; không có constraint chưa validate. Registry dev-import rỗng, không cấp CRUD cho anon/authenticated/service_role.
- Trigger phê duyệt đã gắn và bật; 4 index TV5 current/successor/open-request/open-incident đều UNIQUE và valid.
- Checksum body chuẩn hóa khớp rehearsal: input `76d7d3e9c1b4e6bd0667125e3aace2bb`; persist `f5654bfccd235ef82403e46e65e9128c`; UTC helper `2fea943d86c07ea74be2ec9516cdf6de`. Budget DRAFT vẫn 3 giây.
- Dữ liệu 26 bảng public gốc và Auth users/identities không đổi sau từng migration và sau toàn bộ rollout. Giữ nguyên 60 nhân viên, 16 đăng ký thật, 63 ô nhu cầu/308 vị trí; không thêm lịch.
- Catalog READ ONLY mới: 60 output tại `D:/JolliShift-private/minimal-backup/live-postdeployment-20261103/`. Bỏ qua một mục: migration-history table vốn không tồn tại. Không tự tạo ledger; dùng receipt local. C5 trong collector là guard v1 lịch sử, không dùng làm điều kiện PASS sau nâng v2.
- Chi tiết trong `postflight-acl.json`, `postflight-facts.json`, `supplemental-postflight.json`, `final.json`, `baseline.json`. Baseline chỉ chứa tên cột/count/checksum, không chứa dữ liệu tài khoản.

## Bước kế tiếp cần duyệt riêng

Database TV3–TV5 đã triển khai, sẵn sàng chuẩn bị fresh plan/digest bộ A. Chưa import 51 hồ sơ/640 đăng ký, chưa tạo Auth, chưa bật DEV_IMPORT hoặc TV3/TV4/TV5 persistence. Không thay đổi backend/.env, không commit/push.

Sau khi duyệt import riêng và kiểm tra receipt, xin duyệt bật writer để nghiệm thu web: preview → lưu/mở lại DRAFT → gửi duyệt → duyệt → công bố → nhân viên xem lịch → đổi ca. Postflight lần này kiểm tra catalog/quyền/dữ liệu, không gọi RPC ghi để kiểm thử end-to-end.

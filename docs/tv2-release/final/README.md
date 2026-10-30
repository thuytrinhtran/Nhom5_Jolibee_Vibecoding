> B?n c?p nh?t Git: ?? ??ng b? nh?nh feature/Lichlamnhanvien v?i main e30694b; xung ??t t?ch h?p ?? ???c gi?i quy?t, gi? ??y ?? TV2/TV4. K?t qu? ki?m th? t?ch h?p: backend 68/68, frontend 68/68, build ??t. C?c ghi ch? ch? t?ch h?p main b?n d??i l? tr?ng th?i l?ch s? tr??c b??c ??ng b? n?y.

# TV2 — bộ triển khai cuối, cần trưởng nhóm duyệt

Đích duy nhất: `wlbpprpiieonjrqglicv`. **Chưa chạy migration, bootstrap hoặc kích hoạt cron trên project chung.** Báo cáo GET hiện tại: [cloud-read-only.json](cloud-read-only.json). Service-role REST đang có không chứng minh quyền SQL quản trị hoặc pg_cron đã được bật.

## Thành phần đã lập trình

| Chức năng | Thực hiện |
|---|---|
| Nhân viên | Auth/Bearer TV1; employee và branch lấy từ database; 7 thẻ 4+3 trên desktop; chọn ca, nháp/gửi/sửa; OFF chỉ sau VALID; Crew Leader bị chặn |
| Trạng thái | Timestamp server là nguồn quyết định; GET trả status hiệu lực và stored_status; PUT kiểm tra giờ Express; RPC khóa và kiểm tra giờ PostgreSQL, kiểm tra lại deadline trước ghi |
| Tạo kỳ | `tv2_ensure_registration_periods()` tạo 4 tuần bắt đầu từ thứ Hai tiếp theo, tất cả branch ACTIVE có employee ACTIVE/NV phù hợp; không ghi đè kỳ đã có |
| Lịch | Thứ Sáu 15:00 → Chủ nhật 12:00, Asia/Ho_Chi_Minh; work week thứ Hai–Chủ nhật. Không phụ thuộc cron cập nhật status |
| Scheduler | pg_cron gọi SQL nội bộ mỗi giờ, phút 07; bootstrap một lần khi kích hoạt; vẫn chạy khi laptop tắt, với điều kiện database cloud hoạt động |
| Chống trùng | UNIQUE(branch_id,work_start_date), ON CONFLICT DO NOTHING, advisory lock; toàn bộ lần chạy là transaction; lỗi được cron ghi nhận, lần sau chạy lại an toàn |
| Dữ liệu mẫu | Không xóa/sửa hàng cũ. sample_batch_id giữ nguyên; view nhận diện fixture v2 chỉ khi khớp audit, danh sách nhân viên, timestamp mô phỏng và header chưa sửa. Mẫu mặc định bị loại; TV3 có opt-in |
| Quản lý/TV3 | API đọc có guard phạm vi + 3 truy vấn contract; không sửa code xếp lịch hoặc trang quản lý thuộc người khác |

Scheduler mới không gọi `run_registration_automation`, không gửi hoặc xếp hàng email/Zalo/notification/reminder. Không bật config automation cũ.

## Thứ tự triển khai một lần

1. Trưởng nhóm duyệt code, [migration bổ sung duy nhất](../../../backend/migrations/20261030_registration_effective_state.sql), [00_preflight.sql](00_preflight.sql) và [02_activate_scheduler.sql](02_activate_scheduler.sql). Đối chiếu hash trong manifest. Chạy preflight **chỉ SELECT** bằng SQL Editor role postgres. Kiểm tra PK/FK/RLS/UNIQUE, owner/chữ ký/body RPC, danh sách cron hiện có và khả năng pg_cron. Nếu fingerprint RPC khác bản đã review, dừng để đối chiếu; không bỏ guard.
2. Áp dụng **chỉ migration bổ sung 20261030** toàn bộ một transaction. Không chạy foundation/Auth/M1/M2 lại, `01_apply_tv2.sql` lịch thứ Năm hoặc file 05 đã ngừng sử dụng. Migration tạo hàm/view/state và bổ sung cột; không tạo kỳ hay đổi status/timestamp hiện có. Source generator: `node backend/scripts/prepare-tv2-time-state.cjs`, chỉ ghi local.
3. Triển khai backend/frontend cùng phiên bản, giữ `.env` TV1 hiện có và frontend DEMO=false. Backend server key chỉ ở môi trường backend. TV2 đã lấy các bản sửa Auth từ origin/main c3ba6f2, giữ thêm prefix `/registrations`; không merge Git. Kiểm tra login/me/refresh và GET current. Nếu cloud còn RPC cũ thì chưa được coi là rollout hoàn tất.
4. Trong Supabase Dashboard, bật integration Cron/pg_cron **sau phê duyệt** nếu chưa có. Không tự cài bằng migration. pg_cron là lựa chọn chính vì tác vụ chỉ thao tác PostgreSQL, không cần token HTTP hoặc máy chủ Express đang mở. Tài liệu chính thức: [Cron](https://supabase.com/docs/guides/cron), [cài đặt](https://supabase.com/docs/guides/cron/install). Nếu preflight xác nhận project không hỗ trợ/quyền bị từ chối, chưa kích hoạt file 02; cần chủ project cấp quyền/đổi cấu hình cloud. Chưa có bằng chứng buộc phải thay bằng nhà cung cấp scheduler khác.
5. Role postgres chạy **02_activate_scheduler.sql** một lần: bootstrap tạo trước 4 tuần rồi đăng ký job có tên cố định. Chạy lại cùng file không tạo job/kỳ trùng; job tên đó có nội dung/owner khác sẽ bị từ chối. Bootstrap lỗi sẽ rollback cả activation. Không nhập secret nào vào SQL.
6. Chạy [03_verify.sql](03_verify.sql). Phải có đúng một job ACTIVE đúng command/schedule, không thiếu tuần ở các branch đủ điều kiện, không trùng khóa, state mới, helper-clock không được gọi bởi JWT. Sau tick đầu kiểm tra `cron.job_run_details` không có failed; xem stale_scheduler nếu hơn 2 giờ không thành công. Mở Dashboard Cron để theo dõi lỗi, không tự triển khai notification.
7. Smoke test cloud bằng phiên NV thật được người dùng cho phép: GET đúng employee/branch/department, kỳ và 3 ca; lưu nháp/gửi/F5/đăng nhập lại giữ dữ liệu; thử chéo quyền phải bị chặn. Không dùng đăng ký giả hoặc thay giờ DB thật để test biên. Bàn giao TV3 dùng view/contract mới, kiểm tra include_samples khi cần.

Không còn bước SQL mở kỳ hằng tuần. Một lần triển khai/activation được duyệt vẫn là bắt buộc. Sự cố cloud kéo dài sẽ cần vận hành khắc phục; job tự thử lại mỗi giờ, tạo lại horizon từ tuần hiện tại khi phục hồi, không mở lại cửa sổ đã hết hoặc ghi bù đăng ký quá hạn.

## Phạm vi trang quản lý

README hiện có phần Git Workflow giao UI quản lý/giám sát cho TV5; Design DOCX mô tả UI07 tổng hợp đăng ký và nhu cầu, không giao rõ trang này cho TV2. Các số TV trong README cũ khác cách phân công hiện tại của người dùng, nên không dùng nó để thay module người khác. Giữ `/manager/registrations` nguyên trạng; không tuyên bố trang placeholder đã hoàn thiện. TV2 bàn giao API đọc thật `GET /api/registration-reports/:periodId` cho QL/GS và contract SQL. Nếu nhóm chuyển quyền sở hữu UI07 cho TV2 thì đó là phần giao diện bổ sung cần xác nhận phân công, không ghi đè hiện tại.

## Kết quả và giới hạn xác minh

Các kết quả cuối và danh sách file nằm trong [RESULTS.md](RESULTS.md). Các test SQL dùng PostgreSQL/PGlite cô lập; test activation dùng catalog/API cron giả lập, **không chạy engine pg_cron thật**. Cloud GET xác nhận dữ liệu/schema hiện tại; chưa có quyền SQL catalog được cung cấp nên không chứng nhận extension/RPC body/ACL cloud trước khi nhóm thực hiện preflight. Không tuyên bố đã lưu dữ liệu người dùng hoặc chạy scheduler cloud thành công.

**Điều kiện PR:** code có thể đưa vào Draft PR sau khi chọn đúng file và loại secrets/artifact test. Ready/merge cần review tích hợp main, phân công UI quản lý và kết quả preflight/rollout theo quy trình nhóm. Toàn bộ thay đổi hiện vẫn trong working tree, chưa commit/push/merge.

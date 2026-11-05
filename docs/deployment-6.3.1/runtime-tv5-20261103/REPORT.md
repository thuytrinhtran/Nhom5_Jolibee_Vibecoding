# TV5 — đã bật cho nghiệm thu website, chưa thực hiện thay ca

Project `wlbpprpiieonjrqglicv`, Lê Duẩn, kỳ 02–08/11/2026. Ngày kiểm tra 03/11/2026. Không migration/import/Auth creation; không tự tạo request/invitation hoặc thay lịch; không commit/push.

## Nguyên nhân và sửa

1. `TV5_PERSISTENCE_ENABLED=false` khiến queue trả enabled=false và frontend khóa mọi thao tác ghi. Đã đổi true trong backend/.env, khởi động lại backend.
2. Kiểm tra API thật phát hiện lỗi SQL `57014`: tìm người thay từ nguồn đầy đủ 656 đăng ký vượt statement timeout, không phải không có ứng viên. Query trực tiếp với jit=off vẫn vượt 8s; cấu hình planner transaction-local `jit=off, enable_nestloop=off, plan_cache_mode=force_custom_plan` cho cùng truy vấn trả đủ ứng viên trong **477ms**, giữ nguyên timeout 8s.
3. Thêm transport **chỉ local development** dùng client/kết nối PostgreSQL riêng đã có để gọi nguyên ba RPC TV5 hiện hành, qua transaction có planner settings trên. Đường gọi backend hoàn chỉnh SELECT thử thực tế mất **2103ms**, 4 ứng viên, không lỗi. Không sửa function, role settings hoặc cấu hình project, không tăng timeout, không bỏ validation. GET dùng BEGIN READ ONLY; write vẫn gọi nguyên tv5_mutate với actor từ token, giữ SQL locks/version/snapshot/idempotency/audit. Không nhận SQL/connection/config từ HTTP.
4. Bổ sung guard xác định schedule từ assignment/source/invitation trong DB cho mọi action. Khi scope đang bật chỉ ghi đúng branch/period đã duyệt. Client không cung cấp scope tin cậy; SQL tiếp tục kiểm tra quyền, chủ ca và người nhận lời mời.

Flags mới trong backend/.env (không có secret trong báo cáo):

```ini
TV5_PERSISTENCE_ENABLED=true
TV5_LOCAL_PG_RPC_ENABLED=true
TV5_PG_CONNECTION_FILE=D:/JolliShift-private/minimal-backup/deployment-connection.json
TV5_PG_CLIENT=D:/JolliShift-private/tv3-postgres-tools/node-client/node_modules/pg
```

Scope TV3_WRITE_SCOPE_ENABLED/project/branch/period tiếp tục bật đúng kỳ. Config PG yêu cầu đúng project/direct hoặc Session pooler, port 5432, database postgres, TLS kiểm chứng; không dùng transaction pooler/API key thay password. Credentials không đưa vào browser/log/repository. Đây là cấu hình phục vụ backend local, không phải giải pháp triển khai production; tắt transport sẽ trở lại Supabase API với hạn chế timeout đã phát hiện.

## Quy tắc thời gian thực tế

- Lịch v1 `969c3446-9357-40ef-a40e-1296cca573b8` PUBLISHED từ **03/11/2026 17:07:31** giờ Việt Nam.
- Feedback deadline **04/11/2026 18:09**, còn mở tại thời điểm kiểm tra. CREATE_REQUEST bị chặn sau deadline bằng FEEDBACK_CLOSED; không tự gia hạn.
- Lời mời phải có hạn tương lai; nhận lời trước expires_at, đúng người, còn đủ điều kiện. Xác nhận đúng hạn được lưu lại; manager vẫn phải kiểm tra và duyệt trước khi phân công thay đổi.
- SQL hiện tại **không có gate riêng theo thời điểm bắt đầu/kết thúc ca**; ca quá khứ còn ACTIVE vẫn có thể qua gate nếu còn trong hạn phản hồi. Không tự thêm quy tắc chặn ca quá khứ trong bước này; cần xác nhận nghiệp vụ nếu muốn áp dụng. Chọn ca tương lai cho demo.
- Báo sự cố REPORT là luồng riêng, không dùng để vượt hạn yêu cầu đổi ca. Không cần ngoại lệ thời gian DEV, không bật ngoại lệ TV5 nào. Ngoại lệ đăng ký TV2 tuần 09–15 không áp dụng TV5.

## Ca kiểm thử phù hợp

**nv_jollibee → nv_jollibee_02, 06/11/2026 Ca chiều 12:00–17:00, bộ phận Bếp.**

Assignment `d00ed6e0-06b2-43e7-9c33-82dce15b3401` ACTIVE trong lịch PUBLISHED; chưa có request/incident đang mở cho ca này. SQL tìm người thay với đúng context batch A trả 4 người: js_ld_006, js_ld_010, js_ld_034 và nv_jollibee_02. Người thay thỏa đăng ký VALID, bộ phận/kỹ năng, không trùng và các giới hạn được cấu hình; backend không tự phân công ngoài đăng ký. Cả hai tài khoản có sẵn, không tạo mới.

Các ca khác: nv_jollibee có ca sáng 04/11, sáng/tối 07/11; nv_jollibee_02 có ca sáng/tối 04/11, chiều 05/11, chiều 08/11. Danh sách ứng viên phải lấy từ API đúng context nguồn; không dùng kết quả mặc định 16 đăng ký thật để kết luận không có người thay. Ca sáng 02/11 và tối 03/11 đã qua/đang diễn ra, không chọn làm ca demo.

## Thao tác web

1. `nv_jollibee`: `http://localhost:5173/employee/shift-requests` → Tải lại → tuần 02–08/11 → chọn **06/11 Ca chiều** → loại **Yêu cầu đổi ca trong hạn phản hồi** → nhập lý do → có thể đề xuất **nv_jollibee_02** → **Gửi thông tin**. Thực hiện trước 04/11 18:09.
2. `ql_jollibee`: `http://localhost:5173/manager/shift-requests` → Tải lại → mở yêu cầu → chọn nv_jollibee_02 → nhập hạn nhận lời mời trong tương lai (ví dụ 04/11 17:00 nếu còn ở tương lai khi thao tác) → **Gửi lời mời nhận ca**.
3. `nv_jollibee_02`: trang employee/shift-requests → Tải lại → **Lời mời nhận ca của tôi** → **Nhận lời mời**. Chưa thay phân công ở bước này.
4. Quản lý: Tải lại → mở yêu cầu → **Phê duyệt người này** → xác nhận. Đây là bước duy nhất thay người sau consent hợp lệ; backend/SQL tái kiểm tra mọi điều kiện. Không phải hoán đổi hai chiều.
5. Hai nhân viên mở `/employee/schedule`, chọn tuần 02–08/11, Tải lại. Nếu chỉ thực hiện case này: nv_jollibee còn **4 ca**, nv_jollibee_02 có **6 ca**, ca 06/11 12–17 chuyển đúng người. Tổng ACTIVE vẫn 308, assignment gốc REPLACED được giữ và có successor ACTIVE; audit không xóa.

File `verify-after-replacement.sql` chỉ SELECT để đối chiếu request/invitation, successor, lịch cá nhân từ RPC và coverage sau khi người dùng thực hiện. Chưa xác nhận kết quả sau đổi ca vì chưa có thao tác ghi của người dùng trong bước kiểm tra này.

## Test và trạng thái

- Backend typecheck/build PASS, regression 5 PASS/1 SKIP (employee PostgreSQL integration không chạy trong lượt thường).
- TV5 lifecycle PostgreSQL cô lập chạy riêng **1 PASS**: role/ownership, consent, hai quản lý duyệt cạnh tranh, rollback, từ chối và lịch nhân viên phản ánh người thay. Không dùng Supabase cho các test ghi này.
- Frontend typecheck/build PASS, regression **9 PASS**: request giữ nội dung/retry UUID, lời mời/nhận lời, xác nhận quản lý, disabled state và lịch cá nhân.
- Backend/DB health 200; hai trang employee/manager shift-requests 200, Supabase thật, không mock. Queue thật xác nhận chưa có yêu cầu đang mở cho assignment demo.
- Lần gọi build đầu ở root thiếu package.json; đã chạy lại đúng backend directory. Typecheck bắt lỗi kiểu dữ liệu query động, đã sửa và PASS. Không có lỗi ghi Supabase vì không gọi mutation RPC.

File thay đổi: backend/.env, `shift-change.routes.ts`, `shift-change-write-scope.ts`, `tv5-local-rpc.ts`, hai regression test mới, tài liệu/readiness local. Không thay đổi frontend hoặc migration trong bước này.

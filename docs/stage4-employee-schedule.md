# Giai đoạn 4 — lịch nhân viên

Auth hiện có xác minh token, đọc public.users, kiểm tra NV/active/đổi mật khẩu và đọc hồ sơ employee. employees.user_id có UNIQUE/FK. RPC đọc lịch kiểm tra lại user → employee đang ACTIVE và cùng chi nhánh ACTIVE; không sử dụng employee_id từ browser. Crew Leader được xem lịch, không kế thừa lệnh cấm đăng ký TV2.

GET `/api/employee-schedule?week_start=2026-11-02`, chỉ NV, tuần bắt đầu thứ Hai. Không chấp nhận tham số employee_id/branch_id. Response no-store, qua shared authorized client có refresh Auth hiện có. Không mở Supabase SDK/RLS cho browser.

RPC `employee_schedule_week(uuid,date)` là STABLE, SECURITY DEFINER, chỉ cấp EXECUTE cho service_role. Một snapshot SQL chọn phiên bản PUBLISHED cao nhất trong từng kỳ của chi nhánh, rồi lấy riêng ACTIVE assignments của người gọi. DRAFT/PENDING_APPROVAL/NEEDS_REVISION/APPROVED không xuất hiện và không che phiên bản đã công bố trước đó. Bản công bố mới không có phân công không làm sống lại ca cũ. Nhiều nhóm công bố mâu thuẫn, phân công trùng hoặc chồng giờ báo 409 để quản lý xử lý, không tùy ý chọn/ghép.

Payload giữ assignment_id, schedule_id/group/period/version, employee_id đã được xác minh, ngày/ca/giờ/bộ phận/chi nhánh, nguồn và deadline phản hồi để giai đoạn 5 tham chiếu. Đây chỉ là dữ liệu đọc; API đổi ca tương lai vẫn phải kiểm tra lại chủ sở hữu, ACTIVE và phiên bản hiện hành trong transaction.

Trang `/employee/schedule` thay placeholder, tái sử dụng Auth, menu và CSS lịch. Có chuyển tuần, ngày không có lịch, chi tiết ca qua details, ghi rõ ca qua đêm, loading, retry và đăng nhập lại khi refresh vẫn 401. Bỏ phản hồi cũ khi chuyển tuần/tài khoản.

Migration local `20261103_employee_schedule_read.sql` chưa áp dụng lên Supabase. Không thay đổi workflow/cách công bố hay bật persistence. Sau khi được phép triển khai, cần kiểm tra FK/ACL/function body và PostgREST schema reload, rồi dùng NV thật kiểm tra đăng nhập, tuần 02–08/11/2026, ca qua đêm, phiên hết hạn, chuyển tuần nhanh và công bố giữa lúc nhân viên tải lịch. Chưa kiểm thử trình duyệt hoặc Auth/Supabase thật trong giai đoạn này.

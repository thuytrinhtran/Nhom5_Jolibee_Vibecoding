# Báo cáo kiểm thử tự động TV4

Ngày chạy: 2026-10-29.

## Phạm vi và giới hạn xác minh

TV4 chạy bằng mock store trong bộ nhớ phiên trình duyệt. Lượt này không gọi API nghiệp vụ, không kết nối hoặc ghi PostgreSQL/Supabase, không chạy migration và không deploy. Không có phiên đăng nhập QL hoặc trình duyệt ứng dụng khả dụng trong môi trường kiểm tra, nên chưa thể đọc các giá trị `branch_name`, `branch_id` và role từ tài khoản thật.

Mã backend được kiểm tra có đưa `branch_id` và `branch_name` vào profile khi xác thực. Tuy nhiên, điều đó không xác minh được giá trị của tài khoản QL đang gặp lỗi. `AuthContext` nhận profile từ phiên đăng nhập và TV4 dựng actor từ profile đó.

## Kết quả điều tra và thay đổi

- Mapping trước đây dựa trên khớp chuỗi một phần, có thể ánh xạ nhập nhằng; profile không khớp dẫn đến scope `null` và trang chỉ có thể trông như danh sách trống.
- Mapping hiện khớp chính xác ID fixture hoặc tên chi nhánh đã chuẩn hóa, gồm tiền tố `JolliShift Demo` nếu có. Profile không khớp không được gán sang chi nhánh khác; trang QL hiển thị chẩn đoán có `branch_name`, `branch_id` và kết quả mapping.
- Seed demo có lịch `DRAFT` hiển thị cho QL ở mỗi fixture branch; `PENDING_APPROVAL` vẫn thuộc hàng chờ GS theo bộ lọc hiện có. Do đó, QL có thể thấy lịch mẫu trong scope ngay khi mở trang, còn lịch Thanh Khê sau khi GS từ chối được tìm theo đúng fixture Thanh Khê.
- Service là singleton trong tab nên các actor GS/QL dùng cùng mock store. Test nghiệp vụ xác nhận GS từ chối lịch Thanh Khê 1, rồi actor QL cùng branch thấy đúng phiên bản và lý do. Các test này không mô phỏng đăng nhập/AuthContext thật.

## Kết quả kiểm tra

Chạy từ thư mục `frontend`:

| Lệnh | Kết quả |
|---|---|
| `npm test` | 36 passed, 0 failed, 0 skipped |
| `npm run typecheck` | Thành công |
| `npm run build` | Thành công (Vite 6.4.5) |

Test có service mock kiểm tra đúng branch mapping, lịch QL ban đầu, GS từ chối và QL thấy lý do trên cùng store, cùng trường hợp profile thiếu/không khớp branch. Có thêm kiểm tra server-render cho banner chẩn đoán. Đây không phải kiểm thử trình duyệt tương tác.

Không có test nào chạy trên PostgreSQL/Supabase. Không thể xác nhận giao diện sau đăng nhập bằng trình duyệt trong lượt này: frontend không chạy ở cổng 5173, backend tại cổng 5000, cổng browser automation 9222 không hoạt động và không có runner trình duyệt cài sẵn.

## Cách xác nhận bằng tài khoản QL hiện có

1. Đăng nhập bằng QL và mở `/manager/publish`.
2. Đọc banner **Chẩn đoán phạm vi QL**. Banner cho biết branch name/ID nhận từ profile và fixture được chọn. Với profile Thanh Khê, cần thấy fixture `Thanh Khê 1` (fixture ID `tv4-branch-north`).
3. Danh sách ban đầu có lịch demo thuộc fixture đã ánh xạ. Sau khi GS từ chối lịch Thanh Khê trong cùng tab/store demo, tải lại danh sách QL; lịch phải có `NEEDS_REVISION` và lý do từ chối.
4. Nếu banner báo không ánh xạ, không có chi nhánh hoặc hiển thị chi nhánh khác, ghi lại riêng `branch_name`, `branch_id` và dòng chẩn đoán để đối chiếu với danh mục fixture. Không gửi mật khẩu, token hoặc nội dung `.env`.

Việc mở lại trang hoặc khởi động lại frontend khôi phục seed mock; các thao tác demo không được lưu bền vững.

## Tệp TV4 được cập nhật trong lượt này

- `frontend/src/pages/schedules/scheduleWorkflow.types.ts` — mapping chính xác profile sang fixture và chẩn đoán khi không khớp.
- `frontend/src/pages/schedules/ScheduleWorkflow.tsx` — hiển thị scope profile, lỗi mapping rõ ràng và trạng thái rỗng theo branch.
- `frontend/src/pages/schedules/tv4MockWorkflow.service.ts` — thêm fixture `DRAFT` cho QL ở các branch demo.
- `frontend/tests/schedule-workflow-mock.test.cjs` — hồi quy mapping, lịch QL ban đầu, chẩn đoán và dùng chung store giữa GS/QL.

Các thay đổi Git có sẵn bên ngoài TV4 được giữ nguyên. Không sửa xác thực dùng chung, không commit.

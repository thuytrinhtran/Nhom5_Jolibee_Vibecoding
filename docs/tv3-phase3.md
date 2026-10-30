# TV3 — Giai đoạn 3: Nhu cầu nhân sự và Sales Forecast

Đã triển khai đúng trang **`/manager/demand`**, có route riêng dùng `ProtectedRoute(['QL'])` và `AppLayout`. Trang không còn rơi vào placeholder `/manager/*`. Giữ nhánh `feature/tri-auto-scheduling`, các thay đổi chưa commit và chức năng của TV1/TV2/TV4/TV5.

## Căn cứ đã đọc và thiết kế áp dụng

- `docs/Nhom5_INTENT_HoanChinh_Vibecode.docx`: BR06, BR07, AC07; quản lý xác định nhu cầu dựa trên forecast và tình hình thực tế; không xây mô hình forecast.
- `docs/Nhom5_DESIGN_HoanChinh_Vibecode.docx`: FR07/FR08, UI07, US07, Bảng 09 và các phụ lục; nhập số người cần >=0, nguồn forecast; nhu cầu không gồm Crew Leader.
- `docs/Nhom5_BPMN_Jolibee_Tobe.drawio`: xác định nhu cầu từ Sale Forecast, tổng hợp đăng ký/nhu cầu, kiểm tra cơ cấu và xử lý thiếu người.
- `docs/Nhom5_PhanTichTuDongHoa.docx`: nhu cầu do con người nhập, đối chiếu cung–cầu bằng luật.
- Schema hiện tại `docs/Jollishift.sql`: đã có đủ cột để lưu nhu cầu thủ công và tham chiếu forecast, cùng unique `(branch_id, department_id, shift_id, work_date)`; quyền ghi được thiết kế cho backend service_role.

Không bổ sung công thức, định mức hay tỷ lệ chưa được nhóm xác nhận. Không chạy migration hoặc thay đổi quyền/schema.

## Giao diện

Tại `http://localhost:5173/manager/demand`:

1. Chọn tuần đã có trong `registration_periods` của chi nhánh QL.
2. Chọn ngày, ca và bộ phận (từ dữ liệu hiện có, bao gồm Bếp/Thu ngân/Phục vụ nếu đã được nhóm cấu hình).
3. Nhập số nhân viên cần, kỹ năng bắt buộc nếu có, nguồn/ghi chú Sales Forecast.
4. Bấm **Lưu nhu cầu**. Trang đọc lại nhu cầu và tính lại cung–cầu đã lưu.
5. Bảng có cả bảy ngày và các ca/bộ phận hiện có; có lọc ngày/ca/bộ phận và nút Nhập/Sửa để chọn nhanh một dòng.

Bảng tái sử dụng `RegistrationSummaryTable` và bộ tổng hợp Giai đoạn 2: đăng ký VALID đã khử trùng, người đủ điều kiện, nhu cầu, thiếu/thừa, cảnh báo thiếu kỹ năng/dữ liệu, nguồn forecast. Dòng chưa khai báo nhu cầu là **Chưa đủ dữ liệu đánh giá**, không phải 0. Nhập 0 và lưu mới là nhu cầu 0 rõ ràng.

Bảng thể hiện giá trị **đã lưu**, không tính các giá trị đang nhập chưa lưu. Trường hợp đã lưu nhưng GET đọc lại thất bại có thông báo riêng, không báo thành công đầy đủ. Khi dữ liệu bị người khác thay đổi, trả 409 và hướng dẫn tải lại tuần.

## Sales Forecast và cấu hình

Schema hỗ trợ **`sales_forecast_ref TEXT`**: lưu ghi chú, tên/nguồn dự báo, kỳ dự báo hoặc URL tham chiếu dưới dạng văn bản. UI hiển thị nguồn này trong form và từng dòng bảng. Không tự truy cập URL hoặc gửi thông tin forecast/nhân viên ra dịch vụ ngoài.

Chưa có các trường định lượng doanh số, đơn vị tiền, giá trị forecast theo giờ hoặc bảng định mức chuyển đổi. Không giả lập những trường đó trong database. Chưa có công thức/định mức được cấu hình nên API trả `forecast_mode='REFERENCE_ONLY'`, `staffing_formula_status='NOT_CONFIGURED'`, UI giải thích QL nhập nhu cầu thủ công.

Thiếu forecast không chặn nhu cầu thủ công hợp lệ. Kỹ năng hiện so tên kỹ năng theo dữ liệu hệ thống; chưa có chính sách mức proficiency tối thiểu để tự đánh giá thêm. Nếu nhóm cần forecast định lượng/định mức/audit chỉnh nhu cầu chi tiết, cần thống nhất hợp đồng và phương án lưu trước; không tự sửa schema chung.

## API

Tất cả API nằm trong router `/api/schedules` hiện đã đăng ký, dùng middleware auth và QL hiện có. Chi nhánh và người tạo lấy từ tài khoản xác thực, không nhận từ body.

- `GET /api/schedules/periods`: bộ chọn tuần, tái sử dụng.
- **`GET /api/schedules/periods/:id/requirements`**: trả `{status:'ok', result:{source,is_mock,branch,period,shifts,departments,requirements,skill_names,forecast_mode,staffing_formula_status,summary}}`.
- **`PUT /api/schedules/periods/:id/requirements`**: tạo/cập nhật **một dòng nhu cầu theo khóa ngày/ca/bộ phận**, trả `{status:'ok',result:{source,is_mock,requirement}}`.

Body PUT:

```json
{
  "work_date": "2026-11-02",
  "shift_id": "<UUID ca>",
  "department_id": "<UUID bộ phận>",
  "required_count": 3,
  "required_skill_name": "Bếp nóng",
  "sales_forecast_ref": "Nguồn forecast hoặc ghi chú do QL nhập",
  "expected_updated_at": null
}
```

Dòng mới gửi `expected_updated_at=null`. Khi sửa, gửi nguyên chuỗi `updated_at` nhận từ GET. Hai trường text dùng chuỗi hoặc null; chuỗi trắng được chuẩn hóa thành null. Body không được truyền `branch_id`, `created_by` hoặc trường chưa hỗ trợ. Đổi khóa ngày/ca/bộ phận nghĩa là chọn dòng khác; API không xóa hoặc di chuyển dòng cũ.

Backend kiểm tra:

- Ngày hợp lệ trong tuần QL chọn; đợt phải thuộc chi nhánh QL.
- Ca hoạt động, là ca chi nhánh hoặc mẫu chung; giờ ca hợp lệ.
- Bộ phận tồn tại trong cấu hình.
- Số người là integer >=0; trần 2147483647 là giới hạn kiểu integer PostgreSQL, không phải định mức nhân sự.
- Tên kỹ năng tối đa 100 ký tự theo schema.
- Chuỗi phiên bản cập nhật hợp lệ, không ghi đè nếu đã đổi.

Mã lỗi: 400 dữ liệu/UUID không hợp lệ, 401 chưa đăng nhập, 403 sai role/thiếu chi nhánh, 404 đợt ngoài phạm vi, 409 trùng/đổi phiên bản nhu cầu, 422 ngày/ca/bộ phận không phù hợp, 503 schema/quyền/dịch vụ database chưa đáp ứng.

## Lưu dữ liệu thật và mock

Đã mở rộng `RegistrationSummaryRepository` hiện có bằng `saveRequirement`, không tạo hệ thống repository trùng lặp.

**Supabase:** một `INSERT` hoặc `UPDATE` có điều kiện cho một dòng `staffing_requirements`. INSERT đặt `branch_id`, `created_by`, `excludes_crew_leader=true` phía server. UPDATE chỉ sửa số lượng, kỹ năng, forecast và `updated_at`; giữ người tạo ban đầu. UPDATE lọc theo ID + chi nhánh + `updated_at` cũ; unique constraint xử lý tạo trùng đồng thời. Không cập nhật lịch, đăng ký hoặc bảng phê duyệt. Không ghi thêm bảng audit bằng một thao tác rời có thể thất bại nửa chừng; tracking hiện dùng `created_by`/`updated_at` có sẵn.

Nếu thiếu bảng/cột: 503 `DEMAND_SCHEMA_NOT_READY`; nếu backend chưa có quyền ghi: 503 `DEMAND_WRITE_NOT_ALLOWED`. UI hiển thị lỗi; không tự thêm cột, cấp quyền, chạy migration hay fallback sang mock. Nhóm cần đối chiếu schema hiện hữu và cấu hình quyền backend; thay đổi database chỉ do người có quyền thực hiện sau khi thống nhất.

**Mock development:** cùng API/interface; nhu cầu được lưu trong Map bộ nhớ, phân tách theo chi nhánh/đợt. Các adapter được tạo lại vẫn đọc được thay đổi trong cùng tiến trình. Mất thay đổi khi restart backend. Không ghi vào Supabase và vẫn cần đăng nhập QL thật. Khóa ghi lịch thật trong mock của Giai đoạn 2 vẫn giữ nguyên; chỉ thao tác nhu cầu mô phỏng mới được lưu trong bộ nhớ.

## Chạy

Không sửa `.env`. Trong terminal backend:

```powershell
cd backend
$env:NODE_ENV = 'development'
$env:SCHEDULING_DATA_SOURCE = 'mock'
npm.cmd run dev
```

Dùng dữ liệu thật: đổi `SCHEDULING_DATA_SOURCE` thành `supabase` rồi chạy lại backend. Mock chỉ được phép khi development được bật rõ ràng; không fallback.

Trong terminal khác:

```powershell
cd frontend
npm.cmd run dev
```

Đăng nhập QL, mở `/manager/demand`. Mock dùng tuần 02–08/11/2026 và có nhãn **Dữ liệu mô phỏng (MOCK)**, thông báo chỉ lưu bộ nhớ. Với dữ liệu thật, cần đợt của TV2 và dữ liệu nền ca/bộ phận; không tự tạo hàng loạt trên database chung.

## Kiểm thử thực tế

- Backend `npm.cmd run typecheck`: đạt.
- Backend `npm.cmd test`: **65 pass, 0 fail, 1 skip**; lệnh test bao gồm build TypeScript.
- Frontend `npm.cmd run typecheck`, `npm.cmd run build`: đạt.
- Frontend `npm.cmd test`: **34 pass, 0 fail**.
- Test mới bao gồm validation, ngày/ca/bộ phận, quyền QL/phạm vi, mock tạo/sửa/đọc lại, nguồn forecast, giữ creator, stale revision, hai cập nhật đồng thời, điều kiện UPDATE Supabase, lỗi quyền/schema, route demand, bảy ngày/ba bộ phận, trống khác 0, GET sau PUT và lỗi đọc sau lưu.
- Supabase HEAD chỉ đọc xác nhận đủ cột `staffing_requirements`, gồm forecast/creator/updated_at. Không lấy hoặc in dữ liệu cá nhân.
- HTTP localhost: `/manager/demand` trả 200; PUT API qua Vite proxy không có token trả 401.
- Chưa thực hiện ghi thử trên Supabase chung hoặc end-to-end bằng tài khoản QL thật; test mutation Supabase dùng stub và test mock dùng bộ nhớ. HEAD xác minh schema đọc được, không chứng minh quyền ghi thực tế của credential.
- Test PostgreSQL của RPC tạo lịch cũ vẫn skip khi chưa cấu hình database thử nghiệm. Trang nhu cầu không phụ thuộc RPC tạo lịch này.

## File tạo/sửa

Tạo:

- `backend/src/services/staffing-demand.service.ts`
- `backend/tests/staffing-demand.test.cjs`
- `backend/tests/staffing-demand-api.test.cjs`
- `frontend/src/pages/manager/ManagerDemand.tsx`
- `frontend/src/pages/manager/ManagerDemand.css`
- `frontend/src/services/staffing-demand.view.ts`
- `frontend/tests/staffing-demand.test.cjs`
- `docs/tv3-phase3.md`

Mở rộng file hiện có:

- `backend/src/repositories/registration-summary.types.ts`
- `backend/src/repositories/registration-summary.mock.ts`
- `backend/src/repositories/registration-summary.supabase.ts`
- `backend/src/routes/scheduling.routes.ts`
- `frontend/src/App.tsx`
- `frontend/src/types/scheduling.ts`
- `frontend/src/services/scheduling.service.ts`
- `frontend/src/pages/manager/RegistrationSummaryPanel.tsx` — bảng dùng chung thêm cột forecast và nút Nhập/Sửa tùy chọn; trang schedule giữ cách dùng cũ.

Không thay đổi auth, đăng ký TV2, phê duyệt TV4, đổi ca TV5 hoặc các migration. Không commit/push/merge.

## Phụ thuộc nhóm

- TV2: các đợt và đăng ký VALID thật.
- Dữ liệu nền: chi nhánh, ca hoạt động, bộ phận, hồ sơ/kỹ năng và giới hạn giờ.
- Nhóm nghiệp vụ: cấu trúc forecast định lượng, công thức định mức và mức thành thạo tối thiểu nếu cần mở rộng.
- Nhóm vận hành: xác nhận quyền ghi nhu cầu backend trên môi trường thật; xử lý nếu schema thực tế khác repository.
- Cách tính lịch bận giữa nhiều phiên bản vẫn kế thừa lựa chọn bảo thủ Giai đoạn 2; không sửa quy trình TV4 trong giai đoạn này.

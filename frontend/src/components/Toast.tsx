/** Stateless feedback view: no timer, focus capture or automatic dismissal. */
export function Toast({message,onDismiss,id='action-feedback'}:{message:string;onDismiss:()=>void;id?:string}) {
  return <section className="action-toast" role="status" aria-live="polite" aria-atomic="true" aria-labelledby={`${id}-title`}>
    <span className="action-toast-icon" aria-hidden="true">✓</span>
    <div><strong id={`${id}-title`}>Thao tác thành công</strong><p>{message}</p></div>
    <button type="button" className="action-toast-dismiss" aria-label="Đóng thông báo" onClick={onDismiss}>Đóng</button>
  </section>;
}

export function errorGuidance(message:string):string {
  const explanations:Record<string,string>={
    REPLACEMENT_ALREADY_ACCEPTED:'Đã có nhân viên nhận lời thay ca. Kiểm tra người đã nhận và phê duyệt hoặc từ chối; không kết thúc với lý do không tìm được người.',
    NO_EXPIRED_INVITATIONS:'Chưa có lời mời hết hạn. Chờ người nhận phản hồi hoặc dùng thao tác từ chối với lý do phù hợp.',
    STALE_SCHEDULE_VERSION:'Lịch đã được cập nhật ở nơi khác. Tải lại lịch và kiểm tra phiên bản mới trước khi thao tác.',
    DEMAND_CHANGED:'Nhu cầu đã được người khác thay đổi. Giữ lại nội dung đang nhập, tải lại tuần để đối chiếu trước khi lưu.',
    PERIOD_NOT_CLOSED:'Đăng ký ca vẫn còn mở. Chỉ lưu lịch sau khi đợt đăng ký đã đóng.',
    FEEDBACK_CLOSED:'Đã hết hạn phản hồi lịch. Liên hệ quản lý nếu cần hỗ trợ ca làm.',
    INELIGIBLE_REPLACEMENT:'Nhân viên không còn đáp ứng điều kiện nhận ca. Tải lại danh sách người thay và chọn người đủ điều kiện.',
    INVITATION_CLOSED:'Lời mời đã hết hạn hoặc đã được xử lý. Tải lại danh sách để xem kết quả mới nhất.',
    REQUEST_CONFLICT:'Yêu cầu này đã được xử lý với nội dung khác. Tải lại và kiểm tra kết quả trước khi gửi tiếp.',
    COVERAGE_INCOMPLETE:'Lịch còn thiếu người. Bổ sung các vị trí thiếu rồi kiểm tra lại trước khi gửi duyệt.',
    HARD_CONSTRAINT_FAILED:'Phân công chưa đáp ứng điều kiện xếp lịch. Kiểm tra cảnh báo theo ca và điều chỉnh trước khi tiếp tục.',
  };
  return Object.entries(explanations).find(([code])=>new RegExp(`\\b${code}\\b`).test(message))?.[1]??message;
}

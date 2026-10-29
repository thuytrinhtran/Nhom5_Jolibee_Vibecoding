// Supabase uses status 0/undefined for transport failures. Never invalidate a session for these.
export function authFailure(error?: { status?: number } | null) {
  const status = error?.status === 429 ? 429 : error && (!error.status || error.status >= 500) ? 503 : 401;
  const message = status === 429 ? 'Bạn thao tác quá nhanh. Vui lòng chờ một lúc rồi thử lại.'
    : status === 503 ? 'Dịch vụ xác thực tạm thời không khả dụng. Vui lòng thử lại.'
    : 'Thông tin đăng nhập hoặc phiên không hợp lệ. Vui lòng đăng nhập lại.';
  return { status, message };
}

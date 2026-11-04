import {
  LayoutDashboard, Calendar, Clock, ArrowLeftRight,
  Users, CalendarDays, CheckSquare, Building2, Handshake, History, ClipboardList,
  type LucideIcon,
} from 'lucide-react';
import type { UserRole } from './types/auth';

export interface DashboardLink { label: string; path: string; icon: LucideIcon; group?:string; }
interface DashboardConfig {
  roleLabel: string;
  navigation: DashboardLink[];
  metrics: { label: string; icon: LucideIcon }[];
  actions: (DashboardLink & { description: string })[];
  emptyTitle: string;
  emptyDescription: string;
}

export const dashboardConfig: Record<UserRole, DashboardConfig> = {
  NV: {
    roleLabel: 'Nhân viên',
    navigation: [
      { label: 'Tổng quan', path: '/employee', icon: LayoutDashboard },
      { label: 'Đăng ký ca làm', path: '/employee/register', icon: Calendar },
      { label: 'Yêu cầu & hỗ trợ', path: '/employee/support', icon: ArrowLeftRight },
    ],
    metrics: [
      { label: 'Ca làm sắp tới', icon: CalendarDays },
      { label: 'Đăng ký ca của tôi', icon: ClipboardList },
      { label: 'Yêu cầu đổi ca', icon: ArrowLeftRight },
    ],
    actions: [
      { label: 'Đăng ký ca làm', description: 'Chọn thời gian bạn có thể làm.', path: '/employee/register', icon: Calendar },
      { label: 'Lịch làm của tôi', description: 'Xem lịch chính thức trong Tổng quan.', path: '/employee', icon: Clock },
      { label: 'Yêu cầu & hỗ trợ', description: 'Đổi ca, báo sự cố và theo dõi yêu cầu.', path: '/employee/support', icon: ArrowLeftRight },
    ],
    emptyTitle: 'Lịch làm của bạn',
    emptyDescription: 'Chưa có dữ liệu lịch làm để hiển thị.',
  },
  QL: {
    roleLabel: 'Quản lý cửa hàng',
    navigation: [
      { label: 'Tổng quan', path: '/manager', icon: LayoutDashboard,group:'Tổng quan' },
      { label: 'Đăng ký ca', path: '/manager/registrations', icon: ClipboardList,group:'Lập lịch làm việc' },
      { label: 'Nhu cầu nhân sự', path: '/manager/demand', icon: Users,group:'Lập lịch làm việc' },
      { label: 'Xếp lịch & AI', path: '/manager/schedule', icon: CalendarDays,group:'Lập lịch làm việc' },
      { label: 'Phê duyệt & công bố', path: '/manager/publish', icon: CheckSquare,group:'Lập lịch làm việc' },
      { label: 'Lịch làm việc chính thức', path: '/manager/official-schedule', icon: Calendar,group:'Vận hành' },
      { label: 'Xử lý đổi ca', path: '/manager/shift-requests', icon: ArrowLeftRight,group:'Vận hành' },
      { label: 'Nhân viên', path: '/manager/staff/competency', icon: Users,group:'Quản trị' },
      { label: 'Lịch sử', path: '/manager/publish-history', icon: History,group:'Quản trị' },
    ],
    metrics: [
      { label: 'Đăng ký ca cần xem', icon: ClipboardList },
      { label: 'Nhu cầu nhân sự', icon: Users },
      { label: 'Lịch đang lập', icon: CalendarDays },
      { label: 'Yêu cầu đổi ca', icon: ArrowLeftRight },
    ],
    actions: [
      { label: 'Quản lý lịch', description: 'Xem lịch đăng ký và phân công theo tuần.', path: '/manager/registrations', icon: ClipboardList },
      { label: 'Lập lịch làm', description: 'Mở lịch làm của chi nhánh.', path: '/manager/schedule', icon: CalendarDays },
      { label: 'Công bố lịch', description: 'Xem lịch đã duyệt và công bố cho nhân viên.', path: '/manager/publish', icon: CheckSquare },
      { label: 'Lịch sử công bố', description: 'Tra cứu người công bố, thời điểm và thời hạn phản hồi.', path: '/manager/publish-history', icon: History },
      { label: 'Quản lý nhân viên', description: 'Xem và cập nhật năng lực nhân viên.', path: '/manager/staff/competency', icon: Users },
      { label: 'Xử lý đổi ca', description: 'Xem các yêu cầu đổi ca.', path: '/manager/shift-requests', icon: ArrowLeftRight },
    ],
    emptyTitle: 'Lịch làm của chi nhánh',
    emptyDescription: 'Chưa có dữ liệu lịch làm để hiển thị.',
  },
  GS: {
    roleLabel: 'Giám sát khu vực',
    navigation: [
      { label: 'Tổng quan', path: '/supervisor', icon: LayoutDashboard },
      { label: 'Phê duyệt lịch', path: '/supervisor/approvals', icon: CheckSquare },
      { label: 'Tình hình chi nhánh', path: '/supervisor/branches', icon: Building2 },
      { label: 'Hỗ trợ nhân sự', path: '/supervisor/support', icon: Handshake },
      { label: 'Lịch sử phê duyệt', path: '/supervisor/reports', icon: History },
    ],
    metrics: [
      { label: 'Lịch chờ duyệt', icon: CheckSquare },
      { label: 'Chi nhánh phụ trách', icon: Building2 },
      { label: 'Yêu cầu hỗ trợ nhân sự', icon: Handshake },
    ],
    actions: [
      { label: 'Phê duyệt lịch', description: 'Xem lịch được gửi lên.', path: '/supervisor/approvals', icon: CheckSquare },
      { label: 'Xem tình hình chi nhánh', description: 'Theo dõi các chi nhánh phụ trách.', path: '/supervisor/branches', icon: Building2 },
      { label: 'Hỗ trợ nhân sự', description: 'Xem nhu cầu hỗ trợ giữa chi nhánh.', path: '/supervisor/support', icon: Handshake },
      { label: 'Lịch sử phê duyệt', description: 'Tra cứu các lần phê duyệt.', path: '/supervisor/reports', icon: History },
    ],
    emptyTitle: 'Lịch chờ phê duyệt',
    emptyDescription: 'Chưa có dữ liệu lịch chờ duyệt để hiển thị.',
  },
};

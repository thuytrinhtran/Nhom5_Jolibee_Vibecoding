import {
  LayoutDashboard, Calendar, Clock, ArrowLeftRight, AlertTriangle,
  Users, CalendarDays, CheckSquare, Building2, Handshake, History, ClipboardList,
  type LucideIcon,
} from 'lucide-react';
import type { UserRole } from './types/auth';

export interface DashboardLink { label: string; path: string; icon: LucideIcon; }
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
      { label: 'Lịch làm của tôi', path: '/employee/schedule', icon: Clock },
      { label: 'Đổi ca và lời mời', path: '/employee/shift-requests', icon: ArrowLeftRight },
      { label: 'Báo sự cố', path: '/employee/incidents', icon: AlertTriangle },
    ],
    metrics: [
      { label: 'Ca làm sắp tới', icon: CalendarDays },
      { label: 'Đăng ký ca của tôi', icon: ClipboardList },
      { label: 'Yêu cầu đổi ca', icon: ArrowLeftRight },
    ],
    actions: [
      { label: 'Đăng ký ca tuần tới', description: 'Chọn thời gian bạn có thể làm.', path: '/employee/register', icon: Calendar },
      { label: 'Lịch làm của tôi', description: 'Xem các ca làm của bạn.', path: '/employee/schedule', icon: Clock },
      { label: 'Đổi ca và lời mời', description: 'Xem yêu cầu và lời mời nhận ca.', path: '/employee/shift-requests', icon: ArrowLeftRight },
      { label: 'Báo sự cố', description: 'Gửi thông tin cần hỗ trợ.', path: '/employee/incidents', icon: AlertTriangle },
    ],
    emptyTitle: 'Lịch làm của bạn',
    emptyDescription: 'Chưa có dữ liệu lịch làm để hiển thị.',
  },
  QL: {
    roleLabel: 'Quản lý ca',
    navigation: [
      { label: 'Tổng quan', path: '/manager', icon: LayoutDashboard },
      { label: 'Xem đăng ký', path: '/manager/registrations', icon: ClipboardList },
      { label: 'Nhu cầu nhân sự', path: '/manager/demand', icon: Users },
      { label: 'Lập lịch làm', path: '/manager/schedule', icon: CalendarDays },
      { label: 'Yêu cầu đổi ca', path: '/manager/shift-requests', icon: ArrowLeftRight },
      { label: 'Quản lý nhân viên', path: '/manager/staff', icon: Users },
    ],
    metrics: [
      { label: 'Đăng ký ca cần xem', icon: ClipboardList },
      { label: 'Nhu cầu nhân sự', icon: Users },
      { label: 'Lịch đang lập', icon: CalendarDays },
      { label: 'Yêu cầu đổi ca', icon: ArrowLeftRight },
    ],
    actions: [
      { label: 'Xem đăng ký', description: 'Xem nguyện vọng ca làm.', path: '/manager/registrations', icon: ClipboardList },
      { label: 'Lập lịch làm', description: 'Mở lịch làm của chi nhánh.', path: '/manager/schedule', icon: CalendarDays },
      { label: 'Quản lý nhân viên', description: 'Xem danh sách nhân viên.', path: '/manager/staff', icon: Users },
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

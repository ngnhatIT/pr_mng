/**
 * Danh mục quyền hạn (permission catalog) của hệ thống.
 *
 * Mỗi permission: { code, name, description, module }
 * - code: định danh duy nhất, dạng 'resource.action'
 * - module: nhóm để hiển thị trong UI quản trị
 *
 * Thêm permission mới: thêm vào đây + seed sẽ tự đồng bộ (INSERT ON CONFLICT DO NOTHING).
 * Xóa permission: không xóa cứng — đánh dấu deprecated trong mô tả.
 */

export interface PermissionDef {
  code: string;
  name: string;
  description: string;
  module: string;
}

export const PERMISSIONS: PermissionDef[] = [
  // ---- Học viên ----
  { code: 'students.view', name: 'Xem học viên', description: 'Xem danh sách và hồ sơ học viên', module: 'students' },
  { code: 'students.create', name: 'Thêm học viên', description: 'Tạo hồ sơ học viên mới', module: 'students' },
  { code: 'students.update', name: 'Sửa học viên', description: 'Cập nhật thông tin học viên', module: 'students' },
  { code: 'students.delete', name: 'Xóa học viên', description: 'Xóa hồ sơ học viên (nguy hiểm)', module: 'students' },
  // ---- Lớp học ----
  { code: 'classes.view', name: 'Xem lớp học', description: 'Xem danh sách và chi tiết lớp', module: 'classes' },
  { code: 'classes.create', name: 'Tạo lớp', description: 'Mở lớp học mới', module: 'classes' },
  { code: 'classes.update', name: 'Sửa lớp', description: 'Sửa thông tin, lịch học, giáo viên', module: 'classes' },
  { code: 'classes.delete', name: 'Xóa lớp', description: 'Xóa lớp học (chặn nếu còn bài tập)', module: 'classes' },
  { code: 'classes.enroll', name: 'Xếp lớp', description: 'Thêm/bớt học viên khỏi lớp', module: 'classes' },
  // ---- Điểm danh ----
  { code: 'attendance.view', name: 'Xem điểm danh', description: 'Xem lịch sử điểm danh', module: 'attendance' },
  { code: 'attendance.take', name: 'Điểm danh', description: 'Thực hiện điểm danh buổi học', module: 'attendance' },
  // ---- Học phí ----
  { code: 'invoices.view', name: 'Xem hóa đơn', description: 'Xem hóa đơn và công nợ', module: 'invoices' },
  { code: 'invoices.create', name: 'Tạo hóa đơn', description: 'Lập hóa đơn học phí', module: 'invoices' },
  { code: 'invoices.update', name: 'Sửa hóa đơn', description: 'Sửa hóa đơn chưa thanh toán', module: 'invoices' },
  { code: 'invoices.delete', name: 'Xóa hóa đơn', description: 'Xóa hóa đơn (nguy hiểm)', module: 'invoices' },
  { code: 'payments.collect', name: 'Thu tiền', description: 'Ghi nhận thu tiền mặt/chuyển khoản', module: 'invoices' },
  { code: 'payments.approve', name: 'Duyệt thanh toán', description: 'Duyệt/từ chối payment pending', module: 'invoices' },
  { code: 'payments.refund', name: 'Hoàn tiền', description: 'Thực hiện hoàn tiền', module: 'invoices' },
  // ---- Giáo viên ----
  { code: 'teachers.view', name: 'Xem giáo viên', description: 'Xem danh sách giáo viên', module: 'teachers' },
  { code: 'teachers.create', name: 'Thêm giáo viên', description: 'Tạo hồ sơ giáo viên', module: 'teachers' },
  { code: 'teachers.update', name: 'Sửa giáo viên', description: 'Cập nhật thông tin giáo viên', module: 'teachers' },
  { code: 'teachers.delete', name: 'Xóa giáo viên', description: 'Xóa hồ sơ giáo viên', module: 'teachers' },
  // ---- Lương ----
  { code: 'payroll.view', name: 'Xem lương', description: 'Xem bảng lương giáo viên', module: 'payroll' },
  { code: 'payroll.view_self', name: 'Xem lương của mình', description: 'Giáo viên xem bảng lương cá nhân', module: 'payroll' },
  { code: 'payroll.manage', name: 'Quản lý lương', description: 'Sửa định mức, chốt lương', module: 'payroll' },
  // ---- Bài tập ----
  { code: 'homework.view', name: 'Xem bài tập', description: 'Xem bài tập được giao', module: 'homework' },
  { code: 'homework.create', name: 'Giao bài', description: 'Tạo và giao bài tập', module: 'homework' },
  { code: 'homework.grade', name: 'Chấm bài', description: 'Chấm điểm và nhận xét', module: 'homework' },
  { code: 'homework.delete', name: 'Xóa bài tập', description: 'Xóa bài tập', module: 'homework' },
  // ---- Điểm số ----
  { code: 'grades.view', name: 'Xem điểm', description: 'Xem bảng điểm', module: 'grades' },
  { code: 'grades.manage', name: 'Quản lý điểm', description: 'Nhập/sửa/xóa điểm', module: 'grades' },
  // ---- Buổi học ----
  { code: 'sessions.view', name: 'Xem buổi học', description: 'Xem danh sách buổi học', module: 'sessions' },
  { code: 'sessions.manage', name: 'Quản lý buổi học', description: 'Tạo/sửa/xóa buổi học, sinh mã điểm danh', module: 'sessions' },
  // ---- Báo cáo ----
  { code: 'reports.view', name: 'Xem báo cáo', description: 'Xem báo cáo doanh thu, điểm danh, công nợ', module: 'reports' },
  { code: 'reports.export', name: 'Xuất báo cáo', description: 'Xuất báo cáo ra file', module: 'reports' },
  // ---- Đơn xin nghỉ ----
  { code: 'leaves.view', name: 'Xem đơn nghỉ', description: 'Xem danh sách đơn xin nghỉ', module: 'leaves' },
  { code: 'leaves.manage', name: 'Duyệt đơn nghỉ', description: 'Duyệt/từ chối đơn xin nghỉ', module: 'leaves' },
  // ---- Phòng học ----
  { code: 'rooms.view', name: 'Xem phòng học', description: 'Xem danh sách phòng học', module: 'rooms' },
  { code: 'rooms.manage', name: 'Quản lý phòng học', description: 'Thêm/sửa/xóa phòng học', module: 'rooms' },
  // ---- Học thử ----
  { code: 'trials.view', name: 'Xem học thử', description: 'Xem đăng ký học thử', module: 'trials' },
  { code: 'trials.manage', name: 'Quản lý học thử', description: 'Duyệt/chuyển đổi đăng ký học thử', module: 'trials' },
  // ---- Tuyển sinh ----
  { code: 'leads.view', name: 'Xem leads', description: 'Xem danh sách khách hàng tiềm năng', module: 'leads' },
  { code: 'leads.manage', name: 'Quản lý leads', description: 'Thêm/sửa/xóa leads, chuyển trạng thái', module: 'leads' },
  { code: 'referrals.view', name: 'Xem giới thiệu', description: 'Xem danh sách giới thiệu', module: 'referrals' },
  { code: 'referrals.manage', name: 'Quản lý giới thiệu', description: 'Duyệt/thưởng giới thiệu', module: 'referrals' },
  { code: 'reviews.view', name: 'Xem đánh giá', description: 'Xem đánh giá của phụ huynh', module: 'reviews' },
  { code: 'reviews.manage', name: 'Quản lý đánh giá', description: 'Duyệt/từ chối/xóa đánh giá', module: 'reviews' },
  // ---- Thông báo ----
  { code: 'notifications.view', name: 'Xem thông báo', description: 'Xem lịch sử nhắc Zalo/thông báo', module: 'notifications' },
  { code: 'notifications.send', name: 'Gửi thông báo', description: 'Gửi nhắc học phí/thông báo thủ công', module: 'notifications' },
  { code: 'notifications.manage', name: 'Quản lý thông báo', description: 'Cấu hình và gửi thông báo', module: 'notifications' },
  // ---- Cấu hình ----
  { code: 'settings.view', name: 'Xem cấu hình', description: 'Xem cấu hình trung tâm', module: 'settings' },
  { code: 'settings.manage', name: 'Sửa cấu hình', description: 'Thay đổi cấu hình trung tâm', module: 'settings' },
  { code: 'payment_config.manage', name: 'Cấu hình thanh toán', description: 'Sửa VNPay/VietQR/Zalo', module: 'settings' },
  // ---- Nhân sự ----
  { code: 'users.view', name: 'Xem tài khoản', description: 'Xem danh sách tài khoản nhân sự', module: 'users' },
  { code: 'users.create', name: 'Tạo tài khoản', description: 'Tạo tài khoản nhân sự mới', module: 'users' },
  { code: 'users.update', name: 'Sửa tài khoản', description: 'Sửa thông tin, đổi role', module: 'users' },
  { code: 'users.delete', name: 'Xóa tài khoản', description: 'Vô hiệu hóa tài khoản', module: 'users' },
  // ---- Phân quyền ----
  { code: 'roles.view', name: 'Xem vai trò', description: 'Xem danh sách roles và permissions', module: 'roles' },
  { code: 'roles.manage', name: 'Quản lý vai trò', description: 'Tạo/sửa/xóa roles, gán permissions', module: 'roles' },
  // ---- Hệ thống ----
  { code: 'audit.view', name: 'Xem audit log', description: 'Xem nhật ký hoạt động', module: 'system' },
  { code: 'system.manage', name: 'Quản trị hệ thống', description: 'Quản lý centers, backup, superadmin tools', module: 'system' },
];

/**
 * System roles: vai trò cố định của hệ thống, không được xóa.
 * Mỗi role ánh xạ tới danh sách permission codes.
 * Scope mặc định: 'all' cho superadmin, 'center' cho các role còn lại, 'own' cho teacher một số quyền.
 */
export interface SystemRoleDef {
  code: string;
  name: string;
  description: string;
  /** Map permission code -> scope */
  permissions: Record<string, 'own' | 'center' | 'all'>;
}

const ALL_PERMS = (scope: 'own' | 'center' | 'all'): Record<string, 'own' | 'center' | 'all'> =>
  Object.fromEntries(PERMISSIONS.map((p) => [p.code, scope]));

export const SYSTEM_ROLES: SystemRoleDef[] = [
  {
    code: 'superadmin',
    name: 'Superadmin',
    description: 'Quản trị toàn hệ thống, mọi trung tâm, mọi quyền.',
    permissions: ALL_PERMS('all'),
  },
  {
    code: 'admin',
    name: 'Quản trị trung tâm',
    description: 'Toàn quyền trong trung tâm của mình.',
    permissions: ALL_PERMS('center'),
  },
  {
    code: 'staff',
    name: 'Nhân viên',
    description: 'Vận hành hàng ngày: học viên, lớp, điểm danh, thu tiền, tuyển sinh. Không xóa dữ liệu nhạy cảm, không quản lý lương/cấu hình hệ thống.',
    permissions: {
      'students.view': 'center',
      'students.create': 'center',
      'students.update': 'center',
      'classes.view': 'center',
      'classes.create': 'center',
      'classes.update': 'center',
      'classes.enroll': 'center',
      'sessions.view': 'center',
      'sessions.manage': 'center',
      'attendance.view': 'center',
      'attendance.take': 'center',
      'invoices.view': 'center',
      'invoices.create': 'center',
      'invoices.update': 'center',
      'payments.collect': 'center',
      'payments.approve': 'center',
      'homework.view': 'center',
      'homework.create': 'center',
      'homework.grade': 'center',
      'grades.view': 'center',
      'grades.manage': 'center',
      'reports.view': 'center',
      'leads.view': 'center',
      'leads.manage': 'center',
      'leaves.view': 'center',
      'leaves.manage': 'center',
      'rooms.view': 'center',
      'trials.view': 'center',
      'trials.manage': 'center',
      'referrals.view': 'center',
      'referrals.manage': 'center',
      'reviews.view': 'center',
      'reviews.manage': 'center',
      'teachers.view': 'center',
      'payroll.view': 'center',
      'notifications.view': 'center',
      'notifications.send': 'center',
    },
  },
  {
    code: 'teacher',
    name: 'Giáo viên',
    description: 'Chỉ dữ liệu lớp mình dạy: điểm danh, giao/chấm bài, xem học viên lớp mình, xem lương cá nhân.',
    permissions: {
      'students.view': 'own',
      'classes.view': 'own',
      'sessions.view': 'own',
      'attendance.view': 'own',
      'attendance.take': 'own',
      'homework.view': 'own',
      'homework.create': 'own',
      'homework.grade': 'own',
      'grades.view': 'own',
      'grades.manage': 'own',
      'reports.view': 'own',
      'payroll.view_self': 'own',
    },
  },
];

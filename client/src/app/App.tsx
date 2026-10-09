import { lazy, Suspense, useEffect, type ComponentType, type JSX, type LazyExoticComponent } from 'react';
import { Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom';
import { getToken, getUser } from '../shared/api/client';
import { ErrorBoundary } from '../shared/components/ErrorBoundary';

/** Lazy-load 1 named export từ module page. */
function lazyPage<T extends object>(
  load: () => Promise<T>,
  exportName: keyof T
): LazyExoticComponent<ComponentType> {
  return lazy(() => load().then((m) => ({ default: m[exportName] as ComponentType })));
}

/* ---------- Nhóm public (landing + auth) ---------- */
const Landing = lazyPage(() => import('../features/landing/Landing'), 'Landing');
const Login = lazyPage(() => import('../features/auth/Login'), 'Login');
const ParentLogin = lazyPage(() => import('../features/parent/ParentLogin'), 'ParentLogin');
const ParentRegister = lazyPage(() => import('../features/parent/ParentRegister'), 'ParentRegister');

/* ---------- Nhóm parent ---------- */
const ParentLayout = lazyPage(() => import('../features/parent/ParentLayout'), 'ParentLayout');
const ParentHome = lazyPage(() => import('../features/parent/ParentHome'), 'ParentHome');
const ChildDetail = lazyPage(() => import('../features/parent/ChildDetail'), 'ChildDetail');
const ParentLeaves = lazyPage(() => import('../features/parent/ParentLeaves'), 'ParentLeaves');
const ParentReferral = lazyPage(() => import('../features/parent/ParentReferral'), 'ParentReferral');
const ParentProfile = lazyPage(() => import('../features/parent/ParentProfile'), 'ParentProfile');
const PaymentResult = lazyPage(() => import('../features/parent/PaymentResult'), 'PaymentResult');

/* ---------- Nhóm teacher ---------- */
const TeacherLayout = lazyPage(() => import('../features/teacher/TeacherLayout'), 'TeacherLayout');
const TeacherToday = lazyPage(() => import('../features/teacher/TeacherToday'), 'TeacherToday');
const TeacherGrades = lazyPage(() => import('../features/teacher/TeacherGrades'), 'TeacherGrades');
const TeacherSalary = lazyPage(() => import('../features/teacher/TeacherSalary'), 'TeacherSalary');

/* ---------- Nhóm admin ---------- */
const Layout = lazyPage(() => import('../shared/components/Layout'), 'Layout');
const Dashboard = lazyPage(() => import('../features/dashboard/Dashboard'), 'Dashboard');
const Students = lazyPage(() => import('../features/students/Students'), 'Students');
const StudentDetail = lazyPage(() => import('../features/students/StudentDetail'), 'StudentDetail');
const Classes = lazyPage(() => import('../features/classes/Classes'), 'Classes');
const ClassDetail = lazyPage(() => import('../features/classes/ClassDetail'), 'ClassDetail');
const Attendance = lazyPage(() => import('../features/classes/Attendance'), 'Attendance');
const Tuition = lazyPage(() => import('../features/tuition/Tuition'), 'Tuition');
const ZaloReminders = lazyPage(() => import('../features/notifications/ZaloReminders'), 'ZaloReminders');
const Teachers = lazyPage(() => import('../features/people/Teachers'), 'Teachers');
const Rooms = lazyPage(() => import('../features/classes/Rooms'), 'Rooms');
const Payroll = lazyPage(() => import('../features/people/Payroll'), 'Payroll');
const LeavesAdmin = lazyPage(() => import('../features/leaves/LeavesAdmin'), 'LeavesAdmin');
const Trials = lazyPage(() => import('../features/admissions/Trials'), 'Trials');
const Homework = lazyPage(() => import('../features/homework/Homework'), 'Homework');
const Leads = lazyPage(() => import('../features/admissions/Leads'), 'Leads');
const ReviewsAdmin = lazyPage(() => import('../features/growth/ReviewsAdmin'), 'ReviewsAdmin');
const ReferralsAdmin = lazyPage(() => import('../features/growth/ReferralsAdmin'), 'ReferralsAdmin');
const PaymentConfig = lazyPage(() => import('../features/tuition/PaymentConfig'), 'PaymentConfig');
const System = lazyPage(() => import('../features/system/System'), 'System');
const AuditLogs = lazyPage(() => import('../features/system/AuditLogs'), 'AuditLogs');
const Roles = lazyPage(() => import('../features/system/Roles'), 'Roles');

/** Fallback khi đang tải chunk lazy. */
function RouteFallback() {
  return (
    <div className="route-loader" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
    </div>
  );
}

function RoleGuard({
  roles,
  loginPath,
  children,
}: {
  roles: string[];
  loginPath: string;
  children: JSX.Element;
}) {
  const location = useLocation();
  const authed = !!getToken();
  // Lưu deep-link để login xong quay lại đúng trang đang làm dở.
  useEffect(() => {
    if (!authed) {
      try {
        sessionStorage.setItem('edu_next', location.pathname + location.search);
      } catch {
        /* bỏ qua */
      }
    }
  }, [authed, location.pathname, location.search]);
  if (!authed) return <Navigate to={loginPath} replace />;
  const user = getUser();
  if (!user || !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

/** Redirect các đường dẫn cũ (không còn tồn tại) sang đường dẫn mới, giữ nguyên param */
function OldRedirect({ to }: { to: string }) {
  const params = useParams();
  let path = to;
  Object.entries(params).forEach(([k, v]) => {
    path = path.replace(`:${k}`, v || '');
  });
  return <Navigate to={path} replace />;
}

export default function App() {
  return (
    <ErrorBoundary name="root">
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />

          {/* Cổng phụ huynh (public) */}
          <Route path="/parent/login" element={<ParentLogin />} />
          <Route path="/parent/register" element={<ParentRegister />} />
          <Route
            path="/parent/*"
            element={
              <RoleGuard roles={['parent']} loginPath="/parent/login">
                <ErrorBoundary name="parent">
                  <ParentLayout />
                </ErrorBoundary>
              </RoleGuard>
            }
          >
            <Route index element={<ParentHome />} />
            <Route path="children/:id" element={<ChildDetail />} />
            <Route path="leaves" element={<ParentLeaves />} />
            <Route path="referral" element={<ParentReferral />} />
            <Route path="toi" element={<ParentProfile />} />
            <Route path="thanh-toan-ket-qua" element={<PaymentResult />} />
          </Route>

          {/* Portal giáo viên */}
          <Route
            path="/teacher/*"
            element={
              <RoleGuard roles={['teacher']} loginPath="/login">
                <ErrorBoundary name="teacher">
                  <TeacherLayout />
                </ErrorBoundary>
              </RoleGuard>
            }
          >
            <Route index element={<TeacherToday />} />
            <Route path="diem-danh" element={<Attendance />} />
            <Route path="bai-tap" element={<Homework />} />
            <Route path="diem-so" element={<TeacherGrades />} />
            <Route path="luong" element={<TeacherSalary />} />
          </Route>

          {/* Quản trị trung tâm */}
          <Route
            path="/app/*"
            element={
              <RoleGuard roles={['superadmin', 'admin', 'staff']} loginPath="/login">
                <ErrorBoundary name="app">
                  <Layout />
                </ErrorBoundary>
              </RoleGuard>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="students" element={<Students />} />
            <Route path="students/:id" element={<StudentDetail />} />
            <Route path="classes" element={<Classes />} />
            <Route path="classes/:id" element={<ClassDetail />} />
            <Route path="attendance" element={<Attendance />} />
            <Route path="tuition" element={<Tuition />} />
            <Route path="rooms" element={<Rooms />} />
            <Route path="payroll" element={<Payroll />} />
            <Route path="leaves" element={<LeavesAdmin />} />
            <Route path="trials" element={<Trials />} />
            <Route path="homework" element={<Homework />} />
            <Route path="leads" element={<Leads />} />
            <Route path="danh-gia" element={<ReviewsAdmin />} />
            <Route path="gioi-thieu" element={<ReferralsAdmin />} />
            <Route path="zalo-reminders" element={<ZaloReminders />} />
            <Route path="teachers" element={<Teachers />} />
            <Route path="cau-hinh-thanh-toan" element={<PaymentConfig />} />
            <Route path="system" element={<System />} />
            <Route path="nhat-ky" element={<AuditLogs />} />
            <Route path="phan-quyen" element={<Roles />} />
          </Route>

          {/* Redirect đường dẫn cũ sang mới */}
          <Route path="/students" element={<OldRedirect to="/app/students" />} />
          <Route path="/students/:id" element={<OldRedirect to="/app/students/:id" />} />
          <Route path="/classes" element={<OldRedirect to="/app/classes" />} />
          <Route path="/classes/:id" element={<OldRedirect to="/app/classes/:id" />} />
          <Route path="/attendance" element={<OldRedirect to="/app/attendance" />} />
          <Route path="/tuition" element={<OldRedirect to="/app/tuition" />} />
          <Route path="/teachers" element={<OldRedirect to="/app/teachers" />} />
          <Route path="/zalo-reminders" element={<OldRedirect to="/app/zalo-reminders" />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

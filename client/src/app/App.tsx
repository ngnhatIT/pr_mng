import {
  lazy,
  Suspense,
  useEffect,
  useState,
  type ComponentType,
  type JSX,
  type LazyExoticComponent,
} from 'react';
import {
  createBrowserRouter,
  createRoutesFromElements,
  Route,
  RouterProvider,
  Navigate,
  Outlet,
  useBlocker,
  useParams,
  useLocation,
} from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { clearAuth, getToken, getUser, tryRefresh } from '../shared/api/client';
import { ErrorBoundary } from '../shared/components/ErrorBoundary';
import { ConfirmDialog } from '../shared/components/Modal';
import { NotFound, Forbidden } from './ErrorPages';
import { NetworkBanner } from '../shared/components/NetworkBanner';
import { UnauthorizedListener } from '../shared/api/UnauthorizedListener';
import { PasswordChangeGate } from '../shared/components/PasswordChangeGate';
import { hasUnsavedChanges } from '../shared/hooks/useUnsavedGuard';

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
const InvoiceDetail = lazyPage(() => import('../features/tuition/InvoiceDetail'), 'InvoiceDetail');
const ZaloReminders = lazyPage(() => import('../features/notifications/ZaloReminders'), 'ZaloReminders');
const Teachers = lazyPage(() => import('../features/people/Teachers'), 'Teachers');
const TeacherDetail = lazyPage(() => import('../features/people/TeacherDetail'), 'TeacherDetail');
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

export function RoleGuard({
  roles,
  loginPath,
  children,
}: {
  roles: string[];
  loginPath: string;
  children: JSX.Element;
}) {
  const location = useLocation();
  // CORR-1: access token chỉ nằm trong memory -> reload/tab mới luôn mất. Nếu còn user đã lưu thì thử
  // refresh (HttpOnly cookie) trước, hiện loader trong lúc chờ; chỉ đá về login khi refresh thất bại.
  const [checking, setChecking] = useState(() => !getToken() && !!getUser());
  useEffect(() => {
    if (!checking) return;
    let alive = true;
    void tryRefresh().then((ok) => {
      if (!alive) return;
      if (!ok) clearAuth(); // user đã lưu nhưng phiên hết hạn -> bỏ để lần sau không refresh vô ích
      setChecking(false);
    });
    return () => {
      alive = false;
    };
  }, [checking]);
  const authed = !checking && !!getToken();
  // Lưu deep-link để login xong quay lại đúng trang đang làm dở.
  useEffect(() => {
    if (!checking && !authed) {
      try {
        sessionStorage.setItem('edu_next', location.pathname + location.search);
      } catch {
        /* bỏ qua */
      }
    }
  }, [checking, authed, location.pathname, location.search]);
  if (checking) return <RouteFallback />;
  if (!authed) return <Navigate to={loginPath} replace />;
  const user = getUser();
  if (!user || !roles.includes(user.role)) return <Forbidden />;
  return children;
}

/**
 * FE-2: ErrorBoundary theo TỪNG TRANG, nằm trong layout (sidebar/topbar vẫn còn khi 1 trang crash),
 * key theo pathname để điều hướng sang trang khác là tự reset. Suspense riêng để tải chunk trang
 * không thay cả layout bằng loader.
 */
function PageOutlet() {
  const { pathname } = useLocation();
  return (
    <ErrorBoundary key={pathname} name="page">
      <Suspense fallback={<RouteFallback />}>
        <Outlet />
      </Suspense>
    </ErrorBoundary>
  );
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

/**
 * UX-4: MỘT blocker cho cả app (router chỉ dùng blocker đăng ký sau cùng nên không đặt useBlocker trong từng form).
 * Còn form dirty (useUnsavedGuard / Modal dirty) mà bấm link sang trang khác hoặc Back -> hỏi trước khi rời.
 * Chỉ đổi query (?page=, ?tab=) trên cùng trang thì không chặn.
 */
export function UnsavedChangesPrompt() {
  const { t } = useTranslation('common');
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      hasUnsavedChanges() && currentLocation.pathname !== nextLocation.pathname
  );
  if (blocker.state !== 'blocked') return null;
  return (
    <ConfirmDialog
      title={t('discard.title')}
      message={t('discard.message')}
      confirmLabel={t('discard.confirm')}
      danger
      onClose={() => blocker.reset()}
      onConfirm={() => blocker.proceed()}
    />
  );
}

/** Route gốc: các thành phần cần router context (trước đây đặt quanh <Routes>/trong <BrowserRouter> ở main.tsx). */
function Root() {
  return (
    <ErrorBoundary name="root">
      <UnauthorizedListener />
      <PasswordChangeGate />
      <NetworkBanner />
      <Suspense fallback={<RouteFallback />}>
        <Outlet />
      </Suspense>
      {/* Sau Outlet: cùng z-index với modal của trang nên phải nằm sau trong DOM để hiện đè lên */}
      <UnsavedChangesPrompt />
    </ErrorBoundary>
  );
}

export const routes = createRoutesFromElements(
  <Route element={<Root />}>
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
      <Route element={<PageOutlet />}>
        <Route index element={<ParentHome />} />
        <Route path="children/:id" element={<ChildDetail />} />
        <Route path="leaves" element={<ParentLeaves />} />
        <Route path="referral" element={<ParentReferral />} />
        <Route path="toi" element={<ParentProfile />} />
        <Route path="thanh-toan-ket-qua" element={<PaymentResult />} />
        <Route path="*" element={<NotFound />} />
      </Route>
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
      <Route element={<PageOutlet />}>
        <Route index element={<TeacherToday />} />
        <Route path="diem-danh" element={<Attendance />} />
        <Route path="bai-tap" element={<Homework />} />
        <Route path="diem-so" element={<TeacherGrades />} />
        <Route path="luong" element={<TeacherSalary />} />
        <Route path="*" element={<NotFound />} />
      </Route>
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
      <Route element={<PageOutlet />}>
        <Route index element={<Dashboard />} />
        <Route path="students" element={<Students />} />
        <Route path="students/:id" element={<StudentDetail />} />
        <Route path="classes" element={<Classes />} />
        <Route path="classes/:id" element={<ClassDetail />} />
        <Route path="attendance" element={<Attendance />} />
        <Route path="tuition" element={<Tuition />} />
        <Route path="tuition/invoices/:id" element={<InvoiceDetail />} />
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
        <Route path="teachers/:id" element={<TeacherDetail />} />
        <Route path="cau-hinh-thanh-toan" element={<PaymentConfig />} />
        <Route path="system" element={<System />} />
        <Route path="nhat-ky" element={<AuditLogs />} />
        <Route path="phan-quyen" element={<Roles />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Route>

    {/* Redirect đường dẫn cũ sang mới */}
    <Route path="/students" element={<OldRedirect to="/app/students" />} />
    <Route path="/students/:id" element={<OldRedirect to="/app/students/:id" />} />
    <Route path="/classes" element={<OldRedirect to="/app/classes" />} />
    <Route path="/classes/:id" element={<OldRedirect to="/app/classes/:id" />} />
    <Route path="/attendance" element={<OldRedirect to="/app/attendance" />} />
    <Route path="/tuition" element={<OldRedirect to="/app/tuition" />} />
    <Route path="/tuition/invoices/:id" element={<OldRedirect to="/app/tuition/invoices/:id" />} />
    <Route path="/teachers" element={<OldRedirect to="/app/teachers" />} />
    <Route path="/zalo-reminders" element={<OldRedirect to="/app/zalo-reminders" />} />

    <Route path="*" element={<NotFound />} />
  </Route>
);

// Tạo router lần đầu render (không tạo lúc import: test import App không có window.history thật).
let router: ReturnType<typeof createBrowserRouter> | null = null;

/** Data router (RR7) - cần cho useBlocker (UX-4). Cây route y hệt <Routes> cũ, bọc trong <Root>. */
export default function App() {
  router ??= createBrowserRouter(routes);
  return <RouterProvider router={router} />;
}

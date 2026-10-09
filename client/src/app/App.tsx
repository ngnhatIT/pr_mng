import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { getToken, getUser } from '../shared/api/client';
import { Layout } from '../shared/components/Layout';
import { Login } from '../features/auth/Login';
import { Landing } from '../features/landing/Landing';
import { Dashboard } from '../features/dashboard/Dashboard';
import { Students } from '../features/students/Students';
import { StudentDetail } from '../features/students/StudentDetail';
import { Classes } from '../features/classes/Classes';
import { ClassDetail } from '../features/classes/ClassDetail';
import { Attendance } from '../features/classes/Attendance';
import { Tuition } from '../features/tuition/Tuition';
import { ZaloReminders } from '../features/notifications/ZaloReminders';
import { Teachers } from '../features/people/Teachers';
import { Rooms } from '../features/classes/Rooms';
import { Payroll } from '../features/people/Payroll';
import { LeavesAdmin } from '../features/leaves/LeavesAdmin';
import { Trials } from '../features/admissions/Trials';
import { Homework } from '../features/homework/Homework';
import { Leads } from '../features/admissions/Leads';
import { ReviewsAdmin } from '../features/growth/ReviewsAdmin';
import { ReferralsAdmin } from '../features/growth/ReferralsAdmin';
import { PaymentConfig } from '../features/tuition/PaymentConfig';
import { System } from '../features/system/System';
import { AuditLogs } from '../features/system/AuditLogs';
import { ParentLayout } from '../features/parent/ParentLayout';
import { ParentLogin } from '../features/parent/ParentLogin';
import { ParentRegister } from '../features/parent/ParentRegister';
import { ParentHome } from '../features/parent/ParentHome';
import { ChildDetail } from '../features/parent/ChildDetail';
import { ParentLeaves } from '../features/parent/ParentLeaves';
import { ParentReferral } from '../features/parent/ParentReferral';
import { ParentProfile } from '../features/parent/ParentProfile';
import { PaymentResult } from '../features/parent/PaymentResult';
import { TeacherLayout } from '../features/teacher/TeacherLayout';
import { TeacherToday } from '../features/teacher/TeacherToday';
import { TeacherGrades } from '../features/teacher/TeacherGrades';
import { TeacherSalary } from '../features/teacher/TeacherSalary';
import { JSX } from 'react';

function RoleGuard({
  roles,
  loginPath,
  children,
}: {
  roles: string[];
  loginPath: string;
  children: JSX.Element;
}) {
  if (!getToken()) return <Navigate to={loginPath} replace />;
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
            <ParentLayout />
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
            <TeacherLayout />
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
            <Layout />
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
  );
}

import { useCallback, useEffect, useState } from 'react';
import { teacherApi, SalaryInfo } from './teacher.api';
import { useToast } from '../../shared/ui/toast';
import { Field } from '../../shared/components/Form';
import { PageHeader } from '../../shared/components/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState';
import { StatGridSkeleton } from '../../shared/components/Skeleton';
import { formatVND } from '../../shared/types';
import './TeacherSalary.css';

export function TeacherSalary() {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [month, setMonth] = useState(defaultMonth);
  const [salary, setSalary] = useState<SalaryInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await teacherApi.payroll(month);
      setSalary(data);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Không tải được lương', 'error');
    } finally {
      setLoading(false);
    }
  }, [month, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="page">
      <PageHeader title="Lương của tôi" desc="Chi tiết lương theo từng tháng" />

      <div className="toolbar">
        <Field label="Tháng">
          <input
            className="text-input"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </Field>
      </div>

      {loading ? (
        <StatGridSkeleton count={3} />
      ) : salary ? (
        <>
          <div className="salary-hero">
            <div className="salary-month">Tổng lương tháng {month.slice(5, 7)}/{month.slice(0, 4)}</div>
            <div className="salary-total">{formatVND(salary.total)}</div>
            <div className="salary-sub">{salary.sessions} buổi đã chấm công</div>
          </div>
          <div className="card salary-breakdown">
            <div className="salary-row">
              <span>Số buổi đã chấm công</span>
              <strong>{salary.sessions}</strong>
            </div>
            <div className="salary-row">
              <span>Đơn giá / buổi</span>
              <strong>{formatVND(salary.per_session)}</strong>
            </div>
          </div>
        </>
      ) : (
        <EmptyState
          icon="wallet"
          title="Không có dữ liệu lương"
          desc="Không có dữ liệu lương cho tháng này."
        />
      )}
    </div>
  );
}

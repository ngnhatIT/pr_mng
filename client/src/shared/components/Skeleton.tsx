export function Skeleton({
  width,
  height = 14,
  radius = 6,
  className = '',
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  className?: string;
}) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{ width: width ?? '100%', height, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="table-wrap" aria-hidden="true">
      <table className="table">
        <thead>
          <tr>
            {Array.from({ length: cols }).map((_, i) => (
              <th key={i}>
                <Skeleton width={`${60 + ((i * 37) % 30)}%`} height={12} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c}>
                  <Skeleton width={`${55 + ((r * 31 + c * 17) % 40)}%`} height={13} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="card-grid" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card class-card">
          <Skeleton width="60%" height={18} />
          <div style={{ marginTop: 12 }}>
            <Skeleton height={12} />
            <div style={{ marginTop: 8 }}>
              <Skeleton width="80%" height={12} />
            </div>
            <div style={{ marginTop: 8 }}>
              <Skeleton width="45%" height={12} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function StatGridSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="stat-grid" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="stat-card">
          <Skeleton width="40%" height={26} />
          <div style={{ marginTop: 10 }}>
            <Skeleton width="70%" height={13} />
          </div>
        </div>
      ))}
    </div>
  );
}

import { useTranslation } from 'react-i18next';
import { Icon } from './icons';

/**
 * Tiêu đề cột sắp xếp được: nút trong <th> + aria-sort. sort dạng 'name' | '-name' (khớp parseSort ở server).
 * Bấm: chưa sắp -> tăng -> giảm -> tăng...
 */
export function SortHeader({
  label,
  field,
  sort,
  onSort,
  className,
}: {
  label: string;
  field: string;
  sort: string;
  onSort: (next: string) => void;
  className?: string;
}) {
  const { t } = useTranslation('common');
  const asc = sort === field;
  const desc = sort === `-${field}`;
  return (
    <th scope="col" className={className} aria-sort={asc ? 'ascending' : desc ? 'descending' : 'none'}>
      <button
        type="button"
        className={`sort-btn${asc || desc ? ' is-active' : ''}`}
        onClick={() => onSort(asc ? `-${field}` : field)}
        title={t('table.sortBy', { label })}
      >
        {label}
        <Icon name={asc ? 'chevron-up' : desc ? 'chevron-down' : 'chevronUpDown'} size={12} />
      </button>
    </th>
  );
}

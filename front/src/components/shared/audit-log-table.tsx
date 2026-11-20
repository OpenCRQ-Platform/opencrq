import { Paper } from '@filigran/design-system';
import { DataTable } from '@filigran/ui';
import type { ColumnDefWithOptionsHeader } from '@filigran/ui';
import type { ReactNode } from 'react';
import { getDataTableI18nKey } from '../ui/data-table-i18n';

interface AuditLogTableProps<T extends { id: string }> {
  data: Array<T>,
  columns: Array<ColumnDefWithOptionsHeader<T, unknown>>,
  title: ReactNode,
  onClickRow?: (row: { original: T }) => void,
  headerActions?: ReactNode,
}

/**
 * Audit log table: a headerless DataTable inside a Card, used for
 * chronological event / evidence streams. The title and optional action
 * button sit above the card.
 */
export const AuditLogTable = <T extends { id: string }>({
  data,
  columns,
  title,
  onClickRow,
  headerActions,
}: AuditLogTableProps<T>): ReactNode => (
  <div className="space-y-2">
    <div className="flex items-center justify-between">
      <p className="txt-sub-content">{title}</p>
      {headerActions}
    </div>
    <Paper className="p-[16px_24px]">
      <div className="[&_thead]:hidden [&_.twp]:mt-0">
        <DataTable
          i18nKey={getDataTableI18nKey()}
          data={data}
          columns={columns}
          toolbar={<></>}
          onClickRow={onClickRow}
        />
      </div>
    </Paper>
  </div>
);

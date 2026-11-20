import { Button } from '@filigran/design-system';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent, ReactNode } from 'react';

interface DataPageToolbarProps {
  leftHeaderContent?: ReactNode,
  dataLength?: number,
  pagination?: ReactNode,
  viewToggle?: ReactNode,
  headerActions?: ReactNode,
  onCreate?: () => void,
}

export const DataPageToolbar: FunctionComponent<DataPageToolbarProps> = ({
  leftHeaderContent,
  dataLength,
  pagination,
  viewToggle,
  headerActions,
  onCreate,
}) => (
  <div className="flex flex-wrap items-center justify-between gap-2">
    {leftHeaderContent && <div className="flex flex-wrap items-center gap-2">{leftHeaderContent}</div>}
    <div className="ml-auto flex items-center gap-2">
      {dataLength !== undefined && (
        <p className="txt-sub-content text-muted-foreground">
          <strong>{t({ message: plural(dataLength, { one: '# entity', other: '# entities' }) })}</strong>
        </p>
      )}
      {pagination}
      {viewToggle}
      {headerActions}
      {onCreate && (
        <Button onClick={onCreate}>
          <Trans>Create</Trans>
        </Button>
      )}
    </div>
  </div>
);

import { Button } from '@filigran/design-system';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent, ReactNode } from 'react';

interface DataPageToolbarProps {
  leftHeaderContent?: ReactNode,
  dataLength?: number,
  /** The whole list's count while a search or a filter narrows it, so the count reads "n of N". */
  totalLength?: number,
  pagination?: ReactNode,
  viewToggle?: ReactNode,
  headerActions?: ReactNode,
  onCreate?: () => void,
}

export const DataPageToolbar: FunctionComponent<DataPageToolbarProps> = ({
  leftHeaderContent,
  dataLength,
  totalLength,
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
          <strong>
            {totalLength === undefined
              ? t({ message: plural(dataLength, { one: '# entity', other: '# entities' }) })
              : t({ message: plural(totalLength, { one: `${dataLength} of # entity`, other: `${dataLength} of # entities` }) })}
          </strong>
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

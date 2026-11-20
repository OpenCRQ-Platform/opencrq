import { plural, t } from '@lingui/core/macro';
import type { FunctionComponent } from 'react';
import type { ShowFilter } from '../manage-dependencies-utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';

const isShowFilter = (value: string): value is ShowFilter => value === 'all' || value === 'linked' || value === 'pending';

interface ShowFilterSelectProps {
  value: ShowFilter,
  /** The links the server holds, which the linked view lists. */
  linkedCount: number,
  pendingCount: number,
  onChange: (value: ShowFilter) => void,
}

/** Every asset, the stored links, or the session's changes alone: one list read three ways. */
export const ShowFilterSelect: FunctionComponent<ShowFilterSelectProps> = ({ value, linkedCount, pendingCount, onChange }) => (
  <Select
    value={value}
    onValueChange={(next) => {
      if (isShowFilter(next)) {
        onChange(next);
      }
    }}
  >
    <SelectTrigger className="w-56" aria-label={t`Show`}>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="all">{t`Show all`}</SelectItem>
      <SelectItem value="linked">{plural(linkedCount, { one: 'Show linked · #', other: 'Show linked · #' })}</SelectItem>
      <SelectItem value="pending">{plural(pendingCount, { one: 'Show pending changes · #', other: 'Show pending changes · #' })}</SelectItem>
    </SelectContent>
  </Select>
);

import { Button } from '@filigran/design-system';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent, ReactNode } from 'react';

/**
 * A stale-write toast is the only cue for a field the other writer alone changed, which the reload
 * swaps under the user, so it stays up longer than the 2 s default.
 */
export const STALE_WRITE_TOAST_DURATION = 8000;

interface SavedMeanwhileProps {
  /** The stored value, rendered as the field displays it. */
  children: ReactNode,
  onUse: () => void,
}

/**
 * The value someone else saved in a field the user also changed, shown under that field after a
 * stale-write conflict: the form keeps the user's value, and the next save would erase this one
 * unseen.
 */
export const SavedMeanwhile: FunctionComponent<SavedMeanwhileProps> = ({ children, onUse }) => (
  <div role="note" className="flex items-start justify-between gap-3 rounded border border-[var(--fds-border-elevation-subtle-soft)] px-3 py-2">
    <div className="flex min-w-0 flex-col gap-1">
      <span className="txt-sub-content text-default-secondary"><Trans>Saved meanwhile</Trans></span>
      <div className="txt-sub-content min-w-0 break-words">{children}</div>
    </div>
    <Button type="button" priority="tertiary" size="sm" onClick={onUse}>
      <Trans>Use saved value</Trans>
    </Button>
  </div>
);

import { useState } from 'react';
import { useDebouncedCallback } from 'use-debounce';

const DEFAULT_DELAY_MS = 400;

interface ReconcileDraftParams {
  /** What the URL carries at the current render. */
  committed: string,
  /** What is currently typed. */
  draft: string,
  /** What the hook last considered committed — from props or from its own commit. */
  lastCommitted: string,
}

/** Value to display when the URL and the typed draft diverge. */
export const reconcileDraft = ({ committed, draft, lastCommitted }: ReconcileDraftParams): string =>
  (committed !== lastCommitted ? committed : draft);

interface UseDebouncedDraftResult {
  value: string,
  setValue: (next: string) => void,
  onBlur: () => void,
}

/**
 * `seenCommitted` mirrors the `committed` prop across renders, telling a real external change
 * (back navigation, a link opened elsewhere) apart from a render this hook triggered itself.
 * `syncedValue` is what the hook currently believes is committed, letting `reconcileDraft` tell
 * that same external change apart from the round-trip echo of a commit this hook made itself,
 * which must not clobber a draft typed since.
 *
 * `onBlur` exists because a mousedown on a row blurs the field before the click handler navigates,
 * so a draft still in flight reaches the address while the list is still the current location —
 * a commit from the unmount cleanup would resolve `to: '.'` against the destination instead.
 */
export const useDebouncedDraft = (
  committed: string,
  commit: (next: string) => void,
  delayMs: number = DEFAULT_DELAY_MS,
): UseDebouncedDraftResult => {
  const [value, setValue] = useState(committed);
  const [seenCommitted, setSeenCommitted] = useState(committed);
  const [syncedValue, setSyncedValue] = useState(committed);

  const debouncedCommit = useDebouncedCallback((next: string) => {
    setSyncedValue(next);
    commit(next);
  }, delayMs);

  if (committed !== seenCommitted) {
    setSeenCommitted(committed);
    const reconciled = reconcileDraft({ committed, draft: value, lastCommitted: syncedValue });
    setSyncedValue(committed);
    if (reconciled !== value) {
      debouncedCommit.cancel();
      setValue(reconciled);
    }
  }

  const setDraft = (next: string): void => {
    setValue(next);
    if (next === committed) {
      debouncedCommit.cancel();
      return;
    }
    debouncedCommit(next);
  };

  return { value, setValue: setDraft, onBlur: debouncedCommit.flush };
};

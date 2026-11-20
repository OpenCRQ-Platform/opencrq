import type { EvidenceState } from '@app/module/client';
import { EVIDENCE_STATES } from '@app/module/client';

/** Spread from the server's own enumeration, so a state added there widens the filter with it. */
export const EVIDENCE_STATE_FILTERS = ['all', ...EVIDENCE_STATES] as const;

export type EvidenceStateFilter = (typeof EVIDENCE_STATE_FILTERS)[number];

export const isEvidenceStateFilter = (value: string): value is EvidenceStateFilter =>
  EVIDENCE_STATE_FILTERS.some((candidate) => candidate === value);

/** A finding whose history is empty has never changed state, so it stands as applicable. */
export const resolveEvidenceState = (state: EvidenceState | null | undefined): EvidenceState =>
  state ?? 'applicable';

export const matchesEvidenceStateFilter = (
  state: EvidenceState | null | undefined,
  filter: EvidenceStateFilter,
): boolean => filter === 'all' || resolveEvidenceState(state) === filter;

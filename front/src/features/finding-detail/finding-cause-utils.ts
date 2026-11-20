import type { EvidenceHistoryOrigin } from '@app/module/client';
import type { FlawKind } from './dismissal-vocabulary';

/** What a history row's cause says about the row, read by every label, date and title that depends on it. */
export interface CauseFacts {
  /** The finding's sources wrote it, not a person. */
  bySync: boolean,
  /** A test result caused it, so its `observedAt` is the date of a test. */
  byTest: boolean,
  /** No source reports the finding any more. */
  retirement: boolean,
  /** A person decided the state; handing the finding back is not a decision. */
  decision: boolean,
  /** A person handed the finding back to its sources. */
  handover: boolean,
}

/** The one place a cause is read: a cause added to `EVIDENCE_HISTORY_ORIGINS` stops this compiling until it is placed. */
export const causeFacts = (origin: EvidenceHistoryOrigin): CauseFacts => {
  switch (origin) {
    case 'exposed':
    case 'not_exposed':
      return { bySync: true, byTest: true, retirement: false, decision: false, handover: false };
    case 'no_longer_reported':
      return { bySync: true, byTest: false, retirement: true, decision: false, handover: false };
    case 'user':
      return { bySync: false, byTest: false, retirement: false, decision: true, handover: false };
    case 'reset':
      return { bySync: false, byTest: false, retirement: false, decision: false, handover: true };
    default:
      return origin satisfies never;
  }
};

/**
 * Why a dismissed finding is dismissed: no connector reports it any more, its last test was
 * prevented or detected, or a person set it aside. A connector reports a CVE exposed or not at all,
 * so a CVE never reads as not exposed. A finding with no history reads as set aside.
 */
export type DismissalCause = 'no_longer_reported' | 'not_exposed' | 'set_aside';

export const dismissalCause = (kind: FlawKind, origin: EvidenceHistoryOrigin | null | undefined): DismissalCause => {
  const facts = origin == null ? null : causeFacts(origin);
  if (facts?.retirement || (facts?.byTest && kind === 'cve')) {
    return 'no_longer_reported';
  }
  return facts?.byTest ? 'not_exposed' : 'set_aside';
};

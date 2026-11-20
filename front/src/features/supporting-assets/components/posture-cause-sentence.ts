import { t } from '@lingui/core/macro';
import type { PostureCause } from '../posture-lifeline-utils';

const worstSentence = (name: string, exploitability: number): string =>
  t`Worst finding: ${name}, exploitability ${exploitability}.`;

/**
 * Null when the line records no cause, or its worst finding is gone. `headed` opens a first or a
 * regained posture's sentence by naming it.
 */
const causeSentenceOf = (cause: PostureCause | null, headed: boolean): string | null => {
  if (cause === null || cause.worstFinding === null || cause.change === null) {
    return null;
  }
  const { name } = cause.worstFinding;
  const exploitability = cause.worstExploitability;
  const { change } = cause;
  switch (change.kind) {
    case 'first':
      return headed ? t`First posture. Worst finding: ${name}, exploitability ${exploitability}.` : worstSentence(name, exploitability);
    case 'regained':
      return headed ? t`Posture regained. Worst finding: ${name}, exploitability ${exploitability}.` : worstSentence(name, exploitability);
    case 'worst':
      return worstSentence(name, exploitability);
    case 'exploitability': {
      const { from } = change;
      return t`Exploitability of ${name}: ${from} → ${exploitability}.`;
    }
    case 'tail': {
      const { fromApplicable, toApplicable } = change;
      return t`Applicable findings: ${fromApplicable} → ${toApplicable}. Worst finding: ${name}, exploitability ${exploitability}.`;
    }
    case 'newWorst':
      return t`New worst finding: ${name}, exploitability ${exploitability}.`;
    case 'resolved': {
      const { resolvedName } = change;
      return t`${resolvedName} resolved. Worst finding: ${name}, exploitability ${exploitability}.`;
    }
  }
};

export const postureCauseSentence = (cause: PostureCause | null): string | null => causeSentenceOf(cause, true);

/** The same sentence under a row that already says the posture is a first or a regained one. */
export const postureCauseDetail = (cause: PostureCause | null): string | null => causeSentenceOf(cause, false);

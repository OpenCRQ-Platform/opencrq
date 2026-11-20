import type { CapabilityFunction } from '../controls/capability/constants';
import type { ExpectationType } from '../supporting-assets/constants';

export const VALIDATION_STATES = ['validated', 'contradicted', 'never_tested'] as const;
export type ValidationState = typeof VALIDATION_STATES[number];

/**
 * What a simulation says it expected, in the vocabulary the control catalogue uses for the same
 * behaviour. The two enums are authored by different sources and neither may be renamed to match
 * the other, so the bridge is stated once here.
 */
export const EXPECTATION_TYPE_TO_FUNCTION = {
  detection: 'detect',
  prevention: 'prevent',
} as const satisfies Record<ExpectationType, CapabilityFunction>;

/** A product constant, never a tenant setting. Inclusive: a cell at exactly 75 % success is not held. */
export const MISSED_SHARE_THRESHOLD = 0.25;

/** A cell without a vote is never met. */
export const isExpectationMet = ({ validatedVotes, totalVotes }: { validatedVotes: number, totalVotes: number }): boolean =>
  totalVotes > 0 && (totalVotes - validatedVotes) / totalVotes < MISSED_SHARE_THRESHOLD;

export const PROVEN_POSTURE_HISTORY_RETENTION_DAYS = 365;

export const EVIDENCE_LINE_SORT_KEYS = ['technique', 'scenario', 'family', 'function', 'verdict', 'evaluatedAt', 'assets'] as const;
export type EvidenceLineSortKey = typeof EVIDENCE_LINE_SORT_KEYS[number];

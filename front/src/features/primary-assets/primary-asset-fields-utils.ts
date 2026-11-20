import type { SecurityNeedCriterion, SecurityNeedLevel } from '@app/module/client';
import { SECURITY_NEED_CRITERIA, SECURITY_NEED_LEVELS } from '@app/module/client';
import { compareText, foldText } from '@app/utils/text-fold';

export const DURATION_UNITS = ['minutes', 'hours', 'days'] as const;
export type DurationUnit = (typeof DURATION_UNITS)[number];

const UNIT_MINUTES: Record<DurationUnit, number> = { minutes: 1, hours: 60, days: 24 * 60 };

export interface DurationParts {
  amount: number | null,
  unit: DurationUnit,
}

/** 0 for an unset level, so an unset one sorts below `low`. */
export const securityNeedRank = (level: SecurityNeedLevel | null): number =>
  (level === null ? 0 : SECURITY_NEED_LEVELS.indexOf(level) + 1);

/** The highest of the levels set, the FIPS 199 high-water mark, `null` when none is. */
export const overallSecurityNeed = (needs: Record<SecurityNeedCriterion, SecurityNeedLevel | null>): SecurityNeedLevel | null =>
  SECURITY_NEED_CRITERIA.reduce<SecurityNeedLevel | null>(
    (highest, criterion) => (securityNeedRank(needs[criterion]) > securityNeedRank(highest) ? needs[criterion] : highest),
    null,
  );

/** The largest unit the minutes divide into evenly: only minutes are stored, so 24 hours reopens as 1 day. */
export const splitDuration = (minutes: number | null): DurationParts => {
  if (minutes === null) {
    return { amount: null, unit: 'hours' };
  }
  const unit = minutes > 0 && minutes % UNIT_MINUTES.days === 0
    ? 'days'
    : minutes > 0 && minutes % UNIT_MINUTES.hours === 0 ? 'hours' : 'minutes';
  return { amount: minutes / UNIT_MINUTES[unit], unit };
};

export const durationMinutes = ({ amount, unit }: DurationParts): number | null =>
  (amount === null ? null : Math.round(amount * UNIT_MINUTES[unit]));

/** ISO/TS 22317 keeps the RTO within the MTPD; a breach is worth a warning, never a refusal. */
export const isRtoAboveMtpd = (rtoMinutes: number | null, mtpdMinutes: number | null): boolean =>
  rtoMinutes !== null && mtpdMinutes !== null && rtoMinutes > mtpdMinutes;

/** The business functions already used, once each whatever their case or accents, in reading order. */
export const businessFunctionSuggestions = (rows: ReadonlyArray<{ businessFunction: string | null }>): Array<string> => {
  const byFolded = new Map<string, string>();
  for (const { businessFunction } of rows) {
    const trimmed = businessFunction?.trim();
    if (trimmed && !byFolded.has(foldText(trimmed))) {
      byFolded.set(foldText(trimmed), trimmed);
    }
  }
  return [...byFolded.values()].sort(compareText);
};

/**
 * The suggestion a filter value names, compared as the suggestions are grouped: the value kept while
 * the options load, `''` once no function of that spelling family remains.
 */
export const resolveBusinessFunctionFilter = (value: string, options: ReadonlyArray<string> | undefined): string => {
  if (value === '' || options === undefined) {
    return value;
  }
  const folded = foldText(value.trim());
  return options.find((option) => foldText(option) === folded) ?? '';
};

/** Compared as the server stores it: trimmed, case kept. */
export const isReferenceTaken = (
  rows: ReadonlyArray<{ id: string, reference: string | null }>,
  reference: string | null,
  ownId: string | null,
): boolean => {
  const trimmed = reference?.trim();
  return !!trimmed && rows.some((row) => row.id !== ownId && row.reference === trimmed);
};

export type OverallLevelFilter = 'all' | 'not_set' | SecurityNeedLevel;

/** `''` is every business function, compared like the suggestions are: case and accents ignored. */
export const filterByNativeFields = <T extends Record<SecurityNeedCriterion, SecurityNeedLevel | null> & { businessFunction: string | null }>(
  rows: ReadonlyArray<T>,
  { businessFunction, level }: { businessFunction: string, level: OverallLevelFilter },
): Array<T> => rows.filter((row) => {
  if (businessFunction !== '' && foldText(row.businessFunction?.trim() ?? '') !== foldText(businessFunction.trim())) {
    return false;
  }
  if (level === 'all') {
    return true;
  }
  const overall = overallSecurityNeed(row);
  return level === 'not_set' ? overall === null : overall === level;
});

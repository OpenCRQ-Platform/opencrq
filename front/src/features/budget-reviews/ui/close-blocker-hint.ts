import { plural, t } from '@lingui/core/macro';
import type { CloseBlocker } from '../budget-review-utils';
import { formatList } from '../../../utils';
import { firstAndMore } from '../budget-review-utils';

/** A scope without a risk tolerance shows no per-scenario table, so the hint is the only place naming them. */
const outdatedScenarios = (names: ReadonlyArray<string>): string => {
  const { shown, more } = firstAndMore(names);
  const listed = more > 0 ? [...shown, plural(more, { one: '# more', other: '# more' })] : shown;
  return formatList(listed);
};

export const closeBlockerHint = (blocker: CloseBlocker | null, olderThanHeadlineNames: ReadonlyArray<string>): string | null => {
  switch (blocker) {
    case null: return null;
    case 'no-line': return t`Add at least one budget line before closing.`;
    case 'unpriced': return t`Re-simulate the scenarios first: closing freezes the figures as they stand.`;
    case 'outdated': {
      const scenarios = outdatedScenarios(olderThanHeadlineNames);
      return plural(olderThanHeadlineNames.length, {
        one: `Re-simulate the scenarios first: ${scenarios} changed since this review was priced.`,
        other: `Re-simulate the scenarios first: ${scenarios} changed since this review was priced.`,
      });
    }
  }
};

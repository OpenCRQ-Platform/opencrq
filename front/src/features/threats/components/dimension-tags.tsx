import { Chip, Icon } from '@filigran/design-system';
import { t } from '@lingui/core/macro';
import type { FunctionComponent, ReactElement } from 'react';
import { EmptyValue } from '../../../components/ui/empty-value';
import { cn } from '../../../utils';

export type DimensionKind = 'country' | 'sector';

interface DimensionTagsProps {
  values: Array<string>,
  matchedValue: string | null,
  kind: DimensionKind,
  variant?: 'table' | 'panel',
}

/**
 * How many tags the cell prints before it closes with a counter. The backend already returns the
 * matched value first, so the values the counter hides are the ones that did not match.
 */
const MAX_VISIBLE_TAGS = 2;

const matchPhrase = (kind: DimensionKind, value: string): string => (kind === 'country'
  ? t`${value}, which matches your risk scope's country`
  : t`${value}, which matches your risk scope's sector`);

// eslint-disable-next-line lingui/no-unlocalized-strings -- Tailwind class list, not copy
const TAG_CLASS = 'shrink-0 rounded border px-1.5 py-0.5 txt-sub-content';

/**
 * Country or sector values as tags, the matched one first and marked, the rest plain. Position
 * states the match before any decoration does, so the fade at the end of the cell can never swallow
 * the finding.
 */
export const DimensionTags: FunctionComponent<DimensionTagsProps> = ({ values, matchedValue, kind, variant }): ReactElement => {
  const selectedVariant = variant ?? 'table';
  if (values.length === 0) {
    return <EmptyValue />;
  }
  if (selectedVariant === 'panel') {
    return (
      <span className="flex flex-wrap items-center gap-2">
        {values.map((value) => {
          const isMatched = value === matchedValue;
          if (!isMatched) {
            return <Chip key={value} label={value} entity={kind === 'country' ? 'location' : undefined} />;
          }
          return (
            <span key={value} className="contents">
              <Chip
                aria-hidden="true"
                label={value}
                entity={kind === 'country' ? 'location' : undefined}
                startIcon={<Icon name="check" size={16} />}
              />
              <span className="sr-only">{matchPhrase(kind, value)}</span>
            </span>
          );
        })}
      </span>
    );
  }
  const visible = values.slice(0, MAX_VISIBLE_TAGS);
  const hiddenCount = values.length - visible.length;
  return (
    <span className="flex items-center gap-1 overflow-hidden">
      {/* The fade covers the tags only. Applied to the row it would swallow the counter, which is
          the one part that must survive: it is what says the cell is not showing everything. */}
      <span
        className={cn(
          'flex items-center gap-1 overflow-hidden',
          hiddenCount > 0 && '[mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)]',
        )}
      >
        {visible.map((value) => {
          const isMatched = value === matchedValue;
          return (
            <span
              key={value}
              className={cn(
                TAG_CLASS,
                isMatched
                  ? 'border-primary text-primary bg-[color-mix(in_srgb,hsl(var(--primary))_10%,transparent)]'
                  : 'border-border-light text-muted-foreground',
              )}
            >
              {isMatched
                ? (
                  <>
                    <span aria-hidden="true">{value}</span>
                    <span className="sr-only">{matchPhrase(kind, value)}</span>
                  </>
                )
                : value}
            </span>
          );
        })}
      </span>
      {hiddenCount > 0 && (
        <span className="shrink-0 txt-sub-content text-muted-foreground">+{hiddenCount}</span>
      )}
    </span>
  );
};

import { Button, Icon, Menu, MenuContent, MenuTrigger } from '@filigran/design-system';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent, ReactNode } from 'react';
import { cn } from '../../utils';

export { MenuItem as FilterPillItem, MenuLabel as FilterPillLabel, MenuSeparator as FilterPillSeparator } from '@filigran/design-system';

interface FilterPillProps {
  /** What the filter narrows on, shown alone while it is not set. */
  label: string,
  /** The value it is set to; absent while the filter lets every row through. */
  valueLabel?: string,
  /**
   * The whole pill text, for a set filter whose phrase a translator must see in one message ("Category:
   * except {category}"); defaults to "Label: value".
   */
  text?: string,
  /** The menu rows, `FilterPillItem` with `selected` on the current one. */
  children: ReactNode,
}

/**
 * One typed filter of a list toolbar: a pill that reads "Label" while unset and "Label: value" once
 * set, and opens its choices in a menu. Every records table draws its filters with it, so they look
 * and sit the same on each list (Design standards s.3).
 */
export const FilterPill: FunctionComponent<FilterPillProps> = ({ label, valueLabel, text: wholeText, children }) => {
  const active = valueLabel !== undefined;
  const text = active ? (wholeText ?? t`${label}: ${valueLabel}`) : label;

  return (
    <Menu>
      <MenuTrigger asChild>
        <Button
          type="button"
          priority="secondary"
          data-active={active || undefined}
          // The DS button wraps its children in an inline-flex span that keeps `min-width: auto`, so
          // both spans need `min-w-0` for a long value to be cut inside the pill, chevron included.
          className={cn('max-w-64 [&>span]:min-w-0', active && 'bg-filigran-brand-primary-transparency-10')}
          title={text}
          endIcon={<Icon name="chevron-down" size={16} aria-hidden />}
        >
          <span className="min-w-0 truncate">{text}</span>
        </Button>
      </MenuTrigger>
      <MenuContent align="start">
        {children}
      </MenuContent>
    </Menu>
  );
};

interface FilterClearAllProps {
  /** How many filters are set; nothing is drawn while none is. */
  count: number,
  onClearAll: () => void,
}

/** The active-filter count and the one action that lifts them all, after the filter pills. */
export const FilterClearAll: FunctionComponent<FilterClearAllProps> = ({ count, onClearAll }) => (
  count === 0
    ? null
    : (
      <span className="flex shrink-0 items-center gap-2">
        {/* The foreground token: muted-foreground reads 3.79:1 on the light surface, under WCAG AA's 4.5:1. */}
        <span className="txt-sub-content text-foreground" data-testid="filter-clear-all-count">
          {plural(count, { one: '# active filter', other: '# active filters' })}
        </span>
        <Button type="button" priority="tertiary" onClick={onClearAll}>
          <Trans>Clear all</Trans>
        </Button>
      </span>
    )
);

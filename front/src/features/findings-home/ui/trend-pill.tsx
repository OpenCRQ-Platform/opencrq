import type { IconName } from '@filigran/design-system';
import { Icon } from '@filigran/design-system';
import { i18n } from '@lingui/core';
import type { FunctionComponent } from 'react';
import type { TrendDirection } from '../findings-panel-utils';
import { cn } from '../../../utils';
import { formatNumber } from '../../../utils/format-number';
import { formatSignedDelta, resolveTrendDirection } from '../findings-panel-utils';

export const MARK_TONE_CLASSES: Record<TrendDirection, string> = {
  worse: 'text-[color:var(--fds-color-feedback-error-primary)]',
  better: 'text-[color:var(--fds-color-feedback-success-primary)]',
  flat: 'text-[color:var(--fds-text-default-secondary)]',
};

export const PILL_GROUND_CLASSES: Record<TrendDirection, string> = {
  worse: 'bg-[var(--fds-color-feedback-error-secondary-transparency-30)]',
  better: 'bg-[var(--fds-color-feedback-success-secondary-transparency-30)]',
  flat: 'bg-[var(--fds-bg-elevation-highlight-layer-0)]',
};

const MARK_ICON: Record<TrendDirection, IconName> = {
  worse: 'arrow-up',
  better: 'arrow-down',
  flat: 'arrow-right',
};

interface TrendMarkProps {
  delta: number,
  /**
   * False on a band tooltip, whose leading figure is a plain of-which-new count: there is no
   * previous stock to sign it against, and a sign would claim one.
   */
  signed: boolean,
}

/**
 * The arrow and the figure, tinted by direction. The glyph and the sign carry the direction on
 * their own, so the hue never has to.
 */
export const TrendMark: FunctionComponent<TrendMarkProps> = ({ delta, signed }) => {
  const direction = resolveTrendDirection(delta);
  const locale = i18n.locale || 'en';
  return (
    <span
      className={cn(
        // `align-middle` is load-bearing: an inline-flex box takes its baseline from its first
        // flex item, which here is an icon with no text baseline, so left alone the whole mark
        // rides above the sentence it opens inside a tooltip.
        'inline-flex items-center gap-1 whitespace-nowrap align-middle font-semibold tabular-nums',
        MARK_TONE_CLASSES[direction],
      )}
    >
      <Icon name={MARK_ICON[direction]} size={16} aria-hidden />
      {signed ? formatSignedDelta(delta, locale) : formatNumber(delta, locale)}
    </span>
  );
};

/** Read-only: an increase is bad news here, so it wears the error tint and a decrease the success one. */
export const TrendPill: FunctionComponent<{ delta: number }> = ({ delta }) => (
  <span
    className={cn(
      'inline-flex items-center self-center rounded-full px-[9px] py-[3px] text-[12px]',
      PILL_GROUND_CLASSES[resolveTrendDirection(delta)],
    )}
  >
    <TrendMark delta={delta} signed />
  </span>
);

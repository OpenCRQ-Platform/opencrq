import { t } from '@lingui/core/macro';
import type { FunctionComponent, ReactElement } from 'react';
import type { ResourceLevel } from './resource-level-utils';
import { RESOURCE_LEVELS, resourceLevelRank, toResourceLevel } from './resource-level-utils';

const levelLabel = (level: ResourceLevel): string => {
  switch (level) {
    case 'individual':
      return t`Individual`;
    case 'club':
      return t`Club`;
    case 'contest':
      return t`Contest`;
    case 'team':
      return t`Team`;
    case 'organization':
      return t`Organization`;
    case 'government':
      return t`Government`;
  }
};

/** The translated wording of a built-in level; a tenant's own value is printed as stored. */
export const resourceLevelLabel = (value: string): string => {
  const level = toResourceLevel(value);
  return level === null ? value : levelLabel(level);
};

const BAR_WIDTH = 2.4;
const BAR_STEP = 3.6;
const BAR_BOTTOM = 21;
const UNFILLED_OPACITY = 0.25;

interface ResourceLevelGaugeProps {
  value: string | null,
  size?: number,
  /** Hidden from assistive technology, for a place that already words the level next to the gauge. */
  decorative?: boolean,
}

/** Six rising bars, as many filled as the level's rank. Nothing is drawn for a value outside the six built-ins. */
export const ResourceLevelGauge: FunctionComponent<ResourceLevelGaugeProps> = ({ value, size, decorative }): ReactElement | null => {
  const rank = resourceLevelRank(value);
  if (rank === null || value === null) {
    return null;
  }
  const a11y = decorative ? { 'aria-hidden': true } : { 'role': 'img', 'aria-label': resourceLevelLabel(value) };
  return (
    <svg {...a11y} width={size ?? 24} height={size ?? 24} viewBox="0 0 24 24" className="shrink-0">
      {RESOURCE_LEVELS.map((level, index) => {
        const height = 4 + index * 3;
        const filled = index < rank;
        return (
          <rect
            key={level}
            data-filled={filled}
            x={2 + index * BAR_STEP}
            y={BAR_BOTTOM - height}
            width={BAR_WIDTH}
            height={height}
            rx={0.6}
            fill="currentColor"
            fillOpacity={filled ? 1 : UNFILLED_OPACITY}
          />
        );
      })}
    </svg>
  );
};

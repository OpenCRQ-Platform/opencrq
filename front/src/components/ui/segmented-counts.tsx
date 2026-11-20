import type { ReactNode } from 'react';
import { cn } from '../../utils';

export interface SegmentedCount {
  key: string,
  label: string,
  count: number,
}

interface SegmentedCountsProps {
  segments: Array<SegmentedCount>,
  value: string,
  onChange: (key: string) => void,
  /** Names what the whole group filters, since each segment only names its own slice. */
  ariaLabel: string,
}

/**
 * Counts that are also the filter: every segment states how many rows it would leave, so narrowing
 * a list is never a guess.
 */
export const SegmentedCounts = ({ segments, value, onChange, ariaLabel }: SegmentedCountsProps): ReactNode => (
  <div role="group" aria-label={ariaLabel} className="flex items-center gap-1 rounded-lg border p-0.5">
    {segments.map((segment) => {
      const isActive = segment.key === value;
      return (
        <button
          key={segment.key}
          type="button"
          aria-pressed={isActive}
          onClick={() => onChange(segment.key)}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2 py-1 txt-sub-content',
            isActive ? 'bg-primary/20 text-primary' : 'hover:bg-hover',
          )}
        >
          <span>{segment.label}</span>
          <span className="font-medium tabular-nums">{segment.count}</span>
        </button>
      );
    })}
  </div>
);

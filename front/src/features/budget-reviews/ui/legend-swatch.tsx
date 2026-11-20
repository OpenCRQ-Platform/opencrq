import type { FunctionComponent } from 'react';

export const LegendSwatch: FunctionComponent<{ color: string, dashed: boolean, label: string }> = ({ color, dashed, label }) => (
  <span className="inline-flex items-center gap-2 txt-sub-content text-default-secondary">
    <span
      aria-hidden="true"
      className="inline-block w-4"
      style={{ borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${color}` }}
    />
    {label}
  </span>
);

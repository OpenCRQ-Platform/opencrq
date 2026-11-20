import type { FunctionComponent, ReactNode } from 'react';
import { cn } from '../../../utils/cn';

interface DossierFieldProps {
  label: string,
  children: ReactNode,
  /** When the platform last refreshed the value, and from which feed. */
  freshness?: string,
  /** A `MetricInfo` when the label alone does not say where the value comes from. */
  info?: ReactNode,
  className?: string,
}

export const DossierField: FunctionComponent<DossierFieldProps> = ({ label, children, freshness, info, className }) => (
  <div className={cn('flex min-w-0 flex-col gap-1', className)}>
    <span className="flex items-center gap-1.5 font-content-caption text-content-caption uppercase tracking-[var(--fds-tracking-relaxed)] text-default-secondary">
      {label}
      {info}
    </span>
    <span className="flex flex-wrap items-center gap-2 font-content-base text-content-base">{children}</span>
    {freshness !== undefined && (
      <span className="font-content-caption text-content-caption text-default-secondary">{freshness}</span>
    )}
  </div>
);

/** Auto-fitting field grid, the same responsive posture as the score section's factor columns. */
export const DossierFieldGrid: FunctionComponent<{ children: ReactNode }> = ({ children }) => (
  <div className="grid gap-6 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">{children}</div>
);

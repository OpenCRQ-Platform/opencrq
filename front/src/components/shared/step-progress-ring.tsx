import type { FunctionComponent } from 'react';

const RADIUS = 14.5;

/**
 * A static ring filled to `fraction` (0 to 1), for the circle of a step that is under way. It fills its
 * `relative` parent and follows the parent's round shape; it never moves, whatever the reader's motion setting.
 */
export const StepProgressRing: FunctionComponent<{ fraction: number }> = ({ fraction }) => (
  <svg aria-hidden="true" viewBox="0 0 32 32" className="pointer-events-none absolute inset-0 size-full -rotate-90">
    <circle
      cx="16"
      cy="16"
      r={RADIUS}
      fill="none"
      strokeWidth="3"
      className="stroke-[color:var(--fds-color-feedback-alert-secondary-transparency-30)]"
    />
    <circle
      cx="16"
      cy="16"
      r={RADIUS}
      fill="none"
      strokeWidth="3"
      pathLength="100"
      strokeDasharray={`${Math.round(Math.min(1, Math.max(0, fraction)) * 100)} 100`}
      className="stroke-[color:var(--fds-color-feedback-alert-primary)]"
    />
  </svg>
);

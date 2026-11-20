import { Info, TriangleAlert } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';

type NoticeTone = 'warning' | 'info';

const TONES: Record<NoticeTone, { background: string, icon: string }> = {
  warning: { background: 'var(--fds-color-feedback-warning-secondary-transparency-30)', icon: 'var(--fds-color-feedback-warning-primary)' },
  info: { background: 'var(--fds-color-feedback-info-secondary-transparency-30)', icon: 'var(--fds-color-feedback-info-primary)' },
};

interface ReviewNoticeProps {
  children: ReactNode,
  action?: ReactNode,
  /** `warning` asks for an action, `info` states a limit nobody can act on. */
  tone?: NoticeTone,
}

export const ReviewNotice: FunctionComponent<ReviewNoticeProps> = ({ children, action, tone }) => {
  const colors = TONES[tone ?? 'warning'];
  const Icon = tone === 'info' ? Info : TriangleAlert;
  return (
    <div
      className="flex items-center justify-between gap-4 rounded-[var(--fds-radius-sm)] px-4 py-3"
      style={{ background: colors.background }}
    >
      <span className="flex items-center gap-2.5 txt-body2">
        <Icon aria-hidden="true" className="size-4 shrink-0" style={{ color: colors.icon }} />
        {children}
      </span>
      {action}
    </div>
  );
};

import { TriangleAlert } from 'lucide-react';
import type { FunctionComponent, ReactNode } from 'react';

export type ConnectorBannerSeverity = 'warning' | 'error';

/**
 * The page-level notice of a connector, rendered between the header and the tabs so it reaches every
 * tab. Reserved for a fact that makes the page's controls pointless until someone acts on it
 * elsewhere: anything the operator can simply read belongs in a card.
 */
export const ConnectorBanner: FunctionComponent<{
  severity: ConnectorBannerSeverity,
  title?: ReactNode,
  children: ReactNode,
}> = ({ severity, title, children }) => (
  <div
    className="flex items-start gap-2.5 rounded-[var(--fds-radius-sm)] px-5 py-3"
    style={{ background: `var(--fds-color-feedback-${severity}-secondary-transparency-30)` }}
  >
    <TriangleAlert
      className="mt-0.5 size-[18px] shrink-0"
      style={{ color: `var(--fds-color-feedback-${severity}-primary)` }}
    />
    <div className="font-content-base text-content-base">
      {title !== undefined && <p className="font-semibold">{title}</p>}
      <div>{children}</div>
    </div>
  </div>
);

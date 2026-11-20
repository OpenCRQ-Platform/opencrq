import type { FunctionComponent } from 'react';
import { TooltipHint } from '../../../components/shared';

/**
 * Initials of whoever wrote the row, or a connector's own icon when one is given; a connector and
 * a person share this anatomy.
 *
 * The name is nowhere else in the row, so it carries the accessible name and the trigger takes
 * focus: a hover-only tooltip would be the only way to learn who acted.
 */
export const HistoryAvatar: FunctionComponent<{ name: string, icon?: string | null }> = ({ name, icon }) => (
  <TooltipHint hint={name}>
    <span
      role="img"
      aria-label={name}
      tabIndex={0}
      className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full font-content-caption text-content-caption uppercase"
      style={{ background: icon ? undefined : 'var(--fds-bg-elevation-default-layer-2)' }}
    >
      {icon ? <img src={icon} alt="" className="h-full w-full rounded-full object-contain" /> : name.slice(0, 2)}
    </span>
  </TooltipHint>
);

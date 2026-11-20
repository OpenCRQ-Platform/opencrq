import { Icon, Paper, Text } from '@filigran/design-system';
import type { IconName } from '@filigran/design-system';
import type { FunctionComponent, ReactNode } from 'react';
import { useId } from 'react';
import type { TileTone } from './tile-tone';
import { tileTonePaint } from './tile-tone';

interface DashboardGroupProps {
  id?: string,
  icon: IconName,
  tone?: TileTone,
  title: string,
  info?: ReactNode,
  action?: ReactNode,
  children: ReactNode,
}

/** The cards a group holds take `elevation={2}`, one above it, so they read as held by it. */
export const DashboardGroup: FunctionComponent<DashboardGroupProps> = ({ id, icon, tone, title, info, action, children }) => {
  const titleId = useId();
  const paint = tileTonePaint(tone ?? 'brand');
  return (
    <Paper as="section" id={id} elevation={1} aria-labelledby={titleId} className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--fds-radius-sm)]"
          style={{ background: paint.fill, color: paint.glyph }}
        >
          <Icon name={icon} size={20} />
        </span>
        <Text variant="title-md" as="h2" id={titleId}>{title}</Text>
        {info}
        {action !== undefined && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </Paper>
  );
};

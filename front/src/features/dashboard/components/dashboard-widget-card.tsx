import { Card, CardHeader, CardTitle } from '@filigran/design-system';
import type { FunctionComponent, ReactNode } from 'react';

interface DashboardWidgetCardProps {
  title?: string,
  info?: ReactNode,
  action?: ReactNode,
  elevation?: 1 | 2 | 3,
  children: ReactNode,
}

export const DashboardWidgetCard: FunctionComponent<DashboardWidgetCardProps> = ({ title, info, action, elevation, children }) => (
  <Card elevation={elevation ?? 2} gap={16}>
    {title !== undefined && (
      <CardHeader action={action === undefined || action === null ? undefined : <span className="flex min-h-6 items-center">{action}</span>}>
        <CardTitle as="h3" endAdornment={info}>{title}</CardTitle>
      </CardHeader>
    )}
    {children}
  </Card>
);

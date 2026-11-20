import type { IconName } from '@filigran/design-system';
import { Card, CardTitle, Icon, Text } from '@filigran/design-system';
import type { FunctionComponent, ReactNode } from 'react';

interface SettingsCardProps {
  icon: IconName,
  title: string,
  chip?: ReactNode,
  children: ReactNode,
}

/** Fills its grid cell, so the cards of one grid row share a height. */
export const SettingsCard: FunctionComponent<SettingsCardProps> = ({ icon, title, chip, children }) => (
  <Card padding={16} gap={16} className="h-full min-w-0">
    <div className="flex min-h-6 items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <Icon name={icon} size={16} className="shrink-0 text-icon-highlight" aria-hidden />
        <CardTitle as="h2">{title}</CardTitle>
      </div>
      {chip}
    </div>
    {children}
  </Card>
);

interface SettingsFieldProps {
  label: ReactNode,
  children: ReactNode,
}

/** A label above a value row at least 32px tall, so the fields of a grid row line up across its cards. */
export const SettingsField: FunctionComponent<SettingsFieldProps> = ({ label, children }) => (
  <div className="flex min-w-0 flex-col gap-1.5">
    <Text as="div" variant="content-compact" className="flex items-center gap-1.5 text-default-secondary">{label}</Text>
    <div className="flex min-h-8 min-w-0 items-center *:min-w-0 *:flex-1">
      {typeof children === 'string' ? <Text as="p" variant="content-base">{children}</Text> : children}
    </div>
  </div>
);

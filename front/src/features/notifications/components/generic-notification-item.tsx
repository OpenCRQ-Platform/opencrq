import { i18n } from '@lingui/core';
import { Bell } from 'lucide-react';
import type { FunctionComponent } from 'react';
import { formatTimestamp } from '../../../utils';
import { parseMemberAdded } from '../member-added-notification';

interface GenericNotificationItemProps {
  notification: {
    type?: string,
    title: string,
    message: string,
    data?: unknown,
    read: boolean,
    createdAt: string,
  },
}

/** The stored title and message are English: a notification the front knows is rendered from its data instead. */
const displayedText = (notification: GenericNotificationItemProps['notification']): { title: string, message: string } => {
  const added = parseMemberAdded(notification);
  if (added === null) {
    return notification;
  }
  const { addedBy } = added;
  if (added.scope === 'tenant') {
    const { tenantName } = added;
    return {
      title: i18n._({ id: '{addedBy} added you to {tenantName}', message: '{addedBy} added you to {tenantName}', values: { addedBy, tenantName } }),
      message: i18n._({ id: 'You can now open {tenantName}.', message: 'You can now open {tenantName}.', values: { tenantName } }),
    };
  }
  const { groupNames } = added;
  return {
    title: i18n._({
      id: '{addedBy} added you to the platform administration ({groupNames})',
      message: '{addedBy} added you to the platform administration ({groupNames})',
      values: { addedBy, groupNames },
    }),
    message: i18n._({ id: 'You can now open the platform administration.', message: 'You can now open the platform administration.' }),
  };
};

export const GenericNotificationItem: FunctionComponent<GenericNotificationItemProps> = ({ notification }) => {
  const { title, message } = displayedText(notification);
  return (
    <div className="flex gap-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Bell className="size-4" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={`text-sm leading-tight ${notification.read ? 'font-normal' : 'font-semibold'}`}>
          {title}
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {message}
        </span>
        <span className="text-xs text-muted-foreground">
          {formatTimestamp(notification.createdAt)}
        </span>
      </div>
    </div>
  );
};

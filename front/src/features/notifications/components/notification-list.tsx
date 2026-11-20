import { Link } from '@tanstack/react-router';
import { Trans } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import type { FunctionComponent } from 'react';
import { useTRPC } from '../../../lib';
import { parseMemberAdded } from '../member-added-notification';
import { GenericNotificationItem } from './generic-notification-item';

interface Notification {
  id: string,
  type: string,
  title: string,
  message: string,
  data?: unknown,
  status: string,
  read: boolean,
  createdAt: string,
}

interface NotificationListProps {
  notifications: Array<Notification>,
  tenantId?: string,
  onNavigate?: () => void,
}

export const NotificationList: FunctionComponent<NotificationListProps> = ({ notifications, tenantId, onNavigate }) => {
  const trpc = useTRPC();
  const markAsRead = useMutation(trpc.notifications.markManyAsRead.mutationOptions({
    meta: { skipSuccessToast: true },
  }));

  if (notifications.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        <Trans>No new notifications</Trans>
      </div>
    );
  }

  const handleClick = (notification: Notification) => {
    if (!notification.read) {
      markAsRead.mutate({ ids: [notification.id] });
    }
    onNavigate?.();
  };

  return (
    <div className="max-h-[400px] overflow-y-auto">
      {notifications.map((notification) => {
        const genericContent = (
          <div
            className={`border-b px-4 py-3 last:border-b-0 ${notification.read ? '' : 'bg-primary/5'}`}
          >
            <GenericNotificationItem notification={notification} />
          </div>
        );

        const added = parseMemberAdded(notification);
        if (added?.scope === 'tenant') {
          return (
            <Link
              key={notification.id}
              to="/$tenantId/{-$organizationId}"
              params={{ tenantId: added.tenantId }}
              className="block transition-colors hover:bg-muted/50"
              onClick={() => handleClick(notification)}
            >
              {genericContent}
            </Link>
          );
        }

        if (tenantId) {
          return (
            <Link
              key={notification.id}
              to="/$tenantId/{-$organizationId}/notifications"
              params={{ tenantId }}
              className="block transition-colors hover:bg-muted/50"
              onClick={() => handleClick(notification)}
            >
              {genericContent}
            </Link>
          );
        }

        return <div key={notification.id}>{genericContent}</div>;
      })}
    </div>
  );
};

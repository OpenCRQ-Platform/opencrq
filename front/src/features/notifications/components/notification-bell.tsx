import { Button, IconButton } from '@filigran/design-system';
import { Popover, PopoverContent, PopoverTrigger } from '@filigran/ui';
import { Link } from '@tanstack/react-router';
import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { NotificationsOutlinedIcon } from '../../../components/shared/top-bar-icons';
import { useTRPC } from '../../../lib';
import { useOptionalTenant } from '../../../providers';
import { NotificationList } from './notification-list';

export const NotificationBell: FunctionComponent = () => {
  const trpc = useTRPC();
  const [open, setOpen] = useState(false);
  const tenantContext = useOptionalTenant();
  const close = () => setOpen(false);
  const { data: countData } = useQuery(trpc.notifications.getUnreadCount.queryOptions());
  const { data } = useQuery(trpc.notifications.getNotifications.queryOptions(
    { offset: 0, limit: 5 },
  ));

  const markAllAsRead = useMutation(trpc.notifications.markAllAsRead.mutationOptions({
    meta: { skipSuccessToast: true },
  }));

  const count = typeof countData === 'number' ? countData : 0;
  const items = data?.items ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <span className="relative inline-flex">
        <PopoverTrigger asChild>
          <IconButton
            priority="tertiary"
            aria-label={t`Notifications`}
            icon={<NotificationsOutlinedIcon />}
          />
        </PopoverTrigger>
        {count > 0 && (
          <span className="pointer-events-none absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-feedback-error-primary txt-mini font-bold text-negative-primary">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </span>
      <PopoverContent align="end" className="w-[380px] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h3 className="txt-category"><Trans>Notifications</Trans></h3>
          <Button
            priority="tertiary"
            size="sm"
            loading={markAllAsRead.isPending}
            disabled={count === 0}
            onClick={() => markAllAsRead.mutate()}
          >
            <Trans>Mark all as read</Trans>
          </Button>
        </div>

        <NotificationList notifications={items} tenantId={tenantContext?.tenantId} onNavigate={close} />

        {tenantContext && (
          <div className="border-t px-4 py-2 text-center">
            <Link
              to="/$tenantId/{-$organizationId}/notifications"
              params={{ tenantId: tenantContext.tenantId }}
              className="txt-sub-content text-muted-foreground hover:text-foreground"
              onClick={close}
            >
              <Trans>View all notifications</Trans>
            </Link>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

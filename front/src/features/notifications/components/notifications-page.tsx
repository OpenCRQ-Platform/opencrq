import { Button, Checkbox, Tabs, TabsList, TabsTrigger } from '@filigran/design-system';
import { Bell } from 'lucide-react';
import { plural, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import type { FunctionComponent } from 'react';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useUrlListFilters } from '../../../hooks';
import { useTRPC } from '../../../lib';
import { cn } from '../../../utils';
import { notificationsListSearchSchema } from '../notifications-list-search';
import { GenericNotificationItem } from './generic-notification-item';

const PAGE_SIZE = 20;

export const NotificationsPage: FunctionComponent = () => {
  const trpc = useTRPC();
  const { filters, setFilters } = useUrlListFilters(notificationsListSearchSchema);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const unreadOnly = filters.status === 'unread';
  const { data, isLoading } = useQuery(trpc.notifications.getNotifications.queryOptions(
    { offset: 0, limit, unreadOnly },
  ));

  const markManyAsRead = useMutation(trpc.notifications.markManyAsRead.mutationOptions({
    meta: { skipSuccessToast: true },
    onSuccess: () => {
      setSelected(new Set());
    },
  }));

  const markManyAsUnread = useMutation(trpc.notifications.markManyAsUnread.mutationOptions({
    meta: { skipSuccessToast: true },
    onSuccess: () => {
      setSelected(new Set());
    },
  }));

  const deleteMany = useMutation(trpc.notifications.deleteMany.mutationOptions({
    onSuccess: () => {
      setSelected(new Set());
    },
  }));

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const hasMore = data?.hasMore ?? false;
  const isBulkPending = markManyAsRead.isPending || markManyAsUnread.isPending || deleteMany.isPending;
  const selectedCount = selected.size;

  const allSelected = items.length > 0 && items.every((n) => selected.has(n.id));

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((n) => n.id)));
    }
  };

  const selectedIds = [...selected];

  const changeFilter = (value: string) => {
    setFilters({ status: value === 'unread' ? 'unread' : 'all' });
    setLimit(PAGE_SIZE);
    setSelected(new Set());
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1><Trans>Notifications</Trans></h1>
        {total > 0 && (
          <span className="txt-sub-content text-muted-foreground">
            {t({ message: plural(total, { one: '# notification', other: '# notifications' }) })}
          </span>
        )}
      </div>

      <Tabs
        value={filters.status}
        onValueChange={changeFilter}
      >
        <TabsList>
          <TabsTrigger value="all"><Trans>All</Trans></TabsTrigger>
          <TabsTrigger value="unread"><Trans>Unread</Trans></TabsTrigger>
        </TabsList>
      </Tabs>

      {items.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="flex size-4 shrink-0 items-center justify-center">
            <Checkbox
              checked={allSelected}
              onCheckedChange={toggleSelectAll}
              aria-label={t`Select all notifications`}
            />
          </div>
          <span className={`txt-mini text-muted-foreground ${selected.size === 0 ? 'invisible' : ''}`}>
            {t({ message: plural(selectedCount, { one: '# selected', other: '# selected' }) })}
          </span>
          <Button
            priority="secondary"
            size="sm"
            className={selected.size === 0 ? 'invisible' : ''}
            onClick={() => markManyAsRead.mutate({ ids: selectedIds })}
            disabled={isBulkPending || selected.size === 0}
          >
            <Trans>Mark as read</Trans>
          </Button>
          <Button
            priority="secondary"
            size="sm"
            className={selected.size === 0 ? 'invisible' : ''}
            onClick={() => markManyAsUnread.mutate({ ids: selectedIds })}
            disabled={isBulkPending || selected.size === 0}
          >
            <Trans>Mark as unread</Trans>
          </Button>
          <Button
            priority="secondary"
            size="sm"
            className={selected.size === 0 ? 'invisible' : ''}
            onClick={() => deleteMany.mutate({ ids: selectedIds })}
            disabled={isBulkPending || selected.size === 0}
          >
            <Trans>Delete</Trans>
          </Button>
        </div>
      )}

      {items.length === 0 && !isLoading ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <Bell className="size-12 opacity-20" />
          <p className="txt-sub-content">
            {filters.status === 'unread'
              ? t`You're all caught up! No unread notifications.`
              : t`You're all caught up! Enjoy the calm.`}
          </p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-2 pb-4">
            {items.map((notification) => (
              <div
                key={notification.id}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors',
                  notification.read ? 'bg-card hover:bg-muted/50' : 'bg-primary/5 hover:bg-primary/10',
                )}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (!notification.read) {
                    markManyAsRead.mutate({ ids: [notification.id] });
                  }
                }}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && !notification.read) {
                    e.preventDefault();
                    markManyAsRead.mutate({ ids: [notification.id] });
                  }
                }}
              >
                <div
                  className="flex size-4 shrink-0 items-center justify-center"
                  role="presentation"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Checkbox
                    checked={selected.has(notification.id)}
                    onCheckedChange={() => toggleSelect(notification.id)}
                    aria-label={t`Select notification`}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <GenericNotificationItem notification={notification} />
                </div>
              </div>
            ))}
            {hasMore && (
              <div className="flex justify-center py-2">
                <Button
                  priority="secondary"
                  onClick={() => setLimit((prev) => prev + PAGE_SIZE)}
                  disabled={isLoading}
                >
                  {isLoading ? t`Loading...` : t`Load more`}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

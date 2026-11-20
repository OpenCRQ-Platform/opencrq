import { useToast } from '@filigran/ui';
import { msg } from '@lingui/core/macro';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { i18n, trpcClient } from '../../lib';

const observer = new QueryObserver(new QueryClient(), {
  queryKey: [['health']],
  queryFn: () => trpcClient.health.query(),
  refetchInterval: 5_000,
  retry: 0,
});

export const HealthCheck = () => {
  const failedQueries = useRef(3);
  const toastIds = useRef<Array<string>>([]);
  const { toast, toasts } = useToast();
  useEffect(() => {
    toastIds.current = toasts.filter((t) => t.open).map((t) => t.id);
  }, [toasts]);
  const disconnectedToast = useRef<ReturnType<typeof toast>>(null);

  useEffect(() => {
    const unsubscribe = observer.subscribe((result) => {
      if (result.status === 'error' || result.data?.status === 'error') {
        failedQueries.current += 1;
        if (!toastIds.current.includes(disconnectedToast.current?.id ?? '') && failedQueries.current >= 3) {
          disconnectedToast.current = toast({
            variant: 'destructive',
            description: result.data?.status === 'error' ? i18n._(msg`The server has internal issues.`) : i18n._(msg`The server is not responding.`),
            duration: Infinity,
          });
        }
      } else if (result.status === 'success') {
        failedQueries.current = 0;
        disconnectedToast.current?.dismiss();
        disconnectedToast.current = null;
      }
    });
    return () => {
      unsubscribe();
    };
  }, [toast]);

  return null;
};

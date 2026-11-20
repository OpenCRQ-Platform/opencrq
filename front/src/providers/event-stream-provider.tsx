import type { FunctionComponent, ReactNode } from 'react';
import { useToast } from '@filigran/ui';
import { msg } from '@lingui/core/macro';
import { skipToken, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { useSubscription } from '@trpc/tanstack-react-query';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from '../features';
import { i18n, useTRPC } from '../lib';
import { createDoorbellGate, planDoorbellInvalidations } from './event-stream-utils';

// How long the stream may stay degraded before we warn the user. Kept short relative to the
// server inactivity window so a genuine outage surfaces quickly, while brief blips and silent
// socket re-creations (which resolve well within this window) stay banner-free.
const DESYNC_GRACE_MS = 5_000;
// Backoff bounds for re-subscribing after the SSE stream dies terminally — e.g. the backend
// restarted and the dev proxy answered the reconnect with an HTTP error, which the browser
// EventSource treats as fatal and will not retry on its own.
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 15_000;

const DoorbellHoldContext = createContext<() => () => void>(() => () => {});

/**
 * Holds the page's refreshes until 300 ms after the returned release is called, then refreshes once
 * for every doorbell rung meanwhile. Release it however the work ends: until then, or for up to 15 s, the page refreshes nothing.
 */
export const useHoldDoorbells = () => useContext(DoorbellHoldContext);

export const EventStreamProvider: FunctionComponent<{ children: ReactNode }> = ({ children }) => {
  const trpc = useTRPC();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isAuthenticated = auth.status === 'logged-in';

  const { tenantId } = useParams({ strict: false });

  const [doorbells] = useState(() => createDoorbellGate((doorbell) => {
    for (const invalidation of planDoorbellInvalidations(doorbell, document.visibilityState === 'hidden')) {
      // eslint-disable-next-line no-restricted-syntax -- this is the SSE doorbell mechanism itself; it is what every other invalidation in the app defers to.
      void queryClient.invalidateQueries(invalidation);
    }
  }));

  const reconnectAttempt = useRef(0);
  const [isAuthError, setIsAuthError] = useState(false);

  const { status, reset } = useSubscription(trpc.events.onDataChanged.subscriptionOptions(
    isAuthenticated ? { tenantId: tenantId ?? null } : skipToken,
    {
      onData: (doorbell) => {
        setIsAuthError(false);
        doorbells.ring(doorbell);
      },
      onError: (err) => {
        setIsAuthError(err.data?.code === 'UNAUTHORIZED' || err.data?.code === 'FORBIDDEN');
      },
    },
  ));
  // tRPC's SSE subscription does not recover from a terminal `error`: the stream throws and
  // stops for good (this is what a backend restart looks like through the dev proxy — the
  // reconnect attempt gets an HTTP error response, which EventSource treats as fatal). Drive
  // our own reconnect: on `error`, re-subscribe after a capped exponential backoff. The backoff
  // resets once we're connected again.
  useEffect(() => {
    if (status === 'pending') {
      reconnectAttempt.current = 0;
      return;
    }
    // Auth errors (UNAUTHORIZED / FORBIDDEN) mean the session is invalid — retrying will not
    // help and would spam the backend. The auth system will update isAuthenticated and flip
    // the subscription to skipToken on its own.
    if (status !== 'error' || isAuthError) {
      return;
    }
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** reconnectAttempt.current);
    const timer = setTimeout(() => {
      reconnectAttempt.current += 1;
      reset();
    }, delay);
    return () => clearTimeout(timer);
  }, [status, reset, isAuthError]);

  // Desync banner. Collapse the four-state status into healthy vs degraded so the grace timer
  // keeps ticking while the stream flaps between `connecting` and `error` during reconnect —
  // keying the effect on the raw status would reset the clock on every flap and never fire.
  const desyncToast = useRef<ReturnType<typeof toast> | null>(null);
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDegraded = useRef(false);
  // Whether we have already had a live connection. Lets us tell the first connect (queries fetch
  // on their own) from a re-connect (doorbells were missed while the stream was down — resync).
  const everConnected = useRef(false);

  const phase = status === 'pending' ? 'connected' : status === 'idle' ? 'idle' : 'degraded';

  useEffect(() => {
    const clearGrace = () => {
      if (graceTimer.current !== null) {
        clearTimeout(graceTimer.current);
        graceTimer.current = null;
      }
    };
    const dismissBanner = () => {
      desyncToast.current?.dismiss();
      desyncToast.current = null;
    };

    if (phase === 'connected') {
      clearGrace();
      if (isDegraded.current) {
        isDegraded.current = false;
        dismissBanner();
      }
      if (everConnected.current) {
        // Re-connect: catch up on doorbells missed while the stream was down, including the
        // silent-death case where the socket stayed open with no banner.
        for (const invalidation of planDoorbellInvalidations({ procedures: [], all: true }, document.visibilityState === 'hidden')) {
          // eslint-disable-next-line no-restricted-syntax -- this is the SSE doorbell mechanism's own reconnect resync; it is what every other invalidation in the app defers to.
          void queryClient.invalidateQueries(invalidation);
        }
      }
      everConnected.current = true;
      return;
    }

    if (phase === 'idle') {
      clearGrace();
      isDegraded.current = false;
      everConnected.current = false;
      dismissBanner();
      return;
    }

    // `degraded` (reconnecting or errored): arm the banner once the grace window elapses. No
    // cleanup that clears the timer here — `connecting` and `error` collapse to the same phase,
    // so this effect does not re-run between them and the grace clock survives the reconnect loop.
    if (isDegraded.current || graceTimer.current !== null) {
      return;
    }
    graceTimer.current = setTimeout(() => {
      graceTimer.current = null;
      isDegraded.current = true;
      desyncToast.current = toast({
        variant: 'destructive',
        description: i18n._(msg`Live updates are interrupted — displayed data may be out of date.`),
        duration: Infinity,
      });
    }, DESYNC_GRACE_MS);
  }, [phase, toast, queryClient]);

  // Drop a lingering banner and any pending grace timer if the provider itself unmounts.
  useEffect(() => () => {
    desyncToast.current?.dismiss();
    if (graceTimer.current !== null) {
      clearTimeout(graceTimer.current);
    }
  }, []);

  return <DoorbellHoldContext value={doorbells.hold}>{children}</DoorbellHoldContext>;
};

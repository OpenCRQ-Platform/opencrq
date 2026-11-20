import { SESSION_REVOKED_CHANNEL } from '@app/module';
import { createLogger } from '../../utils/logger';
import { startPgListenLoop } from '../../utils/pg-listen-loop';

const logger = createLogger({ feature: 'events' });

export interface SessionRevokedListenerOptions {
  signal: AbortSignal,
  onRevoke: (sessionId: string) => void,
  // Fired after each LISTEN handshake; the caller reconciles live streams to recover any
  // session_revoked NOTIFY dropped during the disconnect window.
  onListening?: () => void,
  reconnectDelayMs?: number,
}

// LISTEN session_revoked → tear down the live SSE stream bound to a revoked session immediately,
// instead of waiting for its periodic re-check. The payload is the bare session id, not JSON.
export const startSessionRevokedListener = (opts: SessionRevokedListenerOptions): Promise<void> =>
  startPgListenLoop<string>({
    channel: SESSION_REVOKED_CHANNEL,
    signal: opts.signal,
    parse: (payload) => payload,
    onNotify: (sessionId) => opts.onRevoke(sessionId),
    onListening: opts.onListening,
    reconnectDelayMs: opts.reconnectDelayMs,
    logger,
  });

import { Client } from 'pg';
import type { Logger } from './logger';
import { buildPgConnectionConfig } from './pg-connection';
import { sleep } from './utils';

const MAX_RECONNECT_DELAY_MS = 30_000;

export type PgListenChannel = 'data_changed' | 'jobs_changed' | 'session_revoked' | 'opencti_config_changed';

export interface PgListenLoopOptions<T> {
  channel: PgListenChannel,
  signal: AbortSignal,
  parse: (payload: string) => T,
  onNotify: (parsed: T) => void,
  // Fired after each LISTEN handshake; callers drain to catch up on NOTIFYs
  // dropped during the disconnect window.
  onListening?: () => void,
  reconnectDelayMs?: number,
  logger: Logger,
}

export const startPgListenLoop = async <T>({ channel, signal, parse, onNotify, onListening, reconnectDelayMs, logger }: PgListenLoopOptions<T>): Promise<void> => {
  const initialReconnectDelayMs = reconnectDelayMs ?? 1_000;
  let currentReconnectDelayMs = initialReconnectDelayMs;

  const swallowPlaceholderError = (err: Error) => {
    logger.logFromError(err, 'LISTEN client error (no active handler)');
  };

  const buildClient = (): Client => {
    const client = new Client(buildPgConnectionConfig());
    // Placeholder 'error' listener before connect() so an early socket error can't bubble to
    // uncaughtException and crash the worker. Swapped for the loop's own handler once connected.
    client.on('error', swallowPlaceholderError);
    return client;
  };

  while (!signal.aborted) {
    let client: Client | null = null;
    let onError: ((err: Error) => void) | null = null;
    let onEnd: (() => void) | null = null;
    let onNotification: ((msg: { channel: string, payload?: string }) => void) | null = null;
    try {
      client = buildClient();
      await client.connect();
      logger.logTrace(`LISTEN ${channel} connection established`);

      onNotification = (msg) => {
        if (msg.channel !== channel || !msg.payload) {
          return;
        }
        try {
          const parsed = parse(msg.payload);
          onNotify(parsed);
        } catch (err) {
          logger.logFromError(err, `Failed to parse ${channel} payload`, { payload: msg.payload });
        }
      };
      client.on('notification', onNotification);

      let resolveDisconnected!: () => void;
      const disconnected = new Promise<void>((resolve) => {
        resolveDisconnected = resolve;
      });
      onEnd = () => resolveDisconnected();
      onError = (err: Error) => {
        logger.logFromError(err, 'LISTEN client error');
        resolveDisconnected();
      };
      client.off('error', swallowPlaceholderError);
      client.on('end', onEnd);
      client.on('error', onError);

      await client.query(`LISTEN ${channel}`);
      // Connection is healthy — reset backoff for the next disconnect.
      currentReconnectDelayMs = initialReconnectDelayMs;

      try {
        onListening?.();
      } catch (err) {
        logger.logFromError(err, 'onListening callback threw');
      }

      const aborted = new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener('abort', () => resolve(), { once: true });
      });

      await Promise.race([disconnected, aborted]);
    } catch (err) {
      logger.logFromError(err, 'LISTEN listener loop error');
    } finally {
      if (client) {
        if (onError) {
          client.off('error', onError);
        }
        if (onEnd) {
          client.off('end', onEnd);
        }
        if (onNotification) {
          client.off('notification', onNotification);
        }
        client.on('error', swallowPlaceholderError);
        try {
          await client.end();
        } catch {
          // already ended or never connected
        }
      }
    }

    if (!signal.aborted) {
      logger.logTrace(`LISTEN ${channel} listener reconnecting in ${currentReconnectDelayMs}ms`);
      await sleep(currentReconnectDelayMs, signal);
      currentReconnectDelayMs = Math.min(currentReconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
    }
  }

  logger.logTrace(`LISTEN ${channel} listener stopped`);
};

import type { ChildProcess } from 'node:child_process';
import { createLogger } from './logger';

const { logError, logFromError } = createLogger({ engine: 'telemetry' });

interface MetricsCollectMessage {
  type: 'metrics-collect',
  roundId: string,
}

interface MetricsCollectedMessage {
  type: 'metrics-collected',
  roundId: string,
  text: string,
  oversized: boolean,
}

const isMetricsCollectMessage = (message: unknown): message is MetricsCollectMessage =>
  message !== null && typeof message === 'object'
  && 'type' in message && message.type === 'metrics-collect'
  && 'roundId' in message && typeof message.roundId === 'string';

const isMetricsCollectedMessage = (message: unknown): message is MetricsCollectedMessage =>
  message !== null && typeof message === 'object'
  && 'type' in message && message.type === 'metrics-collected'
  && 'roundId' in message && typeof message.roundId === 'string'
  && 'text' in message && typeof message.text === 'string'
  && 'oversized' in message && typeof message.oversized === 'boolean';

// Only send on a still-connected channel, and swallow a synchronous throw so a closing channel
// cannot escape. The boolean return lets the caller record a `send_error` outcome for the child.
export const sendMetricsCollect = (child: ChildProcess, roundId: string): boolean => {
  if (!child.connected) {
    return false;
  }
  try {
    child.send({ type: 'metrics-collect', roundId });
    return true;
  } catch (error) {
    logFromError(error, 'Error sending metrics-collect to child process', { roundId });
    return false;
  }
};

// Bounded before the document enters the channel: the parent re-checks it, but only once Node
// has buffered the frame the limit exists to reject. The flag travels instead of the text, so
// the parent still reports `oversized` rather than an empty collection.
export const sendMetricsSnapshot = (roundId: string, text: string, maxReplyBytes: number) => {
  const oversized = Buffer.byteLength(text, 'utf8') > maxReplyBytes;
  if (oversized) {
    logError('Metrics snapshot exceeds the configured maximum reply size; reporting it as oversized', { roundId, maxReplyBytes });
  }
  try {
    process.send?.({ type: 'metrics-collected', roundId, text: oversized ? '' : text, oversized });
  } catch (error) {
    logFromError(error, 'Error sending metrics-collected to parent process', { roundId });
  }
};

export const onMetricsCollect = (collect: (roundId: string) => Promise<void>) => (message: unknown) => {
  if (isMetricsCollectMessage(message)) {
    collect(message.roundId).catch((error: unknown) => {
      logFromError(error, 'Error collecting metrics snapshot', { roundId: message.roundId });
    });
  }
};

// Runs on an emitter, where a throw would become an uncaught exception.
export const onMetricsCollected = (handleReply: (roundId: string, text: string, oversized: boolean) => void) => (message: unknown) => {
  if (isMetricsCollectedMessage(message)) {
    try {
      handleReply(message.roundId, message.text, message.oversized);
    } catch (error) {
      logFromError(error, 'Error handling a metrics reply', { roundId: message.roundId });
    }
  }
};

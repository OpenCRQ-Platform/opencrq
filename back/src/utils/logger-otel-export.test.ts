import { InMemoryLogRecordExporter, SimpleLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { NodeSDK } from '@opentelemetry/sdk-node';
import * as winston from 'winston';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createLogger } from './logger';

vi.mock('../config', () => ({
  pmConfig: { telemetry: { observability: { otlp: { logs: { enabled: true } } } } },
  getProcessName: vi.fn(() => 'test'),
}));

const exporter = new InMemoryLogRecordExporter();
const processor = new SimpleLogRecordProcessor({ exporter });

// The real SDK, started after logger.ts has built its transport, the order tracing.ts imposes. The
// transport holds a proxy of its own copy of `@opentelemetry/api-logs`, which only the SDK's copy
// can fill: once the two release lines drift apart, every line is dropped without an error.
const sdk = new NodeSDK({
  instrumentations: [],
  resourceDetectors: [],
  spanProcessors: [],
  metricReaders: [],
  logRecordProcessors: [processor],
});

const isWriteCallback = (value: unknown): value is () => void => typeof value === 'function';

beforeAll(() => {
  vi.spyOn(winston.transports.Console.prototype, 'log').mockImplementation((...args: Array<unknown>) => {
    const [, next] = args;
    if (isWriteCallback(next)) {
      next();
    }
  });
  sdk.start();
});

afterAll(async () => {
  await sdk.shutdown();
});

describe('the OpenTelemetry log export', () => {
  it('should hand a line written through the logger to the SDK started after it', async () => {
    createLogger({ feature: 'otel-export-test' }).logError('A line for the collector');

    await processor.forceFlush();
    expect(exporter.getFinishedLogRecords().map((record) => record.body)).toContain('A line for the collector');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { probeTelemetryEndpoint } from './telemetry-probe';

describe('probeTelemetryEndpoint', () => {
  it('returns true when the collector answers 200', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ status: 200 });
    await expect(probeTelemetryEndpoint('https://telemetry.example/v1/metrics', // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock vi.fn() satisfies typeof fetch in practice
      fetchFn as unknown as typeof fetch)).resolves.toBe(true);
    expect(fetchFn).toHaveBeenCalledWith(
      'https://telemetry.example/v1/metrics',
      expect.objectContaining({ method: 'POST', body: '{}' }),
    );
  });

  it('returns false on a non-200 response (self-disable)', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ status: 404 });
    await expect(probeTelemetryEndpoint('https://telemetry.example/v1/metrics', // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock vi.fn() satisfies typeof fetch in practice
      fetchFn as unknown as typeof fetch)).resolves.toBe(false);
  });

  it('returns false when the endpoint is unreachable (self-disable)', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(probeTelemetryEndpoint('https://telemetry.example/v1/metrics', // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test mock vi.fn() satisfies typeof fetch in practice
      fetchFn as unknown as typeof fetch)).resolves.toBe(false);
  });
});

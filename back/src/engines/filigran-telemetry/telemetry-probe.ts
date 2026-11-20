const PROBE_TIMEOUT_MS = 10_000;

/**
 * Startup connectivity probe (OpenCTI model): POST an empty OTLP payload to
 * the collector and require an HTTP 200. When the collector is unreachable
 * (air-gapped install, egress blocked, collector down), telemetry
 * self-disables for the lifetime of the process instead of retrying and
 * logging export errors every cycle.
 */
export const probeTelemetryEndpoint = async (
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> => {
  try {
    const response = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return response.status === 200;
  } catch {
    return false;
  }
};

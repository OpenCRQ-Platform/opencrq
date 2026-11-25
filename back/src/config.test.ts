import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let rawConfig: Record<string, unknown>;

const nconfApi = {
  env: () => nconfApi,
  argv: () => nconfApi,
  file: () => nconfApi,
  get: (key?: string) => (key === undefined ? rawConfig : undefined),
};

vi.mock('nconf', () => ({ default: nconfApi }));

const baseConfig = (): Record<string, unknown> => ({
  healthcheck_http_server: { port: 8080 },
  process_manager: { profile: 'default', heartbeat_timeout: 1000 },
  xtm_one: {
    enabled: true,
    url: 'https://xtm-one.example.com',
    token: 'registration-token',
    platform_url: 'https://opencrq.example.com',
  },
});

const withObservability = (observability: Record<string, unknown>) => ({ ...baseConfig(), telemetry: { observability } });

const enabledPrometheus = async () => {
  rawConfig = withObservability({ prometheus: { enabled: true } });
  const { pmConfig } = await import('./config');
  const prometheus = pmConfig.telemetry?.observability.prometheus;
  if (!prometheus?.enabled) {
    throw new Error('Expected prometheus transport to be enabled');
  }
  return prometheus;
};

describe('pmConfig telemetry.observability', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('turns every transport off, names the service opencrq-platform and logs nothing when the observability block is omitted', async () => {
    rawConfig = { ...baseConfig(), telemetry: {} };
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { pmConfig } = await import('./config');
    if (!pmConfig.telemetry) {
      throw new Error('Expected the telemetry block to parse');
    }
    const { service_name: serviceName, otlp, prometheus, pyroscope, table_statistics: tableStatistics } = pmConfig.telemetry.observability;

    expect(serviceName).toBe('opencrq-platform');
    expect([otlp.traces.enabled, otlp.metrics.enabled, otlp.logs.enabled, prometheus.enabled, pyroscope.enabled, tableStatistics.enabled])
      .toEqual([false, false, false, false, false, false]);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('defaults the scrape port to 14269 when prometheus is enabled with no port set', async () => {
    const prometheus = await enabledPrometheus();

    expect(prometheus.port).toBe(14269);
  });

  it('defaults the collection timeout budget to 2500ms/4500ms when prometheus is enabled with no override', async () => {
    const prometheus = await enabledPrometheus();

    expect(prometheus.collect_timeout_ms).toBe(2_500);
    expect(prometheus.round_deadline_ms).toBe(4_500);
  });

  it('reads the table statistics every five minutes when they are enabled with no interval set', async () => {
    rawConfig = withObservability({ table_statistics: { enabled: true } });

    const { pmConfig } = await import('./config');
    const tableStatistics = pmConfig.telemetry?.observability.table_statistics;

    expect(tableStatistics).toEqual({ enabled: true, interval_ms: 300_000 });
  });

  it('keeps the two collection bounds distinguishable: the round deadline is not a multiple of the per-child timeout', async () => {
    const prometheus = await enabledPrometheus();

    expect(prometheus.collect_timeout_ms).toBeLessThan(prometheus.round_deadline_ms);
    expect(prometheus.round_deadline_ms % prometheus.collect_timeout_ms).not.toBe(0);
    expect(prometheus.round_deadline_ms).toBeLessThan(prometheus.min_interval_ms);
  });

  it.each([
    ['set', { otlp: { traces: { enabled: false, exporter: 'http://127.0.0.1:4317' } }, prometheus: { enabled: false, port: 14269 } }],
    ['left empty', { otlp: { logs: { enabled: false, exporter: '' } }, prometheus: { enabled: false, port: '' }, pyroscope: { enabled: false, server_address: '' } }],
  ])('boots with the settings of a transport turned off %s', async (_case, observability) => {
    rawConfig = withObservability(observability);

    const { pmConfig } = await import('./config');

    expect(pmConfig.telemetry?.observability.prometheus.enabled).toBe(false);
  });

  it('still refuses an unknown key beside a transport turned off', async () => {
    rawConfig = withObservability({ pyroscope: { enabled: false, address: 'http://127.0.0.1:4040' } });

    await expect(import('./config')).rejects.toThrow(/"address"/);
  });

  it.each([
    ['an empty port, which coerces to 0 and binds an ephemeral port', { prometheus: { enabled: true, port: '' } }],
    ['a fractional port, which throws out of server.listen', { prometheus: { enabled: true, port: '14269.5' } }],
    ['a port above the valid range', { prometheus: { enabled: true, port: '70000' } }],
    ['a reply size of 0, which rejects every reply', { prometheus: { enabled: true, max_reply_bytes: '0' } }],
    ['a negative per-child timeout, which fires on the next tick', { prometheus: { enabled: true, collect_timeout_ms: '-1' } }],
    ['a per-child timeout at or above the round deadline', { prometheus: { enabled: true, collect_timeout_ms: '5000', round_deadline_ms: '4000' } }],
    ['an empty OTLP destination, which silently dials the exporter default', { otlp: { metrics: { enabled: true, exporter: '' } } }],
    ['an enabled OTLP signal with no destination', { otlp: { traces: { enabled: true } } }],
    ['an empty Pyroscope address', { pyroscope: { enabled: true, server_address: '' } }],
    ['a malformed transport beside a valid one', { otlp: { metrics: { enabled: true, exporter: 'http://127.0.0.1:4317' } }, prometheus: { enabled: true, port: 'not-a-number' } }],
    ['a non-object otlp block', { otlp: null }],
    ['a table statistics interval short enough to read the size of every table every few seconds', { table_statistics: { enabled: true, interval_ms: '1000' } }],
  ])('refuses %s, and fails fast rather than booting with a configuration that disables the endpoint silently', async (_case, observability) => {
    rawConfig = withObservability(observability);

    await expect(import('./config')).rejects.toThrow();
  });

  it('throws a schema validation error, not a raw TypeError, when telemetry itself is a non-object value', async () => {
    rawConfig = { ...baseConfig(), telemetry: null };

    await expect(import('./config')).rejects.toThrow();
  });

  it.each([
    ['application_name', { application_name: 'opencrq-platform' }],
    ['tags', { tags: 'saas' }],
    ['traces', { traces: { enabled: true, exporter_otlp: 'http://127.0.0.1:4317' } }],
    ['metrics', { metrics: { otlp: { enabled: false } } }],
    ['logs', { logs: { enabled: false } }],
    ['pyroscope', { pyroscope: { enabled: false } }],
  ])('refuses the superseded telemetry.%s key, naming it, instead of dropping it', async (key, telemetry) => {
    rawConfig = { ...baseConfig(), telemetry };

    await expect(import('./config')).rejects.toThrow(new RegExp(`"${key}"`));
  });

  it('refuses a key unknown to a transport, naming it', async () => {
    rawConfig = withObservability({ otlp: { logs: { enabled: true, exporter_otlp: 'http://127.0.0.1:4317' } } });

    await expect(import('./config')).rejects.toThrow(/"exporter_otlp"/);
  });
});

describe('pmConfig feature_flags', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('defaults to no flag when the key is absent', async () => {
    rawConfig = baseConfig();

    const { pmConfig } = await import('./config');

    expect(pmConfig.feature_flags).toEqual([]);
  });

  it('parses a declared flag and the wildcard', async () => {
    rawConfig = { ...baseConfig(), feature_flags: ['*', 'enterprise-edition-status'] };

    const { pmConfig } = await import('./config');

    expect(pmConfig.feature_flags).toEqual(['*', 'enterprise-edition-status']);
  });

  it('fails the boot parse on a flag name absent from the registry', async () => {
    rawConfig = { ...baseConfig(), feature_flags: ['no-such-flag'] };

    await expect(import('./config')).rejects.toThrow();
  });

  it('parses the numeric-keyed object nconf builds from FEATURE_FLAGS__n', async () => {
    rawConfig = { ...baseConfig(), feature_flags: { 0: 'enterprise-edition-status', 1: '*' } };

    const { pmConfig } = await import('./config');

    expect(pmConfig.feature_flags).toEqual(['enterprise-edition-status', '*']);
  });

  it('parses the comma-separated string a single FEATURE_FLAGS env var reaches the schema as', async () => {
    rawConfig = { ...baseConfig(), feature_flags: 'enterprise-edition-status, *' };

    const { pmConfig } = await import('./config');

    expect(pmConfig.feature_flags).toEqual(['enterprise-edition-status', '*']);
  });

  it('fails the boot parse on an unknown name whatever the spelling it arrives in', async () => {
    rawConfig = { ...baseConfig(), feature_flags: { 0: 'no-such-flag' } };

    await expect(import('./config')).rejects.toThrow();
  });

  it('fails the boot parse on an object that is not the indexed form', async () => {
    rawConfig = { ...baseConfig(), feature_flags: { foo: 'enterprise-edition-status' } };

    await expect(import('./config')).rejects.toThrow();
  });
});

describe('pmConfig initial_tenant', () => {
  const DEFAULT_ID = '01a043da-ff47-72c2-aaa4-7da56d85c83e';
  const OTHER_ID = '0192f3b4-5c6d-7e8f-9a0b-1c2d3e4f5a6b';

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('defaults to the Default tenant with the default id when the block is absent', async () => {
    rawConfig = baseConfig();

    const { pmConfig } = await import('./config');

    expect(pmConfig.initial_tenant).toEqual({ id: DEFAULT_ID, name: 'Default' });
  });

  it('keeps a configured id and name as given', async () => {
    rawConfig = { ...baseConfig(), initial_tenant: { id: OTHER_ID, name: 'Acme Bank' } };

    const { pmConfig } = await import('./config');

    expect(pmConfig.initial_tenant).toEqual({ id: OTHER_ID, name: 'Acme Bank' });
  });

  it.each([
    ['only the name', { name: 'Acme Bank' }, { id: DEFAULT_ID, name: 'Acme Bank' }],
    ['only the id', { id: OTHER_ID }, { id: OTHER_ID, name: 'Default' }],
  ])('fills the other key with its default when %s is configured', async (_case, initialTenant, expected) => {
    rawConfig = { ...baseConfig(), initial_tenant: initialTenant };

    const { pmConfig } = await import('./config');

    expect(pmConfig.initial_tenant).toEqual(expected);
  });

  it('reads the number nconf parses an all-digit name into as that name', async () => {
    rawConfig = { ...baseConfig(), initial_tenant: { name: 2026 } };

    const { pmConfig } = await import('./config');

    expect(pmConfig.initial_tenant.name).toBe('2026');
  });

  it('trims the whitespace around the name', async () => {
    rawConfig = { ...baseConfig(), initial_tenant: { name: '  Acme  ' } };

    const { pmConfig } = await import('./config');

    expect(pmConfig.initial_tenant.name).toBe('Acme');
  });

  it('fails the boot parse on a blank name', async () => {
    rawConfig = { ...baseConfig(), initial_tenant: { name: '   ' } };

    await expect(import('./config')).rejects.toThrow(/"initial_tenant"[\s\S]*"name"/);
  });

  it('fails the boot parse on an id that is not a UUID', async () => {
    rawConfig = { ...baseConfig(), initial_tenant: { id: 'not-a-uuid' } };

    await expect(import('./config')).rejects.toThrow(/"initial_tenant"[\s\S]*"id"/);
  });
});

describe('pmConfig xtm_one', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const importConfigError = async (): Promise<string> => {
    try {
      await import('./config');
    } catch (error) {
      return String(error);
    }
    throw new Error('expected the config import to reject');
  };

  it('rejects naming the three env vars when the block is absent', async () => {
    const { xtm_one: _xtmOne, ...rest } = baseConfig();
    rawConfig = rest;

    const message = await importConfigError();

    expect(message).toContain('XTM_ONE__URL');
    expect(message).toContain('XTM_ONE__TOKEN');
    expect(message).toContain('XTM_ONE__PLATFORM_URL');
  });

  it('rejects naming the two missing variables, and not the one already set, on a partial block', async () => {
    rawConfig = { ...baseConfig(), xtm_one: { url: 'https://xtm-one.example.com' } };

    const message = await importConfigError();

    expect(message).toContain('XTM_ONE__TOKEN');
    expect(message).toContain('XTM_ONE__PLATFORM_URL');
    expect(message).not.toContain('XTM_ONE__URL');
  });

  it('rejects naming XTM_ONE__TOKEN when the token is blank', async () => {
    rawConfig = {
      ...baseConfig(),
      xtm_one: {
        url: 'https://xtm-one.example.com',
        token: '   ',
        platform_url: 'https://opencrq.example.com',
      },
    };

    const message = await importConfigError();

    expect(message).toContain('XTM_ONE__TOKEN');
  });

  it('says the token was read as a number, not that it is missing, when nconf parsed it into one', async () => {
    rawConfig = {
      ...baseConfig(),
      xtm_one: {
        url: 'https://xtm-one.example.com',
        token: 123456,
        platform_url: 'https://opencrq.example.com',
      },
    };

    const message = await importConfigError();

    expect(message).toContain('XTM_ONE__TOKEN was read as a number');
    expect(message).not.toContain('XTM One is required');
  });

  it('rejects naming XTM_ONE__ENABLED when it is set to false', async () => {
    rawConfig = {
      ...baseConfig(),
      xtm_one: {
        enabled: false,
        url: 'https://xtm-one.example.com',
        token: 'registration-token',
        platform_url: 'https://opencrq.example.com',
      },
    };

    const message = await importConfigError();

    expect(message).toContain('XTM_ONE__ENABLED');
  });

  it('parses enabled: true with a complete block', async () => {
    rawConfig = baseConfig();

    const { pmConfig } = await import('./config');

    expect(pmConfig.xtm_one).toMatchObject({
      enabled: true,
      url: 'https://xtm-one.example.com',
      token: 'registration-token',
      platform_url: 'https://opencrq.example.com',
    });
  });

  it('trims whitespace around each configured value', async () => {
    rawConfig = {
      ...baseConfig(),
      xtm_one: {
        url: '  https://xtm-one.example.com  ',
        token: '  registration-token  ',
        platform_url: '  https://opencrq.example.com  ',
      },
    };

    const { pmConfig } = await import('./config');

    expect(pmConfig.xtm_one).toMatchObject({
      url: 'https://xtm-one.example.com',
      token: 'registration-token',
      platform_url: 'https://opencrq.example.com',
    });
  });

  it('still requires the block in a development build', async () => {
    vi.stubGlobal('__DEVELOPMENT_BUILD__', true);
    const { xtm_one: _xtmOne, ...rest } = baseConfig();
    rawConfig = rest;

    const message = await importConfigError();

    expect(message).toContain('XTM One is required');
  });

  it('still rejects an incomplete block in a development build', async () => {
    vi.stubGlobal('__DEVELOPMENT_BUILD__', true);
    rawConfig = { ...baseConfig(), xtm_one: { url: 'https://xtm-one.example.com' } };

    const message = await importConfigError();

    expect(message).toContain('XTM_ONE__TOKEN');
  });
});

describe('pmConfig telemetry.usage', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it.each([
    ['on when telemetry.usage is omitted', {}, true],
    ['off when TELEMETRY__USAGE__ENABLED=false', { usage: { enabled: false } }, false],
  ])('is %s', async (_case, telemetry, enabled) => {
    rawConfig = { ...baseConfig(), telemetry };

    const { pmConfig } = await import('./config');

    expect(pmConfig.telemetry?.usage.enabled).toBe(enabled);
  });
});

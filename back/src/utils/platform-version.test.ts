import { afterEach, describe, expect, it, vi } from 'vitest';
import { imageRelease, imageVersion, platformVersion } from './platform-version';

describe('the platform version', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is no image version, reported as 0.0.0-dev, when APP_VERSION is unset, empty or blank', () => {
    for (const value of [undefined, '', '  ']) {
      vi.stubEnv('APP_VERSION', value);
      expect(imageVersion()).toBeUndefined();
      expect(platformVersion()).toBe('0.0.0-dev');
    }
  });

  it('is APP_VERSION trimmed, for the image and in what the platform reports', () => {
    vi.stubEnv('APP_VERSION', ' 0.261112.0-dev.0fed327 ');
    expect(imageVersion()).toBe('0.261112.0-dev.0fed327');
    expect(platformVersion()).toBe('0.261112.0-dev.0fed327');
  });
});

describe('the image release', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is the version with its commit date in Unix seconds', () => {
    vi.stubEnv('APP_VERSION', '0.261127.0-dev.0fed327');
    vi.stubEnv('APP_COMMIT_TIME', '2026-11-27T15:30:12+01:00');
    expect(imageRelease()).toEqual({ version: '0.261127.0-dev.0fed327', committedAt: Date.UTC(2026, 10, 27, 14, 30, 12) / 1_000 });
  });

  it('orders two builds of one day by their commits', () => {
    vi.stubEnv('APP_VERSION', '0.261127.0-dev.ffffff0');
    vi.stubEnv('APP_COMMIT_TIME', '2026-11-27T09:00:00Z');
    const morning = imageRelease();
    vi.stubEnv('APP_VERSION', '0.261127.0-dev.0000001');
    vi.stubEnv('APP_COMMIT_TIME', '2026-11-27T17:00:00Z');
    const evening = imageRelease();
    expect(evening!.committedAt).toBeGreaterThan(morning!.committedAt);
  });

  it('is none without a version, or without a readable commit date', () => {
    vi.stubEnv('APP_VERSION', '');
    vi.stubEnv('APP_COMMIT_TIME', '2026-11-27T09:00:00Z');
    expect(imageRelease()).toBeUndefined();
    vi.stubEnv('APP_VERSION', '0.261127.0');
    for (const value of [undefined, '', 'yesterday']) {
      vi.stubEnv('APP_COMMIT_TIME', value);
      expect(imageRelease()).toBeUndefined();
    }
  });
});

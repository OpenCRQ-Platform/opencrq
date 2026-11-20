import { afterEach, describe, expect, it, vi } from 'vitest';
import { imageVersion, platformVersion } from './platform-version';

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

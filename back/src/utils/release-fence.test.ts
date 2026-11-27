import { describe, expect, it } from 'vitest';
import { applicationNameFor } from './release-fence';

describe('the application name of a connection', () => {
  it('carries the commit date first, the version after', () => {
    expect(applicationNameFor({ version: '0.261127.0-dev.0fed327', committedAt: 1_764_250_212 })).toBe('opencrq:1764250212:0.261127.0-dev.0fed327');
  });

  it('carries no release for a process without one', () => {
    expect(applicationNameFor(undefined)).toBe('opencrq');
  });

  it('fits in what PostgreSQL keeps of it', () => {
    expect(applicationNameFor({ version: '0.261127.0-dev.0fed327', committedAt: 99_999_999_999 }).length).toBeLessThanOrEqual(63);
  });
});

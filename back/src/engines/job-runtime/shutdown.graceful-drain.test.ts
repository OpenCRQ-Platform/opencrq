import { describe, expect, it } from 'vitest';
import { createGracefulDrain } from './shutdown';

describe('createGracefulDrain', () => {
  it('returns immediately when no active jobs', async () => {
    const drain = createGracefulDrain({ size: () => 0 }, 5_000, 50);
    const start = Date.now();
    await drain();
    expect(Date.now() - start).toBeLessThan(200);
  });

  it('waits until activeJobs.size() reaches 0', async () => {
    let active = 3;
    const drain = createGracefulDrain({ size: () => active }, 5_000, 20);

    const drainPromise = drain();
    setTimeout(() => {
      active = 2;
    }, 50);
    setTimeout(() => {
      active = 0;
    }, 150);

    const start = Date.now();
    await drainPromise;
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(150);
    expect(elapsed).toBeLessThan(1_000);
  });

  it('returns after graceMs even if active jobs remain', async () => {
    const drain = createGracefulDrain({ size: () => 5 }, 300, 20);
    const start = Date.now();
    await drain();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(300);
    expect(elapsed).toBeLessThan(800);
  });
});

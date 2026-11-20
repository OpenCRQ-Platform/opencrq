import { describe, expect, it } from 'vitest';
import { drainEventCounter, EVENT_COUNTERS, incrementEventCounter } from './telemetry-events';

describe('telemetry event counters', () => {
  it('declares the user login counter', () => {
    expect(EVENT_COUNTERS.map(({ name }) => name)).toContain('user_login_count');
  });

  it('accumulates increments and resets on drain (per-export-window semantics)', () => {
    expect(drainEventCounter('test_counter')).toBe(0);

    incrementEventCounter('test_counter');
    incrementEventCounter('test_counter');
    incrementEventCounter('test_counter', 3);
    expect(drainEventCounter('test_counter')).toBe(5);

    // Drained: the next export window starts from zero.
    expect(drainEventCounter('test_counter')).toBe(0);

    incrementEventCounter('test_counter');
    expect(drainEventCounter('test_counter')).toBe(1);
  });
});

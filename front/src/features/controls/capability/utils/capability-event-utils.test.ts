import { describe, expect, it } from 'vitest';
import type { CapabilityEvent } from '../types/capability';
import { eventAxisMoves } from './capability-event-utils';

type Fields = Pick<
  CapabilityEvent,
  | 'organizationId' | 'type' | 'oldStrength' | 'newStrength' | 'oldCoverage' | 'newCoverage'
  | 'strengthMode' | 'coverageMode'
>;

const event = (overrides: Partial<Fields>): Fields => ({
  organizationId: null,
  type: 'assessment_set',
  oldStrength: null,
  newStrength: 'L1',
  oldCoverage: null,
  newCoverage: 'L1',
  strengthMode: null,
  coverageMode: null,
  ...overrides,
});

describe('eventAxisMoves', () => {
  it('lists the axes a first assessment sets, with no value before them', () => {
    expect(eventAxisMoves(event({ newStrength: 'L2', newCoverage: 'L1', strengthMode: 'auto' }))).toEqual([
      { axis: 'strength', hasBefore: false, from: null, to: 'L2', toMode: 'auto' },
      { axis: 'coverage', hasBefore: false, from: null, to: 'L1', toMode: null },
    ]);
  });

  it('keeps a switch that left the value where it was, and leaves the untouched axes out', () => {
    expect(eventAxisMoves(event({ type: 'sources_changed', oldStrength: 'L1', oldCoverage: 'L2', newCoverage: 'L2', coverageMode: 'manual' }))).toEqual([
      { axis: 'coverage', hasBefore: true, from: 'L2', to: 'L2', toMode: 'manual' },
    ]);
  });

  it('lists every axis a save moved together', () => {
    expect(eventAxisMoves(event({
      type: 'assessment_change', oldStrength: 'L2', newStrength: 'L3', oldCoverage: 'L3', newCoverage: 'L2', strengthMode: 'manual',
    })).map((move) => move.axis)).toEqual(['strength', 'coverage']);
  });

  it('moves a scope axis whenever its declaration changes, a return to the tenant included', () => {
    expect(eventAxisMoves(event({ organizationId: 'scope-1', oldStrength: 'L1', newStrength: null, newCoverage: null }))).toEqual([
      { axis: 'strength', hasBefore: true, from: 'L1', to: null, toMode: null },
    ]);
  });
});

import { i18n } from '@lingui/core';
import { beforeEach, describe, expect, it } from 'vitest';
import type { EventSentenceFields } from './capability-event-sentence';
import { capabilityEventHeadline, capabilityEventSentence } from './capability-event-sentence';

beforeEach(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

const event = (overrides: Partial<EventSentenceFields>): EventSentenceFields => ({
  organizationId: null,
  userId: 'u1',
  connector: null,
  type: 'assessment_set',
  oldStrength: null,
  newStrength: 'L1',
  oldCoverage: null,
  newCoverage: 'L1',
  strengthMode: null,
  coverageMode: null,
  ...overrides,
});

describe('capabilityEventSentence, tenant lines', () => {
  it('names both derived axes cleared as the assessment cleared', () => {
    const cleared = event({ type: 'assessment_cleared', oldStrength: 'L2', newStrength: null, oldCoverage: 'L2', newCoverage: null });
    expect(capabilityEventSentence(cleared)).toBe('Assessment cleared: no source feeds it any more.');
  });

  it('names a first assessment', () => {
    expect(capabilityEventSentence(event({}))).toBe('Assessment created.');
  });

  it('names a strength move from one rung to the other', () => {
    expect(capabilityEventSentence(event({ type: 'strength_change', oldStrength: 'L1', newStrength: 'L2' })))
      .toBe('Strength changed from Basic to Intermediate.');
  });

  it('names a coverage move from one bucket to the other', () => {
    expect(capabilityEventSentence(event({ type: 'coverage_change', oldCoverage: 'L1', newCoverage: 'L3' })))
      .toBe('Coverage changed from Partial to Full.');
  });

  it('names a move of both axes', () => {
    expect(capabilityEventSentence(event({ type: 'assessment_change' }))).toBe('Strength and coverage updated.');
  });

  it('tells a hand declaration, a re-attach and a source change apart', () => {
    expect(capabilityEventSentence(event({ type: 'sources_changed' }))).toBe('Declared by hand at the value it held.');
    expect(capabilityEventSentence(event({ type: 'sources_changed', connector: 'derivation' }))).toBe('Re-attached to its sources.');
    expect(capabilityEventSentence(event({ type: 'sources_changed', connector: 'derivation', userId: null })))
      .toBe('Derivation sources updated.');
  });

  it('tells a partial clearing from a full one', () => {
    expect(capabilityEventSentence(event({ type: 'assessment_cleared', newStrength: null, newCoverage: null })))
      .toBe('Assessment cleared: no source feeds it any more.');
    expect(capabilityEventSentence(event({ type: 'assessment_cleared', newStrength: null, newCoverage: 'L1' })))
      .toBe('Strength cleared: no source feeds it any more.');
    expect(capabilityEventSentence(event({ type: 'assessment_cleared', newStrength: 'L2', newCoverage: null })))
      .toBe('Coverage cleared: no source feeds it any more.');
  });
});

describe('capabilityEventSentence, scope lines', () => {
  const scope = (overrides: Partial<EventSentenceFields>) => event({ organizationId: 'org', ...overrides });

  it('names an override of an axis the scope followed the tenant on', () => {
    expect(capabilityEventSentence(scope({ newStrength: 'L3', newCoverage: null }))).toBe('Strength overridden to Master.');
    expect(capabilityEventSentence(scope({ newStrength: null, newCoverage: 'L2' }))).toBe('Coverage overridden to Broad.');
  });

  it('names a move between two declared values', () => {
    expect(capabilityEventSentence(scope({ oldStrength: 'L1', newStrength: 'L2', newCoverage: null })))
      .toBe('Strength changed from Basic to Intermediate.');
  });

  it('names an axis handed back to the tenant', () => {
    expect(capabilityEventSentence(scope({ oldStrength: 'L1', newStrength: null, newCoverage: null })))
      .toBe('Strength returned to the tenant value.');
    expect(capabilityEventSentence(scope({ oldCoverage: 'L3', newCoverage: null, newStrength: null })))
      .toBe('Coverage returned to the tenant value.');
  });

  it('names a move of both axes at once', () => {
    expect(capabilityEventSentence(scope({}))).toBe('Strength and coverage updated.');
  });
});

describe('capabilityEventSentence, switches of mode', () => {
  it('names a strength detached from its sources with the value declared', () => {
    expect(capabilityEventSentence(event({
      type: 'strength_change', oldStrength: 'L1', newStrength: 'L2', oldCoverage: 'L1', strengthMode: 'manual',
    }))).toBe('Strength detached from its sources (Basic → Intermediate).');
  });

  it('names a switch that leaves the value where it was', () => {
    expect(capabilityEventSentence(event({
      type: 'sources_changed', oldStrength: 'L1', oldCoverage: 'L1', coverageMode: 'manual',
    }))).toBe('Coverage detached from its sources.');
  });

  it('names a first save re-attaching strength as not assessed before, not derived', () => {
    expect(capabilityEventSentence(event({
      type: 'assessment_change', connector: 'derivation', newStrength: 'L2', newCoverage: 'L1', strengthMode: 'auto',
    }))).toBe('Strength re-attached to its sources (Not assessed → Intermediate).');
  });

  it('names several axes switched together', () => {
    expect(capabilityEventSentence(event({
      type: 'assessment_change', connector: 'derivation', oldStrength: 'L3', oldCoverage: 'L3', strengthMode: 'auto', coverageMode: 'auto',
    }))).toBe('Strength and coverage re-attached to their sources.');
    expect(capabilityEventSentence(event({
      type: 'assessment_change', oldStrength: 'L1', oldCoverage: 'L1', strengthMode: 'manual', coverageMode: 'manual',
    }))).toBe('Strength and coverage detached from their sources.');
    expect(capabilityEventSentence(event({ type: 'assessment_change', oldStrength: 'L1', oldCoverage: 'L1', coverageMode: 'manual' })))
      .toBe('Coverage detached from its sources.');
  });

  it('keeps the value sentence for a change on an axis that stays manual', () => {
    expect(capabilityEventSentence(event({ type: 'strength_change', oldStrength: 'L1', newStrength: 'L2' })))
      .toBe('Strength changed from Basic to Intermediate.');
  });
});

describe('capabilityEventHeadline', () => {
  it('drops the values a value change and a switch name', () => {
    expect(capabilityEventHeadline(event({ type: 'coverage_change', oldCoverage: 'L1', newCoverage: 'L3' }))).toBe('Coverage changed.');
    expect(capabilityEventHeadline(event({
      type: 'strength_change', oldStrength: 'L1', newStrength: 'L2', oldCoverage: 'L1', strengthMode: 'manual',
    }))).toBe('Strength detached from its sources.');
  });

  it('drops the values of a scope override and a scope change', () => {
    expect(capabilityEventHeadline(event({ organizationId: 'org', newStrength: 'L3', newCoverage: null }))).toBe('Strength overridden.');
    expect(capabilityEventHeadline(event({ organizationId: 'org', oldStrength: 'L1', newStrength: 'L2', newCoverage: null }))).toBe('Strength changed.');
  });

  it('keeps a sentence that names no value', () => {
    expect(capabilityEventHeadline(event({}))).toBe('Assessment created.');
  });
});

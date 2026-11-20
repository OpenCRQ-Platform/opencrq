import { describe, expect, it } from 'vitest';
import type { StatedActorAttributes } from './canonical';
import { deriveCanonicalAnalysis } from './canonical';

const stated = (overrides: Partial<StatedActorAttributes> & { stixId: string }): StatedActorAttributes => ({
  entityType: 'intrusion-set',
  name: 'Salt Typhoon',
  description: null,
  mitreGroupId: null,
  confidence: null,
  stixCreated: null,
  firstSeen: null,
  lastSeen: null,
  primaryMotivation: null,
  resourceLevel: null,
  sophistication: null,
  objective: null,
  actorClass: null,
  ...overrides,
});

describe('deriveCanonicalAnalysis', () => {
  it('should carry the stated attributes onto the actor row', () => {
    const attributes = stated({
      stixId: 'intrusion-set--opencti',
      description: 'Chinese state-sponsored espionage group.',
      mitreGroupId: 'G1045',
      confidence: 85,
      stixCreated: new Date('2023-01-15T00:00:00.000Z'),
      firstSeen: new Date('2023-06-01T00:00:00.000Z'),
      lastSeen: new Date('2025-11-01T00:00:00.000Z'),
      primaryMotivation: 'organizational-gain',
      resourceLevel: 'government',
      sophistication: ' expert ',
      objective: 'Steal telecom call records',
      actorClass: 'state_sponsored',
    });

    expect(deriveCanonicalAnalysis(attributes)).toEqual({
      stixId: 'intrusion-set--opencti',
      entityType: 'intrusion-set',
      name: 'Salt Typhoon',
      description: 'Chinese state-sponsored espionage group.',
      mitreGroupId: 'G1045',
      confidence: 85,
      stixCreated: new Date('2023-01-15T00:00:00.000Z'),
      firstSeen: new Date('2023-06-01T00:00:00.000Z'),
      lastSeen: new Date('2025-11-01T00:00:00.000Z'),
      primaryMotivation: 'organizational-gain',
      resourceLevel: 'government',
      sophistication: 'expert',
      objective: 'Steal telecom call records',
      actorClass: 'state_sponsored',
    });
  });

  it('should fall back to the default class when the labels derived none', () => {
    expect(deriveCanonicalAnalysis(stated({ stixId: 'intrusion-set--unclassified' })).actorClass).toBe('default');
  });

  it('should read a blank attribute as absent', () => {
    const blank = stated({
      stixId: 'intrusion-set--blank',
      description: '   ',
      mitreGroupId: '',
      primaryMotivation: '',
      resourceLevel: ' ',
    });

    const canonical = deriveCanonicalAnalysis(blank);

    expect(canonical.description).toBeNull();
    expect(canonical.mitreGroupId).toBeNull();
    expect(canonical.primaryMotivation).toBeNull();
    expect(canonical.resourceLevel).toBeNull();
  });

  // The actor row is what the rest of the platform joins and filters on, so a padded claim has
  // to be promoted without its padding or it matches nothing.
  it('should promote a padded attribute trimmed', () => {
    const padded = stated({
      stixId: 'intrusion-set--padded',
      mitreGroupId: ' G1045 ',
      description: '  Real actor.  ',
    });

    const canonical = deriveCanonicalAnalysis(padded);

    expect(canonical.mitreGroupId).toBe('G1045');
    expect(canonical.description).toBe('Real actor.');
  });
});

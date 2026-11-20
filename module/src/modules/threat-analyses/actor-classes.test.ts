import { describe, expect, it } from 'vitest';
import {
  ACTOR_CLASS_PRESETS,
  ACTOR_CLASS_VALUES,
  deriveActorClass,
  resolveEffectiveActorClass,
} from './actor-classes';

describe('deriveActorClass', () => {
  it('derives each class from its label markers, across separator and casing variants', () => {
    expect(deriveActorClass(['State-Sponsored'], null)).toBe('state_sponsored');
    expect(deriveActorClass(['nation state actor'], null)).toBe('state_sponsored');
    expect(deriveActorClass(['Ransomware-as-a-service'], null)).toBe('ransomware_operator');
    expect(deriveActorClass(['double extortion'], null)).toBe('ransomware_operator');
    expect(deriveActorClass(['hacktivism'], null)).toBe('hacktivist');
    expect(deriveActorClass(['crimeware'], null)).toBe('opportunistic_crime');
    expect(deriveActorClass(['cyber-crime'], null)).toBe('opportunistic_crime');
  });

  it('lets the strongest capability signal win among labels', () => {
    expect(deriveActorClass(['ransomware', 'state-sponsored'], null)).toBe('state_sponsored');
    expect(deriveActorClass(['hacktivism', 'ransomware'], null)).toBe('ransomware_operator');
  });

  it('falls back to the resource level when labels carry no signal', () => {
    expect(deriveActorClass([], 'government')).toBe('state_sponsored');
    expect(deriveActorClass(['espionage'], 'Government')).toBe('state_sponsored');
    expect(deriveActorClass([], 'individual')).toBe('opportunistic_crime');
    expect(deriveActorClass([], 'club')).toBe('opportunistic_crime');
  });

  it('lets a label outrank the resource level', () => {
    expect(deriveActorClass(['ransomware'], 'government')).toBe('ransomware_operator');
  });

  it('answers no signal when neither labels nor resource level carry one', () => {
    expect(deriveActorClass([], null)).toBeNull();
    expect(deriveActorClass(['espionage'], 'organization')).toBeNull();
    expect(deriveActorClass([], 'team')).toBeNull();
  });
});

describe('the actor-class presets', () => {
  it('fix every knob for each of the five classes', () => {
    expect(Object.keys(ACTOR_CLASS_PRESETS).sort()).toEqual([...ACTOR_CLASS_VALUES].sort());
    for (const [actorClass, preset] of Object.entries(ACTOR_CLASS_PRESETS)) {
      for (const knob of ['capability', 'patience', 'stealth'] as const) {
        expect(preset[knob], `${actorClass}.${knob}`).toBeGreaterThanOrEqual(0);
        expect(preset[knob], `${actorClass}.${knob}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('orders the classes as the model states: state sponsored highest, opportunistic lowest', () => {
    const { state_sponsored, opportunistic_crime } = ACTOR_CLASS_PRESETS;
    for (const preset of Object.values(ACTOR_CLASS_PRESETS)) {
      expect(state_sponsored.capability).toBeGreaterThanOrEqual(preset.capability);
      expect(state_sponsored.patience).toBeGreaterThanOrEqual(preset.patience);
      expect(opportunistic_crime.capability).toBeLessThanOrEqual(preset.capability);
    }
  });

});

describe('resolveEffectiveActorClass', () => {
  it('reads the manual pin over the derived class', () => {
    expect(resolveEffectiveActorClass({ actorClass: 'default', actorClassOverride: 'hacktivist' })).toBe('hacktivist');
    expect(resolveEffectiveActorClass({ actorClass: 'state_sponsored', actorClassOverride: null })).toBe('state_sponsored');
  });
});

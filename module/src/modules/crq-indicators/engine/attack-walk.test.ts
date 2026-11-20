import { describe, expect, it } from 'vitest';
import type { AttackerState } from './walk-resolver';
import { ATTACK_OUTCOMES } from '../../attack-outcomes/data/attack-outcomes-data';
import { mitreTacticsData } from '../../mitre-attack/data/mitre-tactics';
import { mitreTechniquesData } from '../../mitre-attack/data/mitre-techniques';
import {
  ATTACK_WALK_TABLES_RELEASE,
  ATTACKER_FACTS,
  PRE_COMPROMISE_TACTIC_EXTERNAL_IDS,
  RESOURCE_TOUCHING_TACTIC_EXTERNAL_IDS,
  TACTIC_WALK_RULES,
  TECHNIQUE_WALK_EXCEPTIONS,
} from './attack-walk';
import {
  EMPTY_ATTACKER_STATE,
  grantEffects,
  isActionPlayable,
  isObjectiveReached,
  playableTactics,
  walkRuleFor,
} from './walk-resolver';

const ruleFor = (tacticExternalId: string) => {
  const rule = TACTIC_WALK_RULES.find((candidate) => candidate.tacticExternalId === tacticExternalId);
  if (rule === undefined) {
    throw new Error(`No walk rule for ${tacticExternalId}`);
  }
  return rule;
};

/**
 * Plays every playable non-terminal tactic until no new fact appears, then returns the closure:
 * whatever the table alone lets an attacker reach from the given exclusions.
 */
const walkToClosure = (excludedTacticExternalIds: ReadonlyArray<string> = []): { state: AttackerState, succeeded: Array<string> } => {
  let state = EMPTY_ATTACKER_STATE;
  const succeeded: Array<string> = [];
  for (;;) {
    const next = playableTactics(state)
      .filter((tacticExternalId) => !ruleFor(tacticExternalId).terminal)
      .filter((tacticExternalId) => !excludedTacticExternalIds.includes(tacticExternalId))
      .filter((tacticExternalId) => !succeeded.includes(tacticExternalId));
    if (next.length === 0) {
      return { state, succeeded };
    }
    for (const tacticExternalId of next) {
      state = grantEffects(state, tacticExternalId);
      succeeded.push(tacticExternalId);
    }
  }
};

describe('the prerequisites and effects table', () => {
  it('covers every vendored tactic except the pre-compromise ones, exactly once', () => {
    const covered = TACTIC_WALK_RULES.map((rule) => rule.tacticExternalId);
    expect(new Set(covered).size).toBe(covered.length);
    expect([...covered, ...PRE_COMPROMISE_TACTIC_EXTERNAL_IDS].sort())
      .toEqual(mitreTacticsData.map((tactic) => tactic.externalId).sort());
  });

  it('states the reference prerequisites and effects', () => {
    expect(ruleFor('TA0001')).toMatchObject({ requires: [], grants: ['foothold'] });
    expect(ruleFor('TA0004')).toMatchObject({ requires: ['foothold'], grants: ['credentials'] });
    expect(ruleFor('TA0006')).toMatchObject({ requires: ['foothold'], grants: ['credentials'] });
    expect(ruleFor('TA0007')).toMatchObject({ requires: ['foothold'], grants: ['knowledge'] });
    expect(ruleFor('TA0008')).toMatchObject({ requires: ['foothold', 'credentials', 'knowledge'], grants: ['deep_access'] });
    expect(ruleFor('TA0009')).toMatchObject({ requires: ['deep_access'], grants: ['gathered_data'] });
    expect(ruleFor('TA0010')).toMatchObject({ requires: ['gathered_data'], grants: [], terminal: true });
    expect(ruleFor('TA0040')).toMatchObject({ requires: ['deep_access'], grants: [], terminal: true });
  });

  it('grants only the five facts and requires only the five facts', () => {
    for (const rule of TACTIC_WALK_RULES) {
      for (const fact of [...rule.requires, ...rule.grants]) {
        expect(ATTACKER_FACTS).toContain(fact);
      }
    }
  });

  it('carries the ATT&CK release it was written against', () => {
    expect(ATTACK_WALK_TABLES_RELEASE).toMatch(/attack-enterprise-\d/);
  });

  it('carries the T1078 exception against a live vendored technique', () => {
    expect(TECHNIQUE_WALK_EXCEPTIONS['T1078']).toEqual({ requires: ['credentials'], grants: ['foothold'], terminal: false });
    for (const techniqueExternalId of Object.keys(TECHNIQUE_WALK_EXCEPTIONS)) {
      const technique = mitreTechniquesData.find((candidate) => candidate.externalId === techniqueExternalId);
      expect(technique?.revoked, techniqueExternalId).toBe(false);
    }
  });

  it('marks exactly the gathering and terminal tactics as resource-touching', () => {
    expect([...RESOURCE_TOUCHING_TACTIC_EXTERNAL_IDS].sort()).toEqual(['TA0009', 'TA0010', 'TA0040']);
  });
});

describe('the walk resolver', () => {
  it('returns exactly the tactics whose required facts are all held', () => {
    expect(playableTactics(EMPTY_ATTACKER_STATE)).toEqual(['TA0001']);

    const withFoothold: AttackerState = new Set(['foothold']);
    expect(playableTactics(withFoothold).sort())
      .toEqual(['TA0001', 'TA0002', 'TA0003', 'TA0004', 'TA0005', 'TA0006', 'TA0007', 'TA0011', 'TA0112'].sort());

    const readyToMove: AttackerState = new Set(['foothold', 'credentials', 'knowledge']);
    expect(playableTactics(readyToMove)).toContain('TA0008');
    expect(playableTactics(readyToMove)).not.toContain('TA0009');
  });

  it('requires credentials for T1078 despite its initial-access tactic', () => {
    expect(isActionPlayable(EMPTY_ATTACKER_STATE, 'TA0001')).toBe(true);
    expect(isActionPlayable(EMPTY_ATTACKER_STATE, 'TA0001', 'T1078')).toBe(false);
    expect(isActionPlayable(new Set(['credentials']), 'TA0001', 'T1078')).toBe(true);
    expect(grantEffects(new Set(['credentials']), 'TA0001', 'T1078')).toEqual(new Set(['credentials', 'foothold']));
  });

  it('answers no rule for pre-compromise tactics', () => {
    for (const tacticExternalId of PRE_COMPROMISE_TACTIC_EXTERNAL_IDS) {
      expect(walkRuleFor(tacticExternalId)).toBeUndefined();
    }
  });

  it('leaves the state untouched when the action grants nothing', () => {
    const state: AttackerState = new Set(['foothold']);
    expect(grantEffects(state, 'TA0002')).toBe(state);
  });
});

describe('the seven-outcome walk', () => {
  it('reaches each declared terminal from an empty state through the table alone, and only there', () => {
    expect(ATTACK_OUTCOMES).toHaveLength(7);
    for (const outcome of ATTACK_OUTCOMES) {
      const { state, succeeded } = walkToClosure();
      expect(isObjectiveReached(succeeded, outcome.terminalTacticExternalId), outcome.name).toBe(false);
      expect(isActionPlayable(state, outcome.terminalTacticExternalId), outcome.name).toBe(true);
      expect(isObjectiveReached([...succeeded, outcome.terminalTacticExternalId], outcome.terminalTacticExternalId), outcome.name).toBe(true);
    }
  });

  it('never reaches an objective without credentials, the Valid Accounts door included', () => {
    const { state } = walkToClosure(['TA0004', 'TA0006']);
    expect(state.has('credentials')).toBe(false);
    for (const outcome of ATTACK_OUTCOMES) {
      expect(isActionPlayable(state, outcome.terminalTacticExternalId), outcome.name).toBe(false);
    }
  });

  it('reaches exfiltration only after collection has gathered data', () => {
    const { state } = walkToClosure(['TA0009']);
    expect(isActionPlayable(state, 'TA0010')).toBe(false);
    expect(isActionPlayable(state, 'TA0040')).toBe(true);
  });
});

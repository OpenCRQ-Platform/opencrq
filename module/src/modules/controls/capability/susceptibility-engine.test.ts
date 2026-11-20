import { describe, expect, it } from 'vitest';
import type { CapabilityEdgeInput, CapabilityStateInput, ScenarioNodeInput } from './susceptibility-engine';
import { STRENGTH_BY_RUNG, SUSCEPTIBILITY_GAMMA } from './constants';
import { buildResistanceEdgeIndex, computeTechniqueResistance, edgeEfficacy, explainTechniqueResistance, noisyOr } from './susceptibility-engine';

// Synthetic MFA-like fixtures (decoupled from the DB / generated seed). The expectations are
// written against the rung ladder rather than its numbers, so this file keeps guarding the formula
// when the ladder's level moves.
const L1 = STRENGTH_BY_RUNG.L1;
const L2 = STRENGTH_BY_RUNG.L2;
const L3 = STRENGTH_BY_RUNG.L3;

const T1078 = 't1078';
const T1078_004 = 't1078-004';
const T1110 = 't1110';
const T1539 = 't1539';
const T1621 = 't1621';

const MFA = 'cap-mfa';

const edge = (techniqueId: string): CapabilityEdgeInput => ({
  capabilityId: MFA,
  techniqueId,
  function: 'prevent',
});

const mfaEdges: Array<CapabilityEdgeInput> = [
  edge(T1078),
  edge(T1078_004),
  edge(T1110),
  edge(T1539),
  edge(T1621),
];

const mfaState = (strengthRung: CapabilityStateInput['strengthRung'], coverageBucket: CapabilityStateInput['coverageBucket']): CapabilityStateInput => ({
  capabilityId: MFA,
  strengthRung,
  coverageBucket,
});

const parentNode = (techniqueId: string): ScenarioNodeInput => ({ techniqueId, parentTechniqueId: null });
const subNode = (techniqueId: string, parentTechniqueId: string): ScenarioNodeInput => ({ techniqueId, parentTechniqueId });

describe('susceptibility-engine', () => {
  describe('edgeEfficacy', () => {
    it('L2/L3 reads the base itself (mod 1.0 reference, coverage 1.0)', () => {
      expect(edgeEfficacy(mfaState('L2', 'L3'))).toBeCloseTo(L2);
    });

    it('L0 instantiates no edge => 0', () => {
      expect(edgeEfficacy(mfaState('L0', 'L3'))).toBe(0);
    });

    it('coverage partial scales by 0.4', () => {
      expect(edgeEfficacy(mfaState('L2', 'L1'))).toBeCloseTo(L2 * 0.4);
    });

    it('coverage none => 0', () => {
      expect(edgeEfficacy(mfaState('L2', 'L0'))).toBe(0);
    });

    it('L1 and L3 bound the ladder', () => {
      expect(edgeEfficacy(mfaState('L1', 'L3'))).toBeCloseTo(L1);
      expect(edgeEfficacy(mfaState('L3', 'L3'))).toBeCloseTo(L3);
    });

    it('efficacy is uniform across edges: only the declared state moves it', () => {
      const state = mfaState('L2', 'L3');
      const efficacies = mfaEdges.map(() => edgeEfficacy(state));
      expect(new Set(efficacies)).toEqual(new Set([L2]));
    });
  });

  describe('noisyOr', () => {
    it('single efficacy passes through', () => {
      expect(noisyOr([0.75])).toBeCloseTo(0.75);
    });

    it('diminishing returns: second control discounted by gamma=0.7', () => {
      // 1 - (1 - 0.75)(1 - 0.45 * 0.7) = 1 - 0.25 * 0.685 = 0.82875
      expect(noisyOr([0.75, 0.45])).toBeCloseTo(0.82875);
    });

    it('order-independent (sorts descending internally)', () => {
      expect(noisyOr([0.45, 0.75])).toBeCloseTo(noisyOr([0.75, 0.45]));
    });

    it('empty => 0', () => {
      expect(noisyOr([])).toBe(0);
    });
  });

  describe('computeTechniqueResistance', () => {
    it('MFA at L2/L3 yields the base on covered nodes (T1078, T1078.004, T1110)', () => {
      const nodes = [parentNode(T1078), subNode(T1078_004, T1078), parentNode(T1110)];
      const mu = computeTechniqueResistance(nodes, mfaEdges, [mfaState('L2', 'L3')]);
      expect(mu.get(T1078)).toBeCloseTo(L2);
      expect(mu.get(T1078_004)).toBeCloseTo(L2);
      expect(mu.get(T1110)).toBeCloseTo(L2);
    });

    it('L0 short-circuits to zero resistance everywhere', () => {
      const nodes = [parentNode(T1078), parentNode(T1110)];
      const mu = computeTechniqueResistance(nodes, mfaEdges, [mfaState('L0', 'L3')]);
      expect(mu.get(T1078)).toBe(0);
      expect(mu.get(T1110)).toBe(0);
    });

    it('uncovered node maps to 0', () => {
      const mu = computeTechniqueResistance([parentNode('t9999')], mfaEdges, [mfaState('L2', 'L3')]);
      expect(mu.get('t9999')).toBe(0);
    });

    it('L3 lifts every covered node by the strength mod only', () => {
      const nodes = [parentNode(T1621), parentNode(T1539)];
      const mu = computeTechniqueResistance(nodes, mfaEdges, [mfaState('L3', 'L3')]);
      expect(mu.get(T1621)).toBeCloseTo(L3);
      expect(mu.get(T1539)).toBeCloseTo(L3);
    });

    it('partial coverage scales the whole node by 0.4', () => {
      const mu = computeTechniqueResistance([parentNode(T1078)], mfaEdges, [mfaState('L2', 'L1')]);
      expect(mu.get(T1078)).toBeCloseTo(L2 * 0.4);
    });

    it('parent fallback: a sub-technique with no specific edge inherits the parent edge', () => {
      const nodes = [subNode('t1078-099', T1078)]; // only T1078 parent edge exists
      const mu = computeTechniqueResistance(nodes, mfaEdges, [mfaState('L2', 'L3')]);
      expect(mu.get('t1078-099')).toBeCloseTo(L2);
    });

    it('most-specific-wins: one edge is used, never the sub-technique and its parent together', () => {
      const edges: Array<CapabilityEdgeInput> = [edge(T1078), edge(T1078_004)];
      const mu = computeTechniqueResistance([subNode(T1078_004, T1078)], edges, [mfaState('L2', 'L3')]);
      // A single contribution, not a noisy-OR of both.
      expect(mu.get(T1078_004)).toBeCloseTo(L2);
    });

    it('two capabilities on the same node combine by noisy-OR', () => {
      const capA: CapabilityEdgeInput = { capabilityId: 'a', techniqueId: T1078, function: 'prevent' };
      const capB: CapabilityEdgeInput = { capabilityId: 'b', techniqueId: T1078, function: 'prevent' };
      const states: Array<CapabilityStateInput> = [
        { capabilityId: 'a', strengthRung: 'L2', coverageBucket: 'L3' },
        { capabilityId: 'b', strengthRung: 'L2', coverageBucket: 'L3' },
      ];
      const mu = computeTechniqueResistance([parentNode(T1078)], [capA, capB], states);
      expect(mu.get(T1078)).toBeCloseTo(1 - (1 - L2) * (1 - L2 * SUSCEPTIBILITY_GAMMA));
    });

    it('CVE-stock hook lowers mu when a finding exists (inert when empty)', () => {
      const cve = new Map([[T1078, 0.5]]);
      const mu = computeTechniqueResistance([parentNode(T1078)], mfaEdges, [mfaState('L2', 'L3')], { cveSusceptibilityByTechnique: cve });
      expect(mu.get(T1078)).toBeCloseTo(L2 * (1 - 0.5));
    });

    it('detect edges are data-only: they do not contribute to mu (palier 0)', () => {
      const detectEdge: CapabilityEdgeInput = { capabilityId: MFA, techniqueId: T1078, function: 'detect' };
      // A node covered only by a detect edge stays uncovered (mu 0).
      const muDetectOnly = computeTechniqueResistance([parentNode(T1078)], [detectEdge], [mfaState('L2', 'L3')]);
      expect(muDetectOnly.get(T1078)).toBe(0);
      // Adding a detect edge alongside a prevent edge does not change the prevent-only result.
      const muPreventOnly = computeTechniqueResistance([parentNode(T1078)], [edge(T1078)], [mfaState('L2', 'L3')]);
      const muMixed = computeTechniqueResistance([parentNode(T1078)], [edge(T1078), detectEdge], [mfaState('L2', 'L3')]);
      expect(muMixed.get(T1078)).toBeCloseTo(muPreventOnly.get(T1078)!);
    });

    // The cross-function combination 1 - Π_f (1 - P_f) would count a capability twice where it
    // holds an edge to the same technique on two functions. A single-member ENGINE_SCORING_FUNCTIONS
    // is what makes that step a no-op, so the guard is on the member count, not on the formula.
    it('a merged dual pair contributes once, not through two functions', () => {
      const mu = computeTechniqueResistance([parentNode(T1078)], [edge(T1078)], [mfaState('L2', 'L3')]);
      expect(mu.get(T1078)).toBeCloseTo(L2);
      // A two-function shape would score 1 - (1 - base)² for the same declaration.
      expect(mu.get(T1078)).not.toBeCloseTo(1 - (1 - L2) ** 2);
    });
  });

  describe('explainTechniqueResistance', () => {
    const WAF = 'cap-waf';
    const twoControls = [edge(T1078), { capabilityId: WAF, techniqueId: T1078, function: 'prevent' as const }];
    const twoStates: Array<CapabilityStateInput> = [
      mfaState('L1', 'L1'),
      { capabilityId: WAF, strengthRung: 'L2', coverageBucket: 'L2' },
    ];

    // The explanation restates the engine's arithmetic instead of riding along with it, so this
    // is what stops the two from drifting apart.
    it('lands on the resistance the engine computes, for every shape', () => {
      const shapes: Array<{ states: Array<CapabilityStateInput>, options?: Parameters<typeof computeTechniqueResistance>[3] }> = [
        { states: twoStates },
        { states: [mfaState('L2', 'L3')] },
        { states: [mfaState('L0', 'L3')] },
        { states: [] },
        { states: twoStates, options: { gamma: 0.5 } },
        { states: twoStates, options: { familyShareByCapability: new Map([[MFA, 0.25], [WAF, 1]]) } },
        { states: twoStates, options: { cveSusceptibilityByTechnique: new Map([[T1078, 0.4]]) } },
        { states: [], options: { cveSusceptibilityByTechnique: new Map([[T1078, 0.4]]) } },
      ];
      for (const { states, options } of shapes) {
        const mu = computeTechniqueResistance([parentNode(T1078)], twoControls, states, options).get(T1078);
        const terms = explainTechniqueResistance(
          parentNode(T1078),
          buildResistanceEdgeIndex(twoControls),
          states,
          options,
        );
        expect(terms.resistance).toBeCloseTo(mu ?? 0, 12);
      }
    });

    it('ranks the controls strongest first and credits each one less than the last', () => {
      const terms = explainTechniqueResistance(parentNode(T1078), buildResistanceEdgeIndex(twoControls), twoStates);
      expect(terms.contributions.map((c) => c.capabilityId)).toEqual([WAF, MFA]);
      expect(terms.contributions[0].credited).toBeCloseTo(terms.contributions[0].efficacy);
      expect(terms.contributions[1].credited).toBeCloseTo(terms.contributions[1].efficacy * terms.gamma);
    });

    it('reports no contribution rather than a zero-strength one for a control at L0', () => {
      const terms = explainTechniqueResistance(parentNode(T1078), buildResistanceEdgeIndex([edge(T1078)]), [mfaState('L0', 'L3')]);
      expect(terms.contributions).toEqual([]);
      expect(terms.resistance).toBe(0);
    });
  });

  describe('family share scaling', () => {
    it('takes a control at full weight when the caller passes no share', () => {
      const mu = computeTechniqueResistance([parentNode(T1078)], [edge(T1078)], [mfaState('L2', 'L3')]);
      expect(mu.get(T1078)).toBeCloseTo(L2);
    });

    it('scales the edge efficacy by the share before the noisy-OR', () => {
      const mu = computeTechniqueResistance([parentNode(T1078)], [edge(T1078)], [mfaState('L2', 'L3')], {
        familyShareByCapability: new Map([[MFA, 0.25]]),
      });
      expect(mu.get(T1078)).toBeCloseTo(L2 * 0.25);
    });

    it('drops a control that can stand on nothing the scenario touches', () => {
      const mu = computeTechniqueResistance([parentNode(T1078)], [edge(T1078)], [mfaState('L3', 'L3')], {
        familyShareByCapability: new Map([[MFA, 0]]),
      });
      expect(mu.get(T1078)).toBe(0);
    });

    it('drops a control missing from a share map that was actually passed', () => {
      const mu = computeTechniqueResistance([parentNode(T1078)], [edge(T1078)], [mfaState('L2', 'L3')], {
        familyShareByCapability: new Map(),
      });
      expect(mu.get(T1078)).toBe(0);
    });
  });
});

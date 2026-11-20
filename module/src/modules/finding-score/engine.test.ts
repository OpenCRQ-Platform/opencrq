import { describe, expect, it } from 'vitest';
import type { FindingScoreInput, FindingScorePolicy, TechniqueInReach, ThreatSignalInput } from './engine';
import { DETECTED_MAGNITUDE_FACTOR } from '../crq-indicators/engine/attack-run-constants';
import { parseCvssContributions, readCvssMetrics } from '../cve/cvss-vector';
import { DECLARED_CRITICALITY_VALUES } from '../supporting-assets/constants';
import { resolveSeverityBand, SEVERITY_BAND_MINIMUMS } from './bands';
import {
  CRITICALITY_COST_FACTORS,
  DETECTION_CREDIT,
  INDEPENDENT_SIGNAL_LIFT,
  THREAT_FLOORS,
  UNEVALUATED_LET_THROUGH,
} from './constants';
import { composeParts, computeFindingScore, controlsFactor, exposureWeightsByExposure, partFigure, threatFactor } from './engine';

const OFF: FindingScorePolicy = {
  unknownCriticalityCountsAs: 'low',
  unknownExposureCountsAs: 'internal',
  exposureWeights: { internet_facing: 1, internal: 0.4 },
};

const SILENCE: ThreatSignalInput = {
  exploitationProbability: null,
  knownExploited: false,
  citedByActiveThreat: false,
};

const input = (overrides: Partial<FindingScoreInput> = {}): FindingScoreInput => ({
  exposure: 'internet_facing',
  criticality: 'high',
  threat: SILENCE,
  exploitationTechniques: [],
  impactTechniques: [],
  cvss: null,
  ...overrides,
});

const inReach = (overrides: Partial<TechniqueInReach> = {}): TechniqueInReach => ({
  techniqueId: 'a',
  claimConfidence: 'high',
  declaredMu: null,
  detectMu: null,
  ...overrides,
});

describe('the threat factor', () => {
  it('takes the base floor when no source says anything', () => {
    const factor = threatFactor(SILENCE, null);
    expect(factor.value).toBe(THREAT_FLOORS.base);
  });

  it('floors a CISA-listed flaw at nine tenths', () => {
    expect(threatFactor({ ...SILENCE, knownExploited: true }, null).value).toBe(0.9);
  });

  it('takes the highest floor any single signal sets', () => {
    expect(threatFactor({ ...SILENCE, knownExploited: true }, null).value).toBe(THREAT_FLOORS.knownExploited);
    expect(threatFactor({ ...SILENCE, citedByActiveThreat: true }, null).value).toBe(THREAT_FLOORS.activeThreat);
    expect(threatFactor({ ...SILENCE, exploitationProbability: 0.42 }, null).value).toBeCloseTo(0.42, 10);
  });

  it('lifts two independent signals a third of the way to certainty', () => {
    const factor = threatFactor({ ...SILENCE, exploitationProbability: 0.1, knownExploited: true }, null);
    const expected = THREAT_FLOORS.knownExploited + (1 - THREAT_FLOORS.knownExploited) * INDEPENDENT_SIGNAL_LIFT;
    expect(factor.value).toBeCloseTo(expected, 10);
  });

  it('never lets a single feed reach certainty on its own', () => {
    expect(threatFactor({ ...SILENCE, exploitationProbability: 1 }, null).value).toBe(1);
    expect(threatFactor({ ...SILENCE, exploitationProbability: 0.99 }, null).value).toBeLessThan(1);
  });

  it('lets a high attack complexity dampen an observed signal without erasing it', () => {
    const signals = { ...SILENCE, knownExploited: true };
    const easy = parseCvssContributions('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H');
    const hard = parseCvssContributions('CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H');
    expect(threatFactor(signals, easy).value).toBe(THREAT_FLOORS.knownExploited);
    expect(threatFactor(signals, hard).value).toBeLessThan(THREAT_FLOORS.knownExploited);
    expect(threatFactor(signals, hard).value).toBeGreaterThan(THREAT_FLOORS.base);
  });

  it('never lets complexity push a finding under what total silence is worth', () => {
    const hard = parseCvssContributions('CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:H/I:H/A:H');
    expect(threatFactor(SILENCE, hard).value).toBe(THREAT_FLOORS.base);
  });

  it('never falls when a signal is added, over the whole input grid', () => {
    const probabilities = [null, 0, 0.01, 0.2, 0.9];
    const flags = [false, true];
    const grid: Array<ThreatSignalInput> = [];
    for (const exploitationProbability of probabilities) {
      for (const knownExploited of flags) {
        for (const citedByActiveThreat of flags) {
          grid.push({ exploitationProbability, knownExploited, citedByActiveThreat });
        }
      }
    }
    // `after` dominates `before` when every source says at least as much, which is what "a signal
    // arrived" means: no source ever retracts.
    const dominates = (after: ThreatSignalInput, before: ThreatSignalInput): boolean =>
      (after.exploitationProbability ?? 0) >= (before.exploitationProbability ?? 0)
      && after.knownExploited >= before.knownExploited
      && after.citedByActiveThreat >= before.citedByActiveThreat;

    for (const before of grid) {
      for (const after of grid) {
        if (dominates(after, before)) {
          expect(threatFactor(after, null).value).toBeGreaterThanOrEqual(threatFactor(before, null).value);
        }
      }
    }
  });

  it('reads a probability of zero as silence rather than as a signal', () => {
    const factor = threatFactor({ ...SILENCE, exploitationProbability: 0, knownExploited: true }, null);
    expect(factor.value).toBe(THREAT_FLOORS.knownExploited);
  });
});

describe('what the controls let through', () => {
  it('takes the precautionary reference value when no technique stands on the side', () => {
    const factor = controlsFactor([], 'weakest');
    expect(factor.value).toBe(UNEVALUATED_LET_THROUGH);
    expect(factor.weakestPath).toBeNull();
  });

  it('takes the weakest technique in reach and never the average', () => {
    const factor = controlsFactor([
      inReach({ techniqueId: 'a', declaredMu: 0.8 }),
      inReach({ techniqueId: 'b', declaredMu: null }),
    ], 'weakest');
    expect(factor.value).toBe(1);
  });

  it('lets through what the declared resistance leaves', () => {
    const factor = controlsFactor([inReach({ declaredMu: 0.6 })], 'weakest');
    expect(factor.value).toBeCloseTo(0.4, 10);
  });

  it('caps the declared resistance so the residual is never below 0.03', () => {
    const factor = controlsFactor([inReach({ declaredMu: 1 })], 'weakest');
    expect(factor.value).toBeCloseTo(0.03, 10);
  });

  it('counts a path in full whatever the confidence of the claim that opens it', () => {
    for (const claimConfidence of ['high', 'medium', 'low'] as const) {
      expect(controlsFactor([inReach({ claimConfidence })], 'weakest').value).toBe(1);
      expect(controlsFactor([inReach({ claimConfidence, declaredMu: 0.4 })], 'weakest').value).toBeCloseTo(0.6, 10);
    }
  });

  it('lets an uncovered deduction decide over a covered claim nobody doubts', () => {
    const factor = controlsFactor([
      inReach({ techniqueId: 'named', claimConfidence: 'high', declaredMu: 0.315 }),
      inReach({ techniqueId: 'deduced', claimConfidence: 'medium', declaredMu: null }),
    ], 'weakest');
    expect(factor.weakestPath?.techniqueId).toBe('deduced');
    expect(factor.value).toBe(1);
  });

  it('names the most confident claim among paths that let through as much', () => {
    const factor = controlsFactor([
      inReach({ techniqueId: 'deduced', claimConfidence: 'medium' }),
      inReach({ techniqueId: 'guessed', claimConfidence: 'low' }),
      inReach({ techniqueId: 'named', claimConfidence: 'high' }),
    ], 'weakest');
    expect(factor.paths.map((path) => path.techniqueId)).toEqual(['named', 'deduced', 'guessed']);
  });

  it('names the technique whose path set the factor', () => {
    const factor = controlsFactor([
      inReach({ techniqueId: 'held', declaredMu: 0.9 }),
      inReach({ techniqueId: 'open', declaredMu: 0.1 }),
    ], 'weakest');
    expect(factor.weakestPath?.techniqueId).toBe('open');
  });

  it('lists every path, the weakest first', () => {
    const factor = controlsFactor([
      inReach({ techniqueId: 'held', declaredMu: 0.9 }),
      inReach({ techniqueId: 'open', declaredMu: 0.1 }),
    ], 'weakest');
    expect(factor.paths.map((path) => path.techniqueId)).toEqual(['open', 'held']);
  });

  it('takes the mean of what every technique lets through when the side averages', () => {
    const factor = controlsFactor([
      inReach({ techniqueId: 'held', declaredMu: 0.8 }),
      inReach({ techniqueId: 'open', declaredMu: null }),
    ], 'mean');
    expect(factor.value).toBeCloseTo(0.6, 10);
    expect(factor.aggregation).toBe('mean');
    expect(factor.weakestPath?.techniqueId).toBe('open');
  });

  it('keeps the precautionary reference value on an empty side that averages', () => {
    expect(controlsFactor([], 'mean').value).toBe(UNEVALUATED_LET_THROUGH);
  });

  it('prices a detection at the rate the CRQ engine prices a detected impact', () => {
    expect(DETECTION_CREDIT).toBeCloseTo(1 - DETECTED_MAGNITUDE_FACTOR, 10);
  });

  it('lets a technique nothing prevents through less when a control detects it', () => {
    const factor = controlsFactor([inReach({ detectMu: 0.8 })], 'weakest');
    expect(factor.value).toBeCloseTo(1 - DETECTION_CREDIT * 0.8, 10);
    expect(factor.weakestPath?.terms.preventionLetThrough).toBe(1);
    expect(factor.weakestPath?.terms.detectMu).toBe(0.8);
  });

  it('narrows what prevention lets through by what detection sees', () => {
    const factor = controlsFactor([inReach({ declaredMu: 0.6, detectMu: 0.5 })], 'weakest');
    expect(factor.value).toBeCloseTo(0.4 * (1 - DETECTION_CREDIT * 0.5), 10);
  });

});

describe('the CVSS vector', () => {
  it('reads the three access metrics apart and lands a wide-open flaw at one', () => {
    const open = parseCvssContributions('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H');
    expect(open?.access).toBeCloseTo(1, 10);
    expect(open?.complexity).toBeCloseTo(1, 10);
    expect(open?.impact).toBeCloseTo(1, 10);
  });

  it('narrows access when the flaw demands local presence, privileges or a click', () => {
    const open = parseCvssContributions('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H');
    const narrow = parseCvssContributions('CVSS:3.1/AV:L/AC:L/PR:H/UI:R/S:U/C:H/I:H/A:H');
    expect(narrow?.access ?? 1).toBeLessThan(open?.access ?? 0);
  });

  it('separates two flaws the base score cannot tell apart', () => {
    // Both are published at 7.5; only the vector says one needs a local session.
    const remote = parseCvssContributions('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H');
    const local = parseCvssContributions('CVSS:3.1/AV:L/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N');
    expect(remote?.access ?? 0).toBeGreaterThan(local?.access ?? 1);
    expect(local?.impact ?? 0).toBeGreaterThan(remote?.impact ?? 1);
  });

  it('reads a 4.0 vector through its own metric names', () => {
    const v4 = parseCvssContributions('CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N');
    expect(v4?.version).toBe('4.0');
    expect(v4?.impact).toBeCloseTo(1, 10);
  });

  it('lets 4.0 attack requirements dampen the same way a high complexity does', () => {
    const plain = parseCvssContributions('CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H');
    const required = parseCvssContributions('CVSS:4.0/AV:N/AC:L/AT:P/PR:N/UI:N/VC:H/VI:H/VA:H');
    expect(required?.complexity ?? 1).toBeLessThan(plain?.complexity ?? 0);
  });

  it('narrows access on both of 4.0 passive and active user interaction', () => {
    const none = parseCvssContributions('CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H');
    const passive = parseCvssContributions('CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:P/VC:H/VI:H/VA:H');
    const active = parseCvssContributions('CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:A/VC:H/VI:H/VA:H');
    expect(passive?.access ?? 1).toBeLessThan(none?.access ?? 0);
    expect(active?.access ?? 1).toBeLessThan(none?.access ?? 0);
  });

  it('refuses a vector missing a metric the score reads, rather than scoring it at the ceiling', () => {
    expect(parseCvssContributions('CVSS:3.1')).toBeNull();
    expect(parseCvssContributions('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U')).toBeNull();
    expect(parseCvssContributions('CVSS:4.0/AV:N/AC:L/PR:N/UI:N/VC:H/VI:H/VA:H')).toBeNull();
  });

  it('refuses a value no table recognises rather than defaulting it to the most permissive', () => {
    expect(parseCvssContributions('CVSS:3.1/AV:Z/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toBeNull();
    expect(parseCvssContributions('CVSS:3.1/AV:N/AC:L/PR:N/UI:Z/S:U/C:H/I:H/A:H')).toBeNull();
  });

  it('refuses a value belonging to the other version of the same metric letter', () => {
    // 4.0 replaced Required with passive and active; neither vocabulary is valid in the other.
    expect(parseCvssContributions('CVSS:3.1/AV:N/AC:L/PR:N/UI:P/S:U/C:H/I:H/A:H')).toBeNull();
    expect(parseCvssContributions('CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:R/VC:H/VI:H/VA:H')).toBeNull();
  });

  it('refuses a version it does not weight rather than guessing at it', () => {
    expect(parseCvssContributions('CVSS:2.0/AV:N/AC:L/Au:N/C:P/I:P/A:P')).toBeNull();
    expect(parseCvssContributions('CVSS:5.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H')).toBeNull();
    expect(parseCvssContributions('not a vector')).toBeNull();
    expect(parseCvssContributions(null)).toBeNull();
  });

  it('names no metric on a vector the score refused, so the panels cannot contradict the figure', () => {
    expect(readCvssMetrics('CVSS:3.1/AV:N')).toEqual([]);
    expect(readCvssMetrics('CVSS:2.0/AV:N/AC:L/Au:N/C:P/I:P/A:P')).toEqual([]);
    expect(readCvssMetrics('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'))
      .toContainEqual({ metric: 'AV', value: 'N' });
  });

  it('floors a vector claiming no impact instead of erasing the finding', () => {
    const inert = parseCvssContributions('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N');
    expect(inert?.impact ?? 0).toBeGreaterThan(0);
  });
});

describe('the reachability', () => {
  const asInternal: FindingScorePolicy = { ...OFF, unknownExposureCountsAs: 'internal' };
  const asInternetFacing: FindingScorePolicy = { ...OFF, unknownExposureCountsAs: 'internet_facing' };
  const vector = parseCvssContributions('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H');
  const listed = { ...SILENCE, knownExploited: true };

  it('prices an unknown exposure exactly as the exposure the tenant counts it as', () => {
    for (const [counted, policy, weight] of [['internal', asInternal, 0.4], ['internet_facing', asInternetFacing, 1]] as const) {
      const unknown = computeFindingScore(input({ exposure: 'unknown', threat: listed, cvss: vector }), policy);
      const declared = computeFindingScore(input({ exposure: counted, threat: listed, cvss: vector }), policy);
      expect(unknown.factors.reachability).toEqual(declared.factors.reachability);
      expect(unknown.factors.reachability.terms).toMatchObject({ exposureCountedAs: counted, exposureWeight: weight });
      expect(unknown.score).toBe(declared.score);
      expect(unknown.band).toBe(declared.band);
    }
  });

  it('leaves a declared exposure alone whatever an unknown one counts as', () => {
    const scored = computeFindingScore(input({ exposure: 'internal' }), asInternetFacing);
    expect(scored.factors.reachability.terms).toMatchObject({ exposureCountedAs: 'internal', exposureWeight: 0.4 });
  });

  it('reads the weight the tenant set, not a default', () => {
    const policy: FindingScorePolicy = { ...asInternal, exposureWeights: { internet_facing: 1, internal: 0.5 } };
    const scored = computeFindingScore(input({ exposure: 'unknown' }), policy);
    expect(scored.factors.reachability.terms.exposureWeight).toBe(0.5);
  });

  it('is the exposure weight alone when no vector was published', () => {
    const scored = computeFindingScore(input({ exposure: 'internal', cvss: null }), OFF);
    expect(scored.factors.reachability.value).toBe(0.4);
    expect(scored.factors.reachability.terms.cvssAccess).toBeNull();
  });

  it('names the weight of unknown in each case and copies the two declared ones', () => {
    expect(exposureWeightsByExposure(asInternal)).toEqual({ internet_facing: 1, internal: 0.4, unknown: 0.4 });
    expect(exposureWeightsByExposure(asInternetFacing)).toEqual({ internet_facing: 1, internal: 0.4, unknown: 1 });
  });
});

describe('the potential impact', () => {
  it('prices an unset criticality exactly as the band the tenant counts it as', () => {
    for (const band of DECLARED_CRITICALITY_VALUES) {
      const policy = { ...OFF, unknownCriticalityCountsAs: band };
      const unset = computeFindingScore(input({ criticality: 'unknown' }), policy);
      const declared = computeFindingScore(input({ criticality: band }), OFF);
      expect(unset.factors.potentialImpact).toEqual(declared.factors.potentialImpact);
      expect(unset.score).toBe(declared.score);
    }
  });

  it('leaves a declared criticality alone whatever an unset one counts as', () => {
    const policy = { ...OFF, unknownCriticalityCountsAs: 'very_high' as const };
    const scored = computeFindingScore(input({ criticality: 'low' }), policy);
    expect(scored.factors.potentialImpact.terms).toMatchObject({ criticalityCountedAs: 'low', criticalityFactor: 0.4 });
  });

  it('gives the top band the ceiling and steps every other band below it', () => {
    expect(CRITICALITY_COST_FACTORS.very_high).toBe(1);
    expect(CRITICALITY_COST_FACTORS.high).toBe(0.9);
    expect(CRITICALITY_COST_FACTORS.medium).toBe(0.7);
    expect(CRITICALITY_COST_FACTORS.low).toBe(0.4);
  });

  it('prices a very_high finding at the ceiling and one that stays high at nine tenths of it', () => {
    const top = computeFindingScore(input({ criticality: 'very_high' }), OFF);
    const high = computeFindingScore(input({ criticality: 'high' }), OFF);
    expect(top.factors.potentialImpact.value).toBe(1);
    expect(high.factors.potentialImpact.value).toBeCloseTo(0.9, 10);
    expect(high.score).toBeLessThan(top.score);
  });
});

describe('the aggregation of each side', () => {
  it('takes the weakest exploitation technique and the mean of the impact techniques', () => {
    const techniques = [
      inReach({ techniqueId: 'held', declaredMu: 0.8 }),
      inReach({ techniqueId: 'open', declaredMu: null }),
    ];
    const scored = computeFindingScore(
      input({ exploitationTechniques: techniques, impactTechniques: techniques }),
      OFF,
    );
    expect(scored.factors.exploitationControls.value).toBe(1);
    expect(scored.factors.impactControls.value).toBeCloseTo(0.6, 10);
  });
});

describe('the composition', () => {
  it('is the root of exploitability times impact, truncated', () => {
    expect(composeParts(0.336, 0.54).score).toBe(42);
    expect(composeParts(0.96, 0.9).score).toBe(92);
    expect(composeParts(0.8, 0.1).score).toBe(28);
  });

  it('scores zero when either part is zero', () => {
    expect(composeParts(0, 0.9).score).toBe(0);
    expect(composeParts(0.9, 0).score).toBe(0);
  });

  it('renders one hundred only when both parts are at their maximum', () => {
    expect(composeParts(1, 1).score).toBe(100);
    expect(composeParts(0.99, 1).score).toBeLessThan(100);
  });

  it('always lands between its two parts, never above their mean', () => {
    for (const [e, i] of [[0.2, 0.9], [0.9, 0.2], [0.5, 0.6], [0.05, 1]] as const) {
      const { score } = composeParts(e, i);
      expect(score).toBeGreaterThanOrEqual(partFigure(Math.min(e, i)));
      expect(score).toBeLessThanOrEqual(partFigure(Math.max(e, i)));
      expect(score).toBeLessThanOrEqual(partFigure((e + i) / 2));
    }
  });

  it('averages reachability and threat, then lets the exploitation controls narrow them', () => {
    const scored = computeFindingScore(input({
      exposure: 'internal',
      threat: { ...SILENCE, knownExploited: true },
      exploitationTechniques: [inReach({ declaredMu: 0.5 })],
    }), OFF);
    expect(scored.reachabilityAndThreat).toBeCloseTo((0.4 + THREAT_FLOORS.knownExploited) / 2, 10);
    expect(scored.exploitability).toBeCloseTo(scored.reachabilityAndThreat * 0.5, 10);
  });

  it('multiplies the potential impact by what the controls let through on the impact techniques', () => {
    const scored = computeFindingScore(input({
      criticality: 'high',
      impactTechniques: [inReach({ declaredMu: 0.4 })],
    }), OFF);
    expect(scored.impact).toBeCloseTo(0.9 * 0.6, 10);
  });

  it('never lets an impact control move the exploitability, nor an exploitation control the impact', () => {
    const bare = computeFindingScore(input(), OFF);
    const guarded = computeFindingScore(input({
      exploitationTechniques: [inReach({ declaredMu: 0.8 })],
    }), OFF);
    const contained = computeFindingScore(input({
      impactTechniques: [inReach({ declaredMu: 0.8 })],
    }), OFF);
    expect(guarded.impact).toBe(bare.impact);
    expect(contained.exploitability).toBe(bare.exploitability);
  });

  it('scores a side nothing evaluates at the reference value, never on fewer terms', () => {
    const scored = computeFindingScore(input({ threat: { ...SILENCE, knownExploited: true } }), OFF);
    expect(scored.factors.exploitationControls.value).toBe(UNEVALUATED_LET_THROUGH);
    expect(scored.factors.impactControls.value).toBe(UNEVALUATED_LET_THROUGH);
    expect(scored.score).toBe(composeParts((1 + THREAT_FLOORS.knownExploited) / 2, 0.9).score);
  });

  it('names the lower term of the weaker part as what holds the score back', () => {
    const guarded = computeFindingScore(input({
      threat: { ...SILENCE, knownExploited: true },
      exploitationTechniques: [inReach({ declaredMu: 0.9 })],
    }), OFF);
    expect(guarded.limitingTerm).toBe('exploitationControls');
    const minor = computeFindingScore(input({
      criticality: 'low',
      threat: { ...SILENCE, knownExploited: true },
    }), OFF);
    expect(minor.limitingTerm).toBe('potentialImpact');
  });
});

describe('the worked cases, Log4Shell on an internet-facing web application of high criticality', () => {
  const log4shell = parseCvssContributions('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H');
  const exploited: ThreatSignalInput = { exploitationProbability: 0.944, knownExploited: true, citedByActiveThreat: true };

  it('reads nothing held when no control is declared', () => {
    const scored = computeFindingScore(input({
      threat: exploited,
      cvss: log4shell,
      exploitationTechniques: [inReach()],
      impactTechniques: [inReach({ techniqueId: 'b' })],
    }), OFF);
    expect(scored.band).toBe('critical');
    expect(scored.score).toBe(composeParts(scored.reachabilityAndThreat, 0.9).score);
  });

  it('lets a WAF on the way in and controls on the estate pull the score down through the root', () => {
    const open = computeFindingScore(input({
      threat: exploited,
      cvss: log4shell,
      exploitationTechniques: [inReach()],
    }), OFF);
    const guarded = computeFindingScore(input({
      threat: exploited,
      cvss: log4shell,
      exploitationTechniques: [inReach({ declaredMu: 0.65 })],
      impactTechniques: [inReach({ techniqueId: 'b', declaredMu: 0.4 })],
    }), OFF);
    expect(guarded.score).toBeLessThan(open.score);
    expect(guarded.band).toBe('medium');
  });
});

describe('the exploitability the posture reads', () => {
  const availabilityOnly = parseCvssContributions('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L');

  it('does not move with the asset criticality', () => {
    const readings = (['very_high', 'high', 'medium', 'low', 'unknown'] as const).map((criticality) =>
      computeFindingScore(input({ criticality, cvss: availabilityOnly }), OFF).exploitability);
    expect(new Set(readings).size).toBe(1);
  });

  it('does not move with the CVSS impact', () => {
    const full = parseCvssContributions('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H');
    const narrow = computeFindingScore(input({ cvss: availabilityOnly }), OFF);
    const wide = computeFindingScore(input({ cvss: full }), OFF);
    expect(narrow.exploitability).toBe(wide.exploitability);
    expect(narrow.impact).toBeLessThan(wide.impact);
  });
});

describe('the bands', () => {
  it('cuts exactly at ninety, seventy and forty', () => {
    expect(resolveSeverityBand(90)).toBe('critical');
    expect(resolveSeverityBand(89)).toBe('high');
    expect(resolveSeverityBand(70)).toBe('high');
    expect(resolveSeverityBand(69)).toBe('medium');
    expect(resolveSeverityBand(40)).toBe('medium');
    expect(resolveSeverityBand(39)).toBe('low');
    expect(resolveSeverityBand(0)).toBe('low');
  });

  it('orders the band minimums hottest first', () => {
    expect(SEVERITY_BAND_MINIMUMS.critical).toBeGreaterThan(SEVERITY_BAND_MINIMUMS.high);
    expect(SEVERITY_BAND_MINIMUMS.high).toBeGreaterThan(SEVERITY_BAND_MINIMUMS.medium);
    expect(SEVERITY_BAND_MINIMUMS.medium).toBeGreaterThan(SEVERITY_BAND_MINIMUMS.low);
  });
});

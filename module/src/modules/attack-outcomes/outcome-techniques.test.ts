import { describe, expect, it } from 'vitest';
import type { CatalogTechnique, CuratedTechnique } from './outcome-techniques';
import {
  computeAttackerMixture,
  computeScenarioTechniqueWeights,
} from '../threat-analyses/technique-weighting';
import { INFERRED_MAX_COUNT, INFERRED_MIN_GROUPS, INFERRED_MIN_WEIGHT } from './constants';
import {
  buildNoEvidenceResult,
  buildNoRepertoireResult,
  buildOutcomeTechniques,
  buildPendingOutcomeTechniques,
  buildPendingRepertoireTechniques,
  buildRepertoireTechniques,
  computeBindingShares,
  dedupeCuratedByParent,
  selectInferredCandidates,
} from './outcome-techniques';

const NOW = new Date('2026-07-27T00:00:00.000Z');

const curated = (externalId: string, category: 'signature' | 'related'): CuratedTechnique => ({
  mitreTechniqueId: `uuid-${externalId}`,
  category,
  externalId,
  name: `Technique ${externalId}`,
  revoked: false,
});

const catalogOf = (externalIds: Array<string>): Map<string, CatalogTechnique> => new Map(
  externalIds.map((externalId) => [externalId, {
    mitreTechniqueId: `uuid-${externalId}`,
    externalId,
    name: `Technique ${externalId}`,
    revoked: false,
  }]),
);

const TACTIC_NAMES = new Map([
  // Deliberately out of ATT&CK order, so the builder's own sort is what the assertion sees.
  ['T1078', [{ name: 'Persistence', order: 5 }, { name: 'Initial Access', order: 4 }]],
]);

// Fresh, perfectly comparable actors: rho = 1 and tau = 1 for each, so every share is 1/(n + 0.5)
// and the expected weights stay exact.
const mixtureOf = (groups: Array<{ key: string, techniqueExternalIds: Array<string> }>) =>
  computeAttackerMixture({
    groups: groups.map((group) => ({
      groupKey: group.key,
      name: group.key,
      entityType: 'intrusion-set' as const,
      aliases: [],
      mitreGroupId: null,
      stixId: `intrusion-set--${group.key}`,
      anchor: { date: NOW, provenance: 'observed' as const },
      countryMatch: false,
      sectorMatch: false,
      weight: 1,
      techniqueExternalIds: group.techniqueExternalIds,
    })),
    now: NOW,
  });

const weightsOf = (mixture: ReturnType<typeof mixtureOf>, groups: Array<{ key: string, techniqueExternalIds: Array<string> }>) =>
  computeScenarioTechniqueWeights({
    mixture,
    links: groups.flatMap((group) => group.techniqueExternalIds.map((mitreExternalId) => ({ groupKey: group.key, mitreExternalId }))),
  });

describe('dedupeCuratedByParent', () => {
  it('keeps the parent row when a parent and one of its sub-techniques are both curated', () => {
    const result = dedupeCuratedByParent([curated('T1003.001', 'related'), curated('T1003', 'signature'), curated('T1078', 'related')]);

    expect(result.map((technique) => technique.externalId)).toEqual(['T1003', 'T1078']);
  });

  it('keeps the strongest category when only sub-techniques of a parent are curated', () => {
    const result = dedupeCuratedByParent([curated('T1003.002', 'related'), curated('T1003.001', 'signature')]);

    expect(result).toHaveLength(1);
    expect(result[0].externalId).toBe('T1003.001');
    expect(result[0].category).toBe('signature');
  });

  it('leaves distinct parents untouched and in input order', () => {
    const result = dedupeCuratedByParent([curated('T1078', 'related'), curated('T1003', 'signature')]);

    expect(result.map((technique) => technique.externalId)).toEqual(['T1078', 'T1003']);
  });
});

describe('selectInferredCandidates', () => {
  const groups = [
    { key: 'alpha', techniqueExternalIds: ['T1595', 'T1590'] },
    { key: 'beta', techniqueExternalIds: ['T1595'] },
  ];
  const mixture = mixtureOf(groups);
  const weights = weightsOf(mixture, groups);

  it('rejects a technique corroborated by fewer than INFERRED_MIN_GROUPS actors', () => {
    const soleContributor = weights.find((weight) => weight.mitreExternalId === 'T1590')!;

    expect(soleContributor.contributions.length).toBeLessThan(INFERRED_MIN_GROUPS);
    expect(soleContributor.weight).toBeGreaterThan(INFERRED_MIN_WEIGHT);
    expect(selectInferredCandidates(weights, new Set()).map((weight) => weight.mitreExternalId)).toEqual(['T1595']);
  });

  it('rejects a corroborated technique that stays under the weight floor', () => {
    // Nine actors dilute every share to 1/9.5, so a technique used by two of them lands at 0.21.
    const many = Array.from({ length: 9 }, (_, index) => ({ key: `g${index}`, techniqueExternalIds: index < 2 ? ['T1595'] : ['T1590'] }));
    const faintMixture = mixtureOf(many);
    const faint = selectInferredCandidates(weightsOf(faintMixture, many), new Set());

    expect(faint.map((weight) => weight.mitreExternalId)).toEqual(['T1590']);
  });

  it('drops the curated parents and truncates to INFERRED_MAX_COUNT in weight order', () => {
    const pool = Array.from({ length: 12 }, (_, index) => `T2${String(index).padStart(3, '0')}`);
    const twins = [
      { key: 'alpha', techniqueExternalIds: ['T1003', ...pool] },
      { key: 'beta', techniqueExternalIds: ['T1003', ...pool] },
    ];
    const candidates = selectInferredCandidates(weightsOf(mixtureOf(twins), twins), new Set(['T1003']));

    expect(candidates).toHaveLength(INFERRED_MAX_COUNT);
    expect(candidates.map((weight) => weight.mitreExternalId)).toEqual(pool.toSorted().slice(0, INFERRED_MAX_COUNT));
    for (let index = 1; index < candidates.length; index += 1) {
      expect(candidates[index - 1].weight).toBeGreaterThanOrEqual(candidates[index].weight);
    }
  });
});

describe('buildOutcomeTechniques', () => {
  const groups = [
    { key: 'alpha', techniqueExternalIds: ['T1003.001', 'T1595'] },
    { key: 'beta', techniqueExternalIds: ['T1003', 'T1595'] },
  ];
  const mixture = mixtureOf(groups);
  const weights = weightsOf(mixture, groups);

  it('emits one active row per parent when a parent and a sub-technique are both curated', () => {
    const curatedRows = [curated('T1003', 'signature'), curated('T1003.001', 'related')];
    const result = buildOutcomeTechniques({
      curated: curatedRows,
      mixture,
      weights,
      inferredCandidates: [],
      catalogByExternalId: catalogOf([]),
      tacticIdsByTechniqueExternalId: new Map(),
    });

    // Both rows fold to T1003 and would otherwise carry the identical share, which the CRQ Monte
    // Carlo would then count twice for a single repertoire membership.
    expect(result.techniques.map((technique) => technique.externalId)).toEqual(['T1003']);
    expect(result.techniques[0].weight).toBeCloseTo(1, 10);
    expect(result.evidenceMode).toBe('attacker-mixture');
  });

  it('drops an inferred candidate the catalog cannot resolve', () => {
    const inferredCandidates = selectInferredCandidates(weights, new Set(['T1003']));
    expect(inferredCandidates.map((weight) => weight.mitreExternalId)).toEqual(['T1595']);

    const result = buildOutcomeTechniques({
      curated: [curated('T1003', 'signature')],
      mixture,
      weights,
      inferredCandidates,
      catalogByExternalId: catalogOf([]),
      tacticIdsByTechniqueExternalId: new Map(),
    });

    expect(result.techniques.map((technique) => technique.externalId)).toEqual(['T1003']);
  });

  it('resolves an inferred candidate against the catalog rows it was handed', () => {
    const inferredCandidates = selectInferredCandidates(weights, new Set(['T1003']));
    const result = buildOutcomeTechniques({
      curated: [curated('T1003', 'signature')],
      mixture,
      weights,
      inferredCandidates,
      catalogByExternalId: catalogOf(['T1595']),
      tacticIdsByTechniqueExternalId: new Map(),
    });

    const inferred = result.techniques.find((technique) => technique.category === 'inferred')!;
    expect(inferred.externalId).toBe('T1595');
    expect(inferred.mitreTechniqueId).toBe('uuid-T1595');
    expect(inferred.sourceCount).toBe(2);
  });

  it('publishes each actor with its share and its playbook cut to the emitted techniques', () => {
    const result = buildOutcomeTechniques({
      curated: [curated('T1003', 'signature')],
      mixture,
      weights,
      inferredCandidates: [],
      catalogByExternalId: catalogOf([]),
      tacticIdsByTechniqueExternalId: new Map(),
    });

    // Same-universe contract: T1595 is in both repertoires but the outcome does not emit it, so the
    // group-conditional engine must not iterate it against a weight computed over another set.
    expect(result.mixtureGroups.map((group) => group.techniqueExternalIds)).toEqual([['T1003'], ['T1003']]);
    expect(result.mixtureGroups.map((group) => group.groupKey)).toEqual(['alpha', 'beta']);
    expect(result.mixtureGroups.reduce((total, group) => total + group.share, 0)).toBeCloseTo(1, 12);
  });

  it('keeps an inferred technique in the playbooks it was emitted from', () => {
    const inferredCandidates = selectInferredCandidates(weights, new Set(['T1003']));
    const result = buildOutcomeTechniques({
      curated: [curated('T1003', 'signature')],
      mixture,
      weights,
      inferredCandidates,
      catalogByExternalId: catalogOf(['T1595']),
      tacticIdsByTechniqueExternalId: new Map(),
    });

    expect(result.mixtureGroups.map((group) => group.techniqueExternalIds)).toEqual([
      ['T1003', 'T1595'],
      ['T1003', 'T1595'],
    ]);
  });

  it('falls back to the editorial levels when nothing admitted uses a curated technique', () => {
    const result = buildOutcomeTechniques({
      curated: [curated('T1110', 'signature'), curated('T1021', 'related')],
      mixture,
      weights,
      inferredCandidates: [],
      catalogByExternalId: catalogOf([]),
      tacticIdsByTechniqueExternalId: new Map(),
    });

    expect(result.evidenceMode).toBe('no-relevant-threats');
    expect(result.techniques.map((technique) => technique.weight)).toEqual([0.5, 0.2]);
    // No mixture to hand the engine: it keeps its flat-OR behavior on the editorial levels.
    expect(result.mixtureGroups).toEqual([]);
    // No actor was admitted, so no repertoire can be searched for an alternative: claiming a
    // chokepoint out of the editorial levels would be claiming CTI there is none.
    expect(result.techniques.map((technique) => technique.bindingShare)).toEqual([0, 0]);
  });
});

describe('computeBindingShares', () => {
  const TACTICS = new Map([
    ['T1566', ['initial-access']],
    ['T1190', ['initial-access']],
    ['T1059', ['execution']],
    // A technique legitimately belongs to several tactics: T1078 is both an entry and a persistence
    // path, so an alternative at EITHER stage is enough to make blocking it a reroute.
    ['T1078', ['initial-access', 'persistence', 'privilege-escalation']],
    ['T1136', ['persistence']],
  ]);

  it('marks a technique binding when the actor holds nothing else at any of its tactics', () => {
    const binding = computeBindingShares({
      groups: [{ groupKey: 'alpha', share: 0.4, techniqueExternalIds: ['T1566', 'T1059'] }],
      tacticIdsByTechniqueExternalId: TACTICS,
    });

    // Each technique is the actor's only one at its own stage: blocking either denies the stage.
    expect(binding.get('alpha')!.get('T1566')).toBe(true);
    expect(binding.get('alpha')!.get('T1059')).toBe(true);
  });

  it('marks a technique non-binding as soon as one same-tactic alternative exists', () => {
    const binding = computeBindingShares({
      groups: [{ groupKey: 'alpha', share: 0.4, techniqueExternalIds: ['T1566', 'T1190', 'T1059'] }],
      tacticIdsByTechniqueExternalId: TACTICS,
    });

    expect(binding.get('alpha')!.get('T1566')).toBe(false);
    expect(binding.get('alpha')!.get('T1190')).toBe(false);
    // Execution is still a single-technique stage for this actor.
    expect(binding.get('alpha')!.get('T1059')).toBe(true);
  });

  it('requires an alternative at EVERY tactic of a multi-tactic technique', () => {
    const covered = computeBindingShares({
      groups: [{ groupKey: 'alpha', share: 0.4, techniqueExternalIds: ['T1078', 'T1190'] }],
      tacticIdsByTechniqueExternalId: TACTICS,
    });
    // T1190 shares initial-access with T1078, which is enough: one documented alternative anywhere
    // means blocking T1078 reroutes rather than denies.
    expect(covered.get('alpha')!.get('T1078')).toBe(false);
    expect(covered.get('alpha')!.get('T1190')).toBe(false);

    const alone = computeBindingShares({
      groups: [{ groupKey: 'alpha', share: 0.4, techniqueExternalIds: ['T1078', 'T1059'] }],
      tacticIdsByTechniqueExternalId: TACTICS,
    });
    expect(alone.get('alpha')!.get('T1078')).toBe(true);
  });

  it('never claims a chokepoint for a technique with no tactic on file', () => {
    const binding = computeBindingShares({
      groups: [{ groupKey: 'alpha', share: 0.4, techniqueExternalIds: ['T9999'] }],
      tacticIdsByTechniqueExternalId: TACTICS,
    });

    expect(binding.get('alpha')!.get('T9999')).toBe(false);
  });

  it('folds sub-techniques onto their parent, the level the repertoire is keyed on', () => {
    const binding = computeBindingShares({
      groups: [{ groupKey: 'alpha', share: 0.4, techniqueExternalIds: ['T1078.004', 'T1059'] }],
      tacticIdsByTechniqueExternalId: TACTICS,
    });

    expect(binding.get('alpha')!.get('T1078')).toBe(true);
    expect(binding.get('alpha')!.has('T1078.004')).toBe(false);
  });
});

describe('buildOutcomeTechniques — bindingShare', () => {
  const TACTICS = new Map([
    ['T1566', ['initial-access']],
    ['T1190', ['initial-access']],
    ['T1486', ['impact']],
  ]);

  // `alpha` can only get in through T1566; `beta` also owns T1190, so blocking T1566 only reroutes
  // it. Both encrypt with T1486, which neither can substitute.
  const groups = [
    { key: 'alpha', techniqueExternalIds: ['T1566', 'T1486'] },
    { key: 'beta', techniqueExternalIds: ['T1566', 'T1190', 'T1486'] },
  ];
  const mixture = mixtureOf(groups);
  const weights = weightsOf(mixture, groups);

  const build = () => buildOutcomeTechniques({
    curated: [curated('T1566', 'signature'), curated('T1486', 'signature')],
    mixture,
    weights,
    inferredCandidates: [],
    catalogByExternalId: catalogOf([]),
    tacticIdsByTechniqueExternalId: TACTICS,
  });

  it('sums only the shares of the actors the technique is a chokepoint for', () => {
    const phishing = build().techniques.find((technique) => technique.externalId === 'T1566')!;
    const alpha = mixture.groups.find((group) => group.groupKey === 'alpha')!;

    expect(phishing.bindingShare).toBeCloseTo(alpha.share, 12);
    // Both actors use it, so the weight carries both shares while only one of them is denied.
    expect(phishing.weight).toBeGreaterThan(phishing.bindingShare);
  });

  it('reaches the full weight when every user of the technique is denied by it', () => {
    const encryption = build().techniques.find((technique) => technique.externalId === 'T1486')!;

    expect(encryption.bindingShare).toBeCloseTo(encryption.weight, 12);
  });

  it('never reports more binding share than weight, for any emitted technique', () => {
    for (const technique of build().techniques) {
      expect(technique.bindingShare).toBeLessThanOrEqual(technique.weight + Number.EPSILON);
      expect(technique.bindingShare).toBeGreaterThanOrEqual(0);
    }
  });

  it('reads the WHOLE ingested repertoire, not the outcome-filtered subset', () => {
    // T1190 is not curated on the outcome, so it is not emitted; it still gives `beta` an
    // initial-access alternative, and pretending otherwise would manufacture a chokepoint out of
    // where the analyst happened to stop curating.
    const result = build();
    expect(result.techniques.map((technique) => technique.externalId)).toEqual(['T1566', 'T1486']);

    const beta = mixture.groups.find((group) => group.groupKey === 'beta')!;
    const phishing = result.techniques.find((technique) => technique.externalId === 'T1566')!;
    expect(phishing.bindingShare).toBeCloseTo(phishing.weight - beta.share, 12);
  });
});

describe('buildRepertoireTechniques', () => {
  const groups = [
    { key: 'alpha', techniqueExternalIds: ['T1566', 'T1059'] },
    { key: 'beta', techniqueExternalIds: ['T1566', 'T1078'] },
  ];
  const mixture = mixtureOf(groups);
  const weights = weightsOf(mixture, groups);

  it('emits every technique of the repertoire, curated or not, highest weight first', () => {
    const result = buildRepertoireTechniques({
      curated: [curated('T1566', 'signature')],
      weights,
      catalogByExternalId: catalogOf(['T1566', 'T1059', 'T1078']),
      mixture,
      tacticsByExternalId: TACTIC_NAMES,
    });

    expect(result.techniques.map((technique) => technique.externalId)).toEqual(['T1566', 'T1059', 'T1078']);
    expect(result.techniques[0].weight).toBeGreaterThan(result.techniques[1].weight);
  });

  it('names the actors behind a technique with their share of the mixture', () => {
    const result = buildRepertoireTechniques({
      curated: [],
      weights,
      catalogByExternalId: catalogOf(['T1566', 'T1059', 'T1078']),
      mixture,
      tacticsByExternalId: TACTIC_NAMES,
    });

    const phishing = result.techniques.find((technique) => technique.externalId === 'T1566')!;
    expect(phishing.threats.map((threat) => threat.canonicalName).sort()).toEqual(['alpha', 'beta']);
    const summed = phishing.threats.reduce((total, threat) => total + threat.share, 0);
    expect(summed).toBeCloseTo(phishing.weight, 12);
  });

  it('counts a curated technique no admitted actor plays instead of listing it', () => {
    const result = buildRepertoireTechniques({
      curated: [curated('T1566', 'signature'), curated('T1490', 'related')],
      weights,
      catalogByExternalId: catalogOf(['T1566', 'T1059', 'T1078', 'T1490']),
      mixture,
      tacticsByExternalId: TACTIC_NAMES,
    });

    expect(result.techniques.map((technique) => technique.externalId)).not.toContain('T1490');
    expect(result.unplayedCuratedCount).toBe(1);
  });

  it('counts a curated sub-technique against its played parent', () => {
    const parentGroups = [{ key: 'alpha', techniqueExternalIds: ['T1003.001'] }];
    const parentMixture = mixtureOf(parentGroups);
    const result = buildRepertoireTechniques({
      curated: [curated('T1003', 'signature')],
      weights: weightsOf(parentMixture, parentGroups),
      catalogByExternalId: catalogOf(['T1003']),
      mixture: parentMixture,
      tacticsByExternalId: TACTIC_NAMES,
    });

    expect(result.techniques.map((technique) => technique.externalId)).toEqual(['T1003']);
    expect(result.unplayedCuratedCount).toBe(0);
  });

  it('carries the mixture the shares were read against, and the tactics in ATT&CK order', () => {
    const tacticGroups = [{ key: 'alpha', techniqueExternalIds: ['T1078'] }];
    const tacticMixture = mixtureOf(tacticGroups);
    const result = buildRepertoireTechniques({
      curated: [],
      mixture: tacticMixture,
      weights: weightsOf(tacticMixture, tacticGroups),
      catalogByExternalId: catalogOf(['T1078']),
      tacticsByExternalId: TACTIC_NAMES,
    });

    expect(result.techniques[0].tacticNames).toEqual(['Initial Access', 'Persistence']);
    expect(result.actors.map((actor) => actor.canonicalName)).toEqual(['alpha']);
    expect(result.actors[0].share).toBeCloseTo(1, 10);
  });

  it('lists every admitted actor, highest share first, including one that plays nothing listed', () => {
    const mixedGroups = [
      { key: 'alpha', techniqueExternalIds: ['T1566', 'T1059', 'T1078'] },
      { key: 'beta', techniqueExternalIds: ['T1566'] },
    ];
    const mixedMixture = mixtureOf(mixedGroups);
    const result = buildRepertoireTechniques({
      curated: [],
      mixture: mixedMixture,
      weights: weightsOf(mixedMixture, mixedGroups),
      catalogByExternalId: catalogOf(['T1566', 'T1059', 'T1078']),
      tacticsByExternalId: TACTIC_NAMES,
    });

    expect(result.actors).toHaveLength(2);
    for (let index = 1; index < result.actors.length; index += 1) {
      expect(result.actors[index - 1].share).toBeGreaterThanOrEqual(result.actors[index].share);
    }
    // beta is admitted, but plays neither T1059 nor T1078.
    const solo = result.techniques.find((technique) => technique.externalId === 'T1059')!;
    expect(solo.threats.map((threat) => threat.canonicalName)).toEqual(['alpha']);
  });

  it('drops a repertoire technique the catalog does not know rather than fabricating it', () => {
    const result = buildRepertoireTechniques({
      curated: [],
      weights,
      catalogByExternalId: catalogOf(['T1566']),
      mixture,
      tacticsByExternalId: TACTIC_NAMES,
    });

    expect(result.techniques.map((technique) => technique.externalId)).toEqual(['T1566']);
  });
});

describe('the mixture-pending results', () => {
  it('answers the outcome read with its mode and nothing else', () => {
    expect(buildPendingOutcomeTechniques()).toEqual({ evidenceMode: 'mixture-pending', mixtureGroups: [], techniques: [] });
  });

  it('answers the repertoire read with its mode and nothing else', () => {
    expect(buildPendingRepertoireTechniques()).toEqual({
      evidenceMode: 'mixture-pending',
      actors: [],
      techniques: [],
      unplayedCuratedCount: 0,
    });
  });
});

describe('the no-scenario results', () => {
  const outcomeCurated = [curated('T1486', 'signature'), curated('T1490', 'related')];

  it('answers the outcome read with the curated fallback under its own mode', () => {
    const result = buildNoEvidenceResult(outcomeCurated, 'no-scenario');

    expect(result.evidenceMode).toBe('no-scenario');
    expect(result.techniques.map((technique) => technique.externalId)).toEqual(['T1486', 'T1490']);
    expect(result).toEqual({ ...buildNoEvidenceResult(outcomeCurated, 'no-relevant-threats'), evidenceMode: 'no-scenario' });
  });

  it('answers the repertoire read with every curated technique unplayed', () => {
    expect(buildNoRepertoireResult(outcomeCurated, 'no-scenario')).toEqual({
      evidenceMode: 'no-scenario',
      actors: [],
      techniques: [],
      unplayedCuratedCount: 2,
    });
  });
});

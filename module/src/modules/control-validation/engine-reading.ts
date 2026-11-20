import type { CapabilityFunction, StrengthReferenceRung } from '../controls/capability/constants';
import type { EffectiveEdge } from '../controls/capability/effective-coverage';
import type { ResolvedPosture } from '../controls/capability/scope-posture';
import type { PhishingStageName } from '../crq-indicators/engine/attack-run-constants';
import type { AttackRunTestedCell } from '../crq-indicators/engine/attack-run-law';
import type { TechniqueTestResult } from './technique-test-results';
import type { TechniqueDeclaration } from './technique-test-readings';
import { coverageCoefficient } from '../controls/capability/constants';
import { isScoredEdge } from '../controls/capability/effective-coverage';
import { phishingStageAnchorOf } from '../crq-indicators/engine/attack-run-constants';
import { phishingStageNameOf, phishingStageTechniquesOf, testedCellReader } from '../crq-indicators/engine/attack-run-law';
import { anchoredStrength, declaredStrength } from '../crq-indicators/engine/attack-run-worlds';
import { foldToParentTechnique } from '../threat-analyses/technique-weighting';

/*
 * The one place control validation reads the CRQ engine's law: which cells it audits, and the
 * declarations it audits them against. Reading the engine's own functions, rather than restating
 * them, is what keeps a rebook and a screen's efficacy on what the engine prices.
 */

interface StageAnchor {
  stage: PhishingStageName,
  byRung: Readonly<Record<StrengthReferenceRung, number>>,
}

interface EngineReader {
  /** The cells the law reads of the control, by technique external id. */
  reads: (cell: Pick<AttackRunTestedCell, 'function' | 'techniqueExternalId'>) => boolean,
  /** The stage anchor the control reads at its phishing stage, null where it has none. */
  anchor: StageAnchor | null,
  stageTechniqueExternalIds: ReadonlyArray<string>,
}

export interface EngineReaders {
  byCapability: ReadonlyMap<string, EngineReader>,
  /** Every technique a reader can read, by id; a stored row sits on the parent an edge on a sub-technique names. */
  externalIdOf: ReadonlyMap<string, string>,
}

type ReadingKey = Pick<TechniqueTestResult, 'capabilityId' | 'function' | 'mitreTechniqueId'>;

/** How the engine reads each control's stored rows, from the scored edges it compiles the control from. */
export const engineReadersOf = (
  edges: ReadonlyArray<EffectiveEdge>,
  techniques: ReadonlyArray<{ id: string, externalId: string, parentTechniqueId: string | null }>,
  capabilities: ReadonlyArray<{ id: string, externalId: string }>,
): EngineReaders => {
  const externalIdOf = new Map<string, string>();
  for (const technique of techniques) {
    externalIdOf.set(technique.id, technique.externalId);
    if (technique.parentTechniqueId !== null) {
      externalIdOf.set(technique.parentTechniqueId, foldToParentTechnique(technique.externalId));
    }
  }
  const edgesByCapability = Map.groupBy(edges.filter(isScoredEdge), (edge) => edge.capabilityId);
  const byCapability = new Map<string, EngineReader>();
  for (const capability of capabilities) {
    const covered = (fn: CapabilityFunction): Array<string> => (edgesByCapability.get(capability.id) ?? [])
      .filter((edge) => edge.function === fn)
      .flatMap((edge) => externalIdOf.get(edge.techniqueId) ?? []);
    const control = { preventTechniqueExternalIds: covered('prevent'), detectTechniqueExternalIds: covered('detect') };
    const stage = phishingStageNameOf(control.preventTechniqueExternalIds);
    const byRung = phishingStageAnchorOf(capability.externalId, stage);
    byCapability.set(capability.id, {
      reads: testedCellReader(control),
      anchor: stage === null || byRung === null ? null : { stage, byRung },
      stageTechniqueExternalIds: phishingStageTechniquesOf(control.preventTechniqueExternalIds),
    });
  }
  return { byCapability, externalIdOf };
};

/**
 * Whether the engine reads a stored row, the one thing a control's levers are priced on: a parent
 * technique's row on a cell the law reads. A sub-technique's own row is for the screens.
 */
export const engineReads = (readers: EngineReaders, row: ReadingKey & Pick<TechniqueTestResult, 'grain'>): boolean => {
  const techniqueExternalId = readers.externalIdOf.get(row.mitreTechniqueId);
  return row.grain === 'technique'
    && techniqueExternalId !== undefined
    && readers.byCapability.get(row.capabilityId)?.reads({ function: row.function, techniqueExternalId }) === true;
};

/**
 * The stage anchor the engine reads a control at on a technique: on prevent, a technique of the
 * control's anchored phishing stage; none elsewhere, where the shared rung scale stands. An anchored
 * stage holds one technique, so the stage's tested result is that technique's own row.
 */
const stageAnchorAt = (readers: EngineReaders, key: ReadingKey): StageAnchor | null => {
  const reader = readers.byCapability.get(key.capabilityId);
  const techniqueExternalId = readers.externalIdOf.get(key.mitreTechniqueId);
  return key.function === 'prevent' && reader?.anchor != null && techniqueExternalId !== undefined
    && reader.stageTechniqueExternalIds.includes(techniqueExternalId)
    ? reader.anchor
    : null;
};

/**
 * Every efficacy the engine audits a control's technique against: the shared rung scale, and on a
 * prevent technique of the control's anchored phishing stage, the stage anchor too.
 */
export const declaredReadings = (posture: ResolvedPosture | undefined, key: ReadingKey, readers: EngineReaders): Array<number> => {
  if (posture === undefined) {
    return [0];
  }
  const coverage = coverageCoefficient(posture.coverageBucket);
  const shared = declaredStrength(posture.strengthRung) * coverage;
  const anchor = stageAnchorAt(readers, key);
  return anchor === null ? [shared] : [shared, anchoredStrength(anchor.byRung, posture.strengthRung) * coverage];
};

/** Each control's declaration at one level, on the engine's scale. */
export const declarationsOf = (postures: ReadonlyArray<ResolvedPosture & { capabilityId: string }>): Map<string, TechniqueDeclaration> =>
  new Map(postures.map((posture) => [posture.capabilityId, {
    strengthRung: posture.strengthRung,
    coverageBucket: posture.coverageBucket,
    strength: declaredStrength(posture.strengthRung),
    coverage: coverageCoefficient(posture.coverageBucket),
    phishingStage: null,
  }]));

/** A control's declaration as the engine reads it on a technique: on its anchored phishing stage, the strength is the stage anchor. */
export const declarationAt = (
  declaration: TechniqueDeclaration | undefined,
  readers: EngineReaders,
  key: ReadingKey,
): TechniqueDeclaration | null => {
  if (declaration === undefined) {
    return null;
  }
  const anchor = stageAnchorAt(readers, key);
  return anchor === null
    ? declaration
    : { ...declaration, strength: anchoredStrength(anchor.byRung, declaration.strengthRung), phishingStage: anchor.stage };
};

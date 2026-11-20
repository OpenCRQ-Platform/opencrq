import type { EntryAsset, UnknownExposureCountsAs } from '../attack-surfaces/entry-applicability';
import type { PhishingDeclarationSettings } from '../crq-indicator-settings/phishing-declaration';
import { entryTechniqueApplies, isInitialAccessTechnique } from '../attack-surfaces/entry-applicability';
import { DEFAULT_PHISHING_SUSCEPTIBILITY, PHISHING_TECHNIQUE } from '../attack-surfaces/phishing';
import { freshPhishingFailureRate } from '../crq-indicator-settings/phishing-declaration';

/** How likely playing a technique the finding opens compromises the asset, controls aside, on 0 to 1. */
export const techniqueOpening = (access: number, threat: number, impact: number): number => access * threat * impact;

export const openingFigure = (opening: number): number => Math.round(100 * opening);

export interface FindingOpeningInput {
  asset: EntryAsset,
  unknownExposureCountsAs: UnknownExposureCountsAs,
  /** The exploitation techniques the finding claims, already narrowed to what the asset's family carries. */
  techniques: ReadonlyArray<{ techniqueId: string, externalId: string }>,
  /** The vector's access contribution, without the exposure weight: the gate carries exposure per technique. */
  access: number,
  threat: number,
  impact: number,
}

export interface TechniqueOpening {
  mitreTechniqueId: string,
  opening: number,
}

export const findingOpenings = (input: FindingOpeningInput): Array<TechniqueOpening> => {
  const opening = techniqueOpening(input.access, input.threat, input.impact);
  return input.techniques
    .filter((technique) => !isInitialAccessTechnique(technique.externalId)
      || entryTechniqueApplies(technique.externalId, input.asset, input.unknownExposureCountsAs))
    .map((technique) => ({ mitreTechniqueId: technique.techniqueId, opening }));
};

/** Where an asset's cell on a technique comes from: a finding that opens it, or the susceptibility of a person. */
export type TechniqueScoreSource = 'finding' | 'susceptibility';

export interface SusceptibilitySettings extends PhishingDeclarationSettings {
  unknownExposureCountsAs: UnknownExposureCountsAs,
}

export interface SusceptibilityCell {
  /** The rate on 0 to 100, rounded for a gauge. */
  score: number,
  /** The exact share, declared or default, on 0 to 1. */
  rate: number,
  /** False when the figure is the default, no simulation rate being declared or the declared one expired. */
  declared: boolean,
  /** True when a simulation is declared but older than the validity window of a measured result. */
  expired: boolean,
  measuredOn: string | null,
}

/**
 * The phishing cell of a person, before any control: the tenant's declared simulation rate while it
 * is fresh, else the default, as the engine reads them. A person is what the door counts as one, an
 * enabled user account, so the cell and the engine share `entryTechniqueApplies`; a device keeps the
 * cell its findings open.
 */
export const susceptibilityCell = (asset: EntryAsset, settings: SusceptibilitySettings, now: Date): SusceptibilityCell | null => {
  const isUserAccount = asset.categoryId === 'identity' && asset.subcategoryId === 'user_account';
  if (!isUserAccount || !entryTechniqueApplies(PHISHING_TECHNIQUE, asset, settings.unknownExposureCountsAs)) {
    return null;
  }
  const fresh = freshPhishingFailureRate(settings, now);
  const rate = fresh ?? DEFAULT_PHISHING_SUSCEPTIBILITY;
  return {
    score: openingFigure(rate),
    rate,
    declared: fresh !== null,
    expired: fresh === null && settings.phishingFailureRate !== null,
    measuredOn: settings.phishingFailureMeasuredOn,
  };
};

export interface TechniqueScoreCellKey {
  supportingAssetId: string,
  mitreTechniqueId: string,
}

export interface HeldOpening extends TechniqueScoreCellKey {
  opening: number,
  evidenceId: string,
}

export type HeldOpenings = Map<string, HeldOpening>;

export const heldOpeningKey = (cell: TechniqueScoreCellKey): string => `${cell.supportingAssetId}|${cell.mitreTechniqueId}`;

/** A tie goes to the lower finding id, so a run holds the same finding whatever order it reads them in. */
export const holdWorstOpening = (held: HeldOpenings, candidate: HeldOpening): void => {
  const key = heldOpeningKey(candidate);
  const current = held.get(key);
  if (
    current === undefined
    || candidate.opening > current.opening
    || (candidate.opening === current.opening && candidate.evidenceId < current.evidenceId)
  ) {
    held.set(key, candidate);
  }
};

export interface EntryOpeningKey {
  assetEvidenceId: string,
  mitreTechniqueId: string,
}

export interface EntryOpeningRow extends EntryOpeningKey {
  supportingAssetId: string,
  cveId: string,
  opening: number,
  threat: number,
}

export const entryOpeningKey = (key: EntryOpeningKey): string => `${key.assetEvidenceId}|${key.mitreTechniqueId}`;

import type { ThreatEntityType } from '@app/module/client';
import { formatFractionAsPercent } from '../../utils/format-number';

/** The two readings of one technique set: how much it is played, and what it is worth. */
export type TtpReading = 'usage' | 'value';

export const TTP_READINGS: ReadonlyArray<TtpReading> = ['usage', 'value'];

export type TechniqueGap = 'estate' | 'catalogue';

export interface RepertoireActor {
  id: string,
  canonicalName: string,
  entityType: ThreatEntityType,
  share: number,
}

export interface RepertoireTechnique {
  mitreTechniqueId: string,
  externalId: string,
  name: string,
  weight: number,
  threats: Array<RepertoireActor>,
  sourceCount: number,
  tacticNames: Array<string>,
}

export interface TechniqueValue {
  mitreTechniqueId: string,
  preventValueMean: number | null,
  detectValueMean: number | null,
}

export interface TechniqueReachGap {
  mitreTechniqueId: string,
  gap: TechniqueGap,
}

export interface TtpRow {
  id: string,
  externalId: string,
  name: string,
  weight: number,
  sourceCount: number,
  tacticNames: Array<string>,
  /** What preventing the technique is worth. Null when it was not priced, like the other two. */
  preventValue: number | null,
  /** What covering its detection is worth. */
  detectValue: number | null,
  /** What interdicting the technique is worth, both levers together. */
  value: number | null,
  /** Why the run could not price it, when it said so. */
  gap: TechniqueGap | null,
}

const pricedLevers = (value: TechniqueValue | undefined): { prevent: number, detect: number } | null => (
  value === undefined || value.preventValueMean === null || value.detectValueMean === null
    ? null
    : { prevent: value.preventValueMean, detect: value.detectValueMean });

/**
 * The rows are the repertoire's, never the run's: a run older than the last ingestion prices
 * techniques the actors no longer carry, and listing those would put the tab on a set the Relevant
 * Threats tab disagrees with. A reach gap is emitted per (technique, family) pair, so the first one
 * naming a technique is the reason kept for it.
 */
export const buildTtpRows = (params: {
  techniques: Array<RepertoireTechnique>,
  techniqueValues: Array<TechniqueValue>,
  reachGaps: Array<TechniqueReachGap>,
}): Array<TtpRow> => {
  const valueByTechniqueId = new Map(params.techniqueValues.map((value) => [value.mitreTechniqueId, value]));
  const gapByTechniqueId = new Map<string, TechniqueGap>();
  for (const reachGap of params.reachGaps) {
    if (!gapByTechniqueId.has(reachGap.mitreTechniqueId)) {
      gapByTechniqueId.set(reachGap.mitreTechniqueId, reachGap.gap);
    }
  }
  return params.techniques.map((technique) => {
    const levers = pricedLevers(valueByTechniqueId.get(technique.mitreTechniqueId));
    return {
      id: technique.mitreTechniqueId,
      externalId: technique.externalId,
      name: technique.name,
      weight: technique.weight,
      sourceCount: technique.sourceCount,
      tacticNames: technique.tacticNames,
      preventValue: levers?.prevent ?? null,
      detectValue: levers?.detect ?? null,
      value: levers === null ? null : levers.prevent + levers.detect,
      gap: gapByTechniqueId.get(technique.mitreTechniqueId) ?? null,
    };
  });
};

/**
 * A technique the attack path gives no step to: interdicting it replays every world through the very
 * same arithmetic as the baseline, so both levers come out as exact zeros. A technique that is played
 * moves the loss by at least a rounding residue, which is why only an exact zero reads this way.
 */
export const isUnplayedTechnique = (row: TtpRow): boolean => row.preventValue === 0 && row.detectValue === 0;

/** Null when the run carries no exposure to divide by, rather than a share of nothing. */
export const shareOfExposure = (value: number, exposure: number): number | null =>
  (exposure <= 0 ? null : value / exposure);

/** The share of the scenario's exposure at which a contribution reads as high. */
export const HIGH_SHARE_OF_EXPOSURE = 0.15;

/**
 * The bar reads the scale the tone reads, and fills at the share of exposure the tone calls high,
 * so a cell never encodes its one number twice on two scales.
 *
 * Unpriced rows and a run with no exposure draw no bar rather than a full one.
 */
export const valueFillRatio = (value: number | null, exposure: number): number | null => {
  if (value === null || exposure <= 0) {
    return null;
  }
  return Math.min(1, Math.max(0, value) / (HIGH_SHARE_OF_EXPOSURE * exposure));
};

/** Four steps of one hue, faintest first. */
export type IntensityStep = 1 | 2 | 3 | 4;

/** The share of the threat at which a technique reads as widely played. */
export const HIGH_SHARE_OF_THREAT = 0.35;

/**
 * How widely a technique is played, read against the whole threat rather than against the
 * most-played technique of the scenario. Relative to the set, the top technique is always the
 * brightest even when it is played by a twentieth of the threat, and the four most-played of a
 * scenario come out at 100%, 98%, 98% and 98% of each other, an indistinguishable block. The cuts
 * are measured instead: over every technique of the seeded scenarios the share runs from 1% to 46%,
 * quartiles at 10%, 17% and 31%.
 */
export const usageStep = (weight: number): IntensityStep => {
  if (weight > HIGH_SHARE_OF_THREAT) {
    return 4;
  }
  if (weight > 0.2) {
    return 3;
  }
  if (weight > 0.1) {
    return 2;
  }
  return 1;
};

/**
 * The share itself, drawn whole and never rescaled: a technique reaches the end of the bar only by
 * being played by every threat that weighs on the scenario. Rescaling so that the top step fills the bar would put back
 * the indistinguishable block the steps above exist to break.
 */
export const usageFillRatio = (weight: number): number => Math.min(1, Math.max(0, weight));

/**
 * What a technique's value says to the defender. The value is the annual loss interdicting the
 * technique would shed, so the alarming end is what is most worth treating and `benign` is what
 * treating would barely move.
 */
export type ValueTone = 'benign' | 'low' | 'medium' | 'high';

/**
 * Read against the scenario's own annual loss exposure, never against the largest technique of the
 * set: a relative scale paints the biggest contribution red even when every contribution is
 * negligible, and calls a technique dangerous for being first among trivia.
 *
 * Most techniques are worth little alone (34 of 47 under 1% of the ALE on a typical estate),
 * so 1% separates the ones that carry nothing, 5% the ordinary contributors, and 15% the few that
 * genuinely move the figure.
 *
 * An exposure of 0 is a run that carries no priced loss to compare against, and everything reads
 * benign rather than inventing an alarm from a scale that does not exist.
 */
export const valueTone = (value: number, exposure: number): ValueTone => {
  const share = exposure <= 0 ? 0 : value / exposure;
  // Inclusive at the cuts so the bar, which fills at exactly `HIGH_SHARE_OF_EXPOSURE`, turns high
  // on the same contribution rather than one step behind it.
  if (share >= HIGH_SHARE_OF_EXPOSURE) {
    return 'high';
  }
  if (share >= 0.05) {
    return 'medium';
  }
  if (share >= 0.01) {
    return 'low';
  }
  return 'benign';
};

export const formatShare = (share: number): string => formatFractionAsPercent(share, 0);

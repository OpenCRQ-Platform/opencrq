import type { ActorClass } from '../../threat-analyses/actor-classes';
import type { StrengthReferenceRung } from '../../controls/capability/constants';
import type { AttackRunConstants } from './attack-run-law';
import { ACTOR_CLASS_PRESETS } from '../../threat-analyses/actor-classes';
import { DEFAULT_PHISHING_SUSCEPTIBILITY, PHISHING_TECHNIQUE } from '../../attack-surfaces/phishing';
import { ACTOR_EXPLOITED_CVE_FLOOR, COUPLE_SUCCESS_CAP } from './engine-constants';

/**
 * The attack run engine's constants, as OpenCRQ's calibration landed them.
 *
 * Every figure the engine displays is computed from these, and every surface displaying one names
 * the calibration it rests on: {@link ATTACK_RUN_CALIBRATION_VINTAGE} is what a run records so a
 * surface can state it rather than invent it.
 *
 * Three provenances, and they are not interchangeable. **Swept** and **fitted** values come from
 * the calibration, which measured a feasible window or a point against the shipped closed forms.
 * **Read** values are owned by a shipped surface and imported here rather than restated.
 * **Judgment** values are chosen by OpenCRQ's calibration and are the ones a customer's security
 * officer is entitled to hear named as arguments rather than measurements.
 */

/** What a run records so every surface can say which calibration it is displaying. */
export const ATTACK_RUN_CALIBRATION_VINTAGE = 'replay-2026-10-12';

/**
 * The constants this vintage leaves at one end of their domain rather than at a calibrated point.
 *
 * A reader who cannot tell a default from a decision has no way to ask the right question about the
 * figure in front of them, so a run names them beside the number it displays. The chain correlation
 * is the live one: a control's coverage enters every attempt as an independent presence, where the
 * steps played on a machine already held share the presence of the step that took it.
 */
export const ATTACK_RUN_CORNER_CONSTANTS: ReadonlyArray<string> = [
  'CHAIN_CORRELATION: coverage read as an independent presence at every attempt, the independent end',
];

/** Hard ceiling on a control's strength, whatever its rung. Arithmetic guard. */
export const ATTACK_RUN_THETA_CAP = 0.95;

export const ATTACK_RUN_CONSTANTS: AttackRunConstants = {
  // Swept by OpenCRQ's calibration, and it compounds over the obstacles after the door: below the
  // window the weakest classes are stopped on an estate that declares nothing, above it the
  // stronger classes overrun their ceilings.
  visitQuota: 16,
  // Judgment: the most detection opportunities a wave gets, kept apart from the visits so that
  // refitting those leaves the detection of the door where it is.
  populationDetectionCap: 7,
  // Judgment: the top of NIST's very low band, scaled as FAIR reads threat capability.
  unknownFlawFloorScale: 0.04,
  // Fitted by OpenCRQ's calibration, at the gain below and at the shipped efficacy rate.
  detectionScale: 0.0403,
  // Judgment, and chosen rather than fitted: the gain and the scale are not separately identifiable,
  // so the gain is decided first and the scale fitted at it.
  signalGain: 0.3,
  // Judgment: the share of an intrusion that runs without tooling its attacker had to establish,
  // since many intrusions use no malware at all, kept below one because some still depend on it.
  execFloor: 0.7,
  // Fitted by OpenCRQ's calibration.
  postDetectionRate: 1.071,
  // Read: shipped arithmetic guards, nothing to calibrate.
  coupleSuccessCap: COUPLE_SUCCESS_CAP,
  actorExploitedCveFloor: ACTOR_EXPLOITED_CVE_FLOOR,
};

/**
 * Price of a detected impact, as a fraction of the magnitude. Judgment, bracketed rather than
 * fixed: detection shortens the loss without undoing it. It is the prevent-versus-detect exchange
 * rate, so moving it swings every detect control's value: it belongs in the sensitivity run, not in
 * a quiet edit.
 */
export const DETECTED_MAGNITUDE_FACTOR = 0.75;

/**
 * Price of an eviction, as a fraction of the magnitude: the response was paid for and the impact
 * was not. Judgment, not fitted.
 */
export const RESPONSE_COST_FRACTION = 0.15;

/**
 * The clock the eviction race runs against, in days, per actor class. Judgment on every row.
 */
export const ATTACK_RUN_DAYS_BY_CLASS: Readonly<Record<ActorClass, number>> = {
  opportunistic_crime: 1,
  ransomware_operator: 5,
  hacktivist: 2,
  default: 14,
  state_sponsored: 90,
};

/**
 * The reaction time a run reads where the organisation declares none, in hours. It is the platform's
 * own seeded triplet rather than a number invented here, so a tenant that never filled the field is
 * scored against the same clock the seed data describes.
 */
export const DEFAULT_REACTION_TIME_HOURS = { min: 0.5, likely: 8, max: 96 };

/**
 * What the phishing entry reads from the people of the scope. `defaultSusceptibility` is the share
 * of a campaign's recipients who take a compromising action when the tenant declares no simulation
 * rate. `credentialShare` is the part of phishing that harvests credentials, the rest delivering a
 * payload. `clientExploitShare` is the part of the payload branch that needs a client-side flaw on
 * the person's device to run, a judgment.
 */
export const PHISHING_CONSTANTS: {
  readonly defaultSusceptibility: number,
  readonly credentialShare: number,
  readonly clientExploitShare: number,
} = {
  defaultSusceptibility: DEFAULT_PHISHING_SUSCEPTIBILITY,
  credentialShare: 0.7,
  clientExploitShare: 0.2,
};

/** The capabilities whose declared posture a phishing simulation rate was measured under. */
export const PHISHING_TRAINING_CAPABILITIES: ReadonlyArray<string> = ['SAT'];

/**
 * The parent techniques whose prevent edges place a control at a stage of a phishing campaign: the
 * email reaching the person, the credentials the person gives, the payload the person runs. A
 * control acts at the first stage, in this order, that holds one of its edges.
 */
export const PHISHING_STAGE_TECHNIQUES: Readonly<Record<'delivery' | 'credential' | 'payload', ReadonlyArray<string>>> = {
  delivery: [PHISHING_TECHNIQUE],
  credential: ['T1078'],
  payload: ['T1204', 'T1203'],
};

export type PhishingStageName = keyof typeof PHISHING_STAGE_TECHNIQUES;

/**
 * The strength a control reads at its own phishing stage, per declared rung, in place of the shared
 * rung scale, and only at that stage: every per-technique product and every other obstacle keeps the
 * shared scale, and coverage is read as for any control. Judgment rather than fitted: OpenCRQ's
 * calibration chose the value each rung reads. Not capped by `ATTACK_RUN_THETA_CAP`, which would
 * flatten the top rungs onto each other.
 *
 * - SEG, email security, at delivery: the share of threats it stops. L1 reads the lowest value.
 * - IDP, through its multi-factor authentication, at the credential stage: the share of targeted
 *   attacks blocked by the factor each rung stands for, the top rung read at 0.99 rather than 1.
 */
export const PHISHING_STAGE_ANCHORS: Readonly<Record<string, {
  readonly stage: PhishingStageName,
  readonly strengthByRung: Readonly<Record<StrengthReferenceRung, number>>,
}>> = {
  SEG: { stage: 'delivery', strengthByRung: { L1: 0.89, L2: 0.97, L3: 0.98 } },
  IDP: { stage: 'credential', strengthByRung: { L1: 0.76, L2: 0.9, L3: 0.99 } },
};

/** The anchor of a control at the stage its edges place it at, null where it has none there. */
export const phishingStageAnchorOf = (
  capabilityExternalId: string,
  stage: PhishingStageName | null,
): Readonly<Record<StrengthReferenceRung, number>> | null => {
  const anchor = PHISHING_STAGE_ANCHORS[capabilityExternalId];
  return anchor !== undefined && anchor.stage === stage ? anchor.strengthByRung : null;
};

/** Either a number of recipients that does not scale with the workforce, or a share of it with its fewest recipients. */
type PhishingCampaign =
  | { readonly fixed: number }
  | { readonly share: number, readonly floor: number };

/** Recipients of one campaign, per actor class. Judgment, weak on the shares; the hacktivist row reads the targeted values as a stated assumption. */
export const PHISHING_CAMPAIGN_BY_CLASS: Readonly<Record<ActorClass, PhishingCampaign>> = {
  opportunistic_crime: { share: 0.01, floor: 1 },
  ransomware_operator: { share: 0.3, floor: 10 },
  hacktivist: { fixed: 10 },
  default: { fixed: 10 },
  state_sponsored: { fixed: 10 },
};

/** Fractional when a share gives one: the engine reads it as a count of chances, not a head count. */
export const phishingCampaignSize = (actorClass: ActorClass, people: number): number => {
  if (people <= 0) {
    return 0;
  }
  const campaign = PHISHING_CAMPAIGN_BY_CLASS[actorClass];
  const recipients = 'fixed' in campaign ? campaign.fixed : Math.max(campaign.floor, campaign.share * people);
  return Math.min(people, recipients);
};

export const actorClassKnobs = (actorClass: ActorClass): {
  capability: number,
  stealth: number,
  patience: number,
  attackRunDays: number,
} => ({
  ...ACTOR_CLASS_PRESETS[actorClass],
  attackRunDays: ATTACK_RUN_DAYS_BY_CLASS[actorClass],
});

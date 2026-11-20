/**
 * Prerequisites and effects of the attack run walk: what an attacker must hold to attempt a tactic
 * and what holding it grants. The attack topology (the OR of several tactics granting one fact,
 * the AND of lateral movement) emerges from these rows; nothing anywhere encodes a hand-drawn
 * chain. Vendored and identical for every tenant: edits are code reviews, not tenant data.
 */

/** ATT&CK knowledge-base release these rows are written against, as data for consumers to display. */
export const ATTACK_WALK_TABLES_RELEASE = 'attack-enterprise-20.0';

export const ATTACKER_FACTS = ['foothold', 'credentials', 'knowledge', 'deep_access', 'gathered_data'] as const;
export type AttackerFact = (typeof ATTACKER_FACTS)[number];

export interface WalkRule {
  readonly requires: ReadonlyArray<AttackerFact>,
  readonly grants: ReadonlyArray<AttackerFact>,
  /** Succeeding at this tactic reaches the objective of any outcome that declares it terminal. */
  readonly terminal: boolean,
}

export interface TacticWalkRule extends WalkRule {
  readonly tacticExternalId: string,
}

/**
 * Pre-compromise tactics: they happen outside the victim's estate, so they are neither a step of
 * the walk nor a detectable action, and deliberately carry no row in either table.
 */
export const PRE_COMPROMISE_TACTIC_EXTERNAL_IDS: ReadonlyArray<string> = ['TA0043', 'TA0042'];

export const TACTIC_WALK_RULES: ReadonlyArray<TacticWalkRule> = [
  // Initial Access
  { tacticExternalId: 'TA0001', requires: [], grants: ['foothold'], terminal: false },
  // Execution
  { tacticExternalId: 'TA0002', requires: ['foothold'], grants: [], terminal: false },
  // Persistence
  { tacticExternalId: 'TA0003', requires: ['foothold'], grants: [], terminal: false },
  // Privilege Escalation
  { tacticExternalId: 'TA0004', requires: ['foothold'], grants: ['credentials'], terminal: false },
  // Stealth
  { tacticExternalId: 'TA0005', requires: ['foothold'], grants: [], terminal: false },
  // Defense Impairment
  { tacticExternalId: 'TA0112', requires: ['foothold'], grants: [], terminal: false },
  // Credential Access
  { tacticExternalId: 'TA0006', requires: ['foothold'], grants: ['credentials'], terminal: false },
  // Discovery (internal reconnaissance)
  { tacticExternalId: 'TA0007', requires: ['foothold'], grants: ['knowledge'], terminal: false },
  // Lateral Movement
  { tacticExternalId: 'TA0008', requires: ['foothold', 'credentials', 'knowledge'], grants: ['deep_access'], terminal: false },
  // Collection
  { tacticExternalId: 'TA0009', requires: ['deep_access'], grants: ['gathered_data'], terminal: false },
  // Command and Control
  { tacticExternalId: 'TA0011', requires: ['foothold'], grants: [], terminal: false },
  // Exfiltration
  { tacticExternalId: 'TA0010', requires: ['gathered_data'], grants: [], terminal: true },
  // Impact
  { tacticExternalId: 'TA0040', requires: ['deep_access'], grants: [], terminal: true },
];

/**
 * Techniques whose prerequisites genuinely differ from their tactic's. T1078 Valid Accounts is
 * initial access that requires already-held credentials: one more door into the estate, guarded by
 * different controls (MFA reduces converting credentials into access, not possessing them).
 */
export const TECHNIQUE_WALK_EXCEPTIONS: Readonly<Record<string, WalkRule>> = {
  T1078: { requires: ['credentials'], grants: ['foothold'], terminal: false },
};

/**
 * The tactics where the scenario group reweights assets, the only steps the simulation overweights:
 * the ones that touch the targeted resource, because they gather it or realize the objective on it.
 */
export const RESOURCE_TOUCHING_TACTIC_EXTERNAL_IDS: ReadonlyArray<string> = TACTIC_WALK_RULES
  .filter((rule) => rule.terminal || rule.grants.includes('gathered_data'))
  .map((rule) => rule.tacticExternalId);

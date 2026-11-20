import { ATTACK_WALK_TABLES_RELEASE, PRE_COMPROMISE_TACTIC_EXTERNAL_IDS } from './attack-walk';

/** ATT&CK release this table is written against, the same vintage as the prerequisites table. */
export const ATTACK_NOISE_TABLES_RELEASE = ATTACK_WALK_TABLES_RELEASE;

/**
 * Noise of the attack run walk: how loud one action of a tactic is, on a 0-1 scale where
 * 0 leaves no usable trace and 1 is an alarm-grade trace. The values feed the detection signal
 * recurrence (the actor's stealth attenuates them there, not here). External reconnaissance and
 * resource development carry no entry by design: mass scanning is permanent background noise, not
 * a detectable attack run step.
 */
export const NOISE_BY_TACTIC: Readonly<Record<string, number>> = {
  // Initial Access
  TA0001: 0.5,
  // Execution
  TA0002: 0.5,
  // Persistence
  TA0003: 0.4,
  // Privilege Escalation
  TA0004: 0.6,
  // Stealth
  TA0005: 0.1,
  // Defense Impairment: tampering with the defenses is itself a visible act
  TA0112: 0.7,
  // Credential Access
  TA0006: 0.6,
  // Discovery: internal reconnaissance is the loud one
  TA0007: 0.8,
  // Lateral Movement
  TA0008: 0.7,
  // Collection
  TA0009: 0.4,
  // Command and Control
  TA0011: 0.3,
  // Exfiltration: over a legitimate channel, the quiet way out
  TA0010: 0.2,
  // Impact
  TA0040: 0.9,
};

/** Techniques markedly quieter or louder than their tactic's typical action. */
export const NOISE_OVERRIDES_BY_TECHNIQUE: Readonly<Record<string, number>> = {
  // Valid Accounts: a legitimate login, indistinguishable from routine sign-ins
  T1078: 0.15,
  // Brute Force: a wall of failed authentications
  T1110: 0.9,
  // Data Encrypted for Impact: the estate goes dark
  T1486: 1.0,
  // Exfiltration Over Alternative Protocol: an unusual channel, louder than the legitimate one
  T1048: 0.4,
  // Indirect Prompt Injection: an instruction hidden in content the model reads as routine
  T1698: 0.15,
  // Direct Prompt Injection: a crafted prompt, visible only where the prompts are logged
  T1699: 0.3,
};

/**
 * The noise one action emits, the technique override winning over its tactic's value. Null for the
 * pre-compromise tactics, which the caller reads as "not a detectable step", never as silence.
 */
export const noiseForAction = (tacticExternalId: string, techniqueExternalId?: string): number | null =>
  (techniqueExternalId !== undefined ? NOISE_OVERRIDES_BY_TECHNIQUE[techniqueExternalId] : undefined)
  ?? NOISE_BY_TACTIC[tacticExternalId]
  ?? null;

export const isDetectableTactic = (tacticExternalId: string): boolean =>
  !PRE_COMPROMISE_TACTIC_EXTERNAL_IDS.includes(tacticExternalId);

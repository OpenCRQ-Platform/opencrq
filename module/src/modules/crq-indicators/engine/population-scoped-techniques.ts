/**
 * The techniques that reach a whole population in one move rather than one asset at a time.
 *
 * Section 6.2 of the specification declares this reference data on the technique and section 4 does
 * not list it among the five tables, so it is the sixth and it is authored here with its reasoning
 * on the same footing as the others.
 *
 * The bar is deliberately narrow: the attacker performs **one** act and every asset of the group is
 * exposed by it. Sending a wave of mail, poisoning a page every workstation browses, or shipping a
 * backdoored artefact every consumer installs all pass it. Anything the attacker has to repeat per
 * asset does not, however cheap the repetition, because the visit quota already prices that.
 *
 * Two failure modes govern an edit. A technique wrongly flagged saturates its obstacle, since the
 * group-level probability replaces the per-asset one before the visit count is applied. A technique
 * wrongly left out makes entry by mass phishing cost as many visits as a hand-run exploit, which is
 * the case the mechanism exists for.
 */

export interface PopulationScopedTechnique {
  readonly techniqueExternalId: string,
  readonly name: string,
  readonly why: string,
}

export const POPULATION_SCOPED_TECHNIQUES: ReadonlyArray<PopulationScopedTechnique> = [
  {
    techniqueExternalId: 'T1566',
    name: 'Phishing',
    why: 'one send reaches the whole mailbox estate, and the gateway contests the wave rather than each message',
  },
  {
    techniqueExternalId: 'T1566.001',
    name: 'Spearphishing Attachment',
    why: 'the attachment rides the same single send as its parent technique',
  },
  {
    techniqueExternalId: 'T1566.002',
    name: 'Spearphishing Link',
    why: 'the link rides the same single send as its parent technique',
  },
  {
    techniqueExternalId: 'T1566.003',
    name: 'Spearphishing via Service',
    why: 'one message on a third-party service reaches every account that reads it',
  },
  {
    techniqueExternalId: 'T1189',
    name: 'Drive-by Compromise',
    why: 'one poisoned page exposes every workstation that browses it, without a per-asset act',
  },
  {
    techniqueExternalId: 'T1195',
    name: 'Supply Chain Compromise',
    why: 'one tampered artefact reaches every asset that installs it',
  },
  {
    techniqueExternalId: 'T1195.002',
    name: 'Compromise Software Supply Chain',
    why: 'the tampered build is distributed once and lands everywhere it is deployed',
  },
];

export const POPULATION_SCOPED_TECHNIQUE_EXTERNAL_IDS: ReadonlySet<string> = new Set(
  POPULATION_SCOPED_TECHNIQUES.map((entry) => entry.techniqueExternalId),
);

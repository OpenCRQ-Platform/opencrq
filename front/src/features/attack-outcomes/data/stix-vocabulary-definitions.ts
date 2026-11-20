import { t } from '@lingui/core/macro';

/**
 * STIX 2.1 `attack-resource-level-ov` (§10.3): six ordered terms ship as `builtIn`, and a producer
 * may add more — the vocabulary is open, so an ingested value absent from this map still renders,
 * just with no known definition.
 */
const RESOURCE_LEVEL_DEFINITIONS: Record<string, () => string> = {
  individual: () => t`Resources limited to the average individual; the threat acts independently.`,
  club: () => t`Members interact on a social and volunteer basis, often with little personal interest in the specific target. The group persists long term.`,
  contest: () => t`A short-lived, perhaps anonymous interaction that concludes when the participants have achieved a single goal.`,
  team: () => t`A formally organized group with a leader, typically motivated by a specific goal. It persists long term and typically operates within a single geography.`,
  organization: () => t`Larger and better resourced than a team — typically a company or crime syndicate. Usually operates in multiple geographic areas and persists long term.`,
  government: () => t`Controls public assets and functions within a jurisdiction; very well resourced and persists long term.`,
};

/** STIX 2.1 `attack-motivation-ov` (§10.2), ten terms. Also an open vocabulary. */
const MOTIVATION_DEFINITIONS: Record<string, () => string> = {
  accidental: () => t`A non-hostile actor whose benevolent or harmless intent inadvertently causes harm.`,
  coercion: () => t`Being forced to act on someone else's behalf, typically through intimidation or blackmail.`,
  dominance: () => t`A desire to assert superiority over someone or something else.`,
  ideology: () => t`A passion to express a set of ideas, beliefs and values that may shape and drive harmful and illegal acts.`,
  notoriety: () => t`Seeking prestige or to become well known through some activity.`,
  'organizational-gain': () => t`Seeking advantage over a competing organization — often theft of intellectual property, business processes or supply chain agreements.`,
  'personal-gain': () => t`The desire to improve one's own financial status, e.g. through financial fraud, hacking for hire or intellectual property theft.`,
  'personal-satisfaction': () => t`A desire to satisfy a strictly personal goal, such as curiosity, thrill-seeking or amusement.`,
  revenge: () => t`A desire to avenge perceived wrongs through harmful actions such as sabotage, violence, theft or fraud.`,
  unpredictable: () => t`Acting without identifiable reason or purpose.`,
};

/** A value outside the built-in vocabulary: the platform still carries and defines it as a value, never as an error. */
const customValueDefinition = (): string => t`A value outside the built-in STIX vocabulary. It is carried and shown exactly as the producer stated it.`;

export type VocabularyField = 'resourceLevel' | 'primaryMotivation';

/** The STIX definition of one ingested value, keyed by the field it was read from. */
export const vocabularyDefinition = (field: VocabularyField, value: string): string => {
  const definitions = field === 'resourceLevel' ? RESOURCE_LEVEL_DEFINITIONS : MOTIVATION_DEFINITIONS;
  return (definitions[value.toLowerCase()] ?? customValueDefinition)();
};

/** The unstated bucket's own definition: an absence, never a value of its own. */
export const notStatedDefinition = (field: VocabularyField): string => (field === 'resourceLevel'
  ? t`The producer published no resource level for these threats. They are carried at full weight and never redistributed over the stated values.`
  : t`The producer published no primary motivation for these threats. They are carried at full weight and never redistributed over the stated values.`);

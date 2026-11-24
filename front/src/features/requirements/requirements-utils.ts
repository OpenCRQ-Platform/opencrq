import { includesFolded } from '@app/utils/text-fold';

export const REQUIREMENT_CRITERIA = ['confidentiality', 'integrity', 'availability'] as const;
export type RequirementCriterion = (typeof REQUIREMENT_CRITERIA)[number];

interface ProtectedCriteria {
  protectsConfidentiality: boolean,
  protectsIntegrity: boolean,
  protectsAvailability: boolean,
}

const PROTECTS_FIELD = {
  confidentiality: 'protectsConfidentiality',
  integrity: 'protectsIntegrity',
  availability: 'protectsAvailability',
} as const satisfies Record<RequirementCriterion, keyof ProtectedCriteria>;

export const protectsField = (criterion: RequirementCriterion): keyof ProtectedCriteria => PROTECTS_FIELD[criterion];

export const protectedCriteria = (row: ProtectedCriteria): Array<RequirementCriterion> =>
  REQUIREMENT_CRITERIA.filter((criterion) => row[PROTECTS_FIELD[criterion]]);

export const filterRequirements = <T extends { name: string, description: string | null, interestedParty: string }>(rows: ReadonlyArray<T>, search: string): Array<T> =>
  rows.filter((row) => includesFolded(row.name, search) || includesFolded(row.description, search) || includesFolded(row.interestedParty, search));

/** The reasons a requirement could never be broken, as codes the form translates. */
export const requirementFormErrors = (values: ProtectedCriteria & { primaryAssetIds: Array<string>, businessValueCategoryIds: Array<string>, lossDriverIds: Array<string> }) => ({
  noCriterion: protectedCriteria(values).length === 0,
  noTarget: values.primaryAssetIds.length + values.businessValueCategoryIds.length === 0,
  noLossDriver: values.lossDriverIds.length === 0,
});

import { defineService } from '../../registry';
import { requireTenantId } from '../../security';
import { DECLARED_ESTATE_KIND_VALUES } from '../declared-estate/constants';
import { computeProgress } from '../financial-profiles/questionnaire-progress';
import { onboardingWizardsRepository } from './repository';

export type OnboardingStepStatus = 'done' | 'started' | 'todo';

/** Todo with nothing answered, started with some answers, done once every one of `total` is. */
const progressStatus = (answered: number, total: number): OnboardingStepStatus => {
  if (answered === 0) {
    return 'todo';
  }
  return answered >= total ? 'done' : 'started';
};

export interface OnboardingWizard {
  readonly id: string,
  readonly organizationId: string,
  readonly steps: {
    readonly company: OnboardingStepStatus,
    readonly assets: OnboardingStepStatus,
    readonly threats: OnboardingStepStatus,
    readonly defenses: OnboardingStepStatus,
    readonly finances: OnboardingStepStatus,
    readonly tolerance: OnboardingStepStatus,
    readonly protect: OnboardingStepStatus,
    readonly scenarios: OnboardingStepStatus,
  },
  readonly finished: boolean,
}

export const onboardingWizardsService = defineService(
  'onboardingWizards',
  onboardingWizardsRepository,
).implement({
  getOnboardingWizard: async ({ repo, eventOrigin }): Promise<OnboardingWizard | null> => {
    requireTenantId(eventOrigin);
    const row = await repo.findFirstOnboardingWizard();
    if (!row) {
      return null;
    }
    const company: OnboardingStepStatus = row.sectorId !== null && row.countryId !== null ? 'done' : 'todo';
    const declaredKinds = await repo.countDeclaredEstateKinds(row.organizationId);
    const assets: OnboardingStepStatus = declaredKinds >= DECLARED_ESTATE_KIND_VALUES.length
      ? 'done'
      : declaredKinds > 0 || await repo.hasSupportingAsset() ? 'started' : 'todo';
    const threats: OnboardingStepStatus = await repo.hasThreat() ? 'done' : 'todo';
    const capabilities = await repo.countCapabilityAssessments(row.organizationId);
    const defenses = progressStatus(capabilities.assessed, capabilities.total);
    const profile = await repo.findFinancialProfile(row.organizationId);
    const progress = profile === undefined ? undefined : computeProgress(profile);
    const finances = progress === undefined ? 'todo' : progressStatus(progress.answeredCount, progress.totalCount);
    const tolerance: OnboardingStepStatus = row.toleranceId !== null ? 'done' : 'todo';
    const protect: OnboardingStepStatus = await repo.hasPrimaryAsset(row.organizationId) ? 'done' : 'todo';
    const scenarios: OnboardingStepStatus = await repo.hasComputedRiskScenario(row.organizationId) ? 'done' : 'todo';
    const steps = { company, assets, threats, defenses, finances, tolerance, protect, scenarios };
    return {
      id: row.id,
      organizationId: row.organizationId,
      steps,
      finished: Object.values(steps).every((status) => status !== 'todo'),
    };
  },
});

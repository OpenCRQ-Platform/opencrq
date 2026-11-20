import type { DrataMirrorInput } from '@app/module';
import type { DrataControlOutput, DrataFrameworkOutput, DrataRequirementOutput } from './drata-types';

// Exact tags only: in Drata, ISO27001 (no year) is the 2013 edition; the 2022 edition is ISO270012022.
const IMPORTED_FRAMEWORK_TAGS = new Set(['ISO270012022', 'SOC_2']);

export const isImportedFramework = (framework: DrataFrameworkOutput): boolean =>
  IMPORTED_FRAMEWORK_TAGS.has(framework.tag);

const parseDate = (value: string | null | undefined): Date | null => {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const buildMirrorInput = (args: {
  frameworks: Array<DrataFrameworkOutput>,
  requirementsByFramework: Map<number, Array<DrataRequirementOutput>>,
  inScopeIdsByFramework: Map<number, Set<number>>,
  readyIdsByFramework: Map<number, Set<number>>,
  controls: Array<DrataControlOutput>,
  syncedAt: Date,
}): DrataMirrorInput => {
  const controlsByRequirement = new Map<number, Array<number>>();
  for (const control of args.controls) {
    for (const requirement of control.requirements ?? []) {
      const list = controlsByRequirement.get(requirement.id) ?? [];
      list.push(control.id);
      controlsByRequirement.set(requirement.id, list);
    }
  }

  return {
    syncedAt: args.syncedAt,
    controls: args.controls.map((control) => ({
      drataId: control.id,
      code: control.code,
      name: control.name,
      description: control.description ?? null,
      isReady: control.flags?.isReady ?? false,
      isMonitored: control.flags?.isMonitored ?? false,
      hasEvidence: control.flags?.hasEvidence ?? false,
      hasPolicy: control.flags?.hasPolicy ?? false,
      archivedAt: parseDate(control.archivedAt),
    })),
    frameworks: args.frameworks.map((framework) => {
      const requirements = args.requirementsByFramework.get(framework.id) ?? [];
      const inScopeIds = args.inScopeIdsByFramework.get(framework.id) ?? new Set<number>();
      const readyIds = args.readyIdsByFramework.get(framework.id) ?? new Set<number>();
      return {
        drataId: framework.id,
        slug: framework.slug,
        tag: framework.tag,
        name: framework.name,
        description: framework.description ?? null,
        isReady: framework.isReady ?? false,
        numInScopeRequirements: framework.numInScopeRequirements ?? 0,
        numReadyInScopeRequirements: framework.numReadyInScopeRequirements ?? 0,
        numInScopeControls: framework.numInScopeControls ?? 0,
        requirements: requirements
          .filter((requirement) => !requirement.archivedAt)
          .map((requirement) => ({
            drataId: requirement.id,
            code: requirement.code ?? null,
            name: requirement.name,
            description: requirement.description ?? null,
            category: requirement.category ?? null,
            isInScope: inScopeIds.has(requirement.id),
            isReady: readyIds.has(requirement.id),
            controlDrataIds: controlsByRequirement.get(requirement.id) ?? [],
          })),
      };
    }),
  };
};

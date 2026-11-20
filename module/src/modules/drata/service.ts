import { newError } from '@app/utils';
import { uuidv7 } from 'uuidv7';
import { requireTenantId } from '../../security';
import { defineService } from '../../registry';
import { drataRepository } from './repository';

export interface DrataControlMirrorInput {
  drataId: number,
  code: string,
  name: string,
  description: string | null,
  isReady: boolean,
  isMonitored: boolean,
  hasEvidence: boolean,
  hasPolicy: boolean,
  archivedAt: Date | null,
}

export interface DrataRequirementMirrorInput {
  drataId: number,
  code: string | null,
  name: string,
  description: string | null,
  category: string | null,
  isInScope: boolean,
  isReady: boolean,
  controlDrataIds: Array<number>,
}

export interface DrataFrameworkMirrorInput {
  drataId: number,
  slug: string,
  tag: string,
  name: string,
  description: string | null,
  isReady: boolean,
  numInScopeRequirements: number,
  numReadyInScopeRequirements: number,
  numInScopeControls: number,
  requirements: Array<DrataRequirementMirrorInput>,
}

export interface DrataMirrorInput {
  syncedAt: Date,
  frameworks: Array<DrataFrameworkMirrorInput>,
  controls: Array<DrataControlMirrorInput>,
}

export const drataService = defineService('drata', drataRepository).implement({
  replaceMirror: async ({ atomic, eventOrigin }, input: DrataMirrorInput) => {
    if (eventOrigin.type !== 'connector') {
      throw newError('Connector origin required');
    }
    const tenantId = requireTenantId(eventOrigin);
    await atomic(async ({ repo }) => {
      await repo.upsertControls(input.controls.map((control) => ({ id: uuidv7(), tenantId, ...control })));
      await repo.deleteControlsNotIn(tenantId, input.controls.map((control) => control.drataId));
      const controlIds = await repo.findControlIdsByDrataId(tenantId);

      await repo.upsertFrameworks(input.frameworks.map((framework) => ({
        id: uuidv7(),
        tenantId,
        drataId: framework.drataId,
        slug: framework.slug,
        tag: framework.tag,
        name: framework.name,
        description: framework.description,
        isReady: framework.isReady,
        numInScopeRequirements: framework.numInScopeRequirements,
        numReadyInScopeRequirements: framework.numReadyInScopeRequirements,
        numInScopeControls: framework.numInScopeControls,
        lastReportedAt: input.syncedAt,
      })));
      await repo.deleteFrameworksNotIn(tenantId, input.frameworks.map((framework) => framework.drataId));
      const frameworkIds = await repo.findFrameworkIdsByDrataId(tenantId);

      const junctionRows: Array<{ requirementId: string, controlId: string }> = [];
      const allRequirementIds: Array<string> = [];
      for (const framework of input.frameworks) {
        const frameworkId = frameworkIds.get(framework.drataId);
        if (!frameworkId) {
          continue;
        }
        await repo.upsertRequirements(framework.requirements.map((requirement) => ({
          id: uuidv7(),
          tenantId,
          frameworkId,
          drataId: requirement.drataId,
          code: requirement.code,
          name: requirement.name,
          description: requirement.description,
          category: requirement.category,
          isInScope: requirement.isInScope,
          isReady: requirement.isReady,
        })));
        await repo.deleteRequirementsNotIn(frameworkId, framework.requirements.map((requirement) => requirement.drataId));
        const requirementIds = await repo.findRequirementIdsByDrataId(frameworkId);
        for (const requirement of framework.requirements) {
          const requirementId = requirementIds.get(requirement.drataId);
          if (!requirementId) {
            continue;
          }
          allRequirementIds.push(requirementId);
          for (const controlDrataId of requirement.controlDrataIds) {
            const controlId = controlIds.get(controlDrataId);
            if (controlId) {
              junctionRows.push({ requirementId, controlId });
            }
          }
        }
      }
      await repo.replaceRequirementControls(tenantId, allRequirementIds, junctionRows);
    });
  },

  getFrameworks: async ({ repo, eventOrigin }) =>
    repo.findFrameworksByTenant(requireTenantId(eventOrigin)),

  /** The derivation's whole view of the mirror: live controls with their readiness. */
  getLiveControlReadiness: async ({ repo, eventOrigin }) =>
    repo.findLiveControlReadiness(requireTenantId(eventOrigin)),

  // The views scope rows by origin, but a client origin without a tenant reads unscoped
  // (see tenantIsolationPolicy), hence the explicit tenant-context gate on every read.
  getFramework: async ({ repo, eventOrigin }, id: string) => {
    requireTenantId(eventOrigin);
    return repo.findFrameworkById(id);
  },

  getRequirements: async ({ repo, eventOrigin }, frameworkId: string) => {
    requireTenantId(eventOrigin);
    return repo.findRequirementsByFramework(frameworkId);
  },

  getRequirement: async ({ repo, eventOrigin }, id: string) => {
    requireTenantId(eventOrigin);
    return repo.findRequirementById(id);
  },

  getControlsForRequirement: async ({ repo, eventOrigin }, requirementId: string) => {
    requireTenantId(eventOrigin);
    return repo.findControlsByRequirement(requirementId);
  },

  getControlsForFramework: async ({ repo, eventOrigin }, frameworkId: string) => {
    requireTenantId(eventOrigin);
    return repo.findControlsByFramework(frameworkId);
  },
});

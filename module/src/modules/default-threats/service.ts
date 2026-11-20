import { uuidv7 } from 'uuidv7';
import type { DefaultThreatsDataset } from './dataset';
import type { DefaultThreatsLoadRecord } from './repository';
import { defineService } from '../../registry';
import { requireTenantId } from '../../security';
import { NonRetryableError } from '../jobs/types';
import { threatAnalysesService } from '../threat-analyses/service';
import { defaultThreatsRepository } from './repository';

export const defaultThreatsService = defineService(
  'defaultThreats',
  defaultThreatsRepository,
).dependsOn(() => [threatAnalysesService]).implement({
  /** A tenant with no settings row is enabled and has loaded nothing. Takes the tenant for the scheduler, which reads under the system origin. */
  getSettings: async ({ repo }, tenantId: string) => {
    const settings = await repo.findSettings(tenantId);
    return {
      enabled: settings?.enabled ?? true,
      etag: settings?.etag ?? null,
      lastModified: settings?.lastModified ?? null,
      appVersion: settings?.appVersion ?? null,
      attackRelease: settings?.attackRelease ?? null,
      loadedAt: settings?.loadedAt ?? null,
    };
  },

  countThreats: async ({ repo, eventOrigin }) => repo.countThreatsBySource(requireTenantId(eventOrigin)),

  /**
   * Switching off retracts every threat the connector loaded, and no other source's, in the one
   * transaction that records the switch: a failed retraction leaves the tenant on, not off and holding them.
   */
  setEnabled: async ({ atomic, repo, deps, eventOrigin }, enabled: boolean) => {
    const tenantId = requireTenantId(eventOrigin);
    if (enabled) {
      await repo.saveEnabled(tenantId, true, uuidv7());
      return { retracted: 0 };
    }
    const retractHeld = async (heldRepo: typeof repo, heldDeps: typeof deps) =>
      heldDeps.threatAnalyses.retractActors(tenantId, 'default-threats', await heldRepo.findHeldStixIds(tenantId));
    const inTransaction = await atomic(async ({ repo: tx, deps: txDeps }) => {
      await tx.saveEnabled(tenantId, false, uuidv7());
      return retractHeld(tx, txDeps);
    });
    // A load that last read the tenant as on, before this transaction committed, wrote after its read of the held threats.
    const late = await retractHeld(repo, deps);
    return { retracted: inTransaction.retracted + late.retracted };
  },

  /** The next sync loads the file whatever it says. */
  forgetLoad: async ({ repo, eventOrigin }) => {
    await repo.clearLoadRecord(requireTenantId(eventOrigin));
  },

  /**
   * Brings the tenant's default threats to the dataset: writes every threat it holds, retracts the
   * held ones it no longer holds, then records the load, so an interrupted load is redone.
   *
   * A tenant may switch the connector off while a load is under way, and the switch's retraction
   * cannot see the threats the load writes after it: the switch is read again once the threats are
   * written, and a tenant found off loses them all.
   *
   * Refuses a dataset with no threat, keeping what the tenant holds: it would retract every one of
   * them, and a file that lost its groups is more likely broken than meant.
   */
  loadDataset: async ({ repo, deps, eventOrigin }, dataset: DefaultThreatsDataset, record: Omit<DefaultThreatsLoadRecord, 'attackRelease'>) => {
    if (dataset.threats.length === 0) {
      throw new NonRetryableError('The Default Threats dataset holds no group or campaign, so it was not loaded');
    }
    const tenantId = requireTenantId(eventOrigin);
    const switchedOff = async () => (await repo.findSettings(tenantId))?.enabled === false;
    const loaded = new Set(dataset.threats.map((threat) => threat.threat.stixId));
    const { created, updated } = await deps.threatAnalyses.ingestBundle(dataset.threats, tenantId, 'default-threats');
    if (await switchedOff()) {
      await deps.threatAnalyses.retractActors(tenantId, 'default-threats', await repo.findHeldStixIds(tenantId));
      return { created: 0, updated: 0, retracted: 0 };
    }
    const { retracted } = await deps.threatAnalyses.retractActors(
      tenantId,
      'default-threats',
      (await repo.findHeldStixIds(tenantId)).filter((stixId) => !loaded.has(stixId)),
    );
    await repo.saveLoadRecord(tenantId, { ...record, attackRelease: dataset.attackRelease }, uuidv7());
    return { created, updated, retracted };
  },
});

import type { EventOrigin } from '@app/module';
import {
  crqIndicatorsRepository,
  mitreTechniques,
  riskScenariosRepository,
  threatAnalyses,
  threatAnalysesRepository,
} from '@app/module';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildActor } from '../../helpers/attack-run-scenario';
import { createTenantWithAdmin } from '../../helpers/factories';
import { db } from '../../setup/db';
import { createTestServices, repositoryContextOf, truncateAllTables } from '../../setup/test-context';

const services = createTestServices(db);

/**
 * A feed keeps citing the ATT&CK ids it was written against, and the vendored release revokes some
 * of them: T1562 Impair Defenses was split across T1685, T1686, T1688, T1689 and T1690, sub-technique
 * by sub-technique. The repertoire reads hand the run, the scenario's controls list and its TTP tab
 * the successor of a revoked id, at the cited grain.
 */
describe('the techniques an actor plays', () => {
  let adminOrigin: EventOrigin;
  let analysisId: string;
  let overlappingAnalysisId: string;

  const analysisIdOf = async (slug: string) =>
    (await db.select({ id: threatAnalyses.id }).from(threatAnalyses).where(eq(threatAnalyses.stixId, `intrusion-set--${slug}`)))[0].id;

  beforeEach(async () => {
    await truncateAllTables(db);
    const setup = await createTenantWithAdmin(services);
    adminOrigin = setup.origin;
    await services.withOrigin(adminOrigin).threatAnalyses.ingestBundle([
      buildActor('lockbit', 'Ransomware crew', ['T1562.001', 'T1562.004', 'T1656', 'T1053.004', 'T1059.001']),
      buildActor('conti', 'Another crew', ['T1562.001', 'T1562.006', 'T1685'], ['CVE-2024-3400']),
    ], setup.tenantId, 'stix-import');
    analysisId = await analysisIdOf('lockbit');
    overlappingAnalysisId = await analysisIdOf('conti');
  });

  // T1053.004 is revoked with no successor, so it stays as cited; T1059.001 is not revoked.
  const PLAYED = ['T1053.004', 'T1059.001', 'T1684.001', 'T1685', 'T1686'];

  it('should read a revoked technique the run prices as its successor', async () => {
    const rows = await crqIndicatorsRepository.findActorTechniqueExternalIds(repositoryContextOf(db, adminOrigin), [analysisId]);
    expect(rows.map((row) => row.techniqueExternalId).sort()).toEqual(PLAYED);
    expect(rows.every((row) => row.analysisId === analysisId)).toBe(true);
  });

  it('should read a revoked technique the scenario lists controls for as its successor', async () => {
    const rows = await riskScenariosRepository.findActorTechniqueExternalIds(repositoryContextOf(db, adminOrigin), [analysisId]);
    expect(rows.map((row) => row.techniqueExternalId).sort()).toEqual(PLAYED);
  });

  it('should weigh a revoked technique on the scenario\'s TTP tab as its successor', async () => {
    const rows = await threatAnalysesRepository.findTechniqueLinksForAnalyses(repositoryContextOf(db, adminOrigin), { analysisIds: [analysisId], gate: 0 });
    expect(rows.map((row) => row.mitreExternalId).sort()).toEqual(PLAYED);
  });

  it('should hold a successor once when the analysis cites it beside two revoked ids it replaces', async () => {
    const rows = await crqIndicatorsRepository.findActorTechniqueExternalIds(repositoryContextOf(db, adminOrigin), [overlappingAnalysisId]);
    expect(rows.map((row) => row.techniqueExternalId)).toEqual(['T1685']);
  });

  describe('the catalogue fingerprint', () => {
    // The stored outcome scores were folded through the succession, so moving it sweeps them.
    it('should move the catalogue fingerprint when ATT&CK moves a revoked id to another successor', async () => {
      const context = repositoryContextOf(db, adminOrigin);
      const [revoked] = await db.select().from(mitreTechniques).where(eq(mitreTechniques.externalId, 'T1562.001'));
      const [otherSuccessor] = await db.select().from(mitreTechniques).where(eq(mitreTechniques.externalId, 'T1686'));
      const before = await threatAnalysesRepository.findCatalogueFingerprint(context);
      try {
        await db.update(mitreTechniques).set({ replacedByTechniqueId: otherSuccessor.id }).where(eq(mitreTechniques.id, revoked.id));
        expect(await threatAnalysesRepository.findCatalogueFingerprint(context)).not.toBe(before);
      } finally {
        await db.update(mitreTechniques).set({ replacedByTechniqueId: revoked.replacedByTechniqueId }).where(eq(mitreTechniques.id, revoked.id));
      }
    });
  });

  it('should list a revoked technique on the actor\'s page as its successor, naming the cited id beside it', async () => {
    const detail = await services.withOrigin(adminOrigin).threatAnalyses.getDetail(overlappingAnalysisId);

    // conti cites T1685 itself beside T1562.001 and T1562.006, which it replaces: one row naming all three.
    expect(detail!.techniques.map((row) => [row.mitreExternalId, row.citedExternalIds])).toEqual([
      ['T1685', ['T1562.001', 'T1562.006', 'T1685']],
    ]);

    const lockbit = await services.withOrigin(adminOrigin).threatAnalyses.getDetail(analysisId);
    expect(lockbit!.techniques.map((row) => [row.mitreExternalId, row.citedExternalIds]).sort()).toEqual([
      ['T1053.004', ['T1053.004']],
      ['T1059.001', ['T1059.001']],
      ['T1684.001', ['T1656']],
      ['T1685', ['T1562.001']],
      ['T1686', ['T1562.004']],
    ]);
    // Read off the successor's catalogue row, not the feed's name or the revoked id's row.
    const impairment = lockbit!.techniques.find((row) => row.mitreExternalId === 'T1685')!;
    expect(impairment.name).toBe('Disable or Modify Tools');
    expect(impairment.mitreTechniqueUrl).toContain('T1685');
    expect(impairment.tactics.map((tactic) => tactic.externalId)).toContain('TA0112');
  });

  it('should count an actor\'s techniques as played, on the threat list and on a CVE\'s actors', async () => {
    const context = repositoryContextOf(db, adminOrigin);

    const [counts] = await threatAnalysesRepository.findComputedAnalysisCounts(context, { gate: 0, analysisIds: [overlappingAnalysisId] });
    const [cveActor] = await threatAnalysesRepository.findAnalysesByCveId(context, { cveId: 'CVE-2024-3400', gate: 0 });

    expect(counts.techniqueCount).toBe(1);
    expect(cveActor.techniqueCount).toBe(1);
  });
});

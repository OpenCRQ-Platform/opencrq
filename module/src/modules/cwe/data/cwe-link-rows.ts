import { newError } from '@app/utils';
import type { cweTechniqueLinks } from '../schema';
import { deriveSeedId } from '../../../seed-ids';
import { mitreTechniquesData } from '../../mitre-attack/data/mitre-techniques';
import { CWE_TECHNIQUE_LINK } from './cwe-technique-link';

const CWE_WEAKNESS_NAMESPACE = '0ff1785a-b22e-4547-9ac6-aef8f8608bd2';

export const cweWeaknessId = (externalId: string): string => deriveSeedId(externalId, CWE_WEAKNESS_NAMESPACE);

const TECHNIQUE_ID_BY_EXTERNAL_ID = new Map(mitreTechniquesData.map((technique) => [technique.externalId, technique.id]));

export const shippedLinkRows = (): Array<typeof cweTechniqueLinks.$inferInsert> => CWE_TECHNIQUE_LINK.map((row) => {
  const mitreTechniqueId = TECHNIQUE_ID_BY_EXTERNAL_ID.get(row.techniqueExternalId);
  if (mitreTechniqueId === undefined) {
    throw newError('Unknown technique in the shipped CWE link', { techniqueExternalId: row.techniqueExternalId });
  }
  const cweId = cweWeaknessId(row.cweExternalId);
  return {
    id: deriveSeedId(`${row.techniqueExternalId}|${row.justificationKind}|${row.justificationRef}`, cweId),
    cweId,
    mitreTechniqueId,
    techniqueExternalId: row.techniqueExternalId,
    justificationKind: row.justificationKind,
    justificationRef: row.justificationRef,
    justificationName: row.justificationName,
  };
});

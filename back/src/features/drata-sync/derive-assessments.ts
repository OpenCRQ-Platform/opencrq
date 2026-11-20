import type { DrataEvidencePair } from '@app/module';
import { DRATA_EVIDENCE_BY_EXTERNAL_ID } from '@app/module';

export interface SupportingControl {
  code: string,
  name: string,
  isReady: boolean,
  levels: Array<DrataEvidencePair['levels'][number]>,
  reach?: DrataEvidencePair['reach'],
}

export interface ControlReadiness {
  code: string,
  name: string,
  isReady: boolean,
}

/**
 * The evidence trail of one capability: its mapped controls present in the tenant's mirror,
 * with their readiness. Empty until a sync mirrored the account.
 */
export const computeSupportingControls = (
  readiness: Array<ControlReadiness>,
  capabilityExternalId: string,
): Array<SupportingControl> => {
  const pairs = DRATA_EVIDENCE_BY_EXTERNAL_ID[capabilityExternalId];
  if (!pairs || pairs.length === 0) {
    return [];
  }
  const byCode = new Map(readiness.map((control) => [control.code, control]));
  return pairs.flatMap((pair) => {
    const mirrored = byCode.get(pair.code);
    return mirrored === undefined ? [] : [{
      code: pair.code,
      name: mirrored.name,
      isReady: mirrored.isReady,
      levels: [...pair.levels],
      ...(pair.reach !== undefined ? { reach: pair.reach } : {}),
    }];
  });
};

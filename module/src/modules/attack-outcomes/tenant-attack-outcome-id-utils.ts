import { deriveSeedId } from '../../seed-ids';
import { ATTACK_OUTCOMES } from './data/attack-outcomes-data';

/**
 * The inverse of `deriveSeedId(tenantId, catalogueAttackOutcomeId)`: which catalog outcome a stored
 * tenant row id came from. A caller feeding a scenario's real `attack_outcome_id` into
 * `deriveEstimates` needs this — the kernel's own activation matrix is keyed by catalogue id, never
 * by a tenant's row id, since the kernel is pure and carries no tenant context.
 */
export const resolveCatalogueAttackOutcomeId = (tenantId: string, tenantAttackOutcomeId: string): string | undefined =>
  ATTACK_OUTCOMES.find((outcome) => deriveSeedId(tenantId, outcome.id) === tenantAttackOutcomeId)?.id;

import { deriveSeedId } from '../../seed-ids';
import { LOSS_DRIVERS } from './data/loss-drivers-data';

/**
 * `deriveEstimates` is pure and knows nothing of a tenant: its `DriverEstimate.lossDriverId` is one
 * of the catalog constants from `loss-drivers-ids.ts`. A tenant's actual `loss_drivers.id` for that
 * driver is never stored as a reverse-lookup column — it is exactly the id `buildLossDriverRows`
 * mints for it, so translating a kernel result into a real FK value is this deterministic derivation
 * rather than a database lookup by name.
 */
export const deriveTenantLossDriverId = (tenantId: string, catalogueLossDriverId: string): string =>
  deriveSeedId(tenantId, catalogueLossDriverId);

/** The inverse of {@link deriveTenantLossDriverId}: which catalog driver a stored tenant row id came from. */
export const resolveCatalogueLossDriverId = (tenantId: string, tenantLossDriverId: string): string | undefined =>
  LOSS_DRIVERS.find((driver) => deriveSeedId(tenantId, driver.id) === tenantLossDriverId)?.id;

import type { DrizzleDB } from '@app/module';
import { schema } from '@app/module';
import { newError } from '@app/utils';
import { inArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';

const INSTANCE_ID_KEY = 'instance_id';
const INSTANCE_CREATION_KEY = 'instance_creation';

export interface InstanceIdentity {
  instanceId: string,
  instanceCreation: string,
}

/**
 * Ensure a durable anonymous instance identity in the `platform_metadata`
 * key-value table. `ON CONFLICT DO NOTHING` keeps the first-boot values for
 * the lifetime of the database, so the same instance keeps reporting under
 * the same id across restarts and upgrades.
 */
export const ensureInstanceIdentity = async (db: DrizzleDB): Promise<InstanceIdentity> => {
  await db.insert(schema.platformMetadata)
    .values([
      { key: INSTANCE_ID_KEY, value: uuidv7() },
      { key: INSTANCE_CREATION_KEY, value: new Date().toISOString() },
    ])
    .onConflictDoNothing();

  const rows = await db.select()
    .from(schema.platformMetadata)
    .where(inArray(schema.platformMetadata.key, [INSTANCE_ID_KEY, INSTANCE_CREATION_KEY]));
  const byKey = Object.fromEntries(rows.map(({ key, value }) => [key, value]));
  const instanceId = byKey[INSTANCE_ID_KEY];
  const instanceCreation = byKey[INSTANCE_CREATION_KEY];

  // Fail fast with a clear error instead of letting `undefined` flow into the
  // OTLP resource attributes (the engine catches and disables telemetry).
  if (!instanceId || !instanceCreation) {
    throw newError('Platform instance identity is missing from platform_metadata', {
      hasInstanceId: Boolean(instanceId),
      hasInstanceCreation: Boolean(instanceCreation),
    });
  }

  return { instanceId, instanceCreation };
};

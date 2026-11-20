import type { SQL, SQLWrapper } from 'drizzle-orm';
import type { FleetPair } from './asset-protection';
import { newError } from '@app/utils';
import { sql } from 'drizzle-orm';
import { EXPECTATION_TYPE_VALUES } from '../supporting-assets/constants';

// The 64th bit of a bigint is its sign.
const MAX_PAIRS = 63;

/**
 * A set of (family, expectation type) pairs held as a bigint, one bit per pair, which groups and
 * sorts far cheaper than a jsonb set of them. `setOf` is a result's pair as a set of one in SQL, to
 * `bit_or` together, and `pairsIn` reads a set back from the decimal string Postgres sends for it.
 */
export const fleetPairSet = (platformTypeKeys: ReadonlyArray<string>) => {
  const pairs = platformTypeKeys.flatMap((platformTypeKey) =>
    EXPECTATION_TYPE_VALUES.map((expectationType): FleetPair => ({ platformTypeKey, expectationType })));
  if (pairs.length > MAX_PAIRS) {
    throw newError('A fleet pair set holds at most 63 pairs', { pairs: pairs.length });
  }
  return {
    setOf: (platformTypeKey: SQLWrapper, expectationType: SQLWrapper): SQL =>
      sql`1::bigint << ((array_position(${sql.param(platformTypeKeys)}::text[], ${platformTypeKey}) - 1) * ${EXPECTATION_TYPE_VALUES.length}
        + array_position(${sql.param(EXPECTATION_TYPE_VALUES)}::text[], ${expectationType}::text) - 1)`,
    pairsIn: (pairSet: string): Array<FleetPair> => {
      const bits = BigInt(pairSet);
      return pairs.filter((_, bit) => ((bits >> BigInt(bit)) & 1n) === 1n);
    },
  };
};

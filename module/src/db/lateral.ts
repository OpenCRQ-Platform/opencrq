import { sql } from 'drizzle-orm';

/** The join condition of a lateral subquery already correlated on its outer row. */
export const LATERAL_ON = sql`true`;

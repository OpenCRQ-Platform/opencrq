import { isValidTimeZone } from '@app/module';
import { z } from 'zod';

/**
 * The viewer's IANA zone, which decides the day a change falls on. A zone name starts with a
 * letter, which refuses a bare offset: `Intl` reads `+01:00` east of UTC, Postgres west.
 */
export const TIME_ZONE_INPUT = z.string().max(64).refine((zone) => /^[A-Za-z]/.test(zone) && isValidTimeZone(zone), { error: 'Unknown time zone' });

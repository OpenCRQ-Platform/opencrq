import { z } from 'zod';

/**
 * A toggle carried in the address. TanStack Router's `parseSearch` runs `JSON.parse` on every
 * value, so `?notReadyOnly=true` already arrives as a boolean — but a hand-written `?x=1` or
 * `?x=yes` arrives as a number or a string, and `z.coerce.boolean()` would read both as `true`,
 * as it would the very string `'false'`. Only the two literal spellings are accepted; anything
 * else falls back to the toggle's own default.
 */
export const urlBoolean = (defaultValue: boolean) => z
  .union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')])
  .catch(defaultValue)
  .default(defaultValue);

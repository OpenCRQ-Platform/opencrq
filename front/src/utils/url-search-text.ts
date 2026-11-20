import { z } from 'zod';

/**
 * A free-text search param. TanStack Router's `parseSearch` runs `JSON.parse` on every value, so
 * `?search=3389` arrives as a number and `?search=true` as a boolean: coercion is what reads them
 * back as the text that was typed. An absent param is the empty search, and so is anything
 * coercion cannot read, since `useUrlListFilters` parses during render and a throw is a blank page.
 */
export const urlSearchText = z.coerce.string().catch('').default('');

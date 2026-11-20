import { useNavigate, useSearch } from '@tanstack/react-router';
import type { z } from 'zod';

interface UseUrlListFiltersResult<TSchema extends z.ZodType<Record<string, unknown>>> {
  filters: z.infer<TSchema>,
  setFilters: (patch: Partial<z.infer<TSchema>>) => void,
}

/**
 * Reads a route's list filters from its search params, parsed against `schema` so the same
 * component can be mounted by any route carrying that shape (`schema.parse` does not care which
 * route matched). Every write replaces the current history entry rather than pushing one, so
 * back navigation leaves the list instead of undoing filters one by one; `...prev` in the search
 * updater keeps whatever other search param the route carries that `schema` does not know about.
 * A default value written by `setFilters` is later removed from the address by the route's own
 * `stripSearchParams` middleware, not by this hook.
 */
export const useUrlListFilters = <TSchema extends z.ZodType<Record<string, unknown>>>(
  schema: TSchema,
): UseUrlListFiltersResult<TSchema> => {
  const search = useSearch({ strict: false });
  const navigate = useNavigate();

  const filters = schema.parse(search);

  const setFilters = (patch: Partial<z.infer<TSchema>>): void => {
    void navigate({
      to: '.',
      search: (prev: Record<string, unknown>) => ({ ...prev, ...patch }),
      replace: true,
    });
  };

  return { filters, setFilters };
};

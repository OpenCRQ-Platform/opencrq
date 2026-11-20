type NoRestrictedSyntaxEntry = { selector: string, message: string };

/**
 * Spread into a workspace's `no-restricted-syntax` array (never into a rules object) to flag
 * manual tRPC query-cache invalidation. The SSE doorbell invalidates every affected query on
 * every data change, so a mutation handler must not reach the query client itself
 * (`queryClient.invalidateQueries(trpc.<path>.queryFilter())`). `router.invalidate()` (the
 * TanStack Router loader cache) is a different mechanism and stays legal.
 */
export const queryInvalidationSelectors: Array<NoRestrictedSyntaxEntry> = [
  {
    selector: 'CallExpression[callee.property.name=/^(invalidateQueries|refetchQueries|resetQueries)$/]',
    message: 'The SSE doorbell owns query-cache freshness (providers/event-stream-provider.tsx) — do not invalidate by hand. A site the doorbell cannot reach (a table with no change trigger, another tenant\'s doorbell, a refresh an immediate action depends on) may, once it says which: // eslint-disable-next-line no-restricted-syntax -- <why no doorbell rings>',
  },
];

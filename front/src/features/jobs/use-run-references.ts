import { useQueries, useQuery } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import type { ReferenceEntityKind, ResolvedReference, RunReference } from './run-references-utils';
import { useTRPC } from '../../lib';
import { chunkIds, groupReferenceIdsByKind, parseRunReferences, resolveRunReference } from './run-references-utils';

interface NameByIdRow { id: string, name: string }

type QueryResult = { data: ReadonlyArray<NameByIdRow> | undefined, isSuccess: boolean };

const mergeNames = (results: ReadonlyArray<QueryResult>): ReadonlyMap<string, string> => {
  const names = new Map<string, string>();
  for (const result of results) {
    for (const row of result.data ?? []) {
      names.set(row.id, row.name);
    }
  }
  return names;
};

export interface RunReferencesLookup {
  /** Every reference a run's payload names, resolved to a label and (where the entity has one) a route. */
  referencesFor: (payload: string | null | undefined) => Array<ResolvedReference>,
  /** Resolves a single reference gathered outside a run's payload, e.g. who triggered it. */
  resolve: (reference: RunReference) => ResolvedReference,
}

/**
 * Fetches the names of every entity a page of runs' payloads name, one call per entity kind and
 * per `chunkIds` chunk, and hands back a lookup a row resolves its own references from. The ids are
 * only known once the runs have loaded, so the names arrive one round-trip after them, and a row
 * shows its fallback labels until then.
 */
export const useRunReferences = (
  runs: ReadonlyArray<{ payload?: string | null }>,
  extraReferences: ReadonlyArray<RunReference> = [],
): RunReferencesLookup => {
  const trpc = useTRPC();
  const { tenantId } = useParams({ strict: false });
  // Reads the raw probe: `useHasManageSecurity` answers `false` while loading, which would read as a hidden name.
  const manageSecurity = useQuery(trpc.capabilities.hasManageSecurity.queryOptions());
  const grouped = groupReferenceIdsByKind(runs, extraReferences);

  const riskScenarioChunks = chunkIds(grouped.riskScenario);
  // The server refuses the whole serviceAccounts router without MANAGE_SECURITY.
  const serviceAccountChunks = manageSecurity.data === true ? chunkIds(grouped.serviceAccount) : [];
  const userChunks = tenantId ? chunkIds(grouped.user) : [];
  const storedFileChunks = chunkIds(grouped.storedFile);

  const queries = useQueries({
    queries: [
      ...riskScenarioChunks.map((ids) => trpc.riskScenarios.getNamesByIds.queryOptions({ ids })),
      ...serviceAccountChunks.map((ids) => trpc.serviceAccounts.getNamesByIds.queryOptions({ ids })),
      ...userChunks.map((ids) => trpc.tenants.getTenantUserNamesByIds.queryOptions({ tenantId: tenantId ?? '', ids })),
      ...storedFileChunks.map((ids) => trpc.fileStorage.getNamesByIds.queryOptions({ ids })),
    ],
  });

  // Each kind's queries sit at a fixed offset in `queries`, in the same order they were spread
  // into it above, so a slice per kind reads them back without any running mutable state.
  const riskScenarioStart = 0;
  const serviceAccountStart = riskScenarioStart + riskScenarioChunks.length;
  const userStart = serviceAccountStart + serviceAccountChunks.length;
  const storedFileStart = userStart + userChunks.length;

  const queriesByKind: Record<ReferenceEntityKind, ReadonlyArray<QueryResult>> = {
    riskScenario: queries.slice(riskScenarioStart, serviceAccountStart),
    serviceAccount: queries.slice(serviceAccountStart, userStart),
    user: queries.slice(userStart, storedFileStart),
    storedFile: queries.slice(storedFileStart, storedFileStart + storedFileChunks.length),
  };
  const namesByKind = {
    riskScenario: mergeNames(queriesByKind.riskScenario),
    serviceAccount: mergeNames(queriesByKind.serviceAccount),
    user: mergeNames(queriesByKind.user),
    storedFile: mergeNames(queriesByKind.storedFile),
  };
  // A kind with no query, such as service accounts once the probe denies MANAGE_SECURITY, has settled already.
  // A failed lookup has not: the reader may see the name, so the id prefix stays rather than "hidden".
  const isSettled = (kind: ReferenceEntityKind) =>
    (kind !== 'serviceAccount' || manageSecurity.isSuccess) && queriesByKind[kind].every((query) => query.isSuccess);

  const resolve = (reference: RunReference): ResolvedReference =>
    resolveRunReference(reference, namesByKind[reference.kind], isSettled(reference.kind));

  return {
    referencesFor: (payload) => parseRunReferences(payload).map(resolve),
    resolve,
  };
};

import type { SupportToPrimaryLinkRole } from '@app/module/client';
import { canonicalLinkRoles, MAX_DEPENDENCY_LINKS_PER_WRITE } from '@app/module/client';
import { toggleLinkRole } from './link-roles-utils';

/** A link the server holds, keyed by the asset on its other end. `roles` is `null` on a link that carries none. */
export interface StoredLink {
  linkId: string,
  roles: ReadonlyArray<SupportToPrimaryLinkRole> | null,
}

export type PendingLink<Row> =
  | { kind: 'add', row: Row, roles: Array<SupportToPrimaryLinkRole> | null }
  | { kind: 'remove', row: Row, linkId: string }
  | { kind: 'edit', row: Row, linkId: string, roles: Array<SupportToPrimaryLinkRole> };

export type PendingLinkKind = PendingLink<unknown>['kind'];

/**
 * What the session changed in one list, keyed by the asset on the other end of the link. A key is
 * absent when its row is as the server stores it, so undoing a change removes the key.
 */
export type LinkDelta<Row> = Readonly<Record<string, PendingLink<Row>>>;

export interface LinkState {
  linked: boolean,
  roles: ReadonlyArray<SupportToPrimaryLinkRole> | null,
  pending: PendingLinkKind | null,
}

export interface PendingCounts {
  added: number,
  removed: number,
  edited: number,
}

const sameRoles = (a: ReadonlyArray<SupportToPrimaryLinkRole>, b: ReadonlyArray<SupportToPrimaryLinkRole>) => {
  const left = canonicalLinkRoles([...a]);
  const right = canonicalLinkRoles([...b]);
  return left.length === right.length && left.every((role, index) => role === right[index]);
};

const without = <Row>(delta: LinkDelta<Row>, id: string): LinkDelta<Row> => {
  const { [id]: _dropped, ...rest } = delta;
  return rest;
};

export const linkStateOf = <Row>(delta: LinkDelta<Row>, id: string, stored: StoredLink | null): LinkState => {
  const change = delta[id];
  if (change === undefined) {
    return { linked: stored !== null, roles: stored?.roles ?? null, pending: null };
  }
  switch (change.kind) {
    case 'add': return { linked: true, roles: change.roles, pending: 'add' };
    case 'remove': return { linked: false, roles: null, pending: 'remove' };
    case 'edit': return { linked: true, roles: change.roles, pending: 'edit' };
  }
};

export const sameLinkState = (a: LinkState, b: LinkState): boolean =>
  a.linked === b.linked
  && a.pending === b.pending
  && (a.roles === b.roles || (a.roles !== null && b.roles !== null && a.roles.length === b.roles.length && a.roles.every((role, index) => role === b.roles?.[index])));

export type PageLinkSummary = 'empty' | 'none' | 'some' | 'all';

/** How many rows of a page are linked, as its header checkbox shows it. */
export const pageLinkSummary = (states: ReadonlyArray<LinkState>): PageLinkSummary => {
  const linked = states.filter((state) => state.linked).length;
  if (states.length === 0) {
    return 'empty';
  }
  if (linked === states.length) {
    return 'all';
  }
  return linked === 0 ? 'none' : 'some';
};

/** Ticking or unticking a row of a list whose links carry no roles. A row back in its stored state leaves the delta. */
export const toggleLink = <Row extends { id: string }>(
  delta: LinkDelta<Row>,
  row: Row,
  stored: StoredLink | null,
): LinkDelta<Row> => {
  const change = delta[row.id];
  if (change?.kind === 'add' || change?.kind === 'remove') {
    return without(delta, row.id);
  }
  if (stored !== null) {
    return { ...delta, [row.id]: { kind: 'remove', row, linkId: stored.linkId } };
  }
  return { ...delta, [row.id]: { kind: 'add', row, roles: null } };
};

/**
 * The roles a row's field now holds, on a list where the roles are the link: no role unlinks the
 * row, a role on an unlinked row links it, and a row back to its stored roles leaves the delta.
 */
export const setLinkRoles = <Row extends { id: string }>(
  delta: LinkDelta<Row>,
  row: Row,
  stored: StoredLink | null,
  roles: Array<SupportToPrimaryLinkRole>,
): LinkDelta<Row> => {
  if (stored === null) {
    return roles.length === 0 ? without(delta, row.id) : { ...delta, [row.id]: { kind: 'add', row, roles } };
  }
  if (roles.length === 0) {
    return { ...delta, [row.id]: { kind: 'remove', row, linkId: stored.linkId } };
  }
  if (stored.roles !== null && sameRoles(roles, stored.roles)) {
    return without(delta, row.id);
  }
  return { ...delta, [row.id]: { kind: 'edit', row, linkId: stored.linkId, roles } };
};

/**
 * The roles after the field reports its next selection. The field adds or drops one role at a time,
 * so the difference names the role clicked: a picked role is reconciled with `unknown` by
 * `toggleLinkRole`, and dropping the last role leaves none, which unlinks the row.
 */
export const applyRoleSelection = (
  previous: ReadonlyArray<SupportToPrimaryLinkRole>,
  next: ReadonlyArray<SupportToPrimaryLinkRole>,
): Array<SupportToPrimaryLinkRole> => {
  const added = next.find((role) => !previous.includes(role));
  return added === undefined ? previous.filter((role) => next.includes(role)) : toggleLinkRole(previous, added);
};

export const pendingCounts = (delta: LinkDelta<unknown>): PendingCounts => {
  const counts = { added: 0, removed: 0, edited: 0 };
  for (const change of Object.values(delta)) {
    if (change.kind === 'add') {
      counts.added += 1;
    } else if (change.kind === 'remove') {
      counts.removed += 1;
    } else {
      counts.edited += 1;
    }
  }
  return counts;
};

export const pendingTotal = (deltas: ReadonlyArray<LinkDelta<unknown>>): number =>
  deltas.reduce((sum, delta) => sum + Object.keys(delta).length, 0);

/** The tab marker: `+3 −1 ~2`, each part only when non-zero, empty when nothing is pending. */
export const pendingMarker = ({ added, removed, edited }: PendingCounts): string =>
  [added > 0 ? `+${added}` : '', removed > 0 ? `−${removed}` : '', edited > 0 ? `~${edited}` : '']
    .filter((part) => part !== '')
    .join(' ');

/** Links or unlinks every row of a page that is not in that state yet. */
export const setPageLinked = <Row extends { id: string }>(
  delta: LinkDelta<Row>,
  rows: ReadonlyArray<{ row: Row, stored: StoredLink | null }>,
  linked: boolean,
): LinkDelta<Row> => {
  let next = delta;
  for (const { row, stored } of rows) {
    if (linkStateOf(next, row.id, stored).linked !== linked) {
      next = toggleLink(next, row, stored);
    }
  }
  return next;
};

export type ShowFilter = 'all' | 'linked' | 'pending';

/** The pending rows of a list, newest change last, as the "pending changes" view shows them. */
export const pendingRows = <Row>(delta: LinkDelta<Row>): Array<Row> => Object.values(delta).map((change) => change.row);

/** Drops the changes whose save succeeded and keeps the others for another try. */
export const withoutSettled = <Row>(delta: LinkDelta<Row>, settledIds: ReadonlySet<string>): LinkDelta<Row> =>
  Object.fromEntries(Object.entries(delta).filter(([id]) => !settledIds.has(id)));

/**
 * The delta brought back in line with the links stored since it was staged, which the server would
 * otherwise skip at each save: an addition of a pair now linked, an edit of a link now gone. A change
 * the stored link already carries out leaves the delta, and one aimed at a link that has gone or been
 * replaced is kept as what it asked for. Returns `delta` itself when nothing moved.
 */
export const reconcileDelta = <Row>(delta: LinkDelta<Row>, storedOf: (id: string) => StoredLink | null): LinkDelta<Row> => {
  let changed = false;
  const next: Record<string, PendingLink<Row>> = {};
  for (const [id, change] of Object.entries(delta)) {
    const reconciled = reconcileChange(change, storedOf(id));
    if (reconciled !== change) {
      changed = true;
    }
    if (reconciled !== null) {
      next[id] = reconciled;
    }
  }
  return changed ? next : delta;
};

const reconcileChange = <Row>(change: PendingLink<Row>, stored: StoredLink | null): PendingLink<Row> | null => {
  switch (change.kind) {
    case 'add':
      if (stored === null) {
        return change;
      }
      return change.roles === null || stored.roles === null || sameRoles(change.roles, stored.roles)
        ? null
        : { kind: 'edit', row: change.row, linkId: stored.linkId, roles: change.roles };
    case 'remove':
      if (stored === null) {
        return null;
      }
      return stored.linkId === change.linkId ? change : { ...change, linkId: stored.linkId };
    case 'edit':
      if (stored === null) {
        return { kind: 'add', row: change.row, roles: change.roles };
      }
      if (stored.roles !== null && sameRoles(change.roles, stored.roles)) {
        return null;
      }
      return stored.linkId === change.linkId ? change : { ...change, linkId: stored.linkId };
  }
};

/** A supporting-to-primary link as the create call takes it. */
export interface PrimaryLinkCreate {
  id: string,
  supportingAssetId: string,
  primaryAssetId: string,
  roles?: Array<SupportToPrimaryLinkRole>,
}

/** A supporting-to-supporting link as the create call takes it. */
export interface SupportLinkCreate {
  id: string,
  providerAssetId: string,
  dependentAssetId: string,
}

/** One request of a save, with the delta keys it settles. */
export type DependencyWrite =
  | { kind: 'createPrimary', ids: Array<string>, links: Array<PrimaryLinkCreate> }
  | { kind: 'updatePrimary', ids: Array<string>, links: Array<{ id: string, roles: Array<SupportToPrimaryLinkRole> }> }
  | { kind: 'deletePrimary', ids: Array<string>, linkIds: Array<string> }
  | { kind: 'createSupport', ids: Array<string>, links: Array<SupportLinkCreate> }
  | { kind: 'deleteSupport', ids: Array<string>, linkIds: Array<string> };

/** Splits the changes of one kind into requests of as many links as one call takes. */
const inWrites = <Payload, Write>(
  entries: ReadonlyArray<[string, Payload]>,
  write: (ids: Array<string>, payloads: Array<Payload>) => Write,
): Array<Write> => {
  const writes: Array<Write> = [];
  for (let start = 0; start < entries.length; start += MAX_DEPENDENCY_LINKS_PER_WRITE) {
    const slice = entries.slice(start, start + MAX_DEPENDENCY_LINKS_PER_WRITE);
    writes.push(write(slice.map(([key]) => key), slice.map(([, payload]) => payload)));
  }
  return writes;
};

/**
 * The requests that save a list of supporting-to-primary links, per kind of change as many as its
 * changes need, none for a kind the delta holds none of. `ends` names the two assets of the link a
 * key stands for.
 */
export const primaryLinkWrites = (
  delta: LinkDelta<unknown>,
  ends: (key: string) => { supportingAssetId: string, primaryAssetId: string },
  newId: () => string,
): Array<DependencyWrite> => {
  const creates: Array<[string, PrimaryLinkCreate]> = [];
  const updates: Array<[string, { id: string, roles: Array<SupportToPrimaryLinkRole> }]> = [];
  const deletes: Array<[string, string]> = [];
  for (const [key, change] of Object.entries(delta)) {
    switch (change.kind) {
      case 'add':
        creates.push([key, { id: newId(), ...ends(key), ...(change.roles === null ? {} : { roles: change.roles }) }]);
        break;
      case 'edit':
        updates.push([key, { id: change.linkId, roles: change.roles }]);
        break;
      case 'remove':
        deletes.push([key, change.linkId]);
        break;
    }
  }
  return [
    ...inWrites(creates, (ids, links): DependencyWrite => ({ kind: 'createPrimary', ids, links })),
    ...inWrites(updates, (ids, links): DependencyWrite => ({ kind: 'updatePrimary', ids, links })),
    ...inWrites(deletes, (ids, linkIds): DependencyWrite => ({ kind: 'deletePrimary', ids, linkIds })),
  ];
};

/**
 * The requests that save one list of supporting-to-supporting links of `assetId`, keyed by the
 * asset on the other end: on `dependsOn` that asset is the provider, on `providesTo` the dependent.
 */
export const supportLinkWrites = (
  delta: LinkDelta<unknown>,
  assetId: string,
  relation: 'dependsOn' | 'providesTo',
  newId: () => string,
): Array<DependencyWrite> => {
  const creates: Array<[string, SupportLinkCreate]> = [];
  const deletes: Array<[string, string]> = [];
  for (const [key, change] of Object.entries(delta)) {
    if (change.kind === 'add') {
      creates.push([key, relation === 'dependsOn'
        ? { id: newId(), providerAssetId: key, dependentAssetId: assetId }
        : { id: newId(), providerAssetId: assetId, dependentAssetId: key }]);
    } else if (change.kind === 'remove') {
      deletes.push([key, change.linkId]);
    }
  }
  return [
    ...inWrites(creates, (ids, links): DependencyWrite => ({ kind: 'createSupport', ids, links })),
    ...inWrites(deletes, (ids, linkIds): DependencyWrite => ({ kind: 'deleteSupport', ids, linkIds })),
  ];
};

/**
 * The delta keys of a write's links the server reports, from their link ids: a create names the id
 * it was given for the new link, an update the id of the stored one.
 */
export const keysOfLinks = (write: DependencyWrite, linkIds: ReadonlyArray<string>): Array<string> => {
  if (linkIds.length === 0 || write.kind === 'deletePrimary' || write.kind === 'deleteSupport') {
    return [];
  }
  const reported = new Set(linkIds);
  return write.ids.filter((_, index) => reported.has(write.links[index].id));
};

/** The changes of a request the server left out, by delta key. */
export interface LeftOut {
  /** The link changed since it was read: the change stays pending until the refresh reconciles it. */
  skipped: ReadonlyArray<string>,
  /** An asset of the link was deleted since it was read: the change is dropped. */
  gone: ReadonlyArray<string>,
}

export const NOTHING_LEFT_OUT: LeftOut = { skipped: [], gone: [] };

/** One request of a save, and the changes of one list it settles once it succeeds. */
export interface SaveOperation<List extends string> {
  list: List,
  ids: ReadonlyArray<string>,
  run: () => Promise<LeftOut>,
}

export interface SaveOutcome<List extends string> {
  /** Per list, the changes now stored. */
  settled: ReadonlyMap<List, ReadonlySet<string>>,
  /** The changes of the requests that failed. */
  failed: number,
  /** The changes the server left out of a request that succeeded, the link having changed since it was read. */
  skipped: number,
  /** The changes settled without being written, an asset of their link having been deleted. */
  gone: number,
}

/**
 * How many requests of a save run at once. Each holds a database connection for its transaction, so
 * a save of thousands of changes must not take the whole pool from everyone else.
 */
const MAX_CONCURRENT_WRITES = 4;

const runSettled = async <Result>(tasks: ReadonlyArray<() => Promise<Result>>, concurrency: number) => {
  const results: Array<PromiseSettledResult<Result>> = [];
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next;
      next += 1;
      results[index] = await tasks[index]().then(
        (value): PromiseSettledResult<Result> => ({ status: 'fulfilled', value }),
        (reason: unknown): PromiseSettledResult<Result> => ({ status: 'rejected', reason }),
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
};

/**
 * Sends the requests, `MAX_CONCURRENT_WRITES` at a time, and reports which changes are settled: a
 * failed request leaves its changes pending rather than failing the whole save, and so does a change
 * the server skipped. A change whose asset is gone is settled, since nothing is left to write.
 */
export const settleOperations = async <List extends string>(
  operations: ReadonlyArray<SaveOperation<List>>,
): Promise<SaveOutcome<List>> => {
  const results = await runSettled(operations.map((operation) => operation.run), MAX_CONCURRENT_WRITES);
  const settled = new Map<List, Set<string>>();
  let failed = 0;
  let skipped = 0;
  let gone = 0;
  results.forEach((result, index) => {
    const { list, ids } = operations[index];
    if (result.status === 'rejected') {
      failed += ids.length;
      return;
    }
    const left = new Set(result.value.skipped);
    skipped += left.size;
    gone += result.value.gone.length;
    const listIds = settled.get(list) ?? new Set<string>();
    ids.filter((id) => !left.has(id)).forEach((id) => listIds.add(id));
    settled.set(list, listIds);
  });
  return { settled, failed, skipped, gone };
};

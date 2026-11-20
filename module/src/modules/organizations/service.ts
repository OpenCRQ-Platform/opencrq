import { newError } from '@app/utils';
import { uuidv7 } from 'uuidv7';
import type { AssetMappingChange, EstateMode, OrganizationIdentityField, RiskTolerance, ScopeRiskTolerance } from './constants';
import type { ResolvedEstate } from './estate-filter';
import type { organizationIdentityEvents, organizations } from './schema';
import type { JournalValue } from '../../db/journal-value';
import type { InferRepository } from '../../registry';
import type { AssetCategory } from '../supporting-assets/constants';
import { decodeJournalValue, encodeJournalValue } from '../../db/journal-value';
import { isUniqueViolationOf } from '../../db/pg-errors';
import { defineService } from '../../registry';
import { originUserId, requireTenantId } from '../../security';
import { ORGANIZATION_IDENTITY_FIELDS, SCOPE_EVENTS_LIMIT } from './constants';
import { RiskScopeAlreadyExistsError, RiskScopeNotFoundError } from './errors';
import { ORGANIZATIONS_ID_TENANT_UNIQUE, ORGANIZATIONS_PKEY } from './schema';
import { OPEN_ESTATE } from './estate-filter';
import { organizationsRepository } from './repository';

type CreateOrganizationValues = Omit<typeof organizations.$inferInsert, 'tenantId'> & {
  mappedAssetIds?: Array<string>,
};

/** What the caller toggled since it read the scope, never the whole mapping: one scope maps up to hundreds of thousands of assets. */
export interface EstateMappingDelta {
  added: Array<string>,
  removed: Array<string>,
}

type UpdateOrganizationValues = Partial<Omit<typeof organizations.$inferInsert, 'tenantId' | 'estateChangedAt'>> & {
  mapping?: EstateMappingDelta,
};

const firmographyIds = (values: Array<{ sectorId?: string | null, countryId?: string | null }>) => ({
  sectorIds: [...new Set(values.flatMap(({ sectorId }) => (sectorId ? [sectorId] : [])))],
  countryIds: [...new Set(values.flatMap(({ countryId }) => (countryId ? [countryId] : [])))],
});

/**
 * Three bind parameters per row on insert, one per row on delete, far under the 65 535 a statement
 * may carry: the ceiling is low enough that a save at the router's cap really does loop.
 */
const MAPPING_CHUNK_ROWS = 1000;

const chunked = (ids: Array<string>): Array<Array<string>> => {
  const chunks: Array<Array<string>> = [];
  for (let index = 0; index < ids.length; index += MAPPING_CHUNK_ROWS) {
    chunks.push(ids.slice(index, index + MAPPING_CHUNK_ROWS));
  }
  return chunks;
};

type OrganizationsRepo = InferRepository<typeof organizationsRepository>;

type MappingRepo = Pick<OrganizationsRepo, 'insertOrganizationAssets'>;

/** The ids this write really mapped: one the scope already maps is not among them. */
const insertMappingRows = async (
  repo: MappingRepo,
  organizationId: string,
  tenantId: string,
  supportingAssetIds: Array<string>,
): Promise<Array<string>> => {
  const inserted: Array<string> = [];
  for (const chunk of chunked([...new Set(supportingAssetIds)])) {
    inserted.push(...await repo.insertOrganizationAssets(chunk.map((supportingAssetId) => ({ organizationId, supportingAssetId, tenantId }))));
  }
  return inserted;
};

interface JournalScope {
  tenantId: string,
  organizationId: string,
  userId: string | null,
}

interface MappingChange {
  added: Array<string>,
  removed: Array<string>,
  estateMode: { from: EstateMode, to: EstateMode } | null,
}

const journalMapping = async (
  repo: Pick<OrganizationsRepo, 'insertAssetMappingEvent' | 'insertAssetMappingEventAssets'>,
  scope: JournalScope,
  { added, removed, estateMode }: MappingChange,
) => {
  if (added.length === 0 && removed.length === 0 && estateMode === null) {
    return;
  }
  const eventId = uuidv7();
  await repo.insertAssetMappingEvent({
    id: eventId,
    ...scope,
    addedCount: added.length,
    removedCount: removed.length,
    oldEstateMode: estateMode?.from ?? null,
    newEstateMode: estateMode?.to ?? null,
  });
  const rows = [
    ...added.map((supportingAssetId) => ({ supportingAssetId, change: 'added' as const })),
    ...removed.map((supportingAssetId) => ({ supportingAssetId, change: 'removed' as const })),
  ];
  for (let index = 0; index < rows.length; index += MAPPING_CHUNK_ROWS) {
    await repo.insertAssetMappingEventAssets(rows.slice(index, index + MAPPING_CHUNK_ROWS)
      .map((row) => ({ ...row, eventId, tenantId: scope.tenantId })));
  }
};

type IdentityRow = NonNullable<Awaited<ReturnType<OrganizationsRepo['lockOrganizationForUpdate']>>>;

type IdentityValues = Partial<Omit<IdentityRow, 'estateMode'>>;

const reactionTimeOf = (min: number | null, likely: number | null, max: number | null): JournalValue =>
  (min === null && likely === null && max === null ? null : [min, likely, max]);

/** Undefined when the save leaves the field out; the three reaction times read as one value. */
const identityValueOf = (field: OrganizationIdentityField, values: IdentityValues, stored: IdentityRow): JournalValue | undefined => {
  if (field !== 'reactionTime') {
    return values[field];
  }
  const { reactionTimeMin: min, reactionTimeLikely: likely, reactionTimeMax: max } = values;
  if (min === undefined && likely === undefined && max === undefined) {
    return undefined;
  }
  return reactionTimeOf(
    min === undefined ? stored.reactionTimeMin : min,
    likely === undefined ? stored.reactionTimeLikely : likely,
    max === undefined ? stored.reactionTimeMax : max,
  );
};

/** One event per identity field the save changes; a field left out of the save keeps its value. */
const identityEvents = (
  stored: IdentityRow,
  values: IdentityValues,
  scope: JournalScope,
): Array<typeof organizationIdentityEvents.$inferInsert> => ORGANIZATION_IDENTITY_FIELDS.flatMap((field) => {
  const sent = identityValueOf(field, values, stored);
  if (sent === undefined) {
    return [];
  }
  const oldValue = encodeJournalValue(identityValueOf(field, stored, stored) ?? null);
  const newValue = encodeJournalValue(sent);
  return oldValue === newValue ? [] : [{ id: uuidv7(), ...scope, field, oldValue, newValue }];
});

export interface OrganizationIdentityEvent {
  readonly id: string,
  readonly field: OrganizationIdentityField,
  readonly before: JournalValue,
  readonly after: JournalValue,
  readonly createdAt: Date,
  readonly userName: string | null,
}

export interface AssetMappingEvent {
  readonly id: string,
  readonly addedCount: number,
  readonly removedCount: number,
  readonly estateMode: { readonly from: EstateMode, readonly to: EstateMode } | null,
  readonly createdAt: Date,
  readonly userName: string | null,
}

export interface AssetMappingEventAsset {
  readonly change: AssetMappingChange,
  readonly id: string,
  readonly name: string | null,
  readonly derivedName: string | null,
  readonly categoryId: AssetCategory,
}

export const organizationsService = defineService(
  'organizations',
  organizationsRepository,
).implement(
  {
    createOrganizations: async ({ atomic, eventOrigin }, values: Array<CreateOrganizationValues>) => {
      const tenantId = requireTenantId(eventOrigin);
      const userId = originUserId(eventOrigin) ?? null;
      await atomic(async ({ repo: atomicRepo }) => {
        await atomicRepo.validateFirmographyIds(firmographyIds(values));
        try {
          await atomicRepo.insertOrganizations(values.map(({ mappedAssetIds: _mapped, ...v }) => ({
            ...v,
            tenantId,
            estateChangedAt: v.estateMode === 'closed' ? new Date() : null,
          })));
        } catch (error) {
          if (isUniqueViolationOf(error, ORGANIZATIONS_PKEY) || isUniqueViolationOf(error, ORGANIZATIONS_ID_TENANT_UNIQUE)) {
            throw new RiskScopeAlreadyExistsError();
          }
          throw error;
        }
        for (const organization of values) {
          const added = await insertMappingRows(atomicRepo, organization.id, tenantId, organization.mappedAssetIds ?? []);
          await journalMapping(atomicRepo, { tenantId, organizationId: organization.id, userId }, { added, removed: [], estateMode: null });
        }
      });
    },
    deleteOrganizations: async ({ repo }, ...args: Parameters<InferRepository<typeof organizationsRepository>['deleteOrganizations']>) => await repo.deleteOrganizations(...args),
    /**
     * Applies the caller's delta, so two savers holding different pages of the same estate keep
     * each other's ticks, and moves `estateChangedAt` only on the rows the writes really touched:
     * re-ticking an asset the scope already maps changes no estate.
     */
    updateOrganization: async ({ repo, atomic, eventOrigin }, id: string, values: UpdateOrganizationValues) => {
      const { mapping, ...columns } = values;
      await repo.validateFirmographyIds(firmographyIds([columns]));
      const tenantId = requireTenantId(eventOrigin);
      const scope = { tenantId, organizationId: id, userId: originUserId(eventOrigin) ?? null };
      return await atomic(async ({ repo: atomicRepo }) => {
        const before = await atomicRepo.lockOrganizationForUpdate(id);
        if (!before) {
          throw new RiskScopeNotFoundError();
        }
        // An asset listed both as added and as removed contradicts itself, so the save leaves it as it is.
        const requestedRemovals = new Set(mapping?.removed ?? []);
        const requestedAdditions = new Set(mapping?.added ?? []);
        const added = await insertMappingRows(atomicRepo, id, tenantId, [...requestedAdditions].filter((assetId) => !requestedRemovals.has(assetId)));
        const removed: Array<string> = [];
        for (const ids of chunked([...requestedRemovals].filter((assetId) => !requestedAdditions.has(assetId)))) {
          removed.push(...await atomicRepo.deleteOrganizationAssets(id, ids));
        }
        const estateMode = columns.estateMode !== undefined && columns.estateMode !== before.estateMode
          ? { from: before.estateMode, to: columns.estateMode }
          : null;
        await journalMapping(atomicRepo, scope, { added, removed, estateMode });
        await atomicRepo.insertIdentityEvents(identityEvents(before, columns, scope));
        const estateChanged = estateMode !== null || added.length > 0 || removed.length > 0;
        const changes = { ...columns, ...(estateChanged ? { estateChangedAt: new Date() } : {}) };
        return Object.keys(changes).length === 0 ? undefined : await atomicRepo.updateOrganization(id, changes);
      });
    },
    /**
     * Moves `estateChangedAt` on every scope mapping one of these assets. Deleting an asset drops
     * its junction rows through the database cascade, which is an estate change no delta reports,
     * so the caller runs this in the deleting transaction and before the delete.
     */
    markEstateChangedByAssets: async ({ repo }, supportingAssetIds: Array<string>) => {
      const affected = new Set<string>();
      for (const chunk of chunked([...new Set(supportingAssetIds)])) {
        for (const id of await repo.findOrganizationIdsMappingAssets(chunk)) {
          affected.add(id);
        }
      }
      if (affected.size === 0) {
        return;
      }
      await repo.stampEstateChanged([...affected], new Date());
    },
    /** The junction row and the date it moves are one write: an asset created inside a closed scope is mapped or not created. */
    mapAssetsIntoScope: async ({ atomic, eventOrigin }, organizationId: string, supportingAssetIds: Array<string>) => {
      if (supportingAssetIds.length === 0) {
        return;
      }
      const tenantId = requireTenantId(eventOrigin);
      const userId = originUserId(eventOrigin) ?? null;
      await atomic(async ({ repo: atomicRepo }) => {
        await atomicRepo.lockOrganizationForUpdate(organizationId);
        const added = await insertMappingRows(atomicRepo, organizationId, tenantId, supportingAssetIds);
        if (added.length > 0) {
          await journalMapping(atomicRepo, { tenantId, organizationId, userId }, { added, removed: [], estateMode: null });
          await atomicRepo.updateOrganization(organizationId, { estateChangedAt: new Date() });
        }
      });
    },
    getIdentityHistory: async ({ repo }, organizationId: string): Promise<Array<OrganizationIdentityEvent>> =>
      (await repo.findIdentityEvents(organizationId, SCOPE_EVENTS_LIMIT)).map((row) => ({
        id: row.id,
        field: row.field,
        before: decodeJournalValue(row.oldValue),
        after: decodeJournalValue(row.newValue),
        createdAt: row.createdAt,
        userName: row.userName,
      })),
    getAssetMappingHistory: async ({ repo }, organizationId: string): Promise<Array<AssetMappingEvent>> =>
      (await repo.findAssetMappingEvents(organizationId, SCOPE_EVENTS_LIMIT)).map((row) => ({
        id: row.id,
        addedCount: row.addedCount,
        removedCount: row.removedCount,
        estateMode: row.oldEstateMode === null || row.newEstateMode === null ? null : { from: row.oldEstateMode, to: row.newEstateMode },
        createdAt: row.createdAt,
        userName: row.userName,
      })),
    getAssetMappingEventAssets: async ({ repo }, eventId: string): Promise<Array<AssetMappingEventAsset>> =>
      await repo.findAssetMappingEventAssets(eventId),
    getOrganization: async ({ repo }, id: string) => {
      const organization = await repo.findOrganizationById(id);
      if (!organization) {
        return undefined;
      }
      const mappedAssetCount = await repo.countMappedAssets(id);
      const declaresEstate = await repo.existsDeclaredEstate(id);
      // A closed scope prices what it maps and what it declares, so it has nothing to price only when it holds neither.
      return { ...organization, mappedAssetCount, noMappedAsset: organization.estateMode === 'closed' && mappedAssetCount === 0 && !declaresEstate };
    },
    getOrganizationProfiles: async ({ repo }) => await repo.findOrganizationProfiles(),
    getOrganizations: async ({ repo }) => {
      const [rows, counts, declaringIds] = await Promise.all([
        repo.findAllOrganizations(),
        repo.countMappedAssetsByOrganization(),
        repo.findOrganizationIdsDeclaringEstate(),
      ]);
      const countByOrganizationId = new Map(counts.map((row) => [row.organizationId, row.mappedAssetCount]));
      const declaring = new Set(declaringIds);
      return rows.map((organization) => {
        const mappedAssetCount = countByOrganizationId.get(organization.id) ?? 0;
        return { ...organization, mappedAssetCount, noMappedAsset: organization.estateMode === 'closed' && mappedAssetCount === 0 && !declaring.has(organization.id) };
      });
    },
    getOrganizationCore: async ({ repo }, ...args: Parameters<InferRepository<typeof organizationsRepository>['findOrganizationCoreById']>) => await repo.findOrganizationCoreById(...args),
    /**
     * The one read of a scope's estate mode. Resolved once and handed to the readers, which join
     * the mapping only on a closed scope and so never read the mode themselves.
     */
    resolveEstate: async ({ repo }, organizationId: string): Promise<ResolvedEstate | undefined> => {
      const organization = await repo.findOrganizationEstateById(organizationId);
      if (organization === undefined) {
        return undefined;
      }
      return organization.estateMode === 'closed' ? { mode: 'closed', organizationId } : OPEN_ESTATE;
    },
    /** Whether the scope maps anything. Asked instead of the count wherever only the emptiness is read. */
    hasMappedAsset: async ({ repo }, organizationId: string) => await repo.existsMappedAsset(organizationId),
    getRiskTolerance: async ({ repo }, organizationId: string): Promise<ScopeRiskTolerance> => {
      const [tolerance, { scenarioCount, ownThresholdCount }] = await Promise.all([
        repo.findRiskTolerance(organizationId),
        repo.countScenarioThresholds(organizationId),
      ]);
      return { tolerance: tolerance ?? null, scenarioCount, ownThresholdCount };
    },
    setRiskTolerance: async ({ repo }, organizationId: string, tolerance: RiskTolerance) => {
      if (!await repo.findOrganizationEstateById(organizationId)) {
        throw new RiskScopeNotFoundError();
      }
      await repo.upsertRiskTolerance(organizationId, tolerance);
    },
    /** The caller's own unpinned scopes. */
    getUnpinnedOrganizationIds: async ({ repo }) => await repo.findUnpinnedOrganizationIds(),
    setOrganizationPinned: async ({ repo, eventOrigin }, organizationId: string, pinned: boolean) => {
      if (eventOrigin.type !== 'client') {
        throw newError('A pin belongs to a user inside a tenant', { originType: eventOrigin.type });
      }
      const { tenantId, userId } = eventOrigin;
      if (pinned) {
        await repo.deleteOrganizationUnpin(userId, organizationId);
        return;
      }
      if (!await repo.findOrganizationEstateById(organizationId)) {
        throw new RiskScopeNotFoundError();
      }
      await repo.insertOrganizationUnpin({ userId, organizationId, tenantId });
    },
  },
);

/** The OpenAEV assets folded onto each OpenCRQ asset, from an OpenAEV asset id to supporting asset id map. */
export const sourceAssetIdsBySupportingAsset = (assetIdMap: ReadonlyMap<string, string>): Map<string, Array<string>> => new Map(
  [...Map.groupBy(assetIdMap, ([, supportingAssetId]) => supportingAssetId)]
    .map(([supportingAssetId, entries]) => [supportingAssetId, entries.map(([sourceAssetId]) => sourceAssetId)]),
);

export interface CompleteMirrorInput {
  /** OpenAEV asset id to OpenCRQ asset id, for every asset the connector has registered. */
  registry: ReadonlyMap<string, string>,
  /** OpenAEV asset id to the OpenAEV tenant that lists it. */
  tenantOfAsset: ReadonlyMap<string, string>,
  /** The OpenAEV tenants whose attack mirror holds everything OpenAEV serves. */
  completeTenants: ReadonlySet<string>,
  /** Every OpenAEV tenant the run reads. */
  runTenantIds: ReadonlyArray<string>,
}

/**
 * Whether the attack evidence of an OpenCRQ asset may be judged: only when its every OpenAEV asset
 * belongs to a tenant with a complete mirror. A pair is judged on the documents of every OpenAEV
 * asset folded onto its OpenCRQ asset, and a document missing from another tenant's mirror may
 * simply not have been read yet, which only that tenant's walk can tell. An OpenAEV asset whose
 * tenant is unknown, because the registry is not filled yet, may belong to any tenant of the run:
 * it passes only when all of them are complete.
 */
export const onCompleteMirrors = ({ registry, tenantOfAsset, completeTenants, runTenantIds }: CompleteMirrorInput): (supportingAssetId: string) => boolean => {
  const sourceAssetIdsBySupportingAssetId = sourceAssetIdsBySupportingAsset(registry);
  const everyTenantComplete = runTenantIds.every((openaevTenantId) => completeTenants.has(openaevTenantId));
  return (supportingAssetId) => (sourceAssetIdsBySupportingAssetId.get(supportingAssetId) ?? []).every((sourceAssetId) => {
    const openaevTenantId = tenantOfAsset.get(sourceAssetId);
    return openaevTenantId === undefined ? everyTenantComplete : completeTenants.has(openaevTenantId);
  });
};

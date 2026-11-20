/** The Combobox's own value shape: an existing tag from the tenant's vocabulary, or one just typed. */
export interface AssetTagOption {
  id: string,
  name: string,
  color: string | null,
}

export const emptyAssetTagsFormValue: Array<AssetTagOption> = [];

/**
 * Prefills the form from the asset's own tags (`getSupportingAsset`'s `tags`), kept to the ones
 * the manual author asserted (`isManual`) — never a connector's. Submitting sends `tagNames` as a
 * full replacement of the manual author's links: starting from every tag the page shows,
 * connector-reported ones included, would pin a connector's tag as if the user had chosen it, and
 * that pin would outlive the connector's own report since a resync deliberately spares manual tags.
 */
export const assetTagsFormValuesFrom = (tags: ReadonlyArray<{ id: string, name: string, color: string | null, isManual: boolean }>): Array<AssetTagOption> =>
  tags.filter((tag) => tag.isManual).map((tag) => ({ id: tag.id, name: tag.name, color: tag.color }));

/**
 * Builds a selectable value for a name typed into the field that matches no vocabulary entry. Its
 * `id` is never sent anywhere — submission reads `name` only (see {@link tagNamesFrom}) — so it
 * only has to be distinct enough for the Combobox's own `isOptionEqualToValue`.
 */
export const createTagFromInput = (name: string): AssetTagOption => ({ id: name, name, color: null });

/**
 * The payload `tagNames` expects: every selected tag's name, whether it came from the tenant's
 * vocabulary or was typed by hand. The backend resolves a name to an existing tag or creates one, so
 * the form never needs to tell the two apart.
 */
export const tagNamesFrom = (tags: ReadonlyArray<AssetTagOption>): Array<string> => tags.map((tag) => tag.name);

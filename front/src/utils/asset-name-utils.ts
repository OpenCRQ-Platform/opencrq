import { includesFolded } from '@app/utils/text-fold';

export interface AssetNameParts {
  name: string | null,
  derivedName: string | null,
}

export type AssetNameDisplay =
  | { kind: 'name' | 'derived', text: string }
  | { kind: 'unnamed' };

const present = (value: string | null): string | null => (value === null || value.trim() === '' ? null : value);

/** The name when there is one, else the derived name, else nothing: a blank string counts as absent. */
export const assetNameDisplay = (asset: AssetNameParts): AssetNameDisplay => {
  const name = present(asset.name);
  if (name !== null) {
    return { kind: 'name', text: name };
  }
  const derivedName = present(asset.derivedName);
  if (derivedName !== null) {
    return { kind: 'derived', text: derivedName };
  }
  return { kind: 'unnamed' };
};

/** Whether the name an asset is shown under contains the search: the server searches that same name, so a client filter must agree. */
export const assetNameMatches = (asset: AssetNameParts, search: string): boolean => {
  const display = assetNameDisplay(asset);
  return display.kind !== 'unnamed' && includesFolded(display.text, search);
};

/** Plain-text twin of `assetNameDisplay`, the label for an unnamed asset being the caller's to translate. */
export const assetNameText = (asset: AssetNameParts, unnamedLabel: string): string => {
  const display = assetNameDisplay(asset);
  return display.kind === 'unnamed' ? unnamedLabel : display.text;
};

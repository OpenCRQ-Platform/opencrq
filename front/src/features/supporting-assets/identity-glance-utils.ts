import type { AssetCategory, AssetSubcategory } from '@app/module/client';

/**
 * Whether an identity row stands for a person or for something a person configured. Five sixths of
 * the identities a real tenant ingests are not people, so a reader has to tell the two apart while
 * scanning a page — but only the two: the six subcategories stay exact on the filter and on the
 * detail, and a mark per subcategory would be six things to learn instead of one distinction to
 * see.
 *
 * `null` means no mark at all: a row that is not an identity, and an identity whose subcategory no
 * source stated. Neither is a non-human — an absent reading must not read as an answer.
 */
export type IdentityGlance = 'human' | 'non-human';

export const identityGlanceOf = (
  categoryId: AssetCategory,
  subcategoryId: AssetSubcategory | null,
): IdentityGlance | null => {
  if (categoryId !== 'identity' || subcategoryId === null) {
    return null;
  }
  // A shared mailbox is a person's surface even though no single person owns it, and a role is a
  // grant held by people. Both read as human: what the mark separates is "someone signs in here"
  // from "something runs here".
  return subcategoryId === 'service_account' || subcategoryId === 'non_human_identity'
    ? 'non-human'
    : 'human';
};

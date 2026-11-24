import type { ProductConnection, ReaderAuthorization, ReaderProduct } from './xtm-providers';
import { ReaderTokenUnavailable } from '../../xtm-one/xtm-one-token-exchange';

/**
 * Why a member cannot be read as in a sibling product, in the one category each case calls for a
 * different action by: an administrator links the product to XTM One (`not_linked`), the product's
 * administrator creates the member's account (`no_account`), or nobody can for now (`unavailable`).
 * Never carries the failure's own text, which can hold upstream output.
 */
export const READER_ACCESS_ISSUES = ['not_linked', 'no_account', 'unavailable'] as const;
export type ReaderAccessIssue = typeof READER_ACCESS_ISSUES[number];

/** The category of a failed attempt to obtain the member's token for a sibling product. */
export const issueOfTokenFailure = (err: unknown): ReaderAccessIssue => {
  if (err instanceof ReaderTokenUnavailable) {
    if (err.refusal === 'audience') {
      return 'not_linked';
    }
    if (err.refusal === 'user') {
      return 'no_account';
    }
  }
  return 'unavailable';
};

/** Whether the member's token for `product` can be obtained, and the category of the failure when not. */
export const probeReaderIssue = async (
  authorization: ReaderAuthorization,
  product: ReaderProduct,
  connection: ProductConnection,
): Promise<ReaderAccessIssue | null> => {
  // An authorization that signs nothing (no user, no XTM One) says nothing about OpenCTI's link.
  if (authorization.unsigned !== undefined) {
    return 'unavailable';
  }
  try {
    return (await authorization(product, connection)) ? null : 'unavailable';
  } catch (err) {
    return issueOfTokenFailure(err);
  }
};

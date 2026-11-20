/**
 * The prefix of every service-account token, the scheme OpenCTI's `flgrn_octi_tkn_` follows.
 * `scripts/ci/boot-image.sh` carries its own copy, in the seeded token it authenticates with.
 */
export const SERVICE_ACCOUNT_TOKEN_PREFIX = 'flgrn_ocrq_tkn_';

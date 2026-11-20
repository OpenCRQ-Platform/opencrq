/**
 * The version an image was built as (`APP_VERSION`): the tag of a release, `0.YYMMDD.z`, or
 * `0.YYMMDD.0-dev.<sha>` for any other commit. Undefined outside an image, where seeding, the reset on
 * version change and the run stamps, which follow it, have nothing to compare. The only reader of
 * `APP_VERSION`, which a lint rule enforces.
 */
export const imageVersion = (): string | undefined => process.env.APP_VERSION?.trim() || undefined;

/** The version the platform reports: the image's, or `0.0.0-dev` for a process run from source. */
export const platformVersion = (): string => imageVersion() ?? '0.0.0-dev';

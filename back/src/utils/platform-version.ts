/**
 * The version an image was built as (`APP_VERSION`): the tag of a release, `0.YYMMDD.z`, or
 * `0.YYMMDD.0-dev.<sha>` for any other commit. Undefined outside an image, where seeding, the reset on
 * version change and the run stamps, which follow it, have nothing to compare. The only reader of
 * `APP_VERSION`, which a lint rule enforces.
 */
export const imageVersion = (): string | undefined => process.env.APP_VERSION?.trim() || undefined;

/** The version the platform reports: the image's, or `0.0.0-dev` for a process run from source. */
export const platformVersion = (): string => imageVersion() ?? '0.0.0-dev';

/** An image's release, ordered by the commit it was built from: two builds of one day do not sort by version. */
export interface ImageRelease {
  version: string,
  /** Unix seconds of the commit's date. */
  committedAt: number,
}

/**
 * The image's release, from `APP_VERSION` and `APP_COMMIT_TIME` (the commit's date, ISO 8601). Undefined
 * when either is missing or unreadable: such a process neither fences an older release out of the
 * database nor is fenced out by a newer one. The only reader of `APP_COMMIT_TIME`, which a lint rule
 * enforces.
 */
export const imageRelease = (): ImageRelease | undefined => {
  const version = imageVersion();
  const committedAtMs = Date.parse(process.env.APP_COMMIT_TIME?.trim() ?? '');
  if (version === undefined || Number.isNaN(committedAtMs)) {
    return undefined;
  }
  return { version, committedAt: Math.floor(committedAtMs / 1_000) };
};

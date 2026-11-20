/**
 * The platform version, which an image carries as `APP_VERSION`: `<major>.YYMMDD.z` for a release,
 * the tag it is built from, and `<major>.YYMMDD.0-dev.<sha>` for any other commit, dated by that
 * commit so that a rebuild keeps it. Dates are in UTC, and `z` counts the releases of a day from 0.
 */

/** The major of every version, 0 during the beta. */
export const MAJOR = 0;

const RELEASE = /^(\d+)\.(\d{6})\.(\d+)$/;

// The tags CI builds a release from: any three numbers, which a release has to be.
const RELEASE_SHAPED = /^\d+\.\d+\.\d+$/;

const yymmdd = (date) => [date.getUTCFullYear() % 100, date.getUTCMonth() + 1, date.getUTCDate()]
  .map((part) => String(part).padStart(2, '0'))
  .join('');

/** The tag names in the output of `git ls-remote --tags`. */
export const tagNames = (lsRemote) => lsRemote.split('\n')
  .map((line) => line.split('\t')[1]?.replace(/^refs\/tags\//, '').replace(/\^\{\}$/, ''))
  .filter(Boolean);

/**
 * The number of the next release cut on `date`, given the tags the repository already has: one past
 * the highest `z` of that day under `major`, or 0 for the day's first.
 */
export const nextReleaseNumber = ({ major, date, tags }) => {
  const day = yymmdd(date);
  const taken = tags
    .map((tag) => RELEASE.exec(tag))
    .filter((match) => match !== null && Number(match[1]) === major && match[2] === day)
    .map((match) => Number(match[3]));
  const z = taken.length === 0 ? 0 : Math.max(...taken) + 1;
  return `${major}.${day}.${z}`;
};

/**
 * The version of an image built from the Git `ref` (`refs/tags/…`, `refs/heads/…`, `refs/pull/…`)
 * at commit `sha`, which `commitDate(sha)` dates, on `today`: the tag's name when it is a release, a
 * development version otherwise. A tag CI builds as a release that is not one of `MAJOR`, dated on a
 * real day between its commit's and `today`, throws, failing the build: a mistyped date would sort
 * above every real release wherever versions are ordered.
 */
export const buildVersion = ({ ref, sha, commitDate, today }) => {
  if (!/^[0-9a-f]{7,}$/.test(sha)) {
    throw new Error(`"${sha}" is not a commit sha`);
  }
  const tag = ref.startsWith('refs/tags/') ? ref.slice('refs/tags/'.length) : null;
  if (tag !== null && RELEASE_SHAPED.test(tag)) {
    const match = RELEASE.exec(tag);
    if (match === null || Number(match[1]) !== MAJOR) {
      throw new Error(`tag ${tag} is not a release: ${MAJOR}.YYMMDD.z`);
    }
    const day = match[2];
    const [yy, mm, dd] = [0, 2, 4].map((at) => Number(day.slice(at, at + 2)));
    const committed = yymmdd(commitDate(sha));
    if (yymmdd(new Date(Date.UTC(2000 + yy, mm - 1, dd))) !== day || day < committed || day > yymmdd(today)) {
      throw new Error(`tag ${tag} is not dated on a day between its commit's, ${committed}, and today, ${yymmdd(today)}`);
    }
    return tag;
  }
  return `${MAJOR}.${yymmdd(commitDate(sha))}.0-dev.${sha.slice(0, 7)}`;
};

const releaseKey = (tag) => {
  const match = RELEASE.exec(tag);
  return match === null ? null : match.slice(1).map(Number);
};

/** Whether `tag` is a release, `<major>.YYMMDD.z` under any major. */
export const isRelease = (tag) => releaseKey(tag) !== null;

/** Orders two releases as numbers, part by part. */
export const compareReleases = (a, b) => {
  const [ka, kb] = [releaseKey(a), releaseKey(b)];
  for (let i = 0; i < 3; i += 1) {
    if (ka[i] !== kb[i]) {
      return ka[i] - kb[i];
    }
  }
  return 0;
};

/** The highest release among `tags`, `exclude` left out, or null when there is none. */
export const highestRelease = (tags, exclude = null) => tags
  .filter((tag) => isRelease(tag) && tag !== exclude)
  .reduce((highest, tag) => (highest === null || compareReleases(tag, highest) > 0 ? tag : highest), null);

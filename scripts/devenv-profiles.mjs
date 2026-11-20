/**
 * The Compose profiles `devenv.mjs` turns on, kept apart so they are tested without an engine.
 */

/** The stack's own XTM One: its database, its platform and its worker. */
export const XTM_ONE_PROFILE = 'xtm-one';

export const MONITORING_PROFILE = 'monitoring';

/**
 * Every profile, which `down` names: Compose leaves the containers of a profile it is not given
 * running, so a stack started with one would outlive its `down`.
 */
export const ALL_PROFILES = [XTM_ONE_PROFILE, MONITORING_PROFILE];

/** The `infra/local/.env` key a worktree sets to `false` to run without its own XTM One. */
export const XTM_ONE_LOCAL_KEY = 'XTM_ONE_LOCAL';

/**
 * A `.env` value as Compose reads it: the text between quotes, or an unquoted value without its
 * inline ` # comment`.
 *
 * @param {string | undefined} raw what follows `=` on the line
 */
export const dotEnvValue = (raw = '') => {
  const value = raw.trim();
  const quoted = /^(['"])(.*?)\1/.exec(value);
  return quoted ? quoted[2] : value.replace(/\s+#.*$/, '').trim();
};

/**
 * Whether the stack starts its own XTM One: unless its `infra/local/.env` says `XTM_ONE_LOCAL=false`.
 *
 * @param {Record<string, string>} env the variables of the worktree's `infra/local/.env`, as written
 */
export const runsOwnXtmOne = (env) => dotEnvValue(env[XTM_ONE_LOCAL_KEY]).toLowerCase() !== 'false';

/**
 * The profiles `up` enables.
 *
 * @param {{ monitoring: boolean, ownXtmOne: boolean }} options
 */
export const upProfiles = ({ monitoring, ownXtmOne }) => [
  ...ownXtmOne ? [XTM_ONE_PROFILE] : [],
  ...monitoring ? [MONITORING_PROFILE] : [],
];

/** @param {Array<string>} profiles */
export const profileArgs = (profiles) => profiles.flatMap((profile) => ['--profile', profile]);

/**
 * The services a profile adds, from what `config --services` lists with it and without it: read
 * from the Compose file rather than named here, so a service added to the profile is covered.
 *
 * @param {string} withProfile
 * @param {string} without
 */
export const servicesOfProfile = (withProfile, without) => {
  const lines = (text) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const base = new Set(lines(without));
  return lines(withProfile).filter((service) => !base.has(service));
};

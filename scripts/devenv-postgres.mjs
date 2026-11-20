/**
 * What `devenv.mjs` decides when it moves a stack's databases to another PostgreSQL major version,
 * kept apart so it is tested without a container engine.
 */

/**
 * The major version of the image a Compose file names in its `x-postgres-image` anchor, `null` when
 * it names none: `pgvector/pgvector` tags end in `-pg<major>`.
 *
 * @param {string} composeFile the Compose file's text
 */
export const pinnedPostgresMajor = (composeFile) => {
  const image = composeFile.match(/^x-postgres-image: &postgres-image (\S+)$/m)?.[1];
  const major = image?.match(/-pg(\d+)$/)?.[1];
  return major ? Number(major) : null;
};

/** One volume per major version, since a data directory opens on the major that created it only. */
export const postgresVolume = (major) => `postgres${major}_data`;

/** Where the image of a major version expects its volume: from 18 on, one level up, with the data under `<major>/docker`. */
export const postgresMountPath = (major) => (major >= 18 ? '/var/lib/postgresql' : '/var/lib/postgresql/data');

/**
 * The volumes of `project` a database may be in: one per major version, and the unnumbered
 * `postgres_data` that PostgreSQL 16 used. XTM One's former server is not one: its database is not moved.
 *
 * @param {string} project the Compose project
 * @param {string[]} names every volume the engine lists
 * @returns {string[]} the volumes, without the project prefix
 */
export const databaseVolumes = (project, names) => names
  .filter((name) => name.startsWith(`${project}_`))
  .map((name) => name.slice(project.length + 1))
  .filter((volume) => /^postgres\d*_data$/.test(volume));

/**
 * The image a database is dumped from: the family that wrote the volume, since another one runs
 * under another uid, which its entrypoint would chown the files to, and reads text indexes with
 * another libc's collation. `postgres_data` was written by the Alpine image, the numbered ones by
 * `pgvector/pgvector`.
 */
export const dumpImage = (volume, major) => (volume === 'postgres_data' ? `postgres:${major}-alpine` : `pgvector/pgvector:pg${major}`);

/**
 * The database a move starts from: the newest major older than `target`. A newer one is left
 * alone, as its dump may use what `target` does not know.
 *
 * @param {{ volume: string, major: number }[]} clusters the clusters the stack's volumes hold
 * @param {number} target the major `compose.yml` pins
 */
export const moveSource = (clusters, target) => clusters
  .filter((cluster) => cluster.major < target)
  .sort((a, b) => b.major - a.major)[0] ?? null;

/** Databases a move leaves behind: the server's own, and the integration tests', which every run recreates. */
export const isMovedDatabase = (name) => name !== 'postgres' && !name.startsWith('app_test_');

const unquote = (identifier) => (identifier.startsWith('"') ? identifier.slice(1, -1).replaceAll('""', '"') : identifier);

/**
 * The statements of `pg_dumpall --globals-only` to run on the new server: the bootstrap role is the
 * new server's own, set from the same configuration, and a role it already has is not created
 * again, so a move that failed half way runs them again.
 *
 * @param {string} globals what `pg_dumpall --globals-only` printed
 * @param {string} bootstrapUser `POSTGRES_USER`
 * @param {string[]} existingRoles the roles the new server has
 */
export const rolesToCreate = (globals, bootstrapUser, existingRoles) => globals
  .split(/\r?\n/)
  .filter((line) => {
    const role = line.match(/^(?:CREATE|ALTER) ROLE ("(?:[^"]|"")*"|[^\s;]+)/)?.[1];
    if (!role) {
      return true;
    }
    if (unquote(role) === bootstrapUser) {
      return false;
    }
    return !(line.startsWith('CREATE ROLE ') && existingRoles.includes(unquote(role)));
  })
  .join('\n');

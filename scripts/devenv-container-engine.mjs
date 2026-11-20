/**
 * What `devenv.mjs` adapts to the container engine it drives, kept apart so it is tested without one.
 */

/**
 * The `--format` of `docker version` whose output `listensBeyondLoopback` reads: the server's
 * platform name, then its components' names. Podman's Docker shim has no such fields and fails it.
 */
export const DOCKER_SERVER_FORMAT = '{{.Server.Platform.Name}}|{{range .Server.Components}}{{.Name}},{{end}}';

/**
 * Whether the backend has to listen on every interface for the stack's XTM One to reach it: only a
 * plain Docker engine on Linux resolves `host-gateway` to the bridge address rather than to the
 * host's loopback. Docker Desktop, Podman and anything this cannot identify answer no.
 *
 * @param {string} platform `process.platform`
 * @param {string} runnerCommand the compose runner's command, `docker`, `podman` or `podman-compose`
 * @param {string | null} dockerServer what `docker version --format DOCKER_SERVER_FORMAT` printed,
 *   `null` when it failed
 */
export const listensBeyondLoopback = (platform, runnerCommand, dockerServer) => {
  if (platform !== 'linux' || runnerCommand !== 'docker' || !dockerServer) {
    return false;
  }
  const [name = '', components = ''] = dockerServer.trim().split('|');
  // The platform name depends on how the engine was packaged; its `Engine` component does not.
  const engine = components.split(',').map((component) => component.trim()).includes('Engine');
  return engine && !/desktop|podman/i.test(`${name} ${components}`);
};

/**
 * The pull policy for XTM One's `rolling` images, `null` to keep the Compose file's `daily`.
 * `podman-compose` hands the policy to `podman create`, which knows no `daily`; `newer` pulls when
 * the registry holds another build, at the cost of a registry check on each `up`.
 *
 * @param {string} composeVersion what the runner's `version` printed on stdout
 */
export const xtmOnePullPolicy = (composeVersion) => (/^podman-compose version/im.test(composeVersion) ? 'newer' : null);

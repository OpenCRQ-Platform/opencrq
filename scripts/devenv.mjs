/**
 * Per-worktree development environment: ports, infrastructure, backend and frontend.
 *
 * Usage: node scripts/devenv.mjs <command> [options]
 *   up        [--install] [--reset] [--seed] [--monitoring] [--console] [--json]
 *   status    [--all] [--json]
 *   down      [--volumes]
 *   logs      [back|front] [--follow] [--lines <n>]
 *   ports     [--json]
 *   snapshot  [name] --dir <path> [--force]
 *   restore   [name] --dir <path> [--reset-cursors] [--force]
 *   snapshots --dir <path>
 *
 * Every worktree of this repository gets a port slot, allocated once and recorded in the shared
 * `.git` directory, so the allocation survives and is the same seen from any worktree. Slot 0 is
 * the standard set of ports, which keeps a single checkout on the values the documentation names.
 *
 * A worktree that already carries a hand-written `back/config/development.local.json` keeps its
 * ports: they are adopted into the registry rather than reallocated, so adopting this tool never
 * moves a stack that is already running.
 *
 * The generated files are `infra/local/.env` and `back/config/development.local.json`, both
 * gitignored, and both merged into rather than overwritten. The Compose file itself is never
 * generated: `infra/local/compose.yml` is versioned and already parameterised by these variables.
 *
 * Each worktree runs its own XTM One, whose secrets and administrator are generated into
 * `infra/local/.env` once and kept: its database holds what they were when it first booted. A
 * worktree whose XTM One port something else serves sets `XTM_ONE_LOCAL=false` in that file, and its
 * own XTM One is then neither started nor left running.
 *
 * A snapshot is a `pg_dump` archive of a worktree's database, which carries the whole platform and
 * every connector ingestion in it. It is bound to the migration version it was taken at: restoring
 * under a branch whose migrations are ahead works, the backend running the missing ones at boot,
 * while restoring under a branch behind the dump does not.
 */

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { DOCKER_SERVER_FORMAT, listensBeyondLoopback, xtmOnePullPolicy } from './devenv-container-engine.mjs';
import { databaseVolumes, dumpImage, isMovedDatabase, moveSource, pinnedPostgresMajor, postgresVolume, rolesToCreate } from './devenv-postgres.mjs';
import { ALL_PROFILES, profileArgs, runsOwnXtmOne, servicesOfProfile, upProfiles, XTM_ONE_LOCAL_KEY, XTM_ONE_PROFILE } from './devenv-profiles.mjs';

// VS Code exports ELECTRON_RUN_AS_NODE to every process it spawns, and node-gyp-build then picks
// the Electron build of a native module for what is plain Node: the backend would die at boot.
// Removed once here, so no child of this script inherits it (servers, yarn install, seeding).
delete process.env.ELECTRON_RUN_AS_NODE;

const SPACING = 100;

/**
 * Port families, as base value at slot 0. The spacing keeps every family apart at every slot:
 * two bases less than SPACING apart can never collide, whatever the slots.
 */
const PORTS = {
  postgres: 5432,
  rustfsApi: 9000,
  rustfsConsole: 9001,
  backend: 3002,
  healthcheck: 8444,
  frontend: 3000,
  pyroscope: 4040,
  otelGrpc: 4317,
  otelHttp: 4318,
  prometheus: 9090,
  grafana: 3020,
  xtmOne: 4005,
  mailpit: 8025,
  // The backend's own Prometheus scrape endpoint, not a container's.
  metrics: 14269,
};

const MONITORING = new Set(['pyroscope', 'otelGrpc', 'otelHttp', 'prometheus', 'grafana']);

const ENV_KEYS = {
  postgres: 'POSTGRES_PORT',
  backend: 'BACKEND_PORT',
  rustfsApi: 'RUSTFS_API_PORT',
  rustfsConsole: 'RUSTFS_CONSOLE_PORT',
  pyroscope: 'PYROSCOPE_PORT',
  otelGrpc: 'OTEL_GRPC_PORT',
  otelHttp: 'OTEL_HTTP_PORT',
  prometheus: 'PROMETHEUS_PORT',
  grafana: 'GRAFANA_PORT',
  xtmOne: 'XTM_ONE_PORT',
  mailpit: 'MAILPIT_PORT',
};

/** Written into `infra/local/.env` when missing, never replaced. */
const XTM_ONE_SECRETS = {
  XTM_ONE_SECRET_KEY: () => randomBytes(32).toString('hex'),
  // Never XTM One's published default: with that one it withholds the license and creates no
  // sign-in client.
  XTM_ONE_REGISTRATION_TOKEN: () => randomBytes(24).toString('hex'),
  XTM_ONE_ADMIN_EMAIL: () => 'xtm-admin@example.com',
  // XTM One's password policy wants a letter and a digit, which random bytes do not guarantee.
  XTM_ONE_ADMIN_PASSWORD: () => `Xtm1-${randomBytes(12).toString('hex')}`,
};

/** Flags earlier stacks wrote and the backend no longer knows: an unknown flag fails its boot. */
const UNKNOWN_FLAGS = ['xtm-sign-in'];

const WIN = process.platform === 'win32';

/** Internal: the detached supervisor this script re-enters to run one workspace's dev server. */
const SERVE = '__serve';

const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

/**
 * Windows needs a shell to run the `.cmd` shims of yarn and docker, and a shell wants one string:
 * an args array alongside `shell` raises a deprecation warning that would land in `--json` output.
 */
const runSync = (parts, options = {}) => (WIN
  ? spawnSync(parts.join(' '), { ...options, shell: true })
  : spawnSync(parts[0], parts.slice(1), options));

const git = (args, cwd = process.cwd()) => {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
};

/**
 * The root of the worktree `cwd` is in and the branch it has checked out, `null` on a detached
 * HEAD. `null` outside a worktree.
 */
const readCheckout = (cwd) => {
  const answer = git(['rev-parse', '--show-toplevel', '--abbrev-ref', 'HEAD'], cwd);
  if (!answer) {
    return null;
  }
  const [root, branch] = answer.split(/\r?\n/);
  // A detached HEAD answers the literal `HEAD` rather than failing.
  return { root: path.resolve(root), branch: branch === 'HEAD' ? null : branch };
};

/** The branch as the registry records it and `status` shows it. */
const branchLabel = (branch) => branch ?? 'detached';

const resolveLayout = () => {
  const checkout = readCheckout(process.cwd());
  if (!checkout) {
    fail('Not inside a git worktree of this repository.');
  }
  const { root } = checkout;
  const commonDir = path.resolve(git(['rev-parse', '--path-format=absolute', '--git-common-dir']));
  const gitDir = path.resolve(git(['rev-parse', '--path-format=absolute', '--git-dir']));
  return {
    root,
    branch: checkout.branch,
    isMain: root === path.dirname(commonDir),
    commonDir,
    // The name of `.git/worktrees/<id>`, which identifies a worktree whatever path it is seen
    // through: a dev container mounts it elsewhere, and `git worktree move` keeps it. `null` for the
    // main checkout.
    worktreeId: path.dirname(gitDir) === path.join(commonDir, 'worktrees') ? path.basename(gitDir) : null,
    registryFile: path.join(commonDir, 'devenv.json'),
    stateDir: path.join(commonDir, 'devenv'),
  };
};

/** The registry in `file`, an empty one when there is no file, `null` for a file that cannot be parsed. */
const parseRegistry = (file) => {
  if (!fs.existsSync(file)) {
    return { version: 1, instances: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed?.instances ? parsed : null;
  } catch {
    return null;
  }
};

const readRegistry = (file) => parseRegistry(file) ?? { version: 1, instances: {} };

/**
 * The registry as it is now, read to be written back. A file that exists but cannot be parsed stops
 * the command: taken for an empty registry, as `readRegistry` takes it, the write would keep only
 * this worktree's entry and drop every other one.
 */
const readRegistryToWrite = (file) => {
  const parsed = parseRegistry(file);
  if (!parsed) {
    fail(`${file} cannot be read as a registry, and writing it would drop every other worktree's entry. Fix or delete it, then run the command again.`);
  }
  return parsed;
};

const writeRegistry = (file, registry) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Written beside the file and renamed over it: a command reading meanwhile sees the registry
  // before or after this write, never half of it, which `readRegistry` would take for no entry at all.
  // The name is random rather than the pid: a dev container shares `.git` with its own pid namespace.
  const partial = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(partial, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
    fs.renameSync(partial, file);
  } catch (error) {
    fs.rmSync(partial, { force: true });
    throw error;
  }
};

/** Write `current`, the registry as read right before, and refresh the caller's copy with it. */
const commitRegistry = (layout, registry, current) => {
  writeRegistry(layout.registryFile, current);
  registry.instances = current.instances;
};

/**
 * Write this worktree's entry, and only it, into the registry as it is now: `up` reads it, then
 * starts containers and servers before it writes its pids, and another worktree may have written
 * its own entry meanwhile. `registry` is refreshed with what was written.
 */
const saveInstance = (layout, registry) => {
  const current = readRegistryToWrite(layout.registryFile);
  const instance = registry.instances[layout.root];
  if (instance) {
    current.instances[layout.root] = instance;
  } else {
    delete current.instances[layout.root];
  }
  commitRegistry(layout, registry, current);
};

const portsForSlot = (slot) => Object.fromEntries(
  Object.entries(PORTS).map(([name, base]) => [name, base + slot * SPACING]),
);

const slugify = (value) => value.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase().replace(/^-|-$/g, '').slice(0, 30);

/**
 * The ports a worktree already carries, read from a config written by hand or by an earlier run.
 * The values are adopted as they stand rather than recomputed from a slot: a stack that is already
 * running must not move because this tool met it for the first time.
 */
const adopted = (root, registry) => {
  const file = path.join(root, 'back', 'config', 'development.local.json');
  if (!fs.existsSync(file)) {
    return null;
  }
  let config;
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  const ports = {};
  const take = (name, value) => {
    if (typeof value === 'number') {
      ports[name] = value;
    }
  };
  take('backend', config.http_server?.port);
  take('frontend', config.dev_server?.port);
  take('healthcheck', config.healthcheck_http_server?.port);
  take('postgres', config.postgres?.port);
  const storage = /:(\d+)/.exec(config.file_storage?.endpoint ?? '');
  if (storage) {
    ports.rustfsApi = Number(storage[1]);
  }
  if (ports.backend === undefined) {
    return null;
  }

  // Another worktree already answering on this backend port means the config is stale, and keeping
  // its ports would hand two stacks the same ones. Reallocating is then the safe answer.
  const claimed = Object.entries(registry.instances)
    .some(([other, instance]) => other !== root && instance.ports.backend === ports.backend);
  if (claimed) {
    return null;
  }

  const slot = (ports.backend - PORTS.backend) / SPACING;
  return { ports, slot: Number.isInteger(slot) && slot >= 0 ? slot : null };
};

/**
 * Whether a recorded pid is still the dev-server supervisor this tool started from `root`: the pid
 * of a worktree removed long ago, or before a reboot, may since have been handed to an unrelated
 * process. Windows refuses to delete a directory a process still runs from, so there a removed
 * worktree has nothing left running.
 */
const runsFrom = (pid, root) => {
  if (WIN || !alive(pid)) {
    return false;
  }
  const result = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
  return result.status === 0 && result.stdout.includes(`${path.join(root, 'scripts', 'devenv.mjs')} ${SERVE}`);
};

/** The Compose project a suffix names, as `compose.yml` spells it. */
const projectOf = (suffix) => `app-dev${suffix}`;

/** The command that manages volumes: `podman-compose` has none of its own. */
const volumeCli = (runner) => (runner.command === 'podman-compose' ? 'podman' : runner.command);

/**
 * The Compose volumes that still exist, by the suffix of the project they belong to, empty when no
 * runtime answers. A released suffix keeps its volumes, and a worktree handed it would otherwise
 * open that database.
 */
const volumesBySuffix = (runner) => {
  const bySuffix = new Map();
  if (!runner) {
    return bySuffix;
  }
  const result = runSync([volumeCli(runner), 'volume', 'ls', '--format', '{{.Name}}'], { encoding: 'utf8' });
  if (result.status !== 0) {
    return bySuffix;
  }
  for (const name of result.stdout.split(/\r?\n/)) {
    const project = name.split('_')[0];
    if (project.startsWith(projectOf('-'))) {
      const suffix = project.slice(projectOf('').length);
      bySuffix.set(suffix, [...(bySuffix.get(suffix) ?? []), name]);
    }
  }
  return bySuffix;
};

/**
 * The suffix a worktree's own `infra/local/.env` records, `null` without one. Its containers and
 * volumes carry that name, so a worktree allocated again after losing its entry must take it back
 * rather than start over on an empty database.
 */
const recordedSuffix = (root) => {
  const file = path.join(root, 'infra', 'local', '.env');
  if (!fs.existsSync(file)) {
    return null;
  }
  const match = /^INSTANCE_SUFFIX=(.*)$/m.exec(fs.readFileSync(file, 'utf8'));
  return match && match[1].trim() !== '' ? match[1].trim() : null;
};

/**
 * Whether git no longer knows the worktree an entry was allocated for. Its path is no evidence
 * either way: from a dev container every other worktree is out of sight, so an entry is gone only
 * once `.git/worktrees/<id>` is, or, for an entry recorded without that id, once `git worktree list`
 * no longer names it at all, not even as prunable.
 */
const isForgotten = (layout, root, instance, listed) => (instance.worktreeId
  ? !fs.existsSync(path.join(layout.commonDir, 'worktrees', instance.worktreeId))
  : !listed.has(root) && !fs.existsSync(path.join(root, '.git')));

const listedWorktrees = () => new Set((git(['worktree', 'list', '--porcelain']) ?? '')
  .split(/\r?\n/)
  .filter((line) => line.startsWith('worktree '))
  .map((line) => path.resolve(line.slice('worktree '.length))));

/**
 * Releases the slot and suffix of every worktree git no longer knows, after stopping what it left
 * running: a slot handed out again with its old stack still up would bind ports that are taken.
 * Its volumes are left, since a wrong verdict here must cost a restart and never a database.
 * An entry is kept, and retried by the next run, while its stack cannot be stopped.
 */
const pruneForgotten = async (layout, registry, runner) => {
  const listed = listedWorktrees();
  const forgotten = Object.entries(registry.instances)
    .filter(([root, instance]) => root !== layout.root && isForgotten(layout, root, instance, listed));
  if (!forgotten.length) {
    return;
  }
  // A suffix a known worktree still holds names that worktree's stack as well.
  const liveSuffixes = new Set(Object.entries(registry.instances)
    .filter(([root]) => !forgotten.some(([gone]) => gone === root))
    .map(([, instance]) => instance.suffix));
  const volumes = volumesBySuffix(runner);
  const released = [];
  for (const [root, instance] of forgotten) {
    const keep = (reason) => process.stderr.write(`  Kept slot ${instance.slot} of ${root}, a worktree git no longer knows: ${reason}. Stop it, then delete its entry from .git/devenv.json.\n`);
    const running = Object.values(instance.pids ?? {}).filter((pid) => runsFrom(pid, root));
    running.forEach(stopProcess);
    // A backend shuts down asynchronously, and one still listening would make the next `up` on this
    // slot take its port for a server of its own already running.
    const exited = await Promise.all(running.map((pid) => waitForExit(pid, SHUTDOWN_GRACE_MS)));
    if (!exited.every(Boolean)) {
      keep(`a server still runs ${SHUTDOWN_GRACE_MS / 1000}s after its stop`);
      continue;
    }
    if (instance.suffix !== '' && !liveSuffixes.has(instance.suffix)) {
      if (!runner) {
        keep('no container runtime answers, so its containers may still hold its ports');
        continue;
      }
      if (!compose(runner, layout.root, ['-p', projectOf(instance.suffix), 'down'], { profiles: ALL_PROFILES, stdio: 'ignore' })) {
        keep('compose down failed');
        continue;
      }
    }
    fs.rmSync(path.join(layout.stateDir, String(instance.slot)), { recursive: true, force: true });
    released.push(root);
    // A suffix a known worktree still holds has its volumes in use: naming them here would hand out
    // the command that deletes a live database.
    const left = liveSuffixes.has(instance.suffix) ? [] : volumes.get(instance.suffix) ?? [];
    const reclaim = left.length ? ` Its volumes are left: \`${volumeCli(runner)} volume rm ${left.join(' ')}\` reclaims them.` : '';
    process.stderr.write(`  Released slot ${instance.slot} of ${root}, a worktree git no longer knows.${reclaim}\n`);
  }
  if (!released.length) {
    return;
  }
  // Stopping took seconds, long enough for an `up` in another worktree to have written its own
  // entry: only the deletions are applied to the registry as it is now.
  const current = readRegistryToWrite(layout.registryFile);
  for (const root of released) {
    delete current.instances[root];
  }
  commitRegistry(layout, registry, current);
};

const allocate = async (layout, registry) => {
  const runner = composeRunner();
  await pruneForgotten(layout, registry, runner);
  const branch = branchLabel(layout.branch);
  const existing = registry.instances[layout.root];
  if (existing) {
    // A family added since the entry was written takes its slot's value; the ones it has never move.
    const missing = Object.keys(PORTS).filter((name) => existing.ports[name] === undefined);
    const stale = existing.worktreeId === undefined || existing.branch !== branch || missing.length > 0;
    if (existing.worktreeId === undefined) {
      existing.worktreeId = layout.worktreeId;
    }
    existing.branch = branch;
    existing.ports = { ...portsForSlot(existing.slot), ...existing.ports };
    if (stale) {
      saveInstance(layout, registry);
    }
    return existing;
  }

  // Probed before the slot is chosen, and the registry read again right after: the probe takes
  // seconds, long enough for another worktree to take a slot, and a slot chosen from the copy read
  // before it would be handed out twice, for good, since an existing entry is returned as is.
  const volumes = volumesBySuffix(runner);
  registry.instances = readRegistryToWrite(layout.registryFile).instances;
  const raced = registry.instances[layout.root];
  if (raced) {
    return raced;
  }
  const taken = new Set(Object.values(registry.instances).map((i) => i.slot));
  const carried = adopted(layout.root, registry);
  let slot;
  if (carried?.slot != null && !taken.has(carried.slot)) {
    slot = carried.slot;
  } else {
    // Slot 0 is the documented set of ports, and belongs to the main checkout whether or not it
    // ever runs this tool. A worktree that took it would move the ports every guide names.
    slot = layout.isMain ? 0 : 1;
    while (taken.has(slot)) {
      slot += 1;
    }
  }

  // The suffix names the Compose project, its containers and its volumes: two instances sharing one
  // recreate each other's stack. Two branch names can slugify to the same value, and a collision
  // falls back to the slot rather than to a variant of the name, which would read as another branch.
  const registered = new Set(Object.values(registry.instances).map((i) => i.suffix));
  const recorded = recordedSuffix(layout.root);
  let suffix;
  if (slot === 0) {
    suffix = '';
  } else if (recorded !== null && !registered.has(recorded)) {
    // Its own volumes, if any, are the ones it is taking back.
    suffix = recorded;
  } else {
    const held = new Set([...registered, ...volumes.keys()]);
    const named = `-${slugify(layout.branch ?? '')}`;
    suffix = named !== '-' && !held.has(named) ? named : `-wt${slot}`;
    while (held.has(suffix)) {
      suffix = `${suffix}-${slot}`;
    }
  }
  const instance = {
    slot,
    branch,
    suffix,
    worktreeId: layout.worktreeId,
    ports: { ...portsForSlot(slot), ...carried?.ports },
    pids: {},
  };
  registry.instances[layout.root] = instance;
  saveInstance(layout, registry);
  return instance;
};

const infraEnvFile = (root) => path.join(root, 'infra', 'local', '.env');

/** A variable's line in a `.env`, with the `export` prefix and the spaces around `=` Compose accepts. */
const ENV_LINE = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=(.*)$/;

/** The variables of a worktree's `infra/local/.env`, empty without one. */
const readInfraEnv = (root) => {
  const file = infraEnvFile(root);
  const values = {};
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = ENV_LINE.exec(line);
      if (match) {
        values[match[1]] = match[2].trim();
      }
    }
  }
  return values;
};

/** The XTM One administrator a worktree's stack created, `null` before its first `up`. */
const xtmOneAdmin = (root) => {
  const env = readInfraEnv(root);
  return env.XTM_ONE_ADMIN_EMAIL && env.XTM_ONE_ADMIN_PASSWORD
    ? { email: env.XTM_ONE_ADMIN_EMAIL, password: env.XTM_ONE_ADMIN_PASSWORD }
    : null;
};

/**
 * Set the managed keys, generate the XTM One secrets still missing, leave every other line of the
 * file untouched. Returns the variables the file holds once written.
 */
const writeInfraEnv = (root, instance) => {
  const file = infraEnvFile(root);
  const current = readInfraEnv(root);
  const managed = { INSTANCE_SUFFIX: instance.suffix };
  for (const [name, key] of Object.entries(ENV_KEYS)) {
    managed[key] = String(instance.ports[name]);
  }
  for (const [key, generate] of Object.entries(XTM_ONE_SECRETS)) {
    managed[key] = current[key] || generate();
  }

  const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : [];
  const seen = new Set();
  const kept = lines.map((line) => {
    const match = ENV_LINE.exec(line);
    if (!match || !(match[1] in managed)) {
      return line;
    }
    seen.add(match[1]);
    return `${match[1]}=${managed[match[1]]}`;
  });
  for (const [key, value] of Object.entries(managed)) {
    if (!seen.has(key)) {
      kept.push(`${key}=${value}`);
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${kept.join('\n').replace(/\n+$/, '')}\n`, 'utf8');
  return { ...current, ...managed };
};

/** The flags of a config, without the ones the backend would refuse. */
const knownFlags = (flags) => {
  const list = typeof flags === 'string' ? flags.split(',').map((flag) => flag.trim()).filter(Boolean) : flags ?? [];
  return list.filter((flag) => !UNKNOWN_FLAGS.includes(flag));
};

const backendConfigFile = (root) => path.join(root, 'back', 'config', 'development.local.json');

const readBackendConfig = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});

const saveBackendConfig = (file, config) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
};

/**
 * The worktree's own collector, Pyroscope and scrape port, merged key by key: whether a transport is
 * on stays the developer's choice, and a transport switched off is never dialled.
 */
const withTelemetryDestinations = (telemetry, ports) => {
  const observability = telemetry?.observability ?? {};
  const otlp = observability.otlp ?? {};
  const collector = `http://127.0.0.1:${ports.otelGrpc}`;
  return {
    ...telemetry,
    observability: {
      ...observability,
      otlp: {
        ...otlp,
        ...Object.fromEntries(['traces', 'metrics', 'logs'].map((signal) => [signal, { ...otlp[signal], exporter: collector }])),
      },
      pyroscope: { ...observability.pyroscope, server_address: `http://127.0.0.1:${ports.pyroscope}` },
      prometheus: { ...observability.prometheus, port: ports.metrics },
    },
  };
};

/**
 * Merge the ports, the telemetry destinations and the stack's XTM One in, so an exporter switched on
 * or a storage endpoint added by hand survives. `listenEverywhere` binds the backend beyond loopback,
 * for an engine whose containers reach the host only through its bridge address.
 */
const writeBackendConfig = (root, instance, env, { listenEverywhere = false } = {}) => {
  const file = backendConfigFile(root);
  const config = readBackendConfig(file);
  config.http_server = { ...config.http_server, port: instance.ports.backend, ...listenEverywhere ? { host: '0.0.0.0' } : {} };
  config.dev_server = { ...config.dev_server, port: instance.ports.frontend };
  config.healthcheck_http_server = { ...config.healthcheck_http_server, port: instance.ports.healthcheck };
  config.postgres = { ...config.postgres, port: instance.ports.postgres };
  config.file_storage = { ...config.file_storage, endpoint: `http://localhost:${instance.ports.rustfsApi}` };
  config.telemetry = withTelemetryDestinations(config.telemetry, instance.ports);
  config.xtm_one = {
    ...config.xtm_one,
    url: urls(instance).xtmOne,
    token: env.XTM_ONE_REGISTRATION_TOKEN,
    // The frontend's URL, which proxies `/api` to the backend: the sign-in callback has to set its
    // cookie on the origin the browser uses.
    platform_url: urls(instance).frontend,
  };
  if (config.feature_flags !== undefined) {
    config.feature_flags = knownFlags(config.feature_flags);
  }
  saveBackendConfig(file, config);
  return file;
};

/**
 * The XTM One administrator goes into a `platform_seed` block that exists, the seed being what signs
 * in with it; a config without one keeps none, since the block's absence is what keeps the seed off.
 */
const writeSeedXtmOneAdmin = (root, env) => {
  const file = backendConfigFile(root);
  const config = readBackendConfig(file);
  if (config.platform_seed && typeof config.platform_seed === 'object') {
    config.platform_seed.xtm_one_admin = { email: env.XTM_ONE_ADMIN_EMAIL, password: env.XTM_ONE_ADMIN_PASSWORD };
    saveBackendConfig(file, config);
  }
};

/** Whether this machine's engine is a plain Docker engine on Linux, as `listensBeyondLoopback` reads it. */
const backendListensEverywhere = (runner) => {
  if (process.platform !== 'linux' || runner.command !== 'docker') {
    return false;
  }
  const probe = runSync(['docker', 'version', '--format', DOCKER_SERVER_FORMAT], { encoding: 'utf8' });
  return listensBeyondLoopback(process.platform, runner.command, probe.status === 0 ? probe.stdout : null);
};

/** The first of the three invocations that answers, so Docker and Podman both work unconfigured. */
const composeRunner = () => {
  const candidates = [
    { command: 'docker', args: ['compose'] },
    { command: 'podman', args: ['compose'] },
    { command: 'podman-compose', args: [] },
  ];
  for (const candidate of candidates) {
    const probe = runSync([candidate.command, ...candidate.args, 'version'], { encoding: 'utf8' });
    if (probe.status === 0) {
      return { ...candidate, pullPolicy: xtmOnePullPolicy(probe.stdout ?? '') };
    }
  }
  return null;
};

/**
 * Runs Compose with `profiles` and no other: `COMPOSE_PROFILES`, from the shell or from
 * `infra/local/.env`, would otherwise add its own, the stack's XTM One among them.
 */
const runCompose = (runner, root, args, { profiles = [], ...spawnOptions } = {}) => runSync(
  [runner.command, ...runner.args, ...profileArgs(profiles), ...args],
  {
    cwd: path.join(root, 'infra', 'local'),
    stdio: 'inherit',
    env: { ...process.env, COMPOSE_PROFILES: '', ...runner.pullPolicy ? { XTM_ONE_PULL_POLICY: runner.pullPolicy } : {} },
    ...spawnOptions,
  },
);

const compose = (runner, root, args, options = {}) => runCompose(runner, root, args, options).status === 0;

/** The services `config --services` lists under `profiles`, `null` when Compose cannot read the file. */
const composeServices = (runner, root, profiles) => {
  const result = runCompose(runner, root, ['config', '--services'], { profiles, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  return result.status === 0 ? result.stdout ?? '' : null;
};

/**
 * Stops the stack's own XTM One, which an `up` without its profile would leave running from an
 * earlier `up`, holding the port whatever replaces it should answer on. Never removes a container.
 */
const stopOwnXtmOne = (runner, root, spawnOptions) => {
  const withProfile = composeServices(runner, root, [XTM_ONE_PROFILE]);
  const without = composeServices(runner, root, []);
  if (withProfile === null || without === null) {
    return false;
  }
  const services = servicesOfProfile(withProfile, without);
  return services.length === 0 || compose(runner, root, ['stop', ...services], { profiles: [XTM_ONE_PROFILE], ...spawnOptions });
};

const probePort = (port) => new Promise((resolve) => {
  const socket = net.connect({ port, host: '127.0.0.1' });
  const done = (answered) => {
    socket.destroy();
    resolve(answered);
  };
  socket.setTimeout(400);
  socket.once('connect', () => done(true));
  socket.once('timeout', () => done(false));
  socket.once('error', () => done(false));
});

const alive = (pid) => {
  if (!pid) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const stopProcess = (pid) => {
  if (!alive(pid)) {
    return;
  }
  if (WIN) {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  // Detached children lead their own process group, so the negated pid reaches the whole tree.
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // already gone
    }
  }
};

/**
 * Waits for a process to actually be gone. `stopProcess` only asks on POSIX, and a backend answers
 * SIGTERM with an asynchronous shutdown, so a caller that needs the process gone has to watch for it.
 */
const waitForExit = async (pid, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (alive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => {
      setTimeout(resolve, 200);
    });
  }
  return !alive(pid);
};

const logPath = (layout, instance, workspace) => path.join(layout.stateDir, String(instance.slot), `${workspace}.log`);

const startWorkspace = (layout, instance, workspace, extraEnv) => {
  const logFile = logPath(layout, instance, workspace);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const handle = fs.openSync(logFile, 'a');
  // What is detached is this script again, not the dev server: a detached process on Windows has
  // no console, and the `cmd.exe` that `yarn` needs there loses its standard handles without one,
  // taking every line the server prints with it. A detached Node process keeps the handles it was
  // given, and the server it starts in turn inherits them normally.
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), SERVE, workspace], {
    cwd: layout.root,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', handle, handle],
    detached: true,
    windowsHide: true,
  });
  child.unref();
  return { pid: child.pid, logFile };
};

/**
 * A window that follows the log, never one that hosts the server: closing it stops the tail alone.
 * Only Windows gets one, since `start` is the single terminal a script can count on being there.
 */
const openLogWindow = (layout, instance, workspace) => {
  if (!WIN || !fs.existsSync(logPath(layout, instance, workspace))) {
    return false;
  }
  const script = fileURLToPath(import.meta.url);
  const title = `${workspace} - slot ${instance.slot}`;
  spawnSync(`start "${title}" "${process.execPath}" "${script}" logs ${workspace} --follow`, {
    cwd: layout.root,
    shell: true,
    stdio: 'ignore',
  });
  return true;
};

const ask = async (question, defaultYes) => {
  if (!process.stdin.isTTY) {
    return defaultYes;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`  ${question} ${defaultYes ? '[Y/n]' : '[y/N]'} `);
  rl.close();
  const normalised = answer.trim().toLowerCase();
  if (!normalised) {
    return defaultYes;
  }
  return normalised === 'y' || normalised === 'yes' || normalised === 'o' || normalised === 'oui';
};

/** Where a session leaves screenshots and probe output: outside the working tree, never committed. */
const evidenceDir = (layout, instance) => path.join(layout.stateDir, String(instance.slot), 'evidence');

const urls = (instance) => ({
  frontend: `http://localhost:${instance.ports.frontend}`,
  backend: `http://localhost:${instance.ports.backend}`,
  healthcheck: `http://localhost:${instance.ports.healthcheck}`,
  xtmOne: `http://localhost:${instance.ports.xtmOne}`,
  mailpit: `http://localhost:${instance.ports.mailpit}`,
});

/** What the summary says next to the stack's XTM One URL: its administrator, or that it is not the stack's own. */
const xtmOneNote = ({ xtmOneLocal, xtmOneAdmin: admin }) => {
  if (!xtmOneLocal) {
    return `(not this stack's own: ${XTM_ONE_LOCAL_KEY}=false in infra/local/.env)`;
  }
  return admin ? `(administrator ${admin.email} / ${admin.password})` : '';
};

const commandUp = async (layout, options) => {
  const registry = readRegistry(layout.registryFile);
  const instance = await allocate(layout, registry);
  // A suffix recorded before collisions were avoided, or written by hand, is never renamed.
  const sharing = Object.entries(registry.instances)
    .filter(([root, other]) => root !== layout.root && other.suffix === instance.suffix)
    .map(([root]) => root);
  if (sharing.length > 0) {
    process.stderr.write(`Warning: this worktree shares the instance suffix "${instance.suffix}" with ${sharing.join(', ')}, so their stacks recreate each other's containers. See "What it writes" in docs/development/development.md.\n`);
  }
  const runner = composeRunner();
  if (!runner) {
    fail('No container runtime found. Install Docker or Podman, or start its service.');
  }

  const install = options.install ?? await ask('Install dependencies (yarn install)?', false);
  const reset = options.reset ?? await ask('Reset the database (destroys the volumes)?', false);
  const seed = options.seed ?? (reset ? await ask('Seed platform data on backend start?', false) : false);

  const env = writeInfraEnv(layout.root, instance);
  const ownXtmOne = runsOwnXtmOne(env);
  // Before `up`, so a stack that fails to start still leaves its ports for a `yarn dev` run by hand.
  writeBackendConfig(layout.root, instance, env, { listenEverywhere: backendListensEverywhere(runner) });

  if (install) {
    runSync(['yarn', 'install'], { cwd: layout.root, stdio: 'inherit' });
  }

  // A machine-read run keeps stdout for its JSON, where some Compose runners print their progress.
  const composeOutput = options.json ? { stdio: ['inherit', 2, 'inherit'] } : {};
  if (reset) {
    compose(runner, layout.root, ['down', '-v', '--remove-orphans'], { profiles: ALL_PROFILES, ...composeOutput });
    destroyFormerDatabases(layout, runner, instance);
  } else {
    await upgradePostgres(layout, registry, runner, instance, composeOutput);
  }
  if (!ownXtmOne && !stopOwnXtmOne(runner, layout.root, composeOutput)) {
    fail(`Compose failed to stop this stack's own XTM One, which ${XTM_ONE_LOCAL_KEY}=false in infra/local/.env leaves off.`);
  }
  // An orphan is a service `compose.yml` no longer declares.
  if (!compose(runner, layout.root, ['up', '-d', '--remove-orphans'], { profiles: upProfiles({ monitoring: options.monitoring, ownXtmOne }), ...composeOutput })) {
    fail('Compose failed to start the infrastructure.');
  }

  if (seed) {
    // The seed is a `platform_seed` block written into the same config file, and the script that
    // writes it asks for the credentials it creates. Delegating keeps one implementation.
    if (!process.stdin.isTTY) {
      fail("--seed runs 'yarn workspace @app/back run seed:setup-dev', which asks questions. Run it from a terminal first, then 'up' again.");
    }
    runSync(['yarn', 'workspace', '@app/back', 'run', 'seed:setup-dev'], {
      cwd: layout.root,
      stdio: 'inherit',
    });
  }
  // After the seed setup, which rewrites the `platform_seed` block this adds the XTM One admin to.
  writeSeedXtmOneAdmin(layout.root, env);

  const started = {};
  if (!(await probePort(instance.ports.backend))) {
    started.back = startWorkspace(layout, instance, 'back', {});
  }
  if (!(await probePort(instance.ports.frontend))) {
    // vite opens a browser on start, which a detached process must not do.
    started.front = startWorkspace(layout, instance, 'front', { BROWSER: 'none' });
  }

  instance.pids = { ...instance.pids, ...Object.fromEntries(Object.entries(started).map(([name, s]) => [name, s.pid])) };
  saveInstance(layout, registry);

  fs.mkdirSync(evidenceDir(layout, instance), { recursive: true });

  const windowed = options.console
    ? ['back', 'front'].filter((workspace) => openLogWindow(layout, instance, workspace))
    : [];

  const report = {
    worktree: layout.root,
    branch: instance.branch,
    slot: instance.slot,
    ports: instance.ports,
    ...urls(instance),
    xtmOneLocal: ownXtmOne,
    xtmOneAdmin: ownXtmOne ? xtmOneAdmin(layout.root) : null,
    evidence: evidenceDir(layout, instance),
  };
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(`\n  slot ${instance.slot}${instance.suffix ? ` (${instance.suffix.slice(1)})` : ''}\n`);
  process.stdout.write(`  frontend     ${report.frontend}\n`);
  process.stdout.write(`  backend      ${report.backend}\n`);
  process.stdout.write(`  healthcheck  ${report.healthcheck}\n`);
  const note = xtmOneNote(report);
  process.stdout.write(`  xtm one      ${report.xtmOne}${note ? `  ${note}` : ''}\n`);
  process.stdout.write(`  mailpit      ${report.mailpit}\n`);
  process.stdout.write('  logs         node scripts/devenv.mjs logs back --follow\n');
  if (options.console) {
    process.stdout.write(windowed.length
      ? `  windows      ${windowed.join(', ')}, following the logs. Closing one leaves the server up.\n`
      : '  windows      --console opens none on this platform, use the logs command above.\n');
  }
  process.stdout.write('\n');
};

const commandStatus = async (layout, options) => {
  const registry = readRegistry(layout.registryFile);
  const entries = Object.entries(registry.instances)
    .filter(([root]) => options.all || root === layout.root);

  const rows = [];
  for (const [root, instance] of entries) {
    // The directory of a removed worktree, when something is left in it, answers for the checkout
    // that contains it.
    const checkout = readCheckout(root);
    const ownXtmOne = runsOwnXtmOne(readInfraEnv(root));
    rows.push({
      worktree: root,
      // The stored branch dates from the last `up` or `ports`, and an entry older than the field
      // has none. A worktree out of reach, as every other one is from a dev container, falls back on it.
      branch: checkout?.root === root ? branchLabel(checkout.branch) : instance.branch ?? 'unknown',
      slot: instance.slot,
      current: root === layout.root,
      ports: instance.ports,
      running: {
        postgres: await probePort(instance.ports.postgres),
        xtmOne: instance.ports.xtmOne !== undefined && await probePort(instance.ports.xtmOne),
        backend: await probePort(instance.ports.backend),
        frontend: await probePort(instance.ports.frontend),
      },
      // An entry from before XTM One joined the stack has no port for it until its next `up`.
      ...urls({ ...instance, ports: { ...portsForSlot(instance.slot), ...instance.ports } }),
      xtmOneLocal: ownXtmOne,
      xtmOneAdmin: ownXtmOne ? xtmOneAdmin(root) : null,
      evidence: evidenceDir(layout, instance),
    });
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
    return;
  }
  if (!rows.length) {
    process.stdout.write('  No environment allocated yet. Run: node scripts/devenv.mjs up\n');
    return;
  }
  process.stdout.write('\n');
  for (const row of rows) {
    const state = [
      row.running.postgres ? 'db' : null,
      row.running.xtmOne ? 'xtm' : null,
      row.running.backend ? 'back' : null,
      row.running.frontend ? 'front' : null,
    ].filter(Boolean).join(' ') || 'stopped';
    process.stdout.write(`  ${row.current ? '*' : ' '} slot ${String(row.slot).padEnd(3)} ${row.branch.padEnd(34)} ${state.padEnd(20)} ${row.frontend}\n`);
    if (row.current) {
      const note = xtmOneNote(row);
      process.stdout.write(`${' '.repeat(45)}xtm one  ${row.xtmOne}${note ? `  ${note}` : ''}\n`);
      process.stdout.write(`${' '.repeat(45)}mailpit  ${row.mailpit}\n`);
    }
  }
  process.stdout.write('\n');
};

const commandDown = (layout, options) => {
  const registry = readRegistry(layout.registryFile);
  const instance = registry.instances[layout.root];
  if (!instance) {
    fail('No environment allocated for this worktree.');
  }

  for (const [name, pid] of Object.entries(instance.pids ?? {})) {
    stopProcess(pid);
    delete instance.pids[name];
  }
  saveInstance(layout, registry);

  const runner = composeRunner();
  if (runner) {
    compose(runner, layout.root, options.volumes ? ['down', '-v', '--remove-orphans'] : ['down', '--remove-orphans'], { profiles: ALL_PROFILES });
    if (options.volumes) {
      destroyFormerDatabases(layout, runner, instance);
    }
  }
  process.stdout.write(`  Stopped slot ${instance.slot}${options.volumes ? ', volumes destroyed' : ''}.\n`);
};

const commandLogs = (layout, target, options) => {
  const registry = readRegistry(layout.registryFile);
  const instance = registry.instances[layout.root];
  if (!instance) {
    fail('No environment allocated for this worktree.');
  }
  const file = logPath(layout, instance, target);
  if (!fs.existsSync(file)) {
    fail(`No log yet for '${target}'. Start it with: node scripts/devenv.mjs up`);
  }

  if (!options.follow) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    process.stdout.write(`${lines.slice(-options.lines).join('\n')}\n`);
    return;
  }
  let offset = fs.statSync(file).size;
  process.stdout.write(fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(-options.lines).join('\n'));
  fs.watchFile(file, { interval: 300 }, (current) => {
    if (current.size <= offset) {
      return;
    }
    const stream = fs.createReadStream(file, { start: offset, end: current.size });
    stream.pipe(process.stdout, { end: false });
    offset = current.size;
  });
};

const commandPorts = async (layout, options) => {
  const registry = readRegistry(layout.registryFile);
  const instance = await allocate(layout, registry);
  if (options.json) {
    process.stdout.write(`${JSON.stringify({ slot: instance.slot, ports: instance.ports, ...urls(instance) }, null, 2)}\n`);
    return;
  }
  for (const [name, port] of Object.entries(instance.ports)) {
    if (MONITORING.has(name)) {
      continue;
    }
    process.stdout.write(`  ${name.padEnd(16)} ${port}\n`);
  }
};

/** Read from the file the container itself is given, so the two can never drift apart. */
const postgresCredentials = (root) => {
  const file = path.join(root, 'infra', 'local', 'config', 'postgres', 'config.env');
  const env = {};
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match) {
        env[match[1]] = match[2].trim();
      }
    }
  }
  return { user: env.POSTGRES_USER ?? 'app', database: env.POSTGRES_DB ?? 'app' };
};

const SNAPSHOT_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

const SHUTDOWN_GRACE_MS = 30_000;

/** Options whose next argument belongs to them, and is therefore never a positional. */
const FLAGS_TAKING_A_VALUE = new Set(['--dir', '--lines']);

/**
 * A custom-format archive opens with `PGDMP`. `pg_dump` and `pg_restore` run inside a container
 * through one of three compose implementations, and an exit code that crossed that wrapper is not
 * reliably the tool's own, so the bytes are what says a dump is a dump.
 */
const isPgDumpArchive = (file) => {
  let handle;
  try {
    handle = fs.openSync(file, 'r');
    const head = Buffer.alloc(5);
    return fs.readSync(handle, head, 0, 5, 0) === 5 && head.toString('latin1') === 'PGDMP';
  } catch {
    return false;
  } finally {
    if (handle !== undefined) {
      fs.closeSync(handle);
    }
  }
};

/** Never defaulted: an archive of a full ingestion is large and holds real third-party data. */
const snapshotDir = (options) => {
  const given = options.dir ?? process.env.DEVENV_SNAPSHOTS;
  if (!given || given.startsWith('--')) {
    fail('Give the snapshot directory: --dir <path>, or set DEVENV_SNAPSHOTS once for the shell.');
  }
  return path.resolve(given);
};

const humanSize = (bytes) => (bytes >= 1024 * 1024
  ? `${(bytes / 1024 / 1024).toFixed(0)} MB`
  : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** What every database command needs, or a stop naming the command that would provide it. */
const databaseTarget = async (layout) => {
  const instance = readRegistry(layout.registryFile).instances[layout.root];
  if (!instance) {
    fail('No environment allocated for this worktree. Run: node scripts/devenv.mjs up');
  }
  if (!(await probePort(instance.ports.postgres))) {
    fail(`Postgres is not answering on port ${instance.ports.postgres}. Run: node scripts/devenv.mjs up`);
  }
  const runner = composeRunner();
  if (!runner) {
    fail('No container runtime found. Install Docker or Podman, or start its service.');
  }
  return { instance, runner, ...postgresCredentials(layout.root) };
};

/** Statements go in on stdin: `-c` would have to survive the shell this script needs on Windows. */
const psql = (layout, target, database, statements) => compose(
  target.runner,
  layout.root,
  ['exec', '-T', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-q', '-U', target.user, '-d', database],
  { input: statements, stdio: ['pipe', 'ignore', 'inherit'] },
);

/**
 * OpenCTI silently reopens at the live edge when the restored cursor has fallen out of its stream
 * retention window, so a dump older than that window ingests a gap it never reports.
 * `stream_generation` is bumped rather than zeroed: it is what tells a consumer still running that
 * its position was thrown away.
 *
 * This runs against the schema the dump carries, before the backend's next boot migrates it forward,
 * so every table and column is checked rather than assumed: a snapshot taken between the migration
 * that created the connector table and the one that added its read counters has the first and not
 * the second. A position that does not exist has nothing to throw away.
 */
const RESET_CURSORS = `
DO $$
BEGIN
  IF to_regclass('integration_settings') IS NOT NULL THEN
    -- Built as text: a dump taken before the column was renamed still carries last_synced_at.
    EXECUTE format('UPDATE integration_settings SET %I = NULL', (
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'integration_settings' AND column_name IN ('last_reported_at', 'last_synced_at')
    ));
  END IF;

  IF to_regclass('opencti_connector_settings') IS NULL THEN
    RETURN;
  END IF;

  UPDATE opencti_connector_settings SET
    "cursor" = NULL, last_event_at = NULL, history_start_at = NULL,
    backfill_target_at = NULL, reached_live_tail_at = NULL;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'opencti_connector_settings' AND column_name = 'stream_generation'
  ) THEN
    -- Built as text so an older schema never has to parse column names it does not carry.
    EXECUTE 'UPDATE opencti_connector_settings SET objects_read = 0, objects_read_at = NULL,'
      || ' stream_generation = stream_generation + 1';
  END IF;
END $$;
`;

const commandSnapshot = async (layout, name, options) => {
  const dir = snapshotDir(options);
  const target = await databaseTarget(layout);
  const file = path.join(dir, `${name}.dump`);
  if (fs.existsSync(file) && !options.force) {
    fail(`Snapshot '${name}' already exists in ${dir}. Pass --force to replace it, or give another name.`);
  }
  fs.mkdirSync(dir, { recursive: true });

  const partial = `${file}.partial`;
  // `'w'` truncates an existing file without touching its mode, so a partial left behind by a killed
  // run would keep whatever it was created with. The archive carries tenants, users and third-party
  // data, and the rename below hands the final file this mode.
  const handle = fs.openSync(partial, 'w', 0o600);
  fs.fchmodSync(handle, 0o600);
  const dumped = compose(
    target.runner,
    layout.root,
    ['exec', '-T', 'postgres', 'pg_dump', '-U', target.user, '-d', target.database, '-Fc'],
    { stdio: ['ignore', handle, 'inherit'] },
  );
  fs.closeSync(handle);
  // Named only once the bytes are a readable archive, so neither an interrupted run nor a wrapper
  // that reported someone else's exit code can leave something a later restore would trust.
  if (!dumped || !isPgDumpArchive(partial)) {
    fs.rmSync(partial, { force: true });
    fail(dumped ? 'pg_dump produced no readable archive.' : 'pg_dump failed.');
  }
  fs.renameSync(partial, file);

  const size = humanSize(fs.statSync(file).size);
  process.stdout.write(`  Snapshot '${name}' taken from slot ${target.instance.slot}, ${size}.\n  ${file}\n`);
};

/**
 * Stops this worktree's backend and frontend and waits for them to be gone: dropping a database only
 * breaks the connections open at that instant, and a server still shutting down reconnects its pool
 * into whatever replaces it.
 */
const stopServers = async (layout, registry) => {
  const instance = registry.instances[layout.root];
  const stopping = [];
  for (const [workspace, pid] of Object.entries(instance.pids ?? {})) {
    stopProcess(pid);
    stopping.push(pid);
    delete instance.pids[workspace];
  }
  for (const pid of stopping) {
    if (!(await waitForExit(pid, SHUTDOWN_GRACE_MS))) {
      // The registry is deliberately still unwritten: a pid that outlived its stop is one this
      // worktree must keep tracking.
      fail(`Process ${pid} is still running ${SHUTDOWN_GRACE_MS / 1000}s after being asked to stop. Stop it, then run the command again.`);
    }
  }
  saveInstance(layout, registry);
};

const targetPostgresMajor = (root) => {
  const file = path.join(root, 'infra', 'local', 'compose.yml');
  const major = fs.existsSync(file) ? pinnedPostgresMajor(fs.readFileSync(file, 'utf8')) : null;
  if (!major) {
    fail(`${file} has no \`x-postgres-image\` anchor naming a tag that ends in -pg<major>.`);
  }
  return major;
};

/** XTM One's database had a server and a volume of its own before it moved into the stack's server. */
const XTM_ONE_FORMER_VOLUME = 'xtm_one_db_data';

const volumeName = (instance, volume) => `${projectOf(instance.suffix)}_${volume}`;

const volumeExists = (runner, name) => runSync([volumeCli(runner), 'volume', 'inspect', name], { stdio: 'ignore' }).status === 0;

/** Every database volume of the stack and XTM One's former one, without the project prefix. */
const stackDatabaseVolumes = (runner, instance) => {
  const listed = runSync([volumeCli(runner), 'volume', 'ls', '--format', '{{.Name}}'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  if (listed.status !== 0) {
    fail('Could not list the volumes. Nothing was changed.');
  }
  const names = listed.stdout.split(/\r?\n/).filter(Boolean);
  const project = projectOf(instance.suffix);
  const formerXtmOne = names.includes(`${project}_${XTM_ONE_FORMER_VOLUME}`) ? [XTM_ONE_FORMER_VOLUME] : [];
  return [...databaseVolumes(project, names), ...formerXtmOne];
};

/** Where a move in progress keeps its dumps, so a move that failed half way resumes rather than restarts. */
const upgradeDir = (layout, instance) => path.join(layout.stateDir, String(instance.slot), 'postgres-upgrade');

/**
 * Called where the caller asked for the volumes to be destroyed, after `down -v` removed the one
 * `compose.yml` mounts: a former one left would be moved back in.
 */
const destroyFormerDatabases = (layout, runner, instance) => {
  fs.rmSync(upgradeDir(layout, instance), { recursive: true, force: true });
  const former = stackDatabaseVolumes(runner, instance).map((volume) => volumeName(instance, volume));
  if (former.length) {
    runSync([volumeCli(runner), 'volume', 'rm', ...former], { stdio: ['ignore', 'ignore', 'inherit'] });
  }
};

const UPGRADE_WAIT_MS = 120_000;

const waitUntil = async (probe) => {
  const deadline = Date.now() + UPGRADE_WAIT_MS;
  while (Date.now() < deadline) {
    if (probe()) {
      return true;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 500);
    });
  }
  return false;
};

/**
 * The database cluster a volume holds: its directory inside the volume and the major version that
 * created it, `null` for a volume holding none. From PostgreSQL 18 on it is under `<major>/docker`.
 * A volume that could not be read stops the command: taken for empty, it would be left behind for good,
 * since the volume `up` then creates is what says no move is due.
 */
const clusterIn = (runner, volume) => {
  const cli = volumeCli(runner);
  const found = runSync([cli, 'run', '--rm', '-v', `${volume}:/volume`, 'busybox:1.38.0',
    'find', '/volume', '-maxdepth', '3', '-name', 'PG_VERSION'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  if (found.status !== 0) {
    fail(`Could not look inside ${volume} for the database it holds. Nothing was changed.`);
  }
  const file = (found.stdout ?? '').split(/\r?\n/).find((line) => /^\/volume(\/\d+\/docker)?\/PG_VERSION$/.test(line));
  if (!file) {
    return null;
  }
  const read = runSync([cli, 'run', '--rm', '-v', `${volume}:/volume`, 'busybox:1.38.0', 'cat', file],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  const major = (read.stdout ?? '').trim();
  if (read.status !== 0 || !/^\d+$/.test(major)) {
    fail(`Could not read the PostgreSQL version of the database in ${volume}. Nothing was changed.`);
  }
  return { subdir: path.posix.dirname(file).slice('/volume'.length), major: Number(major) };
};

/**
 * Dumps the roles and every database of a former volume's cluster into `dir`, from a server of the
 * version that created it, run on that volume alone: nothing else can write to it meanwhile, and it
 * is left as found.
 */
const dumpFormerCluster = async (layout, runner, instance, source, dir) => {
  const cli = volumeCli(runner);
  const { user } = postgresCredentials(layout.root);
  const server = `${projectOf(instance.suffix)}-postgres-upgrade`;
  runSync([cli, 'rm', '-f', server], { stdio: 'ignore' });
  // Mounted away from the image's own data path, which the 18 image refuses to find a foreign mount on.
  const started = runSync([cli, 'run', '-d', '--rm', '--name', server,
    '-v', `${volumeName(instance, source.volume)}:/source`, '-e', `PGDATA=/source${source.subdir}`,
    dumpImage(source.volume, source.major)], { stdio: ['ignore', 'ignore', 'inherit'] });
  if (started.status !== 0) {
    fail(`Could not start PostgreSQL ${source.major} on ${source.volume}. Nothing was changed.`);
  }
  let failure;
  try {
    failure = await dumpDatabases(cli, server, user, source, dir);
  } finally {
    // Before any `fail()`, which exits: a server left running holds the volume `env:down --volumes` removes.
    runSync([cli, 'stop', server], { stdio: 'ignore' });
  }
  if (failure) {
    fail(failure);
  }
};

/** The dumps of `dumpFormerCluster`, from its running server; returns why it failed, `undefined` once all are written. */
const dumpDatabases = async (cli, server, user, source, dir) => {
  const nothingChanged = 'Nothing was changed.';
  if (!(await waitUntil(() => runSync([cli, 'exec', server, 'pg_isready', '-U', user], { stdio: 'ignore' }).status === 0))) {
    runSync([cli, 'logs', '--tail', '20', server], { stdio: ['ignore', 'inherit', 'inherit'] });
    return `PostgreSQL ${source.major} did not start on ${source.volume}. ${nothingChanged}`;
  }
  const listed = runSync([cli, 'exec', '-i', server, 'psql', '-U', user, '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], {
    encoding: 'utf8',
    input: "SELECT datname || '|' || pg_get_userbyid(datdba) FROM pg_database WHERE NOT datistemplate ORDER BY 1;",
  });
  if (listed.status !== 0) {
    return `Could not list the databases of ${source.volume}. ${nothingChanged}`;
  }
  const databases = listed.stdout.split(/\r?\n/).filter(Boolean)
    .map((line) => {
      const [name, owner] = line.split('|');
      return { name, owner };
    })
    .filter(({ name }) => isMovedDatabase(name));
  // A name goes through a shell on Windows and becomes a file name: anything else stays behind.
  const movable = databases.filter(({ name }) => SNAPSHOT_NAME.test(name));
  for (const { name } of databases.filter((database) => !movable.includes(database))) {
    process.stderr.write(`  Database '${name}' stays in ${source.volume}: its name cannot be moved safely.\n`);
  }
  fs.mkdirSync(dir, { recursive: true });
  const dumpTo = (file, args) => {
    const handle = fs.openSync(file, 'w', 0o600);
    const dumped = runSync([cli, 'exec', server, ...args], { stdio: ['ignore', handle, 'inherit'] });
    fs.closeSync(handle);
    return dumped.status === 0;
  };
  if (!dumpTo(path.join(dir, 'roles.sql'), ['pg_dumpall', '-U', user, '--globals-only'])) {
    fs.rmSync(dir, { recursive: true, force: true });
    return `Could not dump the roles of ${source.volume}. ${nothingChanged}`;
  }
  for (const { name } of movable) {
    const file = path.join(dir, `${name}.dump`);
    if (!dumpTo(file, ['pg_dump', '-U', user, '-d', name, '-Fc']) || !isPgDumpArchive(file)) {
      fs.rmSync(dir, { recursive: true, force: true });
      return `Could not dump database '${name}' of ${source.volume}. ${nothingChanged}`;
    }
  }
  // Written last: its presence is what says every dump is complete.
  const manifest = { volume: source.volume, major: source.major, databases: movable };
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest)}\n`, 'utf8');
  return undefined;
};

/** What `psql` prints for `query` on the stack's server, `null` when it fails. */
const queryStackServer = (layout, target, query) => {
  const result = runSync([target.runner.command, ...target.runner.args,
    'exec', '-T', 'postgres', 'psql', '-U', target.user, '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], {
    cwd: path.join(layout.root, 'infra', 'local'),
    encoding: 'utf8',
    input: query,
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  return result.status === 0 ? result.stdout : null;
};

const quoteIdentifier = (name) => `"${name.replaceAll('"', '""')}"`;

/**
 * Moves the databases of a stack whose server ran another major version into the volume of the one
 * `compose.yml` pins, from the newest older major the stack's volumes hold. A data directory only
 * opens on the major that created it, and the dump and restore also rebuild every text index under
 * the new image's collation. Roles, owners and privileges come along, so XTM One's database moves
 * with OpenCRQ's. The former volume is left as it was.
 */
const upgradePostgres = async (layout, registry, runner, instance, composeOutput) => {
  const major = targetPostgresMajor(layout.root);
  const dir = upgradeDir(layout, instance);
  const manifestFile = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestFile)) {
    if (volumeExists(runner, volumeName(instance, postgresVolume(major)))) {
      return;
    }
    const clusters = stackDatabaseVolumes(runner, instance)
      .filter((volume) => volume !== XTM_ONE_FORMER_VOLUME)
      .map((volume) => ({ volume, ...clusterIn(runner, volumeName(instance, volume)) }))
      .filter((cluster) => cluster.major);
    const source = moveSource(clusters, major);
    if (!source) {
      return;
    }
    process.stderr.write(`  Moving the databases of ${volumeName(instance, source.volume)} (PostgreSQL ${source.major}) to PostgreSQL ${major}.\n`);
    await stopServers(layout, registry);
    if (!compose(runner, layout.root, ['stop', 'postgres'], composeOutput)) {
      fail('Could not stop the stack\'s PostgreSQL. Nothing was changed.');
    }
    await dumpFormerCluster(layout, runner, instance, source, dir);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  await stopServers(layout, registry);
  const kept = `The dumps are kept in ${dir} and the next \`yarn env:up\` restores them all again; ${manifest.volume} is left as it was. `
    + `\`yarn env:up --reset\` gives up the move: it starts on an empty database and removes the dumps and ${manifest.volume}. `
    + `Removing the dumps alone would leave PostgreSQL ${major} half filled, and taken for moved.`;
  if (!compose(runner, layout.root, ['up', '-d', '--remove-orphans', 'postgres'], composeOutput)) {
    fail(`Compose failed to start PostgreSQL ${major}. ${kept}`);
  }
  const target = { runner, ...postgresCredentials(layout.root) };
  const ready = await waitUntil(() => compose(runner, layout.root,
    ['exec', '-T', 'postgres', 'pg_isready', '-h', 'localhost', '-U', target.user], { stdio: 'ignore' }));
  if (!ready) {
    fail(`PostgreSQL ${major} did not become ready. ${kept}`);
  }
  const roles = queryStackServer(layout, target, 'SELECT rolname FROM pg_roles;');
  if (roles === null || !psql(layout, target, 'postgres',
    rolesToCreate(fs.readFileSync(path.join(dir, 'roles.sql'), 'utf8'), target.user, roles.split(/\r?\n/)))) {
    fail(`Could not create the roles of ${manifest.volume}. ${kept}`);
  }
  for (const { name, owner } of manifest.databases) {
    const database = quoteIdentifier(name);
    if (!psql(layout, target, 'postgres', `DROP DATABASE IF EXISTS ${database} WITH (FORCE);\nCREATE DATABASE ${database} OWNER ${quoteIdentifier(owner)};`)) {
      fail(`Could not create database '${name}'. ${kept}`);
    }
    const handle = fs.openSync(path.join(dir, `${name}.dump`), 'r');
    const restored = compose(runner, layout.root,
      ['exec', '-T', 'postgres', 'pg_restore', '-U', target.user, '-d', name, '--single-transaction'],
      { stdio: [handle, 'ignore', 'inherit'] });
    fs.closeSync(handle);
    if (!restored) {
      fail(`pg_restore failed on database '${name}'. ${kept}`);
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });

  const moved = manifest.databases.map((database) => database.name);
  process.stderr.write(`  Moved ${moved.length ? moved.join(', ') : 'no database'} to PostgreSQL ${major}.\n`);
  if (!moved.includes('xtm_one')) {
    process.stderr.write('  XTM One starts on an empty database.\n');
  }
  const former = stackDatabaseVolumes(runner, instance)
    .filter((volume) => volume !== postgresVolume(major))
    .map((volume) => volumeName(instance, volume));
  if (former.length) {
    process.stderr.write(`  The former volumes are kept: \`${volumeCli(runner)} volume rm ${former.join(' ')}\` reclaims them.\n`);
  }
};

const commandRestore = async (layout, name, options) => {
  const dir = snapshotDir(options);
  const target = await databaseTarget(layout);
  const file = path.join(dir, `${name}.dump`);
  if (!fs.existsSync(file)) {
    fail(`No snapshot named '${name}' in ${dir}. List them with: node scripts/devenv.mjs snapshots --dir ${dir}`);
  }
  // Read before the database is dropped: past that point a refusal here would have destroyed the
  // data the caller was replacing and put nothing in its place.
  if (!isPgDumpArchive(file)) {
    fail(`'${file}' is not a readable pg_dump archive. Nothing was changed.`);
  }
  const confirmed = options.force
    || await ask(`Replace the database of slot ${target.instance.slot} with snapshot '${name}'?`, false);
  if (!confirmed) {
    process.stdout.write('  Nothing restored.\n');
    return;
  }

  // A backend still writing would land its rows in a database being replaced underneath it.
  await stopServers(layout, readRegistry(layout.registryFile));

  // `WITH (FORCE)` ends whatever sessions a server left behind, which the drop would otherwise wait on.
  const recreated = psql(layout, target, 'postgres', [
    `DROP DATABASE IF EXISTS ${target.database} WITH (FORCE);`,
    `CREATE DATABASE ${target.database};`,
  ].join('\n'));
  if (!recreated) {
    fail('Could not recreate the database.');
  }

  const handle = fs.openSync(file, 'r');
  const restored = compose(
    target.runner,
    layout.root,
    // `--single-transaction` against the empty database just created: an interrupted restore leaves
    // it empty rather than half filled, which would look like a working platform missing rows.
    ['exec', '-T', 'postgres', 'pg_restore', '-U', target.user, '-d', target.database,
      '--no-owner', '--no-privileges', '--single-transaction'],
    { stdio: [handle, 'ignore', 'inherit'] },
  );
  fs.closeSync(handle);
  if (!restored) {
    fail('pg_restore failed.');
  }

  if (options.resetCursors && !psql(layout, target, target.database, RESET_CURSORS)) {
    fail('Restored, but the connector positions could not be reset.');
  }

  const reset = options.resetCursors ? ', connector positions reset' : '';
  process.stdout.write(`  Restored '${name}' into slot ${target.instance.slot}${reset}.\n`);
  process.stdout.write('  Start the servers with: node scripts/devenv.mjs up\n');
};

const commandSnapshots = (options) => {
  const dir = snapshotDir(options);
  const names = (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
    .filter((entry) => entry.endsWith('.dump'))
    .sort();
  if (!names.length) {
    process.stdout.write(`  No snapshot in ${dir}.\n`);
    return;
  }
  process.stdout.write('\n');
  for (const entry of names) {
    const stat = fs.statSync(path.join(dir, entry));
    const taken = stat.mtime.toISOString().slice(0, 16).replace('T', ' ');
    process.stdout.write(`  ${entry.replace(/\.dump$/, '').padEnd(24)} ${humanSize(stat.size).padStart(9)}  ${taken}\n`);
  }
  process.stdout.write(`\n  ${dir}\n\n`);
};

const USAGE = `Usage: node scripts/devenv.mjs <command> [options]

  up        [--install] [--reset] [--seed] [--monitoring] [--console] [--json]
  status    [--all] [--json]
  down      [--volumes]
  logs      [back|front] [--follow] [--lines <n>]
  ports     [--json]
  snapshot  [name] --dir <path> [--force]
  restore   [name] --dir <path> [--reset-cursors] [--force]
  snapshots --dir <path>

Without a flag, 'up' asks about install, reset and seed when run from a terminal,
and skips all three otherwise. 'snapshot' and 'restore' default to the name
'default', and 'restore' asks before replacing a database unless given --force.
The snapshot directory is never guessed: give it with --dir, or set DEVENV_SNAPSHOTS
once for the shell.
`;

const main = async () => {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const has = (flag) => argv.includes(flag);
  const options = {
    all: has('--all'),
    json: has('--json'),
    follow: has('--follow'),
    monitoring: has('--monitoring'),
    console: has('--console'),
    volumes: has('--volumes'),
    force: has('--force'),
    resetCursors: has('--reset-cursors'),
    dir: has('--dir') ? argv[argv.indexOf('--dir') + 1] : undefined,
    lines: Number(argv[argv.indexOf('--lines') + 1]) || 80,
    install: has('--install') ? true : undefined,
    reset: has('--reset') ? true : undefined,
    seed: has('--seed') ? true : undefined,
  };
  // A machine-read run must never block on a question it cannot answer.
  if (options.json) {
    options.install ??= false;
    options.reset ??= false;
    options.seed ??= false;
  }

  if (!command || has('--help') || has('-h')) {
    process.stdout.write(USAGE);
    return;
  }
  if (command === SERVE) {
    // Piped, never inherited: libuv asks for CREATE_NO_WINDOW only when no descriptor is inherited,
    // and this detached process has no console to lend the shell `yarn` needs, so inheriting here
    // opens a console window of its own, one that takes the dev server down when closed.
    const parts = ['yarn', 'workspace', `@app/${argv[1]}`, 'run', 'dev'];
    const child = WIN
      ? spawn(parts.join(' '), { shell: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      : spawn(parts[0], parts.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
    child.on('close', (code) => process.exit(code ?? 1));
    return;
  }

  const layout = resolveLayout();
  // Scanned rather than read at `argv[1]`, so an option typed before the name does not silently
  // leave `restore --force` pointed at 'default' instead of the snapshot that was asked for.
  const positionalArgs = [];
  for (let i = 1; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) {
      positionalArgs.push(argv[i]);
    } else if (FLAGS_TAKING_A_VALUE.has(argv[i])) {
      i += 1;
    }
  }
  const positional = positionalArgs[0] ?? null;
  const snapshotName = positional ?? 'default';
  if (positional && !SNAPSHOT_NAME.test(snapshotName)) {
    fail(`'${snapshotName}' is not a usable snapshot name: letters, digits, dot, dash and underscore only.`);
  }

  switch (command) {
    case 'up': return commandUp(layout, options);
    case 'status': return commandStatus(layout, options);
    case 'down': return commandDown(layout, options);
    case 'logs': return commandLogs(layout, positional ?? 'back', options);
    case 'ports': return commandPorts(layout, options);
    case 'snapshot': return commandSnapshot(layout, snapshotName, options);
    case 'restore': return commandRestore(layout, snapshotName, options);
    case 'snapshots': return commandSnapshots(options);
    default: return fail(`Unknown command '${command}'.\n\n${USAGE}`);
  }
};

await main();

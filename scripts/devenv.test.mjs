/**
 * The registry writes of `devenv.mjs`, run against a throwaway clone with three worktrees and a fake
 * `docker` on the PATH whose `volume ls` takes long enough for two commands to overlap.
 * Run with `yarn test:scripts`.
 */

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { listensBeyondLoopback, xtmOnePullPolicy } from './devenv-container-engine.mjs';
import { ALL_PROFILES, dotEnvValue, profileArgs, runsOwnXtmOne, servicesOfProfile, upProfiles } from './devenv-profiles.mjs';
import { pinnedPostgresMajor, postgresMountPath, postgresVolume, rolesToCreate } from './devenv-postgres.mjs';

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(SCRIPTS, 'devenv.mjs');
const REPO = path.dirname(SCRIPTS);

const git = (cwd, ...args) => {
  const result = spawnSync('git', ['-C', cwd, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
};

const run = (cwd, env, ...args) => new Promise((resolve) => {
  const child = spawn(process.execPath, [SCRIPT, ...args], { cwd, env });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.on('close', (code) => resolve({ code, stdout, stderr }));
});

describe('devenv registry', { skip: process.platform === 'win32' && 'the fake docker is a shell script' }, () => {
  let base;
  let main;
  let registryFile;
  let env;
  const worktrees = [];

  before(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'devenv-test-')));
    main = path.join(base, 'main');
    fs.mkdirSync(main);
    git(main, 'init', '--quiet');
    git(main, 'commit', '--quiet', '--allow-empty', '-m', 'init');
    for (const name of ['a', 'b', 'c']) {
      const root = path.join(base, name);
      git(main, 'worktree', 'add', '--quiet', '-b', `wt-${name}`, root);
      fs.mkdirSync(path.join(root, 'infra', 'local'), { recursive: true });
      fs.writeFileSync(path.join(root, 'infra', 'local', 'compose.yml'), 'x-postgres-image: &postgres-image pgvector/pgvector:0.8.7-pg17\n');
      worktrees.push(root);
    }
    registryFile = path.join(main, '.git', 'devenv.json');
    const bin = path.join(base, 'bin');
    fs.mkdirSync(bin);
    // Answers the compose probe, lists no volume after a delay long enough for a second command to
    // read the registry before the first one writes it, and fails to start any stack.
    fs.writeFileSync(path.join(bin, 'docker'), '#!/bin/sh\nif [ "$1" = "volume" ]; then sleep 3; fi\ncase " $* " in " compose "*" up "*) exit 1 ;; esac\nexit 0\n', { mode: 0o755 });
    env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  });

  after(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('keeps both entries, on distinct slots, when two worktrees allocate at once', async () => {
    const [first, second] = worktrees;
    // The second starts while the first is in its volume probe and ends its own after the first
    // wrote: a slot chosen from the registry read before the probe is the first one's.
    const firstRun = run(first, env, 'ports', '--json');
    await new Promise((resolve) => {
      setTimeout(resolve, 1000);
    });
    const results = await Promise.all([firstRun, run(second, env, 'ports', '--json')]);
    for (const result of results) {
      assert.equal(result.code, 0, result.stderr);
    }
    const { instances } = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
    assert.ok(instances[first], 'the first worktree keeps its entry');
    assert.ok(instances[second], 'the second worktree keeps its entry');
    assert.notEqual(instances[first].slot, instances[second].slot);
    assert.deepEqual(results.map((result) => JSON.parse(result.stdout).slot).sort(), [instances[first].slot, instances[second].slot].sort());
  });

  it('gives each worktree its own XTM One and Mailpit ports, shared with nothing of the other', () => {
    const [first, second] = worktrees;
    const { instances } = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
    const firstPorts = Object.values(instances[first].ports);
    for (const name of ['xtmOne', 'mailpit']) {
      assert.equal(typeof instances[first].ports[name], 'number', `${name} is allocated`);
      assert.notEqual(instances[first].ports[name], instances[second].ports[name]);
    }
    assert.deepEqual(Object.values(instances[second].ports).filter((port) => firstPorts.includes(port)), []);
  });

  it('adds the XTM One ports to an entry written before them, moving none it already had', async () => {
    const root = worktrees[2];
    const registry = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
    // Hand-written ports, adopted from a config: they are kept as they are, not recomputed.
    const ports = { postgres: 5999, rustfsApi: 9999, rustfsConsole: 9998, backend: 3999, healthcheck: 8999, frontend: 3998 };
    registry.instances[root] = { slot: 7, branch: 'wt-c', suffix: '-wt-c', ports, pids: {} };
    fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2));

    const result = await run(root, env, 'ports', '--json');
    assert.equal(result.code, 0, result.stderr);
    const answer = JSON.parse(result.stdout);
    assert.equal(answer.slot, 7);
    for (const [name, port] of Object.entries(ports)) {
      assert.equal(answer.ports[name], port, `${name} stays where it was`);
    }
    assert.equal(answer.ports.xtmOne, 4705);
    assert.equal(answer.ports.mailpit, 8725);
    assert.equal(answer.xtmOne, 'http://localhost:4705');
    assert.deepEqual(JSON.parse(fs.readFileSync(registryFile, 'utf8')).instances[root].ports, answer.ports);
  });

  it('leaves the ports and the XTM One block in the backend config when the stack fails to start', async () => {
    const root = worktrees[2];
    const result = await run(root, env, 'up', '--json');
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Compose failed to start the infrastructure/);

    const config = JSON.parse(fs.readFileSync(path.join(root, 'back', 'config', 'development.local.json'), 'utf8'));
    assert.equal(config.http_server.port, 3999);
    assert.equal(config.postgres.port, 5999);
    assert.equal(config.xtm_one.url, 'http://localhost:4705');
    // This fake engine names no server, so it is not one known to need it.
    assert.equal(config.http_server.host, undefined);
  });

  it('points the backend\'s telemetry at its slot\'s stack, at the slot 0 values of development.json shifted by the slot', () => {
    const root = worktrees[2];
    const shift = 7 * 100;
    const written = JSON.parse(fs.readFileSync(path.join(root, 'back', 'config', 'development.local.json'), 'utf8')).telemetry.observability;
    const shipped = JSON.parse(fs.readFileSync(path.join(REPO, 'back', 'config', 'development.json'), 'utf8')).telemetry.observability;
    const shifted = (url) => url.replace(/:(\d+)$/, (_, port) => `:${Number(port) + shift}`);
    for (const signal of ['traces', 'metrics', 'logs']) {
      assert.equal(written.otlp[signal].exporter, shifted(shipped.otlp[signal].exporter), `${signal} exporter`);
      assert.equal(written.otlp[signal].enabled, undefined, 'the switch is left to development.json');
    }
    assert.equal(written.pyroscope.server_address, shifted(shipped.pyroscope.server_address));
    // development.json names no scrape port: slot 0 is the schema's default.
    assert.equal(shipped.prometheus.port, undefined);
    assert.equal(written.prometheus.port, 14269 + shift);
  });

  it('keeps every telemetry setting written by hand but the destinations on the next up', async () => {
    const root = worktrees[2];
    const file = path.join(root, 'back', 'config', 'development.local.json');
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    config.telemetry.usage = { enabled: false };
    config.telemetry.observability.service_name = 'mine';
    config.telemetry.observability.otlp.metrics = { enabled: true, exporter: 'http://127.0.0.1:1' };
    config.telemetry.observability.prometheus = { enabled: false, port: 1, host: '127.0.0.1' };
    config.telemetry.observability.pyroscope = { enabled: true, server_address: 'http://127.0.0.1:1' };
    fs.writeFileSync(file, JSON.stringify(config));

    await run(root, env, 'up', '--json');
    const { telemetry } = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(telemetry.usage, { enabled: false });
    assert.equal(telemetry.observability.service_name, 'mine');
    assert.deepEqual(telemetry.observability.otlp.metrics, { enabled: true, exporter: 'http://127.0.0.1:5017' });
    assert.deepEqual(telemetry.observability.prometheus, { enabled: false, port: 14969, host: '127.0.0.1' });
    assert.deepEqual(telemetry.observability.pyroscope, { enabled: true, server_address: 'http://127.0.0.1:4740' });
  });

  it('writes a telemetry block the backend\'s schema accepts with every transport switched on', () => {
    const { telemetry } = JSON.parse(fs.readFileSync(path.join(worktrees[2], 'back', 'config', 'development.local.json'), 'utf8'));
    const { observability } = telemetry;
    for (const transport of [...Object.values(observability.otlp), observability.prometheus, observability.pyroscope]) {
      transport.enabled = true;
    }
    // The schema is TypeScript: tsx loads it with its workspace imports, as the backend does.
    const parse = `import { featureConfigs } from ${JSON.stringify(path.join(REPO, 'back', 'src', 'config-schema.ts'))};
      const result = featureConfigs.telemetry.safeParse(JSON.parse(process.env.TELEMETRY));
      if (!result.success) { console.error(JSON.stringify(result.error.issues)); process.exit(1); }`;
    const result = spawnSync(path.join(REPO, 'node_modules', '.bin', 'tsx'), ['-e', parse], { encoding: 'utf8', env: { ...process.env, TELEMETRY: JSON.stringify(telemetry) } });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  });

  it('leaves no partial file beside the registry', () => {
    assert.deepEqual(fs.readdirSync(path.dirname(registryFile)).filter((name) => name.endsWith('.tmp')), []);
  });

  it('refuses to write over a registry it cannot parse', async () => {
    const truncated = fs.readFileSync(registryFile, 'utf8').slice(0, 20);
    fs.writeFileSync(registryFile, truncated);
    const result = await run(worktrees[2], env, 'ports', '--json');
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /cannot be read as a registry/);
    assert.equal(fs.readFileSync(registryFile, 'utf8'), truncated);
  });
});

describe('devenv PostgreSQL move', { skip: process.platform === 'win32' && 'the fake docker is started by a shell script' }, () => {
  let base;
  let root;
  let state;
  let env;
  let project;
  let dumps;

  const volume = (name) => path.join(state, 'volumes', `${project}_${name}`);
  const cluster = (dir, major, { databases = ['app|app'], roles = '' } = {}) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'PG_VERSION'), `${major}\n`);
    fs.writeFileSync(path.join(dir, 'databases'), databases.map((line) => `${line}\n`).join(''));
    fs.writeFileSync(path.join(dir, 'roles.sql'), roles);
  };
  const pinMajor = (major) => {
    fs.writeFileSync(path.join(root, 'infra', 'local', 'compose.yml'), `name: app-dev\nx-postgres-image: &postgres-image pgvector/pgvector:0.8.7-pg${major}\n`);
    env.FAKE_TARGET_VOLUME = `${project}_${postgresVolume(major)}`;
  };
  const calls = () => fs.readFileSync(path.join(state, 'log'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const started = () => calls().filter((args) => args[0] === 'run' && args[1] === '-d');
  const read = (file) => (fs.existsSync(path.join(state, file)) ? fs.readFileSync(path.join(state, file), 'utf8') : '');
  const up = async (fail) => {
    const result = await run(root, { ...env, FAKE_FAIL: fail ?? '' }, 'up', '--json');
    assert.equal(result.code, 1);
    return result;
  };

  before(async () => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'devenv-move-test-')));
    const main = path.join(base, 'main');
    fs.mkdirSync(main);
    git(main, 'init', '--quiet');
    git(main, 'commit', '--quiet', '--allow-empty', '-m', 'init');
    root = path.join(base, 'wt');
    git(main, 'worktree', 'add', '--quiet', '-b', 'wt-move', root);
    fs.mkdirSync(path.join(root, 'infra', 'local'), { recursive: true });
    const bin = path.join(base, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh\nexec "${process.execPath}" "${path.join(SCRIPTS, 'devenv-fake-docker.mjs')}" "$@"\n`, { mode: 0o755 });
    state = path.join(base, 'state');
    env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_DOCKER_STATE: state };
    const allocated = await run(root, env, 'ports', '--json');
    assert.equal(allocated.code, 0, allocated.stderr);
    const { instances } = JSON.parse(fs.readFileSync(path.join(main, '.git', 'devenv.json'), 'utf8'));
    project = `app-dev${instances[root].suffix}`;
    dumps = path.join(main, '.git', 'devenv', String(instances[root].slot), 'postgres-upgrade');
  });

  beforeEach(() => {
    fs.rmSync(state, { recursive: true, force: true });
    fs.rmSync(dumps, { recursive: true, force: true });
    fs.mkdirSync(state);
    pinMajor(17);
  });

  after(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('moves the roles and databases of a PostgreSQL 16 stack, leaving its volume as it was', async () => {
    cluster(volume('postgres_data'), 16, { databases: ['postgres|app', 'app|app', 'scratch|app', 'app_test_w1|app'], roles: 'CREATE ROLE app;\nALTER ROLE app WITH SUPERUSER LOGIN;\n' });

    const result = await up();
    assert.match(result.stderr, /Moved app, scratch to PostgreSQL 17\./);
    assert.match(result.stderr, /XTM One starts on an empty database/);
    assert.deepEqual(started().map((args) => args.slice(-5)), [['-v', `${project}_postgres_data:/source`, '-e', 'PGDATA=/source', 'postgres:16-alpine']]);
    assert.equal(read('servers.json'), '{}', 'the dump server is stopped');
    assert.deepEqual(read('target/restored').split('\n').filter(Boolean), [
      `app PGDMP app from ${project}_postgres_data`,
      `scratch PGDMP scratch from ${project}_postgres_data`,
    ]);
    assert.match(read('target/sql.log'), /CREATE DATABASE "scratch" OWNER "app";/);
    assert.doesNotMatch(read('target/sql.log'), /ROLE app/, 'the bootstrap role is the new server\'s own');
    assert.equal(fs.existsSync(dumps), false);
    assert.ok(fs.existsSync(path.join(volume('postgres_data'), 'PG_VERSION')));
  });

  it('moves from the newest earlier major, with the image that wrote it, XTM One\'s database and role included', async () => {
    cluster(volume('postgres_data'), 16);
    cluster(volume('postgres17_data'), 17, {
      databases: ['app|app', 'xtm_one|xtm_one'],
      roles: 'CREATE ROLE app;\nALTER ROLE app WITH SUPERUSER LOGIN;\nCREATE ROLE xtm_one;\nALTER ROLE xtm_one WITH LOGIN PASSWORD \'x\';\n',
    });
    pinMajor(18);

    const result = await up();
    assert.match(result.stderr, /Moved app, xtm_one to PostgreSQL 18\./);
    assert.doesNotMatch(result.stderr, /XTM One starts on an empty database/);
    assert.equal(started().length, 1);
    assert.deepEqual(started()[0].slice(-3), ['-e', 'PGDATA=/source', 'pgvector/pgvector:pg17']);
    assert.match(read('target/sql.log'), /CREATE ROLE xtm_one;\nALTER ROLE xtm_one WITH LOGIN PASSWORD 'x';/);
    assert.match(read('target/sql.log'), /CREATE DATABASE "xtm_one" OWNER "xtm_one";/);
    assert.match(result.stderr, new RegExp(`volume rm ${project}_postgres17_data ${project}_postgres_data`));
  });

  it('reads a cluster an 18 image wrote under its major\'s directory', async () => {
    cluster(path.join(volume('postgres18_data'), '18', 'docker'), 18);
    pinMajor(19);

    await up();
    assert.deepEqual(started()[0].slice(-3), ['-e', 'PGDATA=/source/18/docker', 'pgvector/pgvector:pg18']);
  });

  it('moves nothing once the volume of the pinned major exists, nor from a later major', async () => {
    cluster(volume('postgres_data'), 16);
    cluster(volume('postgres17_data'), 17);
    await up();
    cluster(volume('postgres18_data'), 18);
    fs.rmSync(volume('postgres17_data'), { recursive: true });
    fs.rmSync(volume('postgres_data'), { recursive: true });
    await up();

    assert.deepEqual(started(), []);
    assert.equal(read('target/restored'), '');
  });

  it('moves nothing from XTM One\'s former volume', async () => {
    cluster(volume('xtm_one_db_data'), 16);

    await up();
    assert.deepEqual(started(), []);
  });

  it('stops, changing nothing, when it cannot read a volume', async () => {
    cluster(volume('postgres_data'), 16);

    const result = await up('probe');
    assert.match(result.stderr, /Could not look inside .*postgres_data/);
    assert.equal(fs.existsSync(path.join(state, 'volumes', env.FAKE_TARGET_VOLUME)), false);
    assert.equal(calls().some((args) => args[0] === 'compose' && args[1] === 'up'), false);
  });

  it('stops the dump server and keeps no dump when a dump fails', async () => {
    cluster(volume('postgres_data'), 16, { databases: ['app|app', 'scratch|app'] });

    const result = await up('dump:scratch');
    assert.match(result.stderr, /Could not dump database 'scratch'/);
    assert.equal(read('servers.json'), '{}');
    assert.equal(fs.existsSync(dumps), false);
    assert.equal(fs.existsSync(path.join(state, 'volumes', env.FAKE_TARGET_VOLUME)), false);
  });

  it('restores its dumps again after a failed restore, without dumping again', async () => {
    cluster(volume('postgres_data'), 16, { databases: ['app|app', 'scratch|app'] });

    const failed = await up('restore:scratch');
    assert.match(failed.stderr, /pg_restore failed on database 'scratch'.*`yarn env:up --reset` gives up the move/);
    assert.ok(fs.existsSync(path.join(dumps, 'manifest.json')));

    fs.rmSync(path.join(state, 'log'));
    fs.rmSync(path.join(state, 'target', 'restored'));
    const resumed = await up();
    assert.match(resumed.stderr, /Moved app, scratch to PostgreSQL 17\./);
    assert.deepEqual(started(), []);
    assert.deepEqual(read('target/restored').split('\n').filter(Boolean).map((line) => line.split(' ')[0]), ['app', 'scratch']);
    assert.equal(fs.existsSync(dumps), false);
  });

  it('removes the former database volumes and the dumps on down --volumes, and nothing of another stack', async () => {
    cluster(volume('postgres_data'), 16);
    cluster(volume('postgres17_data'), 17);
    cluster(volume('xtm_one_db_data'), 16);
    cluster(path.join(state, 'volumes', 'app-dev-other_postgres_data'), 16);
    fs.mkdirSync(dumps, { recursive: true });

    const result = await run(root, env, 'down', '--volumes');
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(fs.readdirSync(path.join(state, 'volumes')), ['app-dev-other_postgres_data']);
    assert.equal(fs.existsSync(dumps), false);
  });

  it('runs again the role statements of a move that failed half way, creating no role twice', () => {
    const globals = 'SET client_encoding = \'UTF8\';\nCREATE ROLE "app";\nALTER ROLE "app" WITH SUPERUSER;\nCREATE ROLE xtm_one;\nALTER ROLE xtm_one WITH LOGIN;\nCREATE ROLE "odd ""name""";\n';
    assert.equal(rolesToCreate(globals, 'app', ['app', 'xtm_one', 'odd "name"']), 'SET client_encoding = \'UTF8\';\nALTER ROLE xtm_one WITH LOGIN;\n');
  });
});

describe('PostgreSQL image pins', () => {
  const text = (file) => fs.readFileSync(path.join(REPO, file), 'utf8');
  const major = pinnedPostgresMajor(text('infra/local/compose.yml'));
  const image = text('infra/local/compose.yml').match(/^x-postgres-image: &postgres-image (\S+)$/m)?.[1];

  it('names the database volumes after the major version the images run, mounted where that image expects them', () => {
    assert.ok(major, 'infra/local/compose.yml pins its image in the x-postgres-image anchor');
    const mount = `${postgresVolume(major)}:${postgresMountPath(major)}`;
    const file = 'infra/local/compose.yml';
    assert.ok(text(file).includes(`- ${mount}\n`), `${file} mounts ${mount}: another major is another volume, which devenv.mjs moves the databases into`);
    assert.match(text(file), new RegExp(`^volumes:\\n(  \\S+:\\n)*  ${postgresVolume(major)}:$`, 'm'), `${file} declares ${postgresVolume(major)}`);
  });

  it('runs one image everywhere', () => {
    for (const file of ['infra/local/compose.yml', '.github/workflows/ci-test-app.yml', '.github/workflows/ci-docker-build.yml']) {
      assert.deepEqual([...new Set(text(file).match(/pgvector\/pgvector:\S+/g))], [image], file);
    }
  });
});

describe('devenv container engine', () => {
  const ENGINE = 'Docker Engine - Community|Engine,containerd,runc,docker-init,';

  it('binds the backend beyond loopback on a plain Docker engine on Linux only', () => {
    assert.equal(listensBeyondLoopback('linux', 'docker', ENGINE), true);
    // An engine packaged without a platform name.
    assert.equal(listensBeyondLoopback('linux', 'docker', '|Engine,containerd,runc,docker-init,\n'), true);
    assert.equal(listensBeyondLoopback('darwin', 'docker', ENGINE), false);
    assert.equal(listensBeyondLoopback('win32', 'docker', ENGINE), false);
  });

  it('keeps the backend on loopback for Docker Desktop, Podman, or an engine it cannot identify', () => {
    assert.equal(listensBeyondLoopback('linux', 'docker', 'Docker Desktop 4.50.0 (209931)|Engine,containerd,runc,docker-init,'), false);
    assert.equal(listensBeyondLoopback('linux', 'docker', '|Podman Engine,Conmon,OCI Runtime (crun),'), false);
    assert.equal(listensBeyondLoopback('linux', 'podman', ENGINE), false);
    assert.equal(listensBeyondLoopback('linux', 'podman-compose', ENGINE), false);
    assert.equal(listensBeyondLoopback('linux', 'docker', null), false);
    assert.equal(listensBeyondLoopback('linux', 'docker', ''), false);
  });

  it('gives podman-compose a pull policy podman knows, and leaves Docker Compose on the file\'s', () => {
    assert.equal(xtmOnePullPolicy('podman-compose version 1.5.0\npodman version 5.6.2\n'), 'newer');
    assert.equal(xtmOnePullPolicy('podman-compose version: 1.0.6\n'), 'newer');
    assert.equal(xtmOnePullPolicy('Docker Compose version v5.1.3\n'), null);
    assert.equal(xtmOnePullPolicy(''), null);
  });
});

describe('devenv profiles', () => {
  it('runs the stack\'s own XTM One unless infra/local/.env says XTM_ONE_LOCAL=false', () => {
    assert.equal(runsOwnXtmOne({}), true);
    assert.equal(runsOwnXtmOne({ XTM_ONE_LOCAL: 'true' }), true);
    assert.equal(runsOwnXtmOne({ XTM_ONE_LOCAL: 'false' }), false);
    assert.equal(runsOwnXtmOne({ XTM_ONE_LOCAL: ' FALSE ' }), false);
  });

  it('reads the setting as Compose reads a .env value, quoted or followed by a comment', () => {
    for (const raw of ['"false"', "'false'", 'false # served elsewhere', '"false" # served elsewhere']) {
      assert.equal(runsOwnXtmOne({ XTM_ONE_LOCAL: raw }), false, raw);
    }
    assert.equal(dotEnvValue('"a # b"'), 'a # b');
    assert.equal(dotEnvValue('a#b'), 'a#b');
    assert.equal(dotEnvValue(undefined), '');
  });

  it('enables the XTM One profile with the stack\'s own XTM One, and monitoring on demand', () => {
    assert.deepEqual(upProfiles({ monitoring: false, ownXtmOne: true }), ['xtm-one']);
    assert.deepEqual(upProfiles({ monitoring: true, ownXtmOne: true }), ['xtm-one', 'monitoring']);
    assert.deepEqual(upProfiles({ monitoring: false, ownXtmOne: false }), []);
    assert.deepEqual(profileArgs(ALL_PROFILES), ['--profile', 'xtm-one', '--profile', 'monitoring']);
  });

  it('reads the services a profile adds from what Compose lists with and without it', () => {
    const without = 'postgres\nredis\nmailpit\n';
    assert.deepEqual(servicesOfProfile('postgres\nxtm-one-db\nredis\nmailpit\nxtm-one\nxtm-one-worker\n', without), ['xtm-one-db', 'xtm-one', 'xtm-one-worker']);
    assert.deepEqual(servicesOfProfile(without, without), []);
  });
});

describe('devenv compose calls', { skip: process.platform === 'win32' && 'the fake docker is a shell script' }, () => {
  let base;
  let root;
  let calls;
  let env;

  before(async () => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'devenv-compose-test-')));
    root = path.join(base, 'main');
    fs.mkdirSync(path.join(root, 'infra', 'local'), { recursive: true });
    // The anchor every `up` reads the PostgreSQL major from.
    fs.writeFileSync(path.join(root, 'infra', 'local', 'compose.yml'), 'x-postgres-image: &postgres-image pgvector/pgvector:0.8.7-pg17\n');
    git(root, 'init', '--quiet');
    git(root, 'commit', '--quiet', '--allow-empty', '-m', 'init');
    calls = path.join(base, 'calls.log');
    const bin = path.join(base, 'bin');
    fs.mkdirSync(bin);
    // Records every compose call with the COMPOSE_PROFILES it inherits, lists the XTM One services
    // only under their profile (by flag or by COMPOSE_PROFILES, as Compose does), and fails `up`, so
    // that no server is started.
    fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh
[ "$1" = "compose" ] || exit 0
shift
echo "$*\${COMPOSE_PROFILES:+ [COMPOSE_PROFILES=$COMPOSE_PROFILES]}" >> '${calls}'
case " $* " in
  *" config --services "*)
    echo postgres; echo redis
    case " $* ,$COMPOSE_PROFILES," in *" --profile xtm-one "*|*",xtm-one,"*) echo xtm-one-db; echo xtm-one; echo xtm-one-worker ;; esac ;;
  *" up "*) exit 1 ;;
esac
exit 0
`, { mode: 0o755 });
    // A shell enabling every profile, which devenv must not let through.
    env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, COMPOSE_PROFILES: 'xtm-one,monitoring' };
    // Registers the stack, which `status` lists only once an `up` has given it a slot.
    await run(root, env, 'up', '--json');
  });

  after(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  const composeCalls = async (...args) => {
    fs.rmSync(calls, { force: true });
    const result = await run(root, env, ...args);
    const lines = fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n') : [];
    // The engine probe runs before any profile matters.
    return { result, lines: lines.filter((line) => !line.startsWith('version')) };
  };

  /** @param {string | null} setting the whole `XTM_ONE_LOCAL` line, `null` for none */
  const setXtmOneLocal = (setting) => {
    const file = path.join(root, 'infra', 'local', '.env');
    const kept = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter((line) => line && !line.includes('XTM_ONE_LOCAL')) : [];
    fs.writeFileSync(file, `${[...kept, ...setting === null ? [] : [setting]].join('\n')}\n`);
  };

  it('starts the stack\'s own XTM One through its profile, and monitoring with it on demand', async () => {
    assert.deepEqual((await composeCalls('up', '--json')).lines, ['--profile xtm-one up -d --remove-orphans']);
    assert.deepEqual((await composeCalls('up', '--json', '--monitoring')).lines, ['--profile xtm-one --profile monitoring up -d --remove-orphans']);
  });

  it('with XTM_ONE_LOCAL=false, stops the stack\'s own XTM One and starts the rest without it, whatever COMPOSE_PROFILES says', async () => {
    setXtmOneLocal('XTM_ONE_LOCAL="false" # served elsewhere');
    const { result, lines } = await composeCalls('up', '--json');
    assert.match(result.stderr, /Compose failed to start the infrastructure/);
    assert.deepEqual(lines, [
      '--profile xtm-one config --services',
      'config --services',
      '--profile xtm-one stop xtm-one-db xtm-one xtm-one-worker',
      'up -d --remove-orphans',
    ]);
    assert.match(fs.readFileSync(path.join(root, 'infra', 'local', '.env'), 'utf8'), /^XTM_ONE_LOCAL="false" # served elsewhere$/m, 'up keeps the setting');
  });

  it('says in its status whether the stack runs its own XTM One, from any line Compose reads', async () => {
    for (const setting of ['XTM_ONE_LOCAL=false', 'export XTM_ONE_LOCAL=false', 'XTM_ONE_LOCAL = false']) {
      setXtmOneLocal(setting);
      const off = JSON.parse((await run(root, env, 'status', '--json')).stdout);
      assert.equal(off[0].xtmOneLocal, false, setting);
    }
    setXtmOneLocal(null);
    const on = JSON.parse((await run(root, env, 'status', '--json')).stdout);
    assert.equal(on[0].xtmOneLocal, true);
  });

  it('brings every profile down, whichever the stack was started with', async () => {
    assert.deepEqual((await composeCalls('down')).lines, ['--profile xtm-one --profile monitoring down --remove-orphans']);
    assert.deepEqual((await composeCalls('down', '--volumes')).lines, ['--profile xtm-one --profile monitoring down -v --remove-orphans']);
  });
});

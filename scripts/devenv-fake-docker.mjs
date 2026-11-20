#!/usr/bin/env node
/**
 * A `docker` for `devenv.test.mjs`, which answers what the PostgreSQL move of `devenv.mjs` asks from
 * the state in `FAKE_DOCKER_STATE`: a directory per volume, the servers it started, and a log of
 * every call. In a volume, a directory holding `PG_VERSION` is a cluster, its `databases` file lists
 * `name|owner` lines and its `roles.sql` is what `pg_dumpall --globals-only` prints.
 *
 * `FAKE_TARGET_VOLUME` is the volume `compose up postgres` creates, `FAKE_FAIL` one of `probe`,
 * `dump:<database>` or `restore:<database>`. A full `compose up` fails, which ends `devenv up` right
 * after the move.
 */

import fs from 'node:fs';
import path from 'node:path';

const state = process.env.FAKE_DOCKER_STATE;
const volumes = path.join(state, 'volumes');
const target = path.join(state, 'target');
const serversFile = path.join(state, 'servers.json');
const args = process.argv.slice(2);
fs.mkdirSync(volumes, { recursive: true });
fs.mkdirSync(target, { recursive: true });
fs.appendFileSync(path.join(state, 'log'), `${JSON.stringify(args)}\n`);

const servers = () => (fs.existsSync(serversFile) ? JSON.parse(fs.readFileSync(serversFile, 'utf8')) : {});
const saveServers = (all) => fs.writeFileSync(serversFile, JSON.stringify(all));
const stdin = () => fs.readFileSync(0, 'utf8');
const failing = (what) => process.env.FAKE_FAIL === what;
const done = (code = 0) => process.exit(code);

const findClusters = (dir, depth = 0) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) {
    return depth < 2 ? findClusters(full, depth + 1) : [];
  }
  return entry.name === 'PG_VERSION' ? [full] : [];
});

const composeCommand = (rest) => {
  const [command, ...more] = rest[0] === '--profile' ? rest.slice(2) : rest;
  if (command === 'version') {
    process.stdout.write('Docker Compose version v2.30.0\n');
    return done();
  }
  if (command === 'up') {
    if (more.at(-1) !== 'postgres') {
      return done(1);
    }
    fs.mkdirSync(path.join(volumes, process.env.FAKE_TARGET_VOLUME), { recursive: true });
    return done();
  }
  if (command === 'down' && more.includes('-v')) {
    fs.rmSync(path.join(volumes, process.env.FAKE_TARGET_VOLUME), { recursive: true, force: true });
    return done();
  }
  if (command !== 'exec') {
    return done();
  }
  const [tool, ...toolArgs] = more.slice(2);
  if (tool === 'psql' && toolArgs.includes('-At')) {
    stdin();
    const roles = path.join(target, 'roles');
    process.stdout.write(fs.existsSync(roles) ? fs.readFileSync(roles, 'utf8') : 'app\n');
    return done();
  }
  if (tool === 'psql') {
    const statements = stdin();
    fs.appendFileSync(path.join(target, 'sql.log'), `${statements}\n`);
    for (const [, role] of statements.matchAll(/^CREATE ROLE (\S+);$/gm)) {
      fs.appendFileSync(path.join(target, 'roles'), `${role}\n`);
    }
    return done();
  }
  if (tool === 'pg_restore') {
    const database = toolArgs[toolArgs.indexOf('-d') + 1];
    const dump = stdin();
    if (failing(`restore:${database}`)) {
      return done(1);
    }
    fs.appendFileSync(path.join(target, 'restored'), `${database} ${dump}\n`);
  }
  return done();
};

if (args[0] === 'compose') {
  composeCommand(args.slice(1));
}
if (args[0] === 'volume') {
  const [, command, ...names] = args;
  if (command === 'ls') {
    process.stdout.write(fs.readdirSync(volumes).map((name) => `${name}\n`).join(''));
    done();
  }
  if (command === 'inspect') {
    done(fs.existsSync(path.join(volumes, names[0])) ? 0 : 1);
  }
  if (command === 'rm') {
    for (const name of names) {
      fs.rmSync(path.join(volumes, name), { recursive: true, force: true });
    }
  }
  done();
}
if (args[0] === 'run') {
  const options = { env: {} };
  let index = 1;
  for (; args[index].startsWith('-'); index += 1) {
    if (args[index] === '--name') {
      index += 1;
      options.name = args[index];
    } else if (args[index] === '-v') {
      index += 1;
      [options.volume, options.mount] = args[index].split(':');
    } else if (args[index] === '-e') {
      index += 1;
      const [key, value] = args[index].split('=');
      options.env[key] = value;
    }
  }
  const [image, ...command] = args.slice(index);
  if (image.startsWith('busybox')) {
    if (failing('probe')) {
      process.stderr.write('Error: pulling busybox failed\n');
      done(125);
    }
    const root = path.join(volumes, options.volume);
    if (command[0] === 'find') {
      process.stdout.write(findClusters(root).map((file) => `/volume${file.slice(root.length)}\n`).join(''));
    } else {
      process.stdout.write(fs.readFileSync(path.join(root, command[1].slice('/volume'.length)), 'utf8'));
    }
    done();
  }
  const all = servers();
  all[options.name] = { image, volume: options.volume, data: options.env.PGDATA.slice(options.mount.length) };
  saveServers(all);
  done();
}
if (args[0] === 'rm' || args[0] === 'stop') {
  const all = servers();
  delete all[args.at(-1)];
  saveServers(all);
  done();
}
if (args[0] === 'exec') {
  const rest = args[1] === '-i' ? args.slice(2) : args.slice(1);
  const [server, tool, ...toolArgs] = rest;
  const running = servers()[server];
  if (!running) {
    done(1);
  }
  const cluster = path.join(volumes, running.volume, running.data);
  if (tool === 'psql') {
    stdin();
    process.stdout.write(fs.readFileSync(path.join(cluster, 'databases'), 'utf8'));
  } else if (tool === 'pg_dumpall') {
    const roles = path.join(cluster, 'roles.sql');
    process.stdout.write(fs.existsSync(roles) ? fs.readFileSync(roles, 'utf8') : '');
  } else if (tool === 'pg_dump') {
    const database = toolArgs[toolArgs.indexOf('-d') + 1];
    if (failing(`dump:${database}`)) {
      done(1);
    }
    process.stdout.write(`PGDMP ${database} from ${running.volume}`);
  }
  done();
}
done();

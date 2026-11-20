/* eslint-disable no-console */
/**
 * Resets the local dev environment, targeting whatever actually serves the backend.
 *
 * The database the backend talks to is the one answering on `postgres.port`, which is
 * not necessarily the one described by `infra/local/compose.yml`: another worktree, or a
 * generated per-worktree compose file, may own that port. So the target is resolved from
 * the port outwards (port -> published container -> its Compose project), never from a
 * hardcoded project name.
 *
 * Usage:
 *   yarn env:reset            drop and recreate the database (keeps uploaded files)
 *   yarn env:reset --infra    destroy the Compose project's volumes instead, so the
 *                             database and the file storage restart in sync
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { isPlatformSeedEnabled, runPlatformSeedSetup } from './dev-platform-seed';
import { dropAndRecreateDatabase, resolvePostgresConfig } from './dev-postgres';

interface PodmanPort {
  host_port: number,
  range: number,
  protocol: string,
}

interface PodmanContainer {
  Names: Array<string>,
  Ports?: Array<PodmanPort>,
  Labels?: Record<string, string>,
}

interface ComposeTarget {
  container: string,
  project: string,
  /** Absolute paths, in the order Compose must receive them. */
  files: Array<string>,
  workingDir: string,
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

const listRunningContainers = (): Array<PodmanContainer> => {
  try {
    return JSON.parse(execFileSync('podman', ['ps', '--format', 'json'], { encoding: 'utf-8' }));
  } catch {
    return [];
  }
};

/**
 * The running container publishing `port`, or null when none does.
 *
 * A mapping can cover a range (`9000-9001` arrives as one entry with `range: 2`), so a
 * plain equality on `host_port` misses every port but the first of the range.
 */
const findContainerOnPort = (port: number): PodmanContainer | null => (
  listRunningContainers().find((container) => (container.Ports ?? []).some((mapping) => (
    mapping.protocol === 'tcp'
    && port >= mapping.host_port
    && port < mapping.host_port + Math.max(mapping.range, 1)
  ))) ?? null
);

/**
 * The Compose coordinates carried by the container's labels, or null when it was not
 * started by Compose (a hand-run `podman run` has no project to reset).
 */
const readComposeTarget = (container: PodmanContainer): ComposeTarget | null => {
  const labels = container.Labels ?? {};
  const project = labels['com.docker.compose.project'];
  const workingDir = labels['com.docker.compose.project.working_dir'];
  const configFiles = labels['com.docker.compose.project.config_files'];
  if (!project || !workingDir || !configFiles) {
    return null;
  }
  return {
    container: container.Names[0] ?? '(unnamed)',
    project,
    workingDir,
    files: configFiles.split(',')
      .map((file) => file.trim())
      .filter(Boolean)
      .map((file) => (isAbsolute(file) ? file : resolve(workingDir, file))),
  };
};

const runCompose = (target: ComposeTarget, args: Array<string>): void => {
  const composeArgs = ['compose', '-p', target.project, ...target.files.flatMap((file) => ['-f', file]), ...args];
  console.log(`\n$ podman ${composeArgs.join(' ')}`);
  const result = spawnSync('podman', composeArgs, { cwd: target.workingDir, stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`podman compose ${args.join(' ')} failed with status ${result.status ?? 'unknown'}`);
  }
};

const confirm = async (rl: ReturnType<typeof createInterface>, question: string): Promise<boolean> => {
  const answer = (await rl.question(question)).trim().toLowerCase();
  return answer === 'y' || answer === 'yes';
};

/**
 * A reset leaves a blank platform, so this is the moment to decide what the next boot rebuilds:
 * demo data, or the setup wizard asking for a first admin.
 */
const offerPlatformSeed = async (rl: ReturnType<typeof createInterface>): Promise<void> => {
  if (isPlatformSeedEnabled()) {
    console.log('\n· platform_seed is enabled, so demo data will be recreated on the next boot.');
    console.log('  `yarn seed:setup-dev` changes the admin credentials, `yarn seed:rollback-dev` drops the block.');
    return;
  }
  if (await confirm(rl, '\nSet up demo data (platform seed) for the next boot? [y/N]: ')) {
    await runPlatformSeedSetup(rl);
  } else {
    console.log('\n· No demo data: the setup wizard will ask you for a first admin account.');
  }
};

const main = async () => {
  const infraMode = process.argv.includes('--infra');
  const cfg = resolvePostgresConfig();

  const isLocal = LOCAL_HOSTS.has(cfg.host);
  const container = isLocal ? findContainerOnPort(cfg.port) : null;
  const target = container ? readComposeTarget(container) : null;

  console.log('Target resolved from back config:');
  console.log(`  host       ${cfg.host}`);
  console.log(`  port       ${cfg.port}`);
  console.log(`  database   ${cfg.database}`);
  console.log(`  container  ${container?.Names[0] ?? '(none published on this port)'}`);
  console.log(`  project    ${target?.project ?? '(not started by Compose)'}`);
  for (const file of target?.files ?? []) {
    console.log(`  file       ${file}`);
  }

  if (!isLocal) {
    console.log(`\n· ${cfg.host} is not a local host, so no container was looked up.`);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (!infraMode) {
      if (!await confirm(rl, `\nDrop and recreate database "${cfg.database}"? [y/N]: `)) {
        console.log('\n· Nothing done.');
        return;
      }
      await dropAndRecreateDatabase(cfg);
      await offerPlatformSeed(rl);
      console.log('\n  Restart `yarn dev`: migrations recreate the schema and the seed runs.');
      console.log('  Uploaded files are untouched, re-run with --infra to wipe those too.');
      return;
    }

    if (!target) {
      throw new Error(container
        ? `Container "${container.Names[0]}" carries no Compose labels, so its project cannot be resolved. Reset it by hand.`
        : `No running container publishes port ${cfg.port}, so there is no Compose project to reset. Start your infrastructure first.`);
    }

    console.log(`\nThis destroys every volume of project "${target.project}": database and uploaded files.`);
    if (!await confirm(rl, 'Continue? [y/N]: ')) {
      console.log('\n· Nothing done.');
      return;
    }

    // The volume wipe already takes the database with it, so no DROP is needed here.
    runCompose(target, ['down', '-v']);
    runCompose(target, ['up', '-d']);

    // Compose reports success even when a container cannot bind its port and stays in
    // `Created`, which silently leaves the old database in place behind the same port.
    const restarted = findContainerOnPort(cfg.port);
    if (restarted) {
      console.log(`\n✓ ${restarted.Names[0]} is running on port ${cfg.port}.`);
      await offerPlatformSeed(rl);
      console.log('\n  Restart `yarn dev`: migrations recreate the schema and the seed runs.');
    } else {
      console.log(`\n✗ Nothing published port ${cfg.port} after the restart.`);
      console.log('  A container is likely stuck in `Created` because another one still holds the port.');
      console.log(`  Check with: podman ps -a --filter publish=${cfg.port}`);
    }
  } finally {
    rl.close();
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

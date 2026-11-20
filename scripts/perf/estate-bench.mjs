#!/usr/bin/env node
/**
 * Times every screen and computation that depends on a risk scope's estate, against the budgets the
 * product owner confirmed on 2026-09-13, and writes one report naming each measure, its budget and
 * its verdict.
 *
 * It expects this worktree's own stack up (`node scripts/devenv.mjs up`) on a database carrying the
 * platform seed's `large_estate` profile; `docs/development/development.md#the-large-estate` holds
 * the recipe. Ports, the seeded admin and the database credentials come from
 * `back/config/development.json` and its `.local.json` override.
 *
 * Usage: node scripts/perf/estate-bench.mjs [--out <dir>] [--repeats <n>] [--skip-runs] [--skip-map]
 * Exit code: 0 every measure passed, 1 one failed, 2 none failed but one was skipped.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

// === The budgets, confirmed by the product owner on 2026-09-13 ===============================

/** Any paginated page of the estate: the picker's pages, the scope's Assets and its Findings. */
const PAGE_BUDGET_MS = 1_000;

/** The estate map drawn at the seeded size, in a browser and not over HTTP. */
const MAP_BUDGET_MS = 2_000;

/**
 * The closed-scope run has no number of its own: its budget is the same scenario priced with the
 * scope open, which it must not be slower than. The margin absorbs the noise of two single samples,
 * and the report prints it rather than claiming "no slower than".
 */
const RUN_TOLERANCE = 1.1;

// === What tells the script the product carries the surface ==================================

/**
 * What the estate map marks itself with on the scope's Details page. The map measure is skipped
 * until an element carries it, so the attribute is a contract between this script and whoever
 * draws the map, and renaming it turns the measure back into a skip rather than into a failure.
 */
const ESTATE_MAP_TESTID = 'estate-map';

// === Everything else ========================================================================

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_OUT_DIR = join(REPO_ROOT, '.dev/perf');
const DEFAULT_REPEATS = 20;

/** The page sizes the product itself asks for: the drawer's picker, then the two data tables. */
const PICKER_PAGE_LIMIT = 25;
const PAGE_LIMIT = 50;

const RUN_TIMEOUT_MS = 900_000;
/**
 * What a wait on the whole queue is allowed to take, against `RUN_TIMEOUT_MS` for one run. A save
 * that moves the estate books a run per scenario of the scope, so the queue a measure has to see
 * empty is N runs deep, and a budget sized for one of them turns every measure after the first save
 * into a timeout.
 */
const QUEUE_TIMEOUT_MS = 3_600_000;
const BROWSER_QUIET_MS = 400;
const BROWSER_TIMEOUT_MS = 180_000;

/** The scope the `large_estate` profile writes: `Organization_AcmeRetailNetwork` of the seed's id table. */
const PROFILE_SCOPE_ID = '019edb28-0017-7000-8000-000000000001';

const NO_ESTATE_MESSAGE = 'No closed scope with a mapping in any tenant. The platform seed stops as '
  + 'soon as its admin user exists, so enabling the large_estate profile on a database that has '
  + 'already been seeded changes nothing: re-seed with `yarn env:down` then `yarn env:up --reset`, '
  + 'or load a snapshot with `yarn env:restore large-estate --dir <dir> --force` then `yarn env:up`.';

const USAGE = [
  'Usage: node scripts/perf/estate-bench.mjs [options]',
  '',
  '  --out <dir>      where perf-report.md and perf-report.json are written (default .dev/perf)',
  '  --repeats <n>    calls sampled per paginated measure (default 20)',
  '  --skip-runs      leave the engine alone: no scenario is priced',
  '  --skip-map       no browser pass',
  '  --help, -h       this text',
  '',
  'Exit code: 0 every measure passed, 1 one failed, 2 none failed but one was skipped.',
].join('\n');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);

const log = (line) => process.stdout.write(`${line}\n`);
const fail = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

if (flag('--help') || flag('-h')) {
  log(USAGE);
  process.exit(0);
}

const option = (name, fallback) => {
  const index = args.indexOf(name);
  if (index === -1) {
    return fallback;
  }
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    fail(`${name} takes a value.\n\n${USAGE}`);
  }
  return value;
};

const outDir = resolve(option('--out', DEFAULT_OUT_DIR));
const repeats = Number(option('--repeats', DEFAULT_REPEATS));
if (!Number.isInteger(repeats) || repeats < 1) {
  fail(`--repeats takes a whole number of calls above zero, not "${option('--repeats', '')}".`);
}

const readConfig = () => {
  const shared = join(REPO_ROOT, 'back/config/development.json');
  const local = join(REPO_ROOT, 'back/config/development.local.json');
  if (!existsSync(local)) {
    fail(`No ${local}. Run: node scripts/devenv.mjs up`);
  }
  const read = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {});
  const base = read(shared);
  const override = read(local);
  const merged = { ...base, ...override, postgres: { ...base.postgres, ...override.postgres } };
  const backend = merged.http_server?.port;
  const frontend = merged.dev_server?.port;
  const admin = merged.platform_seed?.enabled ? merged.platform_seed.admin : undefined;
  if (!backend || !admin?.email || !admin?.password) {
    fail(`${local} carries no backend port or no enabled platform_seed.admin.`);
  }
  return { backend, frontend, admin, postgres: merged.postgres };
};

const percentile = (values, share) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { value: sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)], rank: sorted.length - Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1) };
};

const ORDINALS = ['', 'slowest', 'second-slowest', 'third-slowest', 'fourth-slowest', 'fifth-slowest'];
const rankName = (rank) => ORDINALS[rank] ?? `${rank}th-slowest`;

const round = (value) => Math.round(value * 10) / 10;

// === The tRPC client ========================================================================

const createClient = async ({ backend, admin }) => {
  const base = `http://127.0.0.1:${backend}/trpc`;
  const response = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: admin.email, password: admin.password }),
  }).catch(() => null);
  if (response === null) {
    return fail(`Nothing answers on port ${backend}. Run: node scripts/devenv.mjs up`);
  }
  if (!response.ok) {
    fail(`Login failed: HTTP ${response.status}. Is the backend up and seeded on port ${backend}?`);
  }
  const setCookie = response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie');
  const cookie = setCookie?.split(';')[0];
  if (!cookie) {
    fail('Login returned no session cookie.');
  }

  let tenantId = null;
  const headers = () => ({
    'content-type': 'application/json',
    cookie,
    ...(tenantId === null ? {} : { 'x-tenant-id': tenantId }),
  });

  const unwrap = async (procedure, res) => {
    const body = await res.text();
    if (!res.ok) {
      throw new Error(`${procedure}: HTTP ${res.status} ${body.slice(0, 200)}`);
    }
    return JSON.parse(body).result.data;
  };

  /**
   * A refused connection is retried on a read and never on a write: the worker running a simulation
   * starves the http process for seconds at a time, and a dropped socket says nothing about whether
   * the mutation behind it landed, so replaying one can enqueue a second competing run.
   */
  const send = async (procedure, call, retriable) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await unwrap(procedure, await call());
      } catch (error) {
        if (!retriable || attempt === 3 || !(error instanceof TypeError)) {
          throw error;
        }
        await new Promise((done) => setTimeout(done, 1_000 * attempt));
      }
    }
  };

  return {
    setTenant: (id) => {
      tenantId = id;
    },
    cookie,
    query: async (procedure, input) => {
      const suffix = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`;
      return send(procedure, () => fetch(`${base}/${procedure}${suffix}`, { headers: headers() }), true);
    },
    mutate: async (procedure, input) => send(procedure, () => fetch(`${base}/${procedure}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(input ?? {}),
    }), false),
  };
};

/**
 * The scope the profile seeded, by its stable id, and the largest closed scope of any tenant when
 * the estate came from somewhere else. Picking the first closed scope found would measure whichever
 * one a demo seeder happened to write.
 */
const findLargeEstate = async (client) => {
  const tenants = await client.query('tenants.getTenants');
  let best = null;
  for (const tenant of tenants) {
    client.setTenant(tenant.id);
    const scopes = await client.query('organizations.getOrganizations');
    const profiled = scopes.find((scope) => scope.id === PROFILE_SCOPE_ID);
    if (profiled !== undefined && profiled.mappedAssetCount > 0) {
      if (profiled.estateMode !== 'closed') {
        fail(`Scope "${profiled.name}" is in ${profiled.estateMode} mode. ${NO_ESTATE_MESSAGE}`);
      }
      return { tenant, scope: profiled };
    }
    for (const scope of scopes) {
      if (scope.estateMode === 'closed' && scope.mappedAssetCount > (best?.scope.mappedAssetCount ?? 0)) {
        best = { tenant, scope };
      }
    }
  }
  if (best === null) {
    fail(NO_ESTATE_MESSAGE);
  }
  return best;
};

/**
 * What wrote the score projection the paginated measures page over. The seeder writes it at boot and
 * the daily recompute job overwrites it wholesale, and a reading says nothing about which one it
 * measured unless the report carries the projection's own clock.
 */
const probeProjection = async ({ postgres }, tenantId) => {
  try {
    const { default: pg } = await import('pg');
    const client = new pg.Client({
      host: postgres.host ?? '127.0.0.1',
      port: postgres.port,
      user: postgres.user,
      password: postgres.password,
      database: postgres.database,
    });
    await client.connect();
    try {
      const { rows } = await client.query(
        `select
           max(s.score_changed_at) as last_change,
           (select count(*) from asset_evidence e
             where e.tenant_id = $1 and not exists (select 1 from finding_scores f where f.asset_evidence_id = e.id)) as unscored
         from finding_scores s where s.tenant_id = $1`,
        [tenantId],
      );
      return { lastChange: rows[0].last_change?.toISOString() ?? null, unscored: Number(rows[0].unscored) };
    } finally {
      await client.end();
    }
  } catch (error) {
    return { lastChange: null, unscored: null, error: error.message };
  }
};

// === Measures ===============================================================================

const results = [];

const record = (entry) => {
  results.push(entry);
  const verdict = entry.status === 'pass' ? 'PASS' : entry.status === 'fail' ? 'FAIL' : 'SKIP';
  log(`  ${verdict}  ${entry.name}: ${entry.reading} (budget ${entry.budget})`);
};

const timeCall = async (call) => {
  const started = performance.now();
  const value = await call();
  return { ms: performance.now() - started, value };
};

/**
 * A paginated read, repeated on a different input each time so the reading is not one plan answered
 * from one warm buffer, and judged on its p95 against the one-second budget.
 */
const measurePage = async (name, detail, call) => {
  const budget = `p95 < ${PAGE_BUDGET_MS} ms`;
  try {
    // Warms on input 0 and samples from 1: sampling the input the warm-up just ran would hand one
    // of the calls a buffer no other sample gets.
    await call(0);
    const samples = [];
    for (let index = 1; index <= repeats; index++) {
      samples.push((await timeCall(() => call(index))).ms);
    }
    const p95 = percentile(samples, 0.95);
    record({
      name,
      detail,
      budget,
      reading: `p95 ${round(p95.value)} ms, the ${rankName(p95.rank)} of ${samples.length} warm sequential calls; median ${round(percentile(samples, 0.5).value)} ms`,
      valueMs: round(p95.value),
      budgetMs: PAGE_BUDGET_MS,
      status: p95.value < PAGE_BUDGET_MS ? 'pass' : 'fail',
    });
  } catch (error) {
    record({
      name,
      detail,
      budget,
      reading: `not measured: ${error.message}`,
      valueMs: null,
      budgetMs: PAGE_BUDGET_MS,
      status: 'fail',
    });
  }
};

/**
 * Enqueues a scenario's simulation and waits for the run row the engine writes when it lands: the
 * mutation returns a job id and nothing about the pricing that follows it. Returns the row as well
 * as the elapsed time, since what the run walked is only readable there.
 *
 * `ms` is the pricing alone, timed from the moment a worker claimed the job. Enqueue-to-row would
 * carry whatever else the queue held, and a kind serialized per tenant makes that wait unbounded;
 * `waitMs` reports it separately rather than hiding it inside the measure.
 *
 * Both ends of that wait are Postgres's own stamps, off the job row: `enqueued_at` against a host
 * `Date.now()` would measure the clock skew between this script's box and the database's as well as
 * the wait, and on a run that beats the first poll it would be the whole of the reading.
 */
const runScenario = async (client, riskScenarioId) => {
  const before = await client.query('crqIndicators.getLatestRun', { riskScenarioId });
  const knownRunId = before?.id ?? null;
  const enqueuedAt = performance.now();
  const { jobId } = await client.mutate('crqIndicators.enqueueSimulation', { riskScenarioId });
  let waitMs = null;
  const readWait = async () => {
    const job = await client.query('jobs.getJob', { id: jobId });
    if (job !== null && job.startedAt !== null) {
      waitMs = Math.max(0, Date.parse(job.startedAt) - Date.parse(job.enqueuedAt));
    }
    return job;
  };
  // The run row can land before any poll has seen `started_at`, and a wait counted as zero there
  // would be charged to the pricing instead.
  const elapsed = async (run) => {
    if (waitMs === null) {
      await readWait();
    }
    return { ms: Math.max(0, performance.now() - enqueuedAt - (waitMs ?? 0)), waitMs: waitMs ?? 0, run };
  };
  for (;;) {
    const latest = await client.query('crqIndicators.getLatestRun', { riskScenarioId });
    if (latest !== null && latest.id !== knownRunId) {
      return await elapsed(latest);
    }
    const job = await readWait();
    if (job !== null && job.status !== 'queued' && job.status !== 'running') {
      // The two reads above are not atomic: a run row written between them is a success this
      // loop would otherwise report as a failed job.
      const settled = await client.query('crqIndicators.getLatestRun', { riskScenarioId });
      if (settled !== null && settled.id !== knownRunId) {
        return await elapsed(settled);
      }
      throw new Error(`the simulation job ended ${job.status} after ${round((performance.now() - enqueuedAt) / 1000)}s`);
    }
    if (performance.now() - enqueuedAt > RUN_TIMEOUT_MS) {
      throw new Error(`no run row after ${Math.round(RUN_TIMEOUT_MS / 1000)}s`);
    }
    await new Promise((done) => setTimeout(done, 1_000));
  }
};

/**
 * Waits until the tenant holds no simulation queued or running. An estate save books a run per
 * scenario of the scope on its own, so a run timed straight after one would time that queue as
 * well as itself. The counts are the whole queue: the last job's own status says nothing about its
 * siblings, and the runtime does not finish them in enqueue order.
 */
const drainSimulations = async (client) => {
  const started = performance.now();
  for (;;) {
    const { queued, running } = await client.query('jobs.getActiveRunCounts', { kinds: ['crq-simulation'] });
    if (queued === 0 && running === 0) {
      return;
    }
    if (performance.now() - started > QUEUE_TIMEOUT_MS) {
      throw new Error(`the simulation queue still held ${queued} queued and ${running} running after ${Math.round(QUEUE_TIMEOUT_MS / 1000)}s`);
    }
    await new Promise((done) => setTimeout(done, 2_000));
  }
};

// === The browser measure ====================================================================

/**
 * Only the Windows candidates have been exercised so far; the macOS and Linux paths are written
 * from their packagers' defaults and `CHROME_PATH` is the way past a wrong guess.
 */
const findBrowser = () => {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  return candidates.find((path) => path !== undefined && existsSync(path)) ?? null;
};

const connect = async (url) => {
  const socket = new WebSocket(url);
  await new Promise((done, failed) => {
    socket.addEventListener('open', done, { once: true });
    socket.addEventListener('error', () => failed(new Error(`cannot reach ${url}`)), { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const listeners = new Set();
  // A command is otherwise settled only by a reply carrying its id, so a browser that dies
  // mid-command leaves its promise pending for good and the caller's own timeout, which sits
  // after the await, is never reached: the script hangs instead of writing a report.
  let lost = null;
  const loseAll = (reason) => {
    lost = reason;
    pending.forEach((settle) => settle({ error: { message: reason } }));
    pending.clear();
  };
  socket.addEventListener('close', () => loseAll('the browser closed the debugging socket'));
  socket.addEventListener('error', () => loseAll('the browser debugging socket failed'));
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id !== undefined && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    } else {
      listeners.forEach((listener) => listener(message));
    }
  });
  return {
    send: (method, params) => new Promise((done, failed) => {
      if (lost !== null) {
        failed(new Error(`${method}: ${lost}`));
        return;
      }
      const id = (nextId += 1);
      pending.set(id, (message) => (message.error ? failed(new Error(`${method}: ${message.error.message}`)) : done(message.result)));
      socket.send(JSON.stringify({ id, method, params: params ?? {} }));
    }),
    /** Returns the removal: a navigation timed twice would otherwise leave its first listener counting. */
    on: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: () => socket.close(),
  };
};

/**
 * Navigates the page and returns when the frontend has stopped asking for anything for
 * `BROWSER_QUIET_MS` and has then drawn a frame. The frame is what closes the reading: a map's cost
 * is in its render, which happens after the last response and which no network event announces.
 */
const timeNavigation = async (page, url) => {
  const inFlight = new Set();
  let lastActivity = performance.now();
  const stopListening = page.on((message) => {
    const { requestId } = message.params ?? {};
    if (message.method === 'Network.requestWillBeSent') {
      inFlight.add(requestId);
      lastActivity = performance.now();
    }
    // The app opens a `data_changed` stream and holds it: a request that never finishes by design
    // is not a page still loading, and counting it would make every page read as never quiet.
    if (message.method === 'Network.responseReceived' && message.params?.response?.mimeType === 'text/event-stream') {
      inFlight.delete(requestId);
    }
    if (message.method === 'Network.loadingFinished' || message.method === 'Network.loadingFailed') {
      inFlight.delete(requestId);
      lastActivity = performance.now();
    }
  });
  try {
    const started = performance.now();
    await page.send('Page.navigate', { url });
    for (;;) {
      if (inFlight.size === 0 && performance.now() - lastActivity > BROWSER_QUIET_MS) {
        await page.send('Runtime.evaluate', {
          expression: 'new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true))))',
          awaitPromise: true,
        });
        return performance.now() - started;
      }
      if (performance.now() - started > BROWSER_TIMEOUT_MS) {
        throw new Error(`page never went quiet in ${Math.round(BROWSER_TIMEOUT_MS / 1000)}s`);
      }
      await new Promise((done) => setTimeout(done, 50));
    }
  } finally {
    stopListening();
  }
};

/** The port the browser actually took, which it writes into its profile once it is listening. */
const readDebuggingPort = async (profile) => {
  const file = join(profile, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 100; attempt++) {
    await new Promise((done) => setTimeout(done, 200));
    if (existsSync(file)) {
      const port = Number(readFileSync(file, 'utf8').split('\n')[0]);
      if (Number.isInteger(port) && port > 0) {
        return port;
      }
    }
  }
  throw new Error('the browser never opened its debugging port');
};

const MAP_NAME = 'estate map';
const MAP_DETAIL = 'The scope\'s Details page in a headless browser, from the navigation to the frame '
  + `drawn after the page stops asking for anything, once an element carries \`data-testid="${ESTATE_MAP_TESTID}"\`. `
  + 'Against the dev server, so the reading carries its module graph as well as the estate.';
const MAP_BUDGET = `< ${MAP_BUDGET_MS} ms`;

const skipMap = (reading) => record({
  name: MAP_NAME, detail: MAP_DETAIL, budget: MAP_BUDGET, reading, valueMs: null, budgetMs: MAP_BUDGET_MS, status: 'skip',
});

const measureMap = async ({ frontend, cookie, tenantId, scopeId }) => {
  const binary = findBrowser();
  if (binary === null || frontend === undefined) {
    skipMap(binary === null ? 'not measured: no Chromium found (set CHROME_PATH)' : 'not measured: no frontend port in the config');
    return;
  }

  const profile = mkdtempSync(join(tmpdir(), 'estate-bench-'));
  const browser = spawn(binary, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: 'ignore' });

  let session = null;
  try {
    const port = await readDebuggingPort(profile);
    const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((res) => res.json());
    const browserSession = await connect(version.webSocketDebuggerUrl);
    const { targetId } = await browserSession.send('Target.createTarget', { url: 'about:blank' });
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((res) => res.json());
    const target = targets.find((entry) => entry.id === targetId);
    session = await connect(target.webSocketDebuggerUrl);
    await session.send('Network.enable');
    await session.send('Page.enable');
    const [cookieName, cookieValue] = cookie.split('=');
    await session.send('Network.setCookie', {
      name: cookieName,
      value: cookieValue,
      domain: 'localhost',
      path: '/',
    });

    const url = `http://localhost:${frontend}/${tenantId}/${scopeId}/details`;
    // The dev frontend compiles on first sight and answers a thousand module requests before it
    // draws anything: measuring that would measure Vite, not the estate.
    const warmup = await timeNavigation(session, url);
    const { result } = await session.send('Runtime.evaluate', {
      expression: `document.querySelector('[data-testid="${ESTATE_MAP_TESTID}"]') !== null`,
      returnByValue: true,
    });
    if (result.value !== true) {
      skipMap(`not measured: the scope's Details page draws no \`data-testid="${ESTATE_MAP_TESTID}"\`, so the page holds nothing the estate sizes`);
      return;
    }
    const measured = await timeNavigation(session, url);
    record({
      name: MAP_NAME,
      detail: MAP_DETAIL,
      budget: MAP_BUDGET,
      reading: `${round(measured)} ms (warm-up pass ${round(warmup)} ms)`,
      valueMs: round(measured),
      budgetMs: MAP_BUDGET_MS,
      status: measured < MAP_BUDGET_MS ? 'pass' : 'fail',
    });
  } catch (error) {
    record({ name: MAP_NAME, detail: MAP_DETAIL, budget: MAP_BUDGET, reading: `not measured: ${error.message}`, valueMs: null, budgetMs: MAP_BUDGET_MS, status: 'fail' });
  } finally {
    session?.close();
    browser.kill();
  }
};

// === The runs ===============================================================================

const RUN_NAME = 'closed-scope run';
const RUN_DETAIL = 'One scenario of the closed scope priced twice, over the scope\'s mapping and then '
  + 'over the whole tenant estate: the same target and the same loss scope both times, so the two '
  + 'readings differ only by the estate the engine walked. Each is timed from the moment a worker '
  + 'claimed its job rather than from the enqueue, with the queue wait printed beside it. The run '
  + 'row\'s estate asset count is what says the two runs walked different parks, and equal counts '
  + 'mean there is nothing to compare.';
const RUN_TOLERANCE_PERCENT = Math.round((RUN_TOLERANCE - 1) * 100);
const RUN_BUDGET = `<= the open-estate run + ${RUN_TOLERANCE_PERCENT}%`;

const recordRun = (entry) => record({ name: RUN_NAME, detail: RUN_DETAIL, budget: RUN_BUDGET, ...entry });

/**
 * Prices one scenario with its scope open and again with it closed. Only a comparison of one
 * scenario against itself answers the budget: two scenarios price different targets over different
 * asset sets, and reading one against the other compares them by luck.
 */
const measureScopedRun = async (client, scope, scenarioId) => {
  // Read back rather than assumed: a previous measure that threw may have left the scope elsewhere,
  // and restoring the wrong mode would hand every measure after this one a scope the profile never
  // declared.
  const startingMode = (await client.query('organizations.getOrganization', { id: scope.id }))?.estateMode ?? 'closed';
  try {
    // The mode is set rather than assumed, so a fixture left open still prices the right thing.
    await client.mutate('organizations.updateOrganization', { id: scope.id, estateMode: 'closed' });
    await drainSimulations(client);
    const closed = await runScenario(client, scenarioId);
    await client.mutate('organizations.updateOrganization', { id: scope.id, estateMode: 'open' });
    await drainSimulations(client);
    const open = await runScenario(client, scenarioId);

    const openWalked = open.run.estateAssetCount ?? null;
    const closedWalked = closed.run.estateAssetCount ?? null;
    if (openWalked === null || closedWalked === null) {
      recordRun({
        reading: 'not measured: the run row does not say what it walked',
        valueMs: null,
        budgetMs: null,
        status: 'skip',
      });
      return;
    }
    if (openWalked === closedWalked) {
      recordRun({
        reading: `not measured: both runs walked ${openWalked} assets, so the engine does not narrow by the scope's estate and the two readings price the same work`,
        valueMs: null,
        budgetMs: null,
        status: 'skip',
      });
      return;
    }

    const deltaMs = closed.ms - open.ms;
    const deltaPercent = round((deltaMs / open.ms) * 100);
    recordRun({
      budget: `<= the open-estate run (${round(open.ms / 1000)} s) + ${RUN_TOLERANCE_PERCENT}%`,
      reading: `${round(closed.ms / 1000)} s over ${closedWalked} assets against ${round(open.ms / 1000)} s over ${openWalked}, `
        + `${deltaMs >= 0 ? '+' : ''}${round(deltaMs / 1000)} s (${deltaPercent >= 0 ? '+' : ''}${deltaPercent}%)`
        + `; queue wait ${round(open.waitMs / 1000)} s open, ${round(closed.waitMs / 1000)} s closed`,
      valueMs: round(closed.ms),
      budgetMs: round(open.ms * RUN_TOLERANCE),
      status: closed.ms <= open.ms * RUN_TOLERANCE ? 'pass' : 'fail',
    });
  } catch (error) {
    recordRun({
      reading: `not measured: ${error.message}`,
      valueMs: null,
      budgetMs: null,
      status: 'fail',
    });
  } finally {
    await client.mutate('organizations.updateOrganization', { id: scope.id, estateMode: startingMode })
      .catch((error) => log(`  warn  the scope did not return to ${startingMode} mode: ${error.message}`));
  }
};

// === The report =============================================================================

const writeReport = ({ tenant, scope, estate, projection }) => {
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString();
  const tally = {
    pass: results.filter((entry) => entry.status === 'pass').length,
    skip: results.filter((entry) => entry.status === 'skip').length,
    fail: results.filter((entry) => entry.status === 'fail').length,
  };

  const projectionLine = projection.lastChange === null
    ? `Score projection: not probed (${projection.error ?? 'no database reachable'}).`
    : `Score projection: last written ${projection.lastChange}, ${projection.unscored} finding(s) with no score row. `
      + 'The seeder stamps every row with its finding\'s own state date, one to 240 days back, and the daily recompute overwrites them all with the instant it ran, '
      + 'so a stamp within minutes of the seed is the engine\'s work and a stamp months old is still the seeder\'s.';

  // A skipped measure is written in the conditional: read in the present tense it would claim the
  // script measured something it never ran.
  const detailOf = (entry) => (entry.status === 'skip'
    ? `Would measure: ${entry.detail.charAt(0).toLowerCase()}${entry.detail.slice(1)}`
    : entry.detail);

  const lines = [
    '# Estate performance report',
    '',
    `Run on ${stamp} against tenant \`${tenant.name}\`, scope \`${scope.name}\`.`,
    `Estate: ${estate.assets} assets in the tenant, ${scope.mappedAssetCount} mapped into the scope.`,
    `Findings: ${estate.applicableFindings} applicable in the tenant, ${estate.scopeFindings} of them inside the scope.`,
    projectionLine,
    `Budgets confirmed by the product owner on 2026-09-13. ${tally.pass} pass, ${tally.fail} fail, ${tally.skip} skipped, of ${results.length} measures.`,
    '',
    '| Measure | Budget | Reading | Verdict |',
    '| --- | --- | --- | --- |',
    ...results.map((entry) => `| ${entry.name} | ${entry.budget} | ${entry.reading} | ${entry.status.toUpperCase()} |`),
    '',
    '## What each measure is',
    '',
    ...results.map((entry) => `- **${entry.name}**: ${detailOf(entry)}`),
    '',
  ];

  writeFileSync(join(outDir, 'perf-report.md'), lines.join('\n'), 'utf8');
  writeFileSync(join(outDir, 'perf-report.json'), `${JSON.stringify({
    ranAt: stamp,
    tenant: { id: tenant.id, name: tenant.name },
    scope: { id: scope.id, name: scope.name, mappedAssetCount: scope.mappedAssetCount },
    estate,
    projection,
    repeats,
    tally,
    measures: results,
  }, null, 2)}\n`, 'utf8');
  log(`\n${tally.pass} pass, ${tally.fail} fail, ${tally.skip} skipped. Report written to ${join(outDir, 'perf-report.md')}`);
  return tally;
};

// === The pass ===============================================================================

const main = async () => {
  const config = readConfig();
  const client = await createClient(config);
  const { tenant, scope } = await findLargeEstate(client);
  client.setTenant(tenant.id);
  log(`Tenant ${tenant.name}, scope ${scope.name} (${scope.mappedAssetCount} assets mapped), ${repeats} calls per paginated measure.\n`);

  const firstPage = await client.query('supportingAssets.listSupportingAssets', {
    page: 1, limit: PICKER_PAGE_LIMIT, organizationId: null, membershipOrganizationId: scope.id, sortBy: 'mapped', sortDesc: true,
  });
  const tenantFindings = await client.query('findingScore.listScoredFindings', { page: 1, limit: 1, organizationId: null });
  // The scope's own total, never the tenant's: the Findings page inside a scope pages over what the
  // scope holds, and a page number taken from the tenant's count names pages that do not exist.
  const scopeFindings = await client.query('findingScore.listScoredFindings', { page: 1, limit: 1, organizationId: scope.id });
  const estate = { assets: firstPage.estateTotal, applicableFindings: tenantFindings.total, scopeFindings: scopeFindings.total };
  const projection = await probeProjection(config, tenant.id);

  /**
   * Pages in the last tenth of a range, a different one per sample. A modular stride over the whole
   * range reaches the first pages far more often than the last, and the deep pages are where the
   * sort spills to disk.
   */
  const lastDecile = (pages) => {
    const span = Math.max(1, Math.floor(pages * 0.1));
    const first = Math.max(1, Math.floor(pages * 0.9));
    const page = (index) => first + (index % span);
    const drawn = [...new Set(Array.from({ length: repeats + 1 }, (_, index) => page(index)))].sort((left, right) => left - right);
    const label = drawn.length === 1 ? `page ${drawn[0]}` : `pages ${drawn[0]} to ${drawn[drawn.length - 1]}`;
    return { page, label: `${label} of ${pages}` };
  };

  const pickerPages = Math.max(1, Math.ceil(estate.assets / PICKER_PAGE_LIMIT));
  const deep = lastDecile(pickerPages);
  const scopeAssets = lastDecile(Math.max(1, Math.ceil(scope.mappedAssetCount / PAGE_LIMIT)));
  const scopeFindingPages = lastDecile(Math.max(1, Math.ceil(estate.scopeFindings / PAGE_LIMIT)));

  const sampled = [];
  // One at a time: four of these at once put four parallel plans in flight, and the container's
  // shared memory is sized for a dev database rather than for this park.
  for (const page of [1, Math.ceil(pickerPages / 3), Math.ceil((pickerPages * 2) / 3), pickerPages]) {
    sampled.push(await client.query('supportingAssets.listSupportingAssets', { page, limit: PICKER_PAGE_LIMIT, organizationId: null }));
  }
  // Only names of the generated shape `<category>-<site>-<row>`, and only a prefix two sampled rows
  // share: a hand-written demo name reaches one row, and the picker's default order puts those first.
  const prefixCounts = new Map();
  for (const row of sampled.flatMap((result) => result.items)) {
    const prefix = /^([A-Z]{2,4})-\d+-\d+$/.exec(row.name ?? '')?.[1];
    if (prefix !== undefined) {
      prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
    }
  }
  const drawn = [...prefixCounts].filter(([, count]) => count > 1).map(([prefix]) => prefix);
  const searchTerms = drawn.length > 0 ? drawn : ['SRV'];
  const searchTerm = (index) => searchTerms[index % searchTerms.length];
  const searchMatches = [];
  for (const term of searchTerms) {
    const { total } = await client.query('supportingAssets.listSupportingAssets', { page: 1, limit: 1, organizationId: null, search: term });
    searchMatches.push(`${term} ${total}`);
  }

  await measurePage(
    'picker, first page',
    `listSupportingAssets, page 1 of ${pickerPages} of the tenant estate at the drawer's ${PICKER_PAGE_LIMIT} rows, mapped rows raised first: what the scope drawer opens on, and the one measure whose input cannot vary.`,
    () => client.query('supportingAssets.listSupportingAssets', {
      page: 1, limit: PICKER_PAGE_LIMIT, organizationId: null, membershipOrganizationId: scope.id, sortBy: 'mapped', sortDesc: true,
    }),
  );
  await measurePage(
    'picker, search',
    `listSupportingAssets searching the whole tenant estate under the drawer's plan, ${searchTerms.length} category prefixes drawn from the park's generated names, with the rows each one matches (${searchMatches.join(', ')}).`,
    (index) => client.query('supportingAssets.listSupportingAssets', {
      page: 1, limit: PICKER_PAGE_LIMIT, organizationId: null, search: searchTerm(index), membershipOrganizationId: scope.id, sortBy: 'mapped', sortDesc: true,
    }),
  );
  await measurePage(
    'picker, page change',
    `listSupportingAssets in the last tenth of the tenant estate, ${deep.label}, a different page per call.`,
    (index) => client.query('supportingAssets.listSupportingAssets', {
      page: deep.page(index), limit: PICKER_PAGE_LIMIT, organizationId: null, membershipOrganizationId: scope.id, sortBy: 'mapped', sortDesc: true,
    }),
  );
  await measurePage(
    'scope Assets page',
    `listSupportingAssets narrowed to the closed scope: the Assets page inside it, ${scopeAssets.label}, a different page per call.`,
    // Named rather than left to `pagedInput`, whose `sortDesc` defaults to true: the page sorts
    // by name ascending, and `name desc nulls last` is not a plan the estate's index answers the
    // same way.
    (index) => client.query('supportingAssets.listSupportingAssets', {
      page: scopeAssets.page(index), limit: PAGE_LIMIT, organizationId: scope.id, sortBy: 'name', sortDesc: false,
    }),
  );
  await measurePage(
    'scope Findings page',
    `listScoredFindings narrowed to the closed scope: the Findings page inside it, ${scopeFindingPages.label}, a different page per call.`,
    (index) => client.query('findingScore.listScoredFindings', {
      page: scopeFindingPages.page(index), limit: PAGE_LIMIT, organizationId: scope.id, sortBy: 'score', sortDesc: true,
    }),
  );
  await measurePage(
    'scope Findings tiles',
    'getFindingsPanelCounts on the closed scope: the live counts its header tiles read, one input by construction.',
    () => client.query('findingScore.getFindingsPanelCounts', { organizationId: scope.id }),
  );

  // Before the runs: a simulation holds the worker's thread, and a browser measure taken over one
  // reads the queue rather than the page.
  if (flag('--skip-map')) {
    skipMap('not measured: --skip-map');
  } else {
    await measureMap({ frontend: config.frontend, cookie: client.cookie, tenantId: tenant.id, scopeId: scope.id });
  }

  const scenarios = await client.query('riskScenarios.getRiskScenariosOverview', { organizationId: scope.id });
  const skipRuns = (reading) => recordRun({ reading, valueMs: null, budgetMs: null, status: 'skip' });

  if (flag('--skip-runs')) {
    skipRuns('not measured: --skip-runs');
  } else if (scenarios.length === 0) {
    skipRuns('not measured: the scope has no scenario to price');
  } else {
    await measureScopedRun(client, scope, scenarios[0].id);
  }

  const tally = writeReport({ tenant, scope, estate, projection });
  process.exit(tally.fail > 0 ? 1 : (tally.skip > 0 ? 2 : 0));
};

await main();

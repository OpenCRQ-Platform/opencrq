import type { AddressInfo } from 'node:net';
import type { FakeOpenaev, FakeOpenaevRequest } from './fake-openaev';
import { createServer } from 'node:http';
import { startFakeOpenaev } from './fake-openaev';

/** What a test says about one expectation of an exercise; the rest of the wire shape is filled in. */
export interface LegacyExpectationInput {
  assetId: string,
  /** MITRE external id, e.g. `T1003`; the inject the expectation names carries exactly this one. */
  technique: string,
  expectationType?: 'DETECTION' | 'PREVENTION',
  /** The verdict each security platform type reported, against an expected score of 100. */
  results: ReadonlyArray<{ platform: string, score: number }>,
}

export interface LegacyExerciseInput {
  id: string,
  /** `null` for a simulation that belongs to no scenario. */
  scenarioId: string | null,
  updatedAt: Date,
  expectations: ReadonlyArray<LegacyExpectationInput>,
}

export interface LegacyFindingInput {
  id: string,
  assetId: string,
  cve: string,
  updatedAt: Date,
}

export interface FakeOpenaevLegacy {
  url: string,
  token: string,
  /** The OpenAEV behind this one: its tenants, inventory and snapshot streams. */
  openaev: FakeOpenaev,
  /** The status the snapshot routes answer with: 404 while `BULK_SNAPSHOT_EXPORT` is off, 200 to serve the streams, 403 for an account without the capability. */
  setSnapshotStatus: (status: 200 | 403 | 404) => void,
  /** Replaces the finished exercises an OpenAEV tenant lists. */
  setExercises: (openaevTenantId: string, exercises: Array<LegacyExerciseInput>) => void,
  /** Replaces the findings an OpenAEV tenant lists. */
  setFindings: (openaevTenantId: string, findings: Array<LegacyFindingInput>) => void,
  /** Every request received, those served by the OpenAEV behind included. */
  requests: Array<FakeOpenaevRequest>,
  requestsTo: (method: string, route: string, tenantId?: string) => Array<FakeOpenaevRequest>,
  close: () => Promise<void>,
}

interface Answer {
  status: number,
  body: unknown,
}

const TENANT_ROUTE = /^\/api\/tenants\/([^/]+)(\/.*)$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const injectIdOf = (technique: string): string => `inject-${technique}`;

const pageOf = <T>(content: Array<T>, request: unknown) => {
  const body = isRecord(request) ? request : {};
  const page = typeof body['page'] === 'number' ? body['page'] : 0;
  const size = typeof body['size'] === 'number' ? body['size'] : 100;
  const totalPages = Math.max(1, Math.ceil(content.length / size));
  return {
    content: content.slice(page * size, (page + 1) * size),
    totalElements: content.length,
    totalPages,
    number: page,
    size,
    last: page >= totalPages - 1,
  };
};

/**
 * A fake OpenAEV that serves the routes of the connector's exercise loop and CVE findings search
 * next to those of `startFakeOpenaev`, which it fronts: a request it has no answer for goes to that
 * fake unchanged. The snapshot routes answer with the status a test chooses, 404 until it says
 * otherwise, as an OpenAEV does while its `BULK_SNAPSHOT_EXPORT` preview feature is off.
 */
export const startFakeOpenaevLegacy = async (): Promise<FakeOpenaevLegacy> => {
  const openaev = await startFakeOpenaev();
  const exercises = new Map<string, Array<LegacyExerciseInput>>();
  const findings = new Map<string, Array<LegacyFindingInput>>();
  const requests: Array<FakeOpenaevRequest> = [];
  let snapshotStatus: 200 | 403 | 404 = 404;

  const answerFor = (method: string, openaevTenantId: string, subPath: string, body: unknown): Answer | null => {
    const tenantExercises = exercises.get(openaevTenantId) ?? [];
    if (subPath.startsWith('/snapshot/') && snapshotStatus !== 200) {
      return { status: snapshotStatus, body: { message: snapshotStatus === 404 ? 'not found' : 'forbidden' } };
    }
    if (method === 'POST' && subPath === '/exercises/search') {
      const sorted = [...tenantExercises].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      return {
        status: 200,
        body: pageOf(sorted.map((exercise) => ({
          exercise_id: exercise.id,
          exercise_name: `Exercise ${exercise.id}`,
          exercise_status: 'FINISHED',
          exercise_updated_at: exercise.updatedAt.toISOString(),
        })), body),
      };
    }
    const exerciseRoute = method === 'GET' ? /^\/exercises\/([^/]+)(\/expectations)?$/.exec(subPath) : null;
    if (exerciseRoute !== null) {
      const exercise = tenantExercises.find((candidate) => candidate.id === exerciseRoute[1]);
      if (exercise === undefined) {
        return { status: 404, body: { message: `no such exercise ${exerciseRoute[1]}` } };
      }
      if (exerciseRoute[2] === undefined) {
        return { status: 200, body: { exercise_id: exercise.id, exercise_scenario: exercise.scenarioId } };
      }
      return {
        status: 200,
        body: exercise.expectations.map((expectation, index) => ({
          inject_expectation_id: `${exercise.id}-exp-${index}`,
          inject_expectation_type: expectation.expectationType ?? 'DETECTION',
          inject_expectation_status: expectation.results.some((result) => result.score >= 100) ? 'SUCCESS' : 'FAILED',
          inject_expectation_inject: injectIdOf(expectation.technique),
          inject_expectation_asset: expectation.assetId,
          inject_expectation_score: Math.max(...expectation.results.map((result) => result.score)),
          inject_expectation_expected_score: 100,
          inject_expectation_results: expectation.results.map((result) => ({ sourcePlatform: result.platform, score: result.score })),
        })),
      };
    }
    const scenarioId = method === 'GET' ? /^\/scenarios\/([^/]+)$/.exec(subPath)?.[1] : undefined;
    if (scenarioId !== undefined) {
      return { status: 200, body: { scenario_id: scenarioId, scenario_name: `Scenario ${scenarioId}` } };
    }
    const injectId = method === 'GET' ? /^\/injects\/([^/]+)$/.exec(subPath)?.[1] : undefined;
    if (injectId !== undefined) {
      const technique = injectId.replace(/^inject-/, '');
      return {
        status: 200,
        body: {
          inject_id: injectId,
          inject_title: `Inject ${technique}`,
          inject_attack_patterns: [{ attack_pattern_id: `ap-${technique}`, attack_pattern_external_id: technique }],
        },
      };
    }
    if (method === 'POST' && subPath === '/findings/search') {
      const sorted = [...(findings.get(openaevTenantId) ?? [])].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      return {
        status: 200,
        body: pageOf(sorted.map((finding) => ({
          finding_id: finding.id,
          finding_type: 'cve',
          finding_value: finding.cve,
          finding_updated_at: finding.updatedAt.toISOString(),
          finding_assets: [{ asset_id: finding.assetId }],
        })), body),
      };
    }
    return null;
  };

  const forward = async (method: string, pathAndQuery: string, authorization: string | undefined, rawBody: string): Promise<Answer> => {
    const response = await fetch(`${openaev.url}${pathAndQuery}`, {
      method,
      headers: { 'content-type': 'application/json', ...(authorization === undefined ? {} : { authorization }) },
      ...(rawBody === '' ? {} : { body: rawBody }),
    });
    const text = await response.text();
    return { status: response.status, body: text === '' ? null : JSON.parse(text) };
  };

  const server = createServer((req, res) => {
    const chunks: Array<Buffer> = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      void (async () => {
        const method = req.method ?? 'GET';
        const url = new URL(req.url ?? '/', 'http://fake-openaev');
        const rawBody = Buffer.concat(chunks).toString('utf8');
        const body: unknown = rawBody === '' ? null : JSON.parse(rawBody);
        const match = TENANT_ROUTE.exec(url.pathname);
        requests.push({
          method,
          route: match === null ? url.pathname : (match[2] ?? url.pathname),
          tenantId: match?.[1] ?? null,
          body,
          cursor: isRecord(body) && typeof body['cursor'] === 'string' ? body['cursor'] : null,
        });
        const authorized = req.headers.authorization === `Bearer ${openaev.token}`;
        const own = authorized && match?.[1] !== undefined && match[2] !== undefined ? answerFor(method, match[1], match[2], body) : null;
        const answer = own ?? await forward(method, `${url.pathname}${url.search}`, req.headers.authorization, rawBody);
        res.writeHead(answer.status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(answer.body));
      })();
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a listening TCP server always reports an AddressInfo
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        token: openaev.token,
        openaev,
        setSnapshotStatus: (status) => {
          snapshotStatus = status;
        },
        setExercises: (openaevTenantId, next) => {
          exercises.set(openaevTenantId, next);
        },
        setFindings: (openaevTenantId, next) => {
          findings.set(openaevTenantId, next);
        },
        requests,
        requestsTo: (method, route, tenantId) => requests.filter((request) =>
          request.method === method && request.route === route && (tenantId === undefined || request.tenantId === tenantId)),
        close: async () => {
          await new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          });
          await openaev.close();
        },
      });
    });
  });
};

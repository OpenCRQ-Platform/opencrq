import { FEATURE_FLAGS } from '@app/utils';
import { z } from 'zod';
import { isRecord } from './utils/utils';

export const MAX_RESPONSE_ITEMS_DEFAULT = 20_000;

const withEnabledToggle = <T extends z.ZodObject>(schema: T) =>
  z.discriminatedUnion('enabled', [
    schema.partial().extend({ enabled: z.literal(false) }),
    schema.extend({ enabled: z.literal(true) }),
  ]);

const requiredXtmOneSetting = (envVar: string) => {
  const message = `XTM One is required: set ${envVar}`;
  // nconf's `parseValues` turns an all-digit or `true`/`false` value into a number or a boolean.
  return z.string({
    error: (issue) => (issue.input === undefined
      ? message
      : `${envVar} was read as a ${typeof issue.input}: all-digit and true/false values are converted, use a value with other characters`),
  })
    .trim()
    .min(1, message);
};

/** `setTimeout` holds its delay in a 32-bit int and silently falls back to 1 ms past it. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export const WORKER_HEARTBEAT_INTERVAL_MS = 10_000;
export const WORKER_HEARTBEAT_STALE_AFTER_MS = 30_000;
// Kept below the registry's hour-long retention, past which a live worker's row is pruned by its
// peers between two beats.
const WORKER_HEARTBEAT_MAX_INTERVAL_MS = 300_000;

// Carried by both branches: a deployment with the runtime disabled still answers the liveness question.
const heartbeatKeys = {
  heartbeat_interval_ms: z.coerce.number().int().positive().max(WORKER_HEARTBEAT_MAX_INTERVAL_MS)
    .default(WORKER_HEARTBEAT_INTERVAL_MS),
  heartbeat_stale_after_ms: z.coerce.number().int().positive()
    .default(WORKER_HEARTBEAT_STALE_AFTER_MS),
};

// Chosen to cover a failure and the two runs before it.
export const JOB_LOG_RETENTION_RUNS = 3;
export const STREAM_LOG_RETENTION_LINES = 500;

// Held here rather than read from the domain module: config is parsed at boot by every process,
// and reaching into that barrel for one number loads the whole schema and service registry with it.
const SCORE_HISTORY_RETENTION_DAYS = 365;

// Carried by both branches: the reader runs in a process whose own job runtime may be disabled.
const logRetentionKeys = {
  log_retention_runs: z.coerce.number().int().positive().default(JOB_LOG_RETENTION_RUNS),
  log_retention_lines: z.coerce.number().int().positive().default(STREAM_LOG_RETENTION_LINES),
};

// Large by design: growth has never caused a problem, so nothing here should delete too eagerly.
export const JOB_RUN_RETENTION_DAYS = 30;

// Carried by both branches: the reader runs in a process whose own job runtime may be disabled.
const runRetentionKeys = {
  run_retention_days: z.coerce.number().int().positive().default(JOB_RUN_RETENTION_DAYS),
};

// Only a JSON config file hands this key a real array. `FEATURE_FLAGS=a,b` arrives as a plain
// string, and `FEATURE_FLAGS__0=a` as `{ 0: 'a' }`, because nconf's `__` separator builds a nested
// object and never an array. All three are normalised to a list here, so the enum below rejects a
// genuinely unknown name rather than the spelling it was configured with. Only the numeric keys
// nconf builds are taken as a list, so a misshapen object is still reported as a wrong shape.
const toFlagList = (raw: unknown): unknown => {
  if (typeof raw === 'string') {
    return raw.split(',').map((flag) => flag.trim()).filter((flag) => flag.length > 0);
  }
  return isRecord(raw) && Object.keys(raw).every((key) => /^\d+$/.test(key)) ? Object.values(raw) : raw;
};

// A transport switched off reads none of its settings: their names are checked, their values are not,
// so an empty destination left beside `enabled: false` still boots.
const switchedOff = (fields: z.ZodObject) => z.strictObject({
  enabled: z.literal(false),
  ...Object.fromEntries(Object.keys(fields.shape).map((key) => [key, z.unknown().optional()])),
});

// An empty destination would parse, and the exporter would then dial its own default target.
const otlpSignalFields = z.strictObject({
  exporter: z.string().min(1),
});

const otlpSignal = z.discriminatedUnion('enabled', [
  switchedOff(otlpSignalFields),
  otlpSignalFields.extend({ enabled: z.literal(true) }),
]).default({ enabled: false });

const pyroscopeFields = z.strictObject({
  server_address: z.string().min(1),
});

const prometheusFields = z.strictObject({
  // 14269 is OpenCTI's documented default for the same endpoint
  port: z.coerce.number().int().min(1).max(65535).default(14269),
  public_port: z.coerce.number().int().min(1).max(65535).optional(),
  host: z.string().min(1).default('0.0.0.0'),
  collect_timeout_ms: z.coerce.number().int().positive().default(2_500),
  round_deadline_ms: z.coerce.number().int().positive().default(4_500),
  min_interval_ms: z.coerce.number().int().positive().default(5_000),
  max_reply_bytes: z.coerce.number().int().positive().default(2 * 1024 * 1024),
});

export const featureConfigs = {
  // Development feature flags, off by default and named from the closed `FEATURE_FLAGS` registry:
  // an unknown name fails the boot parse instead of being silently ignored. `'*'` turns every flag
  // on at once.
  feature_flags: z.preprocess(toFlagList, z.array(z.enum(FEATURE_FLAGS))),

  // Process Manager
  healthcheck_http_server: z.object({
    port: z.coerce.number(),
    public_port: z.coerce.number().optional(),
  }),

  // Strict at every level: an unknown key fails the boot parse instead of being dropped, which
  // would silently turn its transport off.
  telemetry: z.strictObject({
    // Anonymous usage statistics sent to Filigran (docs/deployment/usage-telemetry.md).
    usage: z.strictObject({
      enabled: z.boolean().default(true),
      // Comma-separated deployment tags (e.g. "saas,eu-west"), normalized and exported as the
      // `filigran.telemetry.tags` resource attribute.
      tags: z.string().default(''),
    }).prefault({}),
    observability: z.strictObject({
      // OpenTelemetry `service.name` of every OTLP signal and the Prometheus endpoint, and the
      // Pyroscope application name.
      service_name: z.string().min(1).default('opencrq-platform'),
      otlp: z.strictObject({
        traces: otlpSignal,
        metrics: otlpSignal,
        logs: otlpSignal,
      }).prefault({}),
      prometheus: z.discriminatedUnion('enabled', [
        switchedOff(prometheusFields),
        prometheusFields.extend({ enabled: z.literal(true) })
          .refine(({ collect_timeout_ms, round_deadline_ms }) => collect_timeout_ms < round_deadline_ms, {
            error: 'collect_timeout_ms must be strictly below round_deadline_ms',
            path: ['collect_timeout_ms'],
          }),
      ]).default({ enabled: false }),
      pyroscope: z.discriminatedUnion('enabled', [
        switchedOff(pyroscopeFields),
        pyroscopeFields.extend({ enabled: z.literal(true) }),
      ]).default({ enabled: false }),
    }).prefault({}),
  }),

  // Processes
  postgres: z.object({
    database: z.string(),
    user: z.string(),
    host: z.string(),
    port: z.coerce.number(),
    password: z.string(),
    pool_max: z.coerce.number().min(10).default(20),
  }),

  http_server: z.object({
    host: z.string(),
    port: z.coerce.number(),
    public_port: z.coerce.number().optional(),
    max_response_items: z.coerce.number().int().min(1).default(MAX_RESPONSE_ITEMS_DEFAULT),
  }),

  front_path: z.string().optional(),

  platform: z.object({
    reset_on_version_change: z.boolean().default(false),
  }),

  // The id is configurable because connector configuration is keyed by tenant id and must be
  // writable before the first boot.
  initial_tenant: z.object({
    id: z.uuid().default('01a043da-ff47-72c2-aaa4-7da56d85c83e'),
    name: z.coerce.string().trim().min(1).default('Default'),
  }),

  platform_seed: withEnabledToggle(z.object({
    admin: z.object({
      email: z.string(),
      password: z.string(),
    }),
    // A plain object rather than a toggled union: the sizes carry defaults of their own, so a
    // deployment that sets one and forgets `enabled` is ignored instead of failing to boot.
    large_estate: z.object({
      enabled: z.boolean().default(false),
      assets: z.coerce.number().int().positive().default(100_000),
      findings: z.coerce.number().int().nonnegative().default(300_000),
      mapped_assets: z.coerce.number().int().nonnegative().default(30_000),
    }).prefault({}),
    // An administrator of the XTM One in `xtm_one.url`, which the seed signs in as to create its users
    // there. Optional to the parse so its absence fails the seed alone, with a message, and not the boot.
    xtm_one_admin: z.object({
      email: z.string(),
      password: z.string(),
    }).optional(),
  })),

  // File storage (RustFS/S3-compatible) is optional deployment-level configuration — when the
  // `file_storage` block is entirely absent, the feature is disabled at boot (no crash). When
  // present, endpoint/access_key/secret_key are mandatory: an incomplete block is a hard
  // configuration error caught by Zod at `config()` parse time. Env vars: FILE_STORAGE__ENDPOINT,
  // FILE_STORAGE__ACCESS_KEY, FILE_STORAGE__SECRET_KEY, FILE_STORAGE__BUCKET, FILE_STORAGE__REGION.
  file_storage: z.object({
    endpoint: z.string(),
    access_key: z.string(),
    secret_key: z.string(),
    bucket: z.string().default('opencrq'),
    region: z.string().default('eu-west-3'),
  }),

  // Inlined (not via withEnabledToggle) because the generic wrapper collapses
  // the discriminated-union literal types in Zod v4, leaving consumers with
  // `any`-typed fields after the `if (jobs.enabled)` narrowing.
  jobs: z.discriminatedUnion('enabled', [
    z.object({
      enabled: z.literal(false),
      max_concurrent: z.coerce.number().optional(),
      polling_fallback_ms: z.coerce.number().optional(),
      ...heartbeatKeys,
      ...logRetentionKeys,
      ...runRetentionKeys,
    }),
    z.object({
      enabled: z.literal(true),
      max_concurrent: z.coerce.number().default(4),
      polling_fallback_ms: z.coerce.number().default(30_000),
      ...heartbeatKeys,
      ...logRetentionKeys,
      ...runRetentionKeys,
    }),
  ]).superRefine((jobs, ctx) => {
    if (jobs.heartbeat_stale_after_ms <= jobs.heartbeat_interval_ms) {
      ctx.addIssue({
        code: 'custom',
        path: ['heartbeat_stale_after_ms'],
        message: 'heartbeat_stale_after_ms must exceed heartbeat_interval_ms, or a live worker reads as absent between two beats',
      });
    }
  }),

  // Throttle of the change-driven recompute dispatcher: the first event of a burst books the run
  // clamp(factor x last run duration, floor, cap) later, and every event until then folds into it,
  // so a kind runs at most once per delay however fast its tables are written.
  recompute: z.object({
    debounce_factor: z.coerce.number().positive().default(1),
    debounce_floor_ms: z.coerce.number().int().positive().default(500),
    debounce_cap_ms: z.coerce.number().int().positive().default(300_000),
    // A LISTEN reconnect asks every routed job for every tenant, so two catch-ups closer than
    // this are one.
    reconnect_min_interval_ms: z.coerce.number().int().positive().default(600_000),
    // `HH:MM` UTC, the day boundary being caught itself UTC. Tenants are spread across the hour
    // that follows it, so a tenant's run starts at its own instant inside that hour.
    daily_at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'daily_at must be HH:MM on a 24-hour UTC clock').default('03:00'),
    // Trimmed at the end of each run, and never below the line in force when the window opens.
    score_history_retention_days: z.coerce.number().int().positive().default(SCORE_HISTORY_RETENTION_DAYS),
  }),

  // A doorbell tells every connected client of a tenant to refetch, so a bulk write would ring
  // once per window for its whole duration. Writes carrying a job origin get their own, much
  // coarser window.
  events: z.object({
    doorbell_window_ms: z.coerce.number().int().positive().max(MAX_TIMER_DELAY_MS).default(100),
    job_doorbell_window_ms: z.coerce.number().int().positive().max(MAX_TIMER_DELAY_MS).default(30_000),
  }),

  // Each connector is a map keyed by tenant UUID (`CONNECTORS__<NAME>__<tenant-uuid>__<field>`
  // env vars), never a single deployment-wide credential: two tenants can point the same
  // connector at different accounts/instances.
  connectors: z.object({
    nist: z.record(z.uuid(), z.object({
      api_key: z.string().optional(),
    })).optional(),
    microsoft_graph: z.record(z.uuid(), z.object({
      azure_tenant_id: z.string(),
      client_id: z.string(),
      client_secret: z.string(),
    })).optional(),
    openaev: z.record(z.uuid(), z.object({
      url: z.url(),
      token: z.string(),
    })).optional(),
    opencti: z.record(z.uuid(), z.object({
      url: z.url(),
      token: z.string(),
    })).optional(),
    // The folder Default Threats reads its file from: OpenCRQ's dataset repository unless set, a
    // mirror on an air-gapped platform, or empty to turn the connector off for every tenant.
    default_threats: z.object({
      dataset_url: z.union([z.url(), z.literal('')]).optional(),
    }).optional(),
    drata: z.record(z.uuid(), z.object({
      url: z.url().default('https://public-api.drata.com'),
      api_key: z.string(),
      // Drata workspace to read; accounts without Multiple Product Support always use workspace 1.
      workspace_id: z.coerce.number().default(1),
    })).optional(),
  }).optional(),

  // The deployment's bootstrap admin token (APP__ADMIN__TOKEN, a UUIDv4), the counterpart of
  // OpenCTI's APP__ADMIN__TOKEN and OpenAEV's OPENAEV_ADMIN_TOKEN: it authenticates the
  // provisioning API (`/api/xtm/peer-tokens`) a deployment manager calls to give a sibling product a
  // service account here. Unset, that API answers 404.
  // nconf splits env names on `__`: APP__ADMIN__TOKEN is `app.admin.token`.
  app: z.object({
    admin: z.object({
      token: z.uuid({ version: 'v4' }).optional(),
    }).prefault({}),
  }),

  // The sibling XTM products of this deployment, for the product switcher (XTM__OPENCTI_URL,
  // XTM__OPENAEV_URL). A URL only: the connections themselves are `connectors.<name>.<tenant>`.
  xtm: z.object({
    opencti_url: z.url().optional(),
    openaev_url: z.url().optional(),
  }),

  // XTM One (Filigran agentic AI platform) integration: the platform registers itself with XTM One
  // (heartbeat every 5 minutes), publishes an Ed25519 JWKS for cross-platform authentication, and
  // proxies the embedded "Ask Ariane" chat, and signs the users in. Required in every build. Env vars: XTM_ONE__URL, XTM_ONE__TOKEN, XTM_ONE__PLATFORM_URL, and XTM_ONE__ENABLED if
  // set must be true - XTM One can no longer be turned off.
  xtm_one: z.object({
    enabled: z.literal(true, { error: 'XTM_ONE__ENABLED can no longer disable XTM One: remove it, or set it to true' }).optional(),
    // XTM One base URL (e.g. https://xtm-one.example.com).
    url: requiredXtmOneSetting('XTM_ONE__URL'),
    // Shared platform registration token (PLATFORM_REGISTRATION_TOKEN on
    // the XTM One side).
    token: requiredXtmOneSetting('XTM_ONE__TOKEN'),
    // Public base URL of THIS OpenCRQ instance - used as the JWT issuer,
    // the JWKS audience, and the platform_url sent at registration.
    platform_url: requiredXtmOneSetting('XTM_ONE__PLATFORM_URL'),
  }, { error: 'XTM One is required: set XTM_ONE__URL, XTM_ONE__TOKEN and XTM_ONE__PLATFORM_URL' }),
};

// --- PARTIALS & ROOT ---
const partialConfigSchema = z.object({
  postgres: featureConfigs.postgres.partial().optional(),
  http_server: featureConfigs.http_server.partial().optional(),
  front_path: featureConfigs.front_path.optional(),
  jobs: featureConfigs.jobs.optional(),
});

export const configSchema = z.object({
  healthcheck_http_server: featureConfigs.healthcheck_http_server,
  postgres: featureConfigs.postgres.optional(),
  http_server: featureConfigs.http_server.optional(),
  front_path: featureConfigs.front_path.optional(),
  platform: featureConfigs.platform.optional(),
  platform_seed: featureConfigs.platform_seed.optional(),
  initial_tenant: featureConfigs.initial_tenant.prefault({}),
  telemetry: featureConfigs.telemetry.optional(),
  jobs: featureConfigs.jobs.optional(),
  recompute: featureConfigs.recompute.prefault({}),
  events: featureConfigs.events.prefault({}),
  connectors: featureConfigs.connectors.optional(),
  app: featureConfigs.app.prefault({}),
  xtm: featureConfigs.xtm.prefault({}),
  xtm_one: featureConfigs.xtm_one,
  file_storage: featureConfigs.file_storage.optional(),
  feature_flags: featureConfigs.feature_flags.default([]),

  process_manager: z.object({
    profile: z.string(),
    heartbeat_timeout: z.coerce.number(),
  }).catchall(
    z.record(z.string(),
      partialConfigSchema.and(z.object({
        script: z.string(),
        memory: z.coerce.number(),
      }))),
  ),
});

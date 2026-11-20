// Tables excluded from the data_changed doorbell. `sessions` churns constantly and clients never
// read it (revocation has its own channel); `platform_metadata` holds deployment keys only the
// server reads, never a client query; `workers` is rewritten on a few-second heartbeat and
// `job_logs` takes a row per captured log line, while the doorbell invalidates every client's whole
// query cache on each event; `job_dependencies` is rewritten row by row on every observed run, and
// only the dispatcher reads it, from its own load at start.
export const TABLES_WITHOUT_DATA_CHANGED_TRIGGER = new Set(['sessions', 'platform_metadata', 'workers', 'job_logs', 'job_dependencies']);

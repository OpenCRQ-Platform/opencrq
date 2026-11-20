// Confidence a claim is read at when its producer states none, in the same 0-100 unit as the gate.
// It sits on the default gate deliberately: a catalogue that states a confidence nowhere, which is
// every MITRE ATT&CK bundle, would otherwise import cleanly and be read by nothing.
export const DEFAULT_RELATION_CONFIDENCE = 60;

// Ten columns per anchor row, held well under Postgres' 65 535 bind parameters per statement.
export const ACTIVITY_ANCHOR_CHUNK_SIZE = 1000;

// Five columns per outcome-score row, so a batch of `LIST_PROJECTION_BATCH_SIZE` analyses times
// the outcome catalogue's size stays well under Postgres' 65 535 bind parameters per statement
// however far the catalogue grows, rather than only at today's seven curated outcomes.
export const OUTCOME_SCORE_UPSERT_CHUNK_SIZE = 5000;

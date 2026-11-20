// Reference seeders run on every boot and in every integration-test global setup, so they upsert in
// chunked multi-row statements instead of one statement per row.
const CHUNK_SIZE = 500;

export const chunk = <T>(rows: ReadonlyArray<T>, size: number = CHUNK_SIZE): Array<Array<T>> => {
  const chunks: Array<Array<T>> = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
};

// Postgres rejects a multi-row `ON CONFLICT DO UPDATE` carrying the same conflict key twice
// ("cannot affect row a second time"), so keys are deduplicated before batching. Last row wins,
// but a duplicate in vendored data is almost certainly a generator bug, hence the warning.
export const dedupeBy = <T>(rows: ReadonlyArray<T>, key: (row: T) => string): Array<T> => {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    byKey.set(key(row), row);
  }
  if (byKey.size !== rows.length) {
    // eslint-disable-next-line no-console
    console.warn(`[seed] dropped ${rows.length - byKey.size} duplicate conflict key(s) before batching`);
  }
  return [...byKey.values()];
};

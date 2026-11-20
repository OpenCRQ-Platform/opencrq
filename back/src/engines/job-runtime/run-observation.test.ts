import { schema } from '@app/module';
import { describe, expect, it } from 'vitest';
import { createRunObservation } from './run-observation';

describe('run observation', () => {
  it('should hand the handler a Drizzle instance whose statements are EXPLAINed on the pool', async () => {
    const queries: Array<string> = [];
    // Drizzle sends a prepared-query object, the recorder's EXPLAIN a plain string.
    const fakePool = {
      query: (query: string | { text: string }) => {
        const sqlText = typeof query === 'string' ? query : query.text;
        queries.push(sqlText);
        return Promise.resolve({
          rows: sqlText.startsWith('EXPLAIN')
            ? [{ 'QUERY PLAN': [{ Plan: { 'Node Type': 'Seq Scan', 'Relation Name': 'cve' } }] }]
            : [],
          rowCount: 0,
        });
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- minimal fake; drizzle only calls query()
    const observation = createRunObservation(fakePool as never);
    await observation.db.select({ id: schema.cve.id }).from(schema.cve);
    const resolved = await observation.recorder.resolve();

    expect(queries.filter((sqlText) => !sqlText.startsWith('EXPLAIN'))).toHaveLength(1);
    expect(queries.find((sqlText) => !sqlText.startsWith('EXPLAIN'))).toContain('"cve"');
    expect(queries.some((sqlText) => sqlText.startsWith('EXPLAIN (FORMAT JSON) ') && sqlText.includes('"cve"'))).toBe(true);
    expect(resolved.reads).toEqual(['cve']);
  });
});

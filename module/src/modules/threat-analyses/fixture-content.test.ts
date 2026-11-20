import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__');

const fixtureBundleSchema = z.object({
  objects: z.array(z.object({
    id: z.string(),
    type: z.string(),
    source_ref: z.string().optional(),
    target_ref: z.string().optional(),
    identity_class: z.string().optional(),
    description: z.string().nullish(),
  })),
});

const fixtureObjects = () => readdirSync(fixturesDir)
  .filter((name) => name.endsWith('.json'))
  .flatMap((name) => fixtureBundleSchema
    .parse(JSON.parse(readFileSync(join(fixturesDir, name), 'utf8')))
    .objects.map((object) => ({ file: name, object })));

describe('threat bundle fixtures', () => {
  it('should hold no indicator and no relationship to one', () => {
    const offenders = fixtureObjects()
      .filter(({ object }) => object.type === 'indicator'
        || [object.source_ref, object.target_ref].some((ref) => ref?.startsWith('indicator--')))
      .map(({ file, object }) => `${file}: ${object.id}`);

    expect(
      offenders,
      'Indicators come from third-party feeds whose terms cannot be checked, and no test reads one: a re-export from OpenCTI brings them back, so strip them before committing it.',
    ).toEqual([]);
  });

  it('should give no organization identity a description', () => {
    const offenders = fixtureObjects()
      .filter(({ object }) => object.type === 'identity' && object.identity_class === 'organization' && object.description)
      .map(({ file, object }) => `${file}: ${object.id}`);

    expect(
      offenders,
      'Producer names are redacted in the fixtures, and a producer description says who the producer is: set it to null.',
    ).toEqual([]);
  });
});

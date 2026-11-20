import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestSequencer, TestSpecification, Vitest } from 'vitest/node';

const DURATIONS_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'test-durations.json',
);

type Weighted = { spec: TestSpecification, key: string, ms: number };

const readDurations = (): Record<string, number> => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(DURATIONS_FILE, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) => (typeof value === 'number' ? [[key, value]] : [])),
    );
  } catch {
    return {};
  }
};

const median = (values: Array<number>): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const byDurationDesc = (a: Weighted, b: Weighted): number => b.ms - a.ms || (a.key < b.key ? -1 : 1);

/**
 * Splits the suite by measured duration instead of by file count.
 *
 * `vitest --shard` slices a path-sorted list into equal counts, which left the slowest shard 45%
 * longer than the fastest one and put that difference straight on the CI critical path. Durations
 * come from `test-durations.json`; a file missing from it weighs the median, so a new test spreads
 * sanely until the file is refreshed.
 */
export class DurationBalancedSequencer implements TestSequencer {
  private readonly ctx: Vitest;

  constructor(ctx: Vitest) {
    this.ctx = ctx;
  }

  private weigh(specs: Array<TestSpecification>): Array<Weighted> {
    const durations = readDurations();
    const fallback = median(Object.values(durations));
    return specs.map((spec) => {
      const key = path.relative(this.ctx.config.root, spec.moduleId).split(path.sep).join('/');
      return { spec, key, ms: durations[key] ?? fallback };
    });
  }

  // Longest-processing-time bin packing: hand each file, slowest first, to the shard that is
  // currently the emptiest.
  shard(specs: Array<TestSpecification>): Promise<Array<TestSpecification>> {
    const shard = this.ctx.config.shard;
    if (!shard) {
      return Promise.resolve(specs);
    }
    const bins = Array.from({ length: shard.count }, () => ({
      load: 0,
      specs: new Array<TestSpecification>(),
    }));
    for (const { spec, ms } of this.weigh(specs).sort(byDurationDesc)) {
      const lightest = bins.reduce((min, bin) => (bin.load < min.load ? bin : min));
      lightest.load += ms;
      lightest.specs.push(spec);
    }
    return Promise.resolve(bins[shard.index - 1]?.specs ?? []);
  }

  // Starting the long files first keeps the workers busy to the end of the shard.
  sort(specs: Array<TestSpecification>): Promise<Array<TestSpecification>> {
    return Promise.resolve(
      this.weigh(specs)
        .sort(byDurationDesc)
        .map(({ spec }) => spec),
    );
  }
}

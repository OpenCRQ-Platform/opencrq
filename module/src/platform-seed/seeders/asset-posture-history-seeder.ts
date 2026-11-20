import { and, asc, eq, inArray } from 'drizzle-orm';
import type { EvidenceState } from '../../modules/supporting-assets/schema';
import { createPrng, deriveSeed } from '../../modules/crq-indicators/engine/prng';
import { resolveSeverityBand } from '../../modules/finding-score/bands';
import { assetPostureHistory } from '../../modules/finding-score/schema';
import { cve } from '../../modules/cve/schema';
import { assetEvidence, assetEvidenceHistory } from '../../modules/supporting-assets/schema';
import { assetPostureHistoryId, Tenant_Acme } from '../data/ids';
import { registerPlatformSeed } from '../platform-seed-registry';

/** Its 6 months are full and its 12 months are not, and it holds most of the seeded dismissals. */
const FRAME_DAYS = 300;

/** Every third asset loses its posture between these days ago, so a break shows in the card's default window. */
const GAP_FROM_DAYS_AGO = 40;
const GAP_UNTIL_DAYS_AGO = 30;

/** A finding dismissed within this many days is preferred as the worst one, so its dismissal reads as a resolution. */
const RESOLUTION_LEAD_DAYS = 30;

/** One asset in seven changes only over today's last few hours, and another is left to the first recompute's single line. */
const HOURS_ONLY_EVERY = 7;
const HOURS_ONLY_REMAINDER = 3;
const SINGLE_LINE_REMAINDER = 5;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const clampScore = (value: number): number => Math.min(Math.max(Math.round(value), 0), 100);

const WALK_FLOOR = 20;
const WALK_CEILING = 92;

interface SeedFinding {
  id: string,
  epss: number,
  /** Oldest first. */
  states: Array<{ at: number, state: EvidenceState }>,
}

type JournalLine = Omit<typeof assetPostureHistory.$inferInsert, 'id' | 'supportingAssetId' | 'tenantId'>;

const applicableAt = (findings: ReadonlyArray<SeedFinding>, at: number): Array<SeedFinding> =>
  findings.filter((finding) => finding.states.findLast((change) => change.at <= at)?.state === 'applicable');

/**
 * The cause the recompute would have journaled with `score`: the worst finding takes the points the
 * posture lost, so `explainAssetPosture` replays the line to its own score.
 */
const lineWithCause = (at: number, score: number, worst: SeedFinding, applicableCount: number): JournalLine => {
  const worstExploitability = 100 - score;
  const counts = { critical: 0, high: 0, medium: 0, low: applicableCount - 1 };
  counts[resolveSeverityBand(worstExploitability)] += 1;
  return {
    changedAt: new Date(at),
    score,
    worstAssetEvidenceId: worst.id,
    worstExploitability,
    criticalCount: counts.critical,
    highCount: counts.high,
    mediumCount: counts.medium,
    lowCount: counts.low,
  };
};

const lostLine = (at: number): JournalLine => ({ changedAt: new Date(at), score: null });

const dismissedSoon = (finding: SeedFinding, at: number): boolean => finding.states
  .some((change) => change.state === 'dismissed' && change.at > at && change.at <= at + RESOLUTION_LEAD_DAYS * DAY_MS);

const worstFirst = (at: number) => (a: SeedFinding, b: SeedFinding): number =>
  Number(dismissedSoon(b, at)) - Number(dismissedSoon(a, at)) || b.epss - a.epss || a.id.localeCompare(b.id);

/**
 * An asset's posture across the frame, one line where the integer score moved: the same worst
 * finding drifting, another one overtaking it, or the worst one dismissed on the day the history
 * says. Seeded off the asset's id, so the demo is the same on every reseed.
 */
const walkAsset = (findings: ReadonlyArray<SeedFinding>, assetIndex: number, frameStart: number): Array<JournalLine> => {
  const prng = createPrng(deriveSeed(findings[0].id, 'platform-seed-posture'));
  const drift = assetIndex % 2 === 0 ? 0.25 : -0.25;
  const withGap = assetIndex % 3 === 0;
  const lines: Array<JournalLine> = [];
  let score = 35 + prng() * 45;
  let worst: SeedFinding | null = null;
  let journaled: number | null | undefined;

  for (let dayIndex = 0; dayIndex < FRAME_DAYS; dayIndex++) {
    const at = frameStart + dayIndex * DAY_MS + Math.floor((2 + prng() * 16) * HOUR_MS);
    const applicable = applicableAt(findings, at).toSorted(worstFirst(at));
    if (applicable.length === 0) {
      if (journaled !== undefined && journaled !== null) {
        lines.push(lostLine(at));
        journaled = null;
      }
      worst = null;
      continue;
    }

    if (worst === null || !applicable.includes(worst)) {
      score += worst === null ? 0 : 2 + prng() * 4;
      worst = applicable[0];
    } else if (applicable[0] !== worst && dismissedSoon(applicable[0], at)) {
      worst = applicable[0];
      score -= 2 + prng() * 4;
    } else if (applicable.length > 1 && prng() < 0.04) {
      worst = applicable.find((finding) => finding !== worst) ?? worst;
      score -= 2 + prng() * 4;
    } else if (prng() < 0.15) {
      score += (prng() - 0.5) * 8 + drift * 3;
    }
    score = Math.min(Math.max(score, WALK_FLOOR), WALK_CEILING);

    const daysAgo = FRAME_DAYS - dayIndex;
    const today = withGap && daysAgo <= GAP_FROM_DAYS_AGO && daysAgo >= GAP_UNTIL_DAYS_AGO ? null : clampScore(score);
    if (today !== journaled) {
      lines.push(today === null ? lostLine(at) : lineWithCause(at, today, worst, applicable.length));
      journaled = today;
    }
  }
  return lines;
};

/**
 * Two walked assets cross a band in the last week, one from Medium into Critical and one from High
 * to Medium, so comparing the seeded runs a week apart lists a row under each of the two bands.
 */
const BAND_CROSSINGS = new Map<number, readonly [number, number]>([[1, [60, 12]], [2, [40, 58]]]);
const CROSSING_SETTLED_DAYS_AGO = 10;
const CROSSING_DAYS_AGO = 3;

const crossBand = (lines: ReadonlyArray<JournalLine>, findings: ReadonlyArray<SeedFinding>, now: number, [from, to]: readonly [number, number]): Array<JournalLine> => {
  const settledAt = now - CROSSING_SETTLED_DAYS_AGO * DAY_MS;
  const lineAt = (at: number, score: number): JournalLine => {
    const applicable = applicableAt(findings, at).toSorted(worstFirst(at));
    return applicable.length === 0 ? lostLine(at) : lineWithCause(at, score, applicable[0], applicable.length);
  };
  return [
    ...lines.filter((line) => line.changedAt.getTime() < settledAt),
    lineAt(settledAt, from),
    lineAt(now - CROSSING_DAYS_AGO * DAY_MS, to),
  ];
};

/** Five changes over the last few hours, the asset's first posture among them. */
const walkHours = (findings: ReadonlyArray<SeedFinding>, now: number): Array<JournalLine> => {
  const applicable = applicableAt(findings, now).toSorted(worstFirst(now));
  const first = applicable[0];
  const second = applicable[1] ?? first;
  const start = now - 4 * HOUR_MS;
  const steps: Array<{ minutes: number, score: number, worst: SeedFinding }> = [
    { minutes: 0, score: 48, worst: first },
    { minutes: 39, score: 52, worst: first },
    { minutes: 75, score: 50, worst: second },
    { minutes: 148, score: 55, worst: second },
    { minutes: 183, score: 58, worst: second },
  ];
  return steps.map(({ minutes, score, worst }) => lineWithCause(start + minutes * 60_000, score, worst, applicable.length));
};

registerPlatformSeed('asset-posture-history', async ({ db, now }) => {
  const frameStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - FRAME_DAYS);

  const evidence = await db
    .select({ id: assetEvidence.id, supportingAssetId: assetEvidence.supportingAssetId, epss: cve.epss })
    .from(assetEvidence)
    .innerJoin(cve, eq(cve.id, assetEvidence.cveId))
    .where(eq(assetEvidence.tenantId, Tenant_Acme));
  if (evidence.length === 0) {
    return;
  }
  const history = await db
    .select({ assetEvidenceId: assetEvidenceHistory.assetEvidenceId, state: assetEvidenceHistory.state, at: assetEvidenceHistory.stateChangedAt })
    .from(assetEvidenceHistory)
    .where(and(eq(assetEvidenceHistory.tenantId, Tenant_Acme), inArray(assetEvidenceHistory.assetEvidenceId, evidence.map((row) => row.id))))
    .orderBy(asc(assetEvidenceHistory.stateChangedAt));

  const findingsByAsset = new Map<string, Array<SeedFinding>>();
  const findingById = new Map<string, SeedFinding>();
  for (const row of evidence.toSorted((a, b) => a.id.localeCompare(b.id))) {
    const finding: SeedFinding = { id: row.id, epss: row.epss ?? 0, states: [] };
    findingById.set(row.id, finding);
    findingsByAsset.set(row.supportingAssetId, [...findingsByAsset.get(row.supportingAssetId) ?? [], finding]);
  }
  for (const row of history) {
    findingById.get(row.assetEvidenceId)?.states.push({ at: row.at.getTime(), state: row.state });
  }

  // Only an asset the first recompute will give a posture, or its curve would end on a stale score.
  const assetIds = [...findingsByAsset.entries()]
    .filter(([, findings]) => applicableAt(findings, now.getTime()).length > 0)
    .map(([supportingAssetId]) => supportingAssetId)
    .sort();

  const rows = assetIds.flatMap((supportingAssetId, assetIndex) => {
    const findings = findingsByAsset.get(supportingAssetId)!;
    const remainder = assetIndex % HOURS_ONLY_EVERY;
    if (remainder === SINGLE_LINE_REMAINDER) {
      return [];
    }
    const walked = remainder === HOURS_ONLY_REMAINDER ? walkHours(findings, now.getTime()) : walkAsset(findings, assetIndex, frameStart);
    const crossing = BAND_CROSSINGS.get(assetIndex);
    const lines = crossing === undefined ? walked : crossBand(walked, findings, now.getTime(), crossing);
    return lines.map((line, lineIndex) => ({ ...line, id: assetPostureHistoryId(assetIndex, lineIndex), supportingAssetId, tenantId: Tenant_Acme }));
  });
  if (rows.length > 0) {
    await db.insert(assetPostureHistory).values(rows);
  }
});

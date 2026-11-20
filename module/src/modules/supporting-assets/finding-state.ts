import type { EvidenceHistoryOrigin, EvidenceState, SYNC_ORIGINS } from './constants';

/** Where one source of a finding stands, as `evidence-source-freshness.ts` reads it. */
export interface SourceStanding {
  /** The source row's id, which settles two verdicts of one date. */
  id: string,
  /** When the source last said where it stands: its test, or the later run over its asset that left it out. */
  verdictAt: Date,
  /** What its latest verdict said, whether or not the source still stands behind it. */
  exposed: boolean,
  reporting: boolean,
  reason: string | null,
}

export interface FindingStateRow {
  state: EvidenceState,
  origin: EvidenceHistoryOrigin,
}

export interface DerivedFindingState {
  state: EvidenceState,
  origin: (typeof SYNC_ORIGINS)[number],
  observedAt: Date,
  reason: string | null,
}

// By verdict date, then by id, so the source whose wording a row carries never depends on the
// order the sources were read in.
const byVerdictAt = (a: SourceStanding, b: SourceStanding): number =>
  a.verdictAt.getTime() - b.verdictAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const earliest = (sources: ReadonlyArray<SourceStanding>): SourceStanding =>
  sources.reduce((a, b) => (byVerdictAt(b, a) < 0 ? b : a));

const latest = (sources: ReadonlyArray<SourceStanding>): SourceStanding =>
  sources.reduce((a, b) => (byVerdictAt(b, a) > 0 ? b : a));

/**
 * The history row a finding's sources call for, or null when its latest row already says it.
 *
 * A finding is exposed while any source still reports it exposed: one open attack path is enough.
 * Otherwise it is not exposed while a source still reports it, and no longer reported once none
 * does. A person's decision stands until handed back, and a handed-back finding hears only what a
 * source said after the handover, keeping the person's state until one has.
 *
 * `observedAt` is when the change happened by the sources' own clocks: the first exposed verdict
 * opens an exposure, and the last verdict closes one, counting the silence of a source that last
 * said exposed, since the exposure lasted until then.
 */
export const deriveFindingState = (params: {
  sources: ReadonlyArray<SourceStanding>,
  latest: FindingStateRow | null,
  handedBackAt: Date | null,
  retirementReason: string | null,
}): DerivedFindingState | null => {
  if (params.latest?.origin === 'user') {
    return null;
  }
  const { handedBackAt } = params;
  const heard = handedBackAt === null
    ? params.sources
    : params.sources.filter((source) => source.verdictAt.getTime() > handedBackAt.getTime());
  if (heard.length === 0) {
    return null;
  }

  const reporting = heard.filter((source) => source.reporting);
  const exposed = reporting.filter((source) => source.exposed);
  let derived: DerivedFindingState;
  if (exposed.length > 0) {
    const opening = earliest(exposed);
    derived = { state: 'applicable', origin: 'exposed', observedAt: opening.verdictAt, reason: opening.reason };
  } else if (reporting.length > 0) {
    const closing = latest(heard.filter((source) => source.reporting || source.exposed));
    derived = { state: 'dismissed', origin: 'not_exposed', observedAt: closing.verdictAt, reason: latest(reporting).reason };
  } else {
    derived = { state: 'dismissed', origin: 'no_longer_reported', observedAt: latest(heard).verdictAt, reason: params.retirementReason };
  }

  // A sync cause names its state, so the same cause is the same row.
  if (params.latest?.origin === derived.origin) {
    return null;
  }
  return derived;
};

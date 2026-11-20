import { foldCrqSimulationPayload } from '../crq-indicators/run-profile';

/** The payload an active row carries once an ask with `asked` folds into it. */
export type PayloadFold = (held: unknown, asked: unknown) => Record<string, unknown>;

/**
 * The kinds whose payload says what a run computes. An ask folding into a row of one of them widens
 * its payload, at enqueue and when a follow-up finds its key taken, or what the ask wanted is lost.
 * Every other kind keeps the payload it was booked with.
 */
const PAYLOAD_FOLDS: ReadonlyMap<string, PayloadFold> = new Map([
  ['crq-simulation', foldCrqSimulationPayload],
]);

export const payloadFoldOf = (kind: string): PayloadFold | undefined => PAYLOAD_FOLDS.get(kind);

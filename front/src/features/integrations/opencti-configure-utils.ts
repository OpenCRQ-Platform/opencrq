import type { OpenctiThreatVisibility } from '@app/module/client';

interface SavedBinding {
  streamId: string | null,
  serviceAccountId: string | null,
  threatVisibility: OpenctiThreatVisibility,
}

interface ChosenBinding {
  streamId: string,
  /** `null` for a new service account, created with the binding. */
  serviceAccountId: string | null,
  threatVisibility: OpenctiThreatVisibility,
}

/**
 * What a save of the Configure drawer sends. Binding the stream again replays it from the start, so
 * a save that changes only the visibility leaves the stream alone; a save that changes nothing binds
 * again, as it always has.
 */
export const configureSaveSteps = (saved: SavedBinding | null, chosen: ChosenBinding): { rebind: boolean, setVisibility: boolean } => {
  const setVisibility = chosen.threatVisibility !== (saved?.threatVisibility ?? 'per_member');
  const bindingChanged = chosen.serviceAccountId === null
    || chosen.streamId !== saved?.streamId
    || chosen.serviceAccountId !== saved.serviceAccountId;
  return { rebind: bindingChanged || !setVisibility, setVisibility };
};

import type { JobHandler } from '@app/module';
import { sharedSlotGroups } from '@app/module';
import { newError } from '@app/utils';

export interface JobRegistrationOptions {
  /** Every statement of the run is recorded; the reads and writes it reveals are persisted and
   * the dispatcher routes on them. Nothing is declared by hand. */
  observed?: boolean,
  /** Booked once a day at `recompute.daily_at`, even when no table changed: for the reads that
   * depend on the clock alone. */
  daily?: boolean,
  /** Never two runs in flight for one tenant, for a kind an observation does not already serialize. */
  serialized?: boolean,
  /** A kind this one shares its per-tenant slot with: a run of either waits while the other runs. */
  serializedWith?: string,
}

export interface JobRegistration {
  kind: string,
  options: JobRegistrationOptions,
}

export class HandlerRegistry {
  private readonly handlers = new Map<string, JobHandler>();
  private readonly options = new Map<string, JobRegistrationOptions>();

  register = <TPayload extends Record<string, unknown>, TState extends Record<string, unknown>>(
    kind: string,
    handler: JobHandler<TPayload, TState>,
    options?: JobRegistrationOptions,
  ): void => {
    if (this.handlers.has(kind)) {
      throw newError('Job handler is already registered', { kind });
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- handler<TPayload,TState> widens to base JobHandler; payload is deserialized JSON at call time
    this.handlers.set(kind, handler as JobHandler);
    this.options.set(kind, options ?? {});
  };

  get(kind: string): JobHandler | undefined {
    return this.handlers.get(kind);
  }

  getOptions(kind: string): JobRegistrationOptions | undefined {
    return this.options.get(kind);
  }

  listKinds(): Array<string> {
    return Array.from(this.handlers.keys());
  }

  /**
   * Kinds that must never have two runs in flight for one tenant. Every observed kind is one: the
   * recompute dispatcher tracks `running` and `changedDuringRun` per (kind, tenant) rather than per
   * run, so a second run clears the first's state, one completion then reporting the kind idle while
   * the other still executes, and a change committed in between is never followed up. A kind may
   * also ask for it on its own, when what it computes is too heavy to run beside itself.
   */
  listSerializedKinds(): Array<string> {
    return Array.from(this.options.entries())
      .filter(([kind]) => this.isSerialized(kind))
      .map(([kind]) => kind);
  }

  isSerialized(kind: string): boolean {
    const options = this.options.get(kind);
    return options?.observed === true || options?.serialized === true || this.slotMates(kind).length > 1;
  }

  /** The kinds sharing `kind`'s per-tenant slot, itself included. */
  slotMates(kind: string): Array<string> {
    return this.listSharedSlots().find((group) => group.includes(kind)) ?? [kind];
  }

  listSharedSlots(): Array<Array<string>> {
    return sharedSlotGroups([...this.options].map(([kind, { serializedWith }]) => ({ kind, serializedWith })));
  }

  listRegistrations(): Array<JobRegistration> {
    return Array.from(this.options.entries()).map(([kind, options]) => ({ kind, options }));
  }
}

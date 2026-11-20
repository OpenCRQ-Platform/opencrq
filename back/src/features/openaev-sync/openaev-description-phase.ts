import type { createOpenaevClient } from './openaev-api-client';
import { mapWithConcurrency } from '../../utils';
import { createLogger } from '../../utils/logger';
import { OpenaevNotFoundError } from './openaev-api-client';
import { linkedPersonNameOf, overviewFieldsOf } from './openaev-mapping-utils';

const { logFromError } = createLogger({ feature: 'openaev-sync' });

/** GET /assets/{id} calls a run may spend on descriptions, shared by every OpenAEV tenant it reads. */
export const DESCRIPTION_FETCH_BUDGET = 500;

/**
 * The calls the next OpenAEV tenant may spend: an even share of what the run has left, since the
 * candidates include assets already fetched and a tenant with a large estate would otherwise take the
 * whole budget run after run. What a tenant leaves unspent goes to the tenants after it.
 */
export const descriptionBudgetShare = (budgetLeft: number, tenantsLeft: number): number => Math.floor(budgetLeft / tenantsLeft);

/** Assets fetched, then written and marked together: what a crash can lose, and what one transaction reprojects. */
const WRITE_BATCH_SIZE = 100;

/** The service methods the phase calls, as plain functions so a test can hand them over as `vi.fn()`. */
export interface DescriptionPhaseServices {
  openaevConnector: {
    listDescriptionCandidates: (input: { connectorId: string, openaevTenantId: string, limit: number }) => Promise<Array<string>>,
    markDescriptionsFetched: (input: { connectorId: string, sourceAssetIds: Array<string>, fetchedAt: Date }) => Promise<void>,
  },
  supportingAssets: {
    updateReportedOverviewFields: (input: {
      connectorId: string,
      entries: Array<{ sourceAssetId: string, description: string | null, url: string | null, linkedPerson: string | null }>,
    }) => Promise<void>,
  },
}

export interface DescriptionPhaseProgress {
  /** Assets of the candidate list answered (described or gone) or failed so far in this call. */
  processed: number,
  /** Candidates this call set out to fetch. */
  total: number,
}

export interface DescriptionPhaseDeps {
  client: Pick<ReturnType<typeof createOpenaevClient>, 'getAssetOverview' | 'findUsers'>,
  svc: DescriptionPhaseServices,
  connectorId: string,
  openaevTenantId: string,
  /** The most `GET /assets/{id}` calls this call may issue. */
  budget: number,
  /** The most of those calls in flight at once. */
  concurrency: number,
  signal: AbortSignal,
  now: () => Date,
  onProgress?: (progress: DescriptionPhaseProgress) => Promise<void>,
}

export interface DescriptionPhaseResult {
  /** `GET /assets/{id}` calls issued, answered or not: what the caller takes off the run's budget. */
  calls: number,
}

/**
 * Fetches the description, url and linked person of the generic assets of one OpenAEV tenant that no
 * batch route describes (`needsDescriptionFetch`), never fetched first and then the one fetched
 * longest ago, and stores what OpenAEV answers. An asset fetched less than a day ago is not a candidate.
 *
 * The candidates are read once, capped at `budget`, and worked through in batches of
 * `WRITE_BATCH_SIZE`, `concurrency` calls at a time. Each batch is written before the next one
 * starts: the fields it fetched (`updateReportedOverviewFields`), then the stamp that sends its
 * assets to the back of the queue, so a crash in between fetches them again rather than losing
 * them. A field OpenAEV no longer holds is written as `null`. The linked person arrives as an
 * OpenAEV user id and is stored as a name, resolved with one `findUsers` call per batch
 * (`linkedPersonNameOf`); a directory that cannot be read counts as a failure of the assets that
 * name a person, since writing `null` for them would erase a name already stored.
 *
 * An asset OpenAEV does not know any more (`OpenaevNotFoundError`) is stamped with nothing written.
 * Any other failure of one asset is logged, written nothing and stamped all the same, so an asset
 * that fails for good moves to the back of the queue instead of holding the budget run after run;
 * it does not fail the run either, a description is not what the run is for. The exception is a
 * batch in which nothing at all was answered: OpenAEV being down is not the assets' fault, so none
 * of that batch is stamped and the phase ends for this tenant, costing one batch of calls rather
 * than the whole budget.
 *
 * An abort stops the phase between calls and writes what was already fetched; an asset not fetched
 * is never stamped.
 */
export const syncDescriptions = async (deps: DescriptionPhaseDeps): Promise<DescriptionPhaseResult> => {
  const { client, svc, connectorId, openaevTenantId, concurrency, signal, now, onProgress } = deps;
  if (deps.budget <= 0 || signal.aborted) {
    return { calls: 0 };
  }
  const candidates = await svc.openaevConnector.listDescriptionCandidates({ connectorId, openaevTenantId, limit: deps.budget });

  let calls = 0;
  for (let start = 0; start < candidates.length && !signal.aborted; start += WRITE_BATCH_SIZE) {
    const batch = candidates.slice(start, start + WRITE_BATCH_SIZE);
    // Indexed by position in the batch, so what is written follows the candidate order whichever
    // call answers first. A slot left `undefined` was never fetched (the run was aborted).
    const outcomes = new Array<{ fields: ReturnType<typeof overviewFieldsOf> } | 'gone' | 'failed' | undefined>(batch.length);
    await mapWithConcurrency(batch.map((sourceAssetId, index) => ({ sourceAssetId, index })), concurrency, async ({ sourceAssetId, index }) => {
      calls += 1;
      try {
        outcomes[index] = { fields: overviewFieldsOf(await client.getAssetOverview(openaevTenantId, sourceAssetId)) };
      } catch (err) {
        if (err instanceof OpenaevNotFoundError) {
          outcomes[index] = 'gone';
        } else if (!signal.aborted) {
          outcomes[index] = 'failed';
          logFromError(err, 'OpenAEV asset description fetch failed', { openaevTenantId, sourceAssetId });
        }
      }
    }, signal);

    const userIds = [...new Set(outcomes.flatMap((outcome) => (typeof outcome === 'object' && outcome.fields.linkedPerson !== null ? [outcome.fields.linkedPerson] : [])))];
    let namesById = new Map<string, string | null>();
    if (userIds.length > 0) {
      try {
        namesById = new Map((await client.findUsers(openaevTenantId, userIds)).map((user) => [user.user_id, linkedPersonNameOf(user)]));
      } catch (err) {
        if (!signal.aborted) {
          logFromError(err, 'OpenAEV users lookup failed, leaving the assets that name a person for a later run', { openaevTenantId });
        }
        outcomes.forEach((outcome, index) => {
          if (typeof outcome === 'object' && outcome.fields.linkedPerson !== null) {
            outcomes[index] = 'failed';
          }
        });
      }
    }

    const entries: Array<{ sourceAssetId: string, description: string | null, url: string | null, linkedPerson: string | null }> = [];
    const answered: Array<string> = [];
    const failed: Array<string> = [];
    outcomes.forEach((outcome, index) => {
      if (outcome === undefined) {
        return;
      }
      if (outcome === 'failed') {
        failed.push(batch[index]);
        return;
      }
      answered.push(batch[index]);
      if (outcome !== 'gone') {
        const { description, url, linkedPerson } = outcome.fields;
        entries.push({ sourceAssetId: batch[index], description, url, linkedPerson: linkedPerson === null ? null : namesById.get(linkedPerson) ?? null });
      }
    });
    const openaevIsDown = answered.length === 0 && failed.length > 0;
    if (entries.length > 0) {
      await svc.supportingAssets.updateReportedOverviewFields({ connectorId, entries });
    }
    const stamped = openaevIsDown ? [] : [...answered, ...failed];
    if (stamped.length > 0) {
      await svc.openaevConnector.markDescriptionsFetched({ connectorId, sourceAssetIds: stamped, fetchedAt: now() });
    }
    await onProgress?.({ processed: start + batch.length, total: candidates.length });

    if (openaevIsDown) {
      break;
    }
  }
  return { calls };
};

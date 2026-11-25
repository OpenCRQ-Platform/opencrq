import { and, eq, exists, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { RepositoryContext } from '../../registry';

type CveRowContext = Pick<RepositoryContext, 'db' | 'views'>;

/** Whether NVD reported on the CVE row `views.cve` holds in the enclosing query. */
export const cveHasNvdObservation = ({ db, views }: CveRowContext): SQL<boolean> => sql<boolean>`${exists(db
  .select({ one: sql`1` })
  .from(views.cveSourceObservations)
  .where(and(eq(views.cveSourceObservations.cveId, views.cve.id), eq(views.cveSourceObservations.source, 'nvd'))))}`;

/**
 * `nvdRecordState` reading `none`, for the CVE row `views.cve` holds in the enclosing query: false
 * on a row with no CVE, which a left join leaves null.
 */
export const cveNvdRecordMissing = (context: CveRowContext): SQL<boolean> =>
  sql<boolean>`(${context.views.cve.remediationReadAt} is not null and not ${cveHasNvdObservation(context)})`;

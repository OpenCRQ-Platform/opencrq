import { sql } from 'drizzle-orm';

/**
 * Rewrites every finding's stored state and latest verdict from its logs in one pass: the
 * whole-table derivation the row-by-row triggers must agree with.
 */
export const rederiveFindingStates = sql`
  UPDATE asset_evidence e SET
    current_state = coalesce(d.state, 'applicable'),
    current_state_changed_at = coalesce(d.state_changed_at, e.created_at),
    current_state_since = coalesce(d.entered_at, e.created_at),
    latest_verdict_exposed = lv.is_exposed,
    latest_verdict_observed_at = lv.observed_at
  FROM (SELECT tenant_id, id AS asset_evidence_id FROM asset_evidence) t
  CROSS JOIN LATERAL asset_evidence_derived_state((
    SELECT array_agg(h ORDER BY h.state_changed_at, h.id)
    FROM asset_evidence_history h
    WHERE h.tenant_id = t.tenant_id AND h.asset_evidence_id = t.asset_evidence_id
  )) d
  LEFT JOIN LATERAL (
    SELECT v.is_exposed, v.observed_at
    FROM asset_evidence_verdicts v
    WHERE v.tenant_id = t.tenant_id AND v.asset_evidence_id = t.asset_evidence_id
    ORDER BY v.recorded_at DESC, v.observed_at DESC, v.id DESC
    LIMIT 1
  ) lv ON true
  WHERE e.id = t.asset_evidence_id AND e.tenant_id = t.tenant_id`;

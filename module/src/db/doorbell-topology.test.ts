import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { describe, expect, it } from 'vitest';
import { createDoorbellTopology, loadDoorbellParents } from './doorbell-topology';

// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the loader reads `rows` and nothing else of the raw result
const catalogue = (rows: Array<{ child: string, fn: string, args: string | null }>) => ({
  execute: () => Promise.resolve({ rows }),
}) as unknown as Pick<NodePgDatabase, 'execute'>;

describe('loadDoorbellParents', () => {
  it('should read the parent from the second trigger argument of the generic functions', async () => {
    const parents = await loadDoorbellParents(catalogue([
      { child: 'attack_outcome_mitre_techniques', fn: 'notify_data_changed_tenant_via_fk', args: 'attack_outcome_id\\000attack_outcomes\\000' },
      { child: 'budget_review_lines', fn: 'notify_data_changed_tenant_via_2hop_fk', args: 'review_id\\000budget_reviews\\000organization_id\\000organizations\\000' },
    ]));
    expect(parents).toEqual([
      { child: 'attack_outcome_mitre_techniques', parent: 'attack_outcomes' },
      { child: 'budget_review_lines', parent: 'budget_reviews' },
    ]);
  });

  it('should know the parent the hard-coded function names in its body', async () => {
    const parents = await loadDoorbellParents(catalogue([
      { child: 'crq_indicator_group_scores', fn: 'notify_data_changed_tenant_via_crq_run', args: null },
    ]));
    expect(parents).toEqual([
      { child: 'crq_indicator_group_scores', parent: 'crq_indicator_runs' },
    ]);
  });

  it('should refuse a function it cannot place, rather than routing nothing for its children', async () => {
    await expect(loadDoorbellParents(catalogue([
      { child: 'new_child', fn: 'notify_data_changed_tenant_via_something_new', args: null },
    ]))).rejects.toThrow('unknown table');
  });

  it('should refuse a generic trigger that carries no parent argument', async () => {
    await expect(loadDoorbellParents(catalogue([
      { child: 'orphan', fn: 'notify_data_changed_tenant_via_fk', args: 'only_the_fk\\000' },
    ]))).rejects.toThrow('no parent table argument');
  });
});

describe('createDoorbellTopology', () => {
  const topology = createDoorbellTopology([
    { child: 'risk_scenarios', parent: 'organizations' },
    { child: 'scenario_loss_estimates', parent: 'risk_scenarios' },
    { child: 'primary_assets', parent: 'organizations' },
  ]);

  it('should close a DELETE over every level hanging under the deleted table', () => {
    expect([...topology.tablesChangedBy('organizations', 'DELETE')].sort())
      .toEqual(['organizations', 'primary_assets', 'risk_scenarios', 'scenario_loss_estimates']);
    expect([...topology.tablesChangedBy('risk_scenarios', 'DELETE')].sort())
      .toEqual(['risk_scenarios', 'scenario_loss_estimates']);
  });

  it('should not expand an insert, an update, or an op it was not told', () => {
    expect(topology.tablesChangedBy('organizations', 'INSERT')).toEqual(new Set(['organizations']));
    expect(topology.tablesChangedBy('organizations', 'UPDATE')).toEqual(new Set(['organizations']));
    expect(topology.tablesChangedBy('organizations', undefined)).toEqual(new Set(['organizations']));
  });

  it('should leave a table without children alone', () => {
    expect(topology.tablesChangedBy('scenario_loss_estimates', 'DELETE')).toEqual(new Set(['scenario_loss_estimates']));
  });
});

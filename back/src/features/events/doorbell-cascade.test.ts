import { describe, expect, it, vi } from 'vitest';
import { EVERY_TABLE } from './data-changed-hub';
import { createDoorbellCascade } from './doorbell-cascade';

const PARENTS = [
  { child: 'risk_scenarios', parent: 'organizations' },
  { child: 'scenario_loss_estimates', parent: 'risk_scenarios' },
];

describe('createDoorbellCascade', () => {
  it('loads the topology once, on the first change, and closes a DELETE over the children', async () => {
    const loadParents = vi.fn(() => Promise.resolve(PARENTS));
    const cascade = createDoorbellCascade({ loadParents });

    expect(loadParents).not.toHaveBeenCalled();
    expect([...await cascade({ table: 'organizations', op: 'DELETE' })].sort())
      .toEqual(['organizations', 'risk_scenarios', 'scenario_loss_estimates']);
    expect([...await cascade({ table: 'organizations', op: 'UPDATE' })]).toEqual(['organizations']);
    expect(loadParents).toHaveBeenCalledTimes(1);
  });

  it('rings every table for the change a failed load served, then loads again for the next one', async () => {
    let fail = true;
    const failures: Array<unknown> = [];
    const cascade = createDoorbellCascade({
      loadParents: () => (fail ? Promise.reject(new Error('not connected')) : Promise.resolve(PARENTS)),
      onLoadFailed: (error) => failures.push(error),
    });

    expect([...await cascade({ table: 'organizations', op: 'DELETE' })]).toEqual([EVERY_TABLE]);
    expect(failures).toHaveLength(1);

    fail = false;
    expect([...await cascade({ table: 'risk_scenarios', op: 'DELETE' })].sort()).toEqual(['risk_scenarios', 'scenario_loss_estimates']);
  });

  it('expands the changes in the order they landed, whatever the load takes', async () => {
    let release: (() => void) | undefined;
    const cascade = createDoorbellCascade({
      loadParents: () => new Promise((resolve) => {
        release = () => resolve(PARENTS);
      }),
    });
    const order: Array<string> = [];
    const first = cascade({ table: 'organizations', op: 'DELETE' }).then(() => order.push('first'));
    const second = cascade({ table: 'assets', op: 'INSERT' }).then(() => order.push('second'));

    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    release!();
    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'second']);
  });
});

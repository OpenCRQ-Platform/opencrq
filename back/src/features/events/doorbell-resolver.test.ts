import { describe, expect, it, vi } from 'vitest';
import type { DataChangedSignal } from './data-changed-hub';
import type { DoorbellTargets } from './query-dependency-index';
import type { ResolvingIndex } from './doorbell-resolver';
import { createDoorbellResolver } from './doorbell-resolver';

const indexNaming = (procedures: Array<string>): ResolvingIndex => ({
  targetsOf: vi.fn(() => ({ procedures, all: false })),
});

describe('createDoorbellResolver', () => {
  it('resolves one doorbell once, however many streams receive it', () => {
    const index = indexNaming(['organizations.getOrganizations']);
    const resolved: Array<[DataChangedSignal, DoorbellTargets]> = [];
    const resolve = createDoorbellResolver(index, (signal, targets) => resolved.push([signal, targets]));
    const doorbell: DataChangedSignal = { tenantId: 'tenant-1', tables: ['organizations'] };

    // The hub emits one object to every subscriber, so three streams see the same doorbell.
    const targets = [resolve(doorbell), resolve(doorbell), resolve(doorbell)];

    expect(index.targetsOf).toHaveBeenCalledTimes(1);
    expect(resolved).toHaveLength(1);
    expect(targets[0]).toBe(targets[1]);
    expect(targets[2]).toEqual({ procedures: ['organizations.getOrganizations'], all: false });
  });

  it('resolves each doorbell of its own', () => {
    const index = indexNaming([]);
    const resolve = createDoorbellResolver(index, () => undefined);

    resolve({ tenantId: 'tenant-1', tables: ['organizations'] });
    resolve({ tenantId: 'tenant-1', tables: ['organizations'] });

    expect(index.targetsOf).toHaveBeenCalledTimes(2);
  });
});

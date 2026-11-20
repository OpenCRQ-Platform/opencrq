import type { ParsedThreat } from '../stix-bundle-parser';
import type { OutcomeCounterRecord } from './outcome-counter';
import { OUTCOME_COUNTER_OUTCOMES } from './outcome-counter';

// The model reads at most eight reports per threat, the most recent first.
export const MAX_COUNTER_REPORTS = 8;

type CounterReport = ParsedThreat['reports'][number];

const byRecencyThenId = (a: CounterReport, b: CounterReport): number => {
  if (a.published !== null && b.published !== null && a.published.getTime() !== b.published.getTime()) {
    return b.published.getTime() - a.published.getTime();
  }
  if ((a.published === null) !== (b.published === null)) {
    return a.published === null ? 1 : -1;
  }
  if (a.stixId === b.stixId) {
    return 0;
  }
  return a.stixId < b.stixId ? -1 : 1;
};

/**
 * The parents of a threat as the counter reads them: one per distinct `attributed-to` target, flagged
 * inferred when every relationship to it is, carrying the seven percentages stored for that target in
 * the counter's order. A target with no stored percentages, or whose attack outcomes are not all in the
 * tenant, carries null: a partial row would hand the counter holes. A target is flagged with evidence
 * when one of its stored records has it.
 */
export const buildCounterParents = (
  attributions: ReadonlyArray<{ targetStixId: string, isInferred: boolean }>,
  storedRows: ReadonlyArray<{ stixId: string, attackOutcomeId: string, probability: number, evidenceSufficient: boolean }>,
  catalogIdByRowId: ReadonlyMap<string, string>,
): OutcomeCounterRecord['parents'] => {
  const probabilitiesByStixId = new Map<string, Map<string, number>>();
  const sufficientStixIds = new Set<string>();
  for (const row of storedRows) {
    const catalogId = catalogIdByRowId.get(row.attackOutcomeId);
    if (catalogId === undefined) {
      continue;
    }
    const held = probabilitiesByStixId.get(row.stixId) ?? new Map<string, number>();
    held.set(catalogId, row.probability);
    probabilitiesByStixId.set(row.stixId, held);
    if (row.evidenceSufficient) {
      sufficientStixIds.add(row.stixId);
    }
  }
  const inferredByTarget = new Map<string, boolean>();
  for (const attribution of attributions) {
    inferredByTarget.set(attribution.targetStixId, (inferredByTarget.get(attribution.targetStixId) ?? true) && attribution.isInferred);
  }
  return [...inferredByTarget].map(([targetStixId, inferred]) => {
    const held = probabilitiesByStixId.get(targetStixId);
    const probabilities = OUTCOME_COUNTER_OUTCOMES.map((catalogId) => held?.get(catalogId));
    return {
      inferred,
      probabilities: probabilities.every((value): value is number => value !== undefined) ? probabilities : null,
      evidenceSufficient: sufficientStixIds.has(targetStixId),
    };
  });
};

/**
 * The sheet the outcome counter scores, read off one parsed threat. `parents` comes from the
 * caller, which alone knows the probabilities each parent already carries.
 */
export const buildCounterRecord = (
  entry: ParsedThreat,
  parents: OutcomeCounterRecord['parents'],
): OutcomeCounterRecord => ({
  id: entry.threat.stixId,
  type: entry.threat.entityType,
  name: entry.threat.name,
  aliases: entry.aliases,
  title: entry.threat.entityType === 'campaign' ? entry.threat.name : null,
  // Collapsed, as the model reads it: the counter cuts the description at 3000 characters.
  description: (entry.threat.description ?? '').replace(/\s+/g, ' ').trim(),
  motivations: [entry.threat.primaryMotivation, ...entry.secondaryMotivations]
    .filter((motivation): motivation is string => motivation !== null && motivation.trim().length > 0),
  goals: entry.goals,
  malware: entry.malware.map((malware) => ({ name: malware.name, types: malware.types })),
  labels: entry.threat.labels.filter((label) => !label.startsWith('source:')),
  sectors: entry.sectors.map((sector) => sector.name),
  techniques: entry.techniques.map((technique) => technique.mitreExternalId),
  parentCount: new Set(entry.attributions.map((attribution) => attribution.targetStixId)).size,
  parents,
  reports: [...entry.reports]
    .sort(byRecencyThenId)
    .slice(0, MAX_COUNTER_REPORTS)
    .map((report) => ({ title: report.title, summary: report.summary, labels: report.labels })),
});

/** What `orderParentsFirst` reads of an entry. */
export interface ParentOrderable {
  threat: { stixId: string },
  attributions: ReadonlyArray<{ targetStixId: string }>,
}

// Tarjan's strongly connected components, iterative: a batch can hold a chain too long for the call stack.
const strongComponents = (parentsOf: ReadonlyArray<ReadonlyArray<number>>): Array<number> => {
  const size = parentsOf.length;
  const discovery = new Array<number>(size).fill(-1);
  const lowLink = new Array<number>(size).fill(0);
  const onStack = new Array<boolean>(size).fill(false);
  const componentOf = new Array<number>(size).fill(-1);
  const stack: Array<number> = [];
  let clock = 0;
  let components = 0;

  const discover = (node: number): void => {
    discovery[node] = clock;
    lowLink[node] = clock;
    clock += 1;
    stack.push(node);
    onStack[node] = true;
  };

  for (let root = 0; root < size; root++) {
    if (discovery[root] !== -1) {
      continue;
    }
    discover(root);
    const frames: Array<{ node: number, next: number }> = [{ node: root, next: 0 }];
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const { node } = frame;
      if (frame.next < parentsOf[node].length) {
        const parent = parentsOf[node][frame.next];
        frame.next += 1;
        if (discovery[parent] === -1) {
          discover(parent);
          frames.push({ node: parent, next: 0 });
        } else if (onStack[parent]) {
          lowLink[node] = Math.min(lowLink[node], discovery[parent]);
        }
        continue;
      }
      frames.pop();
      if (lowLink[node] === discovery[node]) {
        let member: number;
        do {
          member = stack.pop()!;
          onStack[member] = false;
          componentOf[member] = components;
        } while (member !== node);
        components += 1;
      }
      const caller = frames[frames.length - 1];
      if (caller) {
        lowLink[caller.node] = Math.min(lowLink[caller.node], lowLink[node]);
      }
    }
  }
  return componentOf;
};

/** A binary min-heap of numbers. */
const createMinHeap = () => {
  const items: Array<number> = [];
  return {
    get size() {
      return items.length;
    },
    push: (value: number): void => {
      items.push(value);
      let child = items.length - 1;
      while (child > 0) {
        const parent = (child - 1) >> 1;
        if (items[parent] <= items[child]) {
          break;
        }
        [items[parent], items[child]] = [items[child], items[parent]];
        child = parent;
      }
    },
    pop: (): number => {
      const top = items[0];
      const last = items.pop()!;
      if (items.length > 0) {
        items[0] = last;
        let parent = 0;
        for (;;) {
          const left = 2 * parent + 1;
          const right = left + 1;
          let smallest = parent;
          if (left < items.length && items[left] < items[smallest]) {
            smallest = left;
          }
          if (right < items.length && items[right] < items[smallest]) {
            smallest = right;
          }
          if (smallest === parent) {
            break;
          }
          [items[parent], items[smallest]] = [items[smallest], items[parent]];
          parent = smallest;
        }
      }
      return top;
    },
  };
};

/**
 * The entries of a batch with every `attributed-to` target before the entries pointing at it, which
 * a child needs because it reads the percentages its parent was just given. A parent outside the
 * batch constrains nothing. Entries with no link between them keep their input order, and the
 * members of a cycle, which have no right order, keep theirs and stay together.
 */
export const orderParentsFirst = <T extends ParentOrderable>(entries: ReadonlyArray<T>): Array<T> => {
  const indexByStixId = new Map<string, number>();
  entries.forEach((entry, index) => {
    if (!indexByStixId.has(entry.threat.stixId)) {
      indexByStixId.set(entry.threat.stixId, index);
    }
  });
  const parentsOf = entries.map((entry, index) => {
    const parents = new Set<number>();
    for (const attribution of entry.attributions) {
      const parent = indexByStixId.get(attribution.targetStixId);
      if (parent !== undefined && parent !== index) {
        parents.add(parent);
      }
    }
    return [...parents];
  });

  const componentOf = strongComponents(parentsOf);
  const members: Array<Array<number>> = [];
  entries.forEach((_, index) => {
    (members[componentOf[index]] ??= []).push(index);
  });
  const waitingOn = new Array<number>(members.length).fill(0);
  const childrenOf = new Map<number, Array<number>>();
  parentsOf.forEach((parents, child) => {
    for (const parent of parents) {
      if (componentOf[parent] !== componentOf[child]) {
        waitingOn[componentOf[child]] += 1;
        const children = childrenOf.get(parent);
        if (children) {
          children.push(child);
        } else {
          childrenOf.set(parent, [child]);
        }
      }
    }
  });

  // Ready components leave in the order of their first member: the batch's own order wherever it is free.
  const componentByFirstMember = new Map(members.map((component, id) => [component[0], id]));
  const ready = createMinHeap();
  members.forEach((component, id) => {
    if (waitingOn[id] === 0) {
      ready.push(component[0]);
    }
  });
  const ordered: Array<T> = [];
  while (ready.size > 0) {
    const component = members[componentByFirstMember.get(ready.pop())!];
    for (const member of component) {
      ordered.push(entries[member]);
      for (const child of childrenOf.get(member) ?? []) {
        const childComponent = componentOf[child];
        waitingOn[childComponent] -= 1;
        if (waitingOn[childComponent] === 0) {
          ready.push(members[childComponent][0]);
        }
      }
    }
  }
  return ordered;
};

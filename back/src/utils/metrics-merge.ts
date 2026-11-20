interface FamilyBlock {
  name: string,
  help?: string,
  type?: string,
  unit?: string,
  samples: Array<string>,
}

export interface DroppedFamily {
  name: string,
  reason: 'type-conflict',
}

export interface MetadataConflict {
  name: string,
  field: 'help' | 'unit',
}

export interface MergeResult {
  text: string,
  invalidProcesses: Array<string>,
  emptyProcesses: Array<string>,
  droppedFamilies: Array<DroppedFamily>,
  metadataConflicts: Array<MetadataConflict>,
}

const splitDirective = (line: string, prefix: string): { name: string, rest: string } => {
  const body = line.slice(prefix.length);
  const spaceIndex = body.indexOf(' ');
  return spaceIndex === -1
    ? { name: body, rest: '' }
    : { name: body.slice(0, spaceIndex), rest: body.slice(spaceIndex + 1) };
};

// A sample line carries `process_name` as a label, never as the metric name itself, so a bare
// substring check is enough given the controlled label syntax every process emits.
const hasProcessNameLabel = (sample: string): boolean => /[{,]process_name="/.test(sample);

// Walks a single process's exposition text into per-family blocks: a HELP/TYPE/optional-UNIT
// triplet followed by every sample line until the next directive or the end of the text.
// A sample before any directive is reported, not discarded: dropping it carries the rest of the
// block past the `process_name` validation below.
const parseFamilyBlocks = (text: string): { blocks: Array<FamilyBlock>, hasOrphanSample: boolean } => {
  const blocks: Array<FamilyBlock> = [];
  let current: FamilyBlock | undefined;
  let hasOrphanSample = false;

  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    if (line.startsWith('# HELP ')) {
      const { name, rest } = splitDirective(line, '# HELP ');
      current = { name, help: rest, samples: [] };
      blocks.push(current);
    } else if (line.startsWith('# TYPE ')) {
      const { name, rest } = splitDirective(line, '# TYPE ');
      if (!current || current.name !== name) {
        current = { name, samples: [] };
        blocks.push(current);
      }
      current.type = rest;
    } else if (line.startsWith('# UNIT ')) {
      const { name, rest } = splitDirective(line, '# UNIT ');
      if (current && current.name === name) {
        current.unit = rest;
      }
    } else if (!line.startsWith('#')) {
      if (current) {
        current.samples.push(line);
      } else {
        hasOrphanSample = true;
      }
    }
  }

  return { blocks, hasOrphanSample };
};

// Groups every contributing process's blocks by family name, in first-seen order: the first
// block seen for a family sets its HELP/TYPE/UNIT, every later block only appends sample lines.
// Never sums, reorders or otherwise rewrites a sample — this module only groups and concatenates.
export const mergeMetricsSnapshots = (snapshots: Array<{ processName: string, text: string }>): MergeResult => {
  const families = new Map<string, FamilyBlock>();
  const invalidProcesses: Array<string> = [];
  const emptyProcesses: Array<string> = [];
  const conflictedFamilyNames = new Set<string>();
  const droppedFamilies: Array<DroppedFamily> = [];
  const metadataConflicts: Array<MetadataConflict> = [];

  for (const { processName, text } of snapshots) {
    const { blocks, hasOrphanSample } = parseFamilyBlocks(text);

    // A process's contribution is dropped whole — every family it contributed, not only the
    // offending one — the moment one of its sample lines is malformed or lacks `process_name`.
    if (hasOrphanSample || blocks.some((block) => block.samples.some((sample) => !hasProcessNameLabel(sample)))) {
      invalidProcesses.push(processName);
      continue;
    }

    // A process that answered with no sample at all has a broken pipeline; counting it as a
    // successful collection asserts health for the one process the document lost.
    if (blocks.every((block) => block.samples.length === 0)) {
      emptyProcesses.push(processName);
      continue;
    }

    for (const block of blocks) {
      const family = families.get(block.name);
      if (!family) {
        families.set(block.name, { name: block.name, help: block.help, type: block.type, unit: block.unit, samples: [...block.samples] });
        continue;
      }

      // Backfills a family field left undefined by an earlier block (e.g. a process whose
      // exposition omitted UNIT for this family) instead of only ever comparing against it.
      // HELP/UNIT disagreement, once both sides are known, keeps the first value seen and
      // reports the conflict.
      if (block.help !== undefined) {
        if (family.help === undefined) {
          family.help = block.help;
        } else if (block.help !== family.help) {
          metadataConflicts.push({ name: block.name, field: 'help' });
        }
      }
      if (block.unit !== undefined) {
        if (family.unit === undefined) {
          family.unit = block.unit;
        } else if (block.unit !== family.unit) {
          metadataConflicts.push({ name: block.name, field: 'unit' });
        }
      }
      // TYPE disagreement drops the entire family — the format admits no valid
      // rendering of two types under one family name.
      if (block.type !== undefined) {
        if (family.type === undefined) {
          family.type = block.type;
        } else if (block.type !== family.type) {
          conflictedFamilyNames.add(block.name);
        }
      }

      family.samples.push(...block.samples);
    }
  }

  const lines: Array<string> = [];
  for (const [name, family] of families) {
    if (conflictedFamilyNames.has(name)) {
      droppedFamilies.push({ name, reason: 'type-conflict' });
      continue;
    }
    if (family.help !== undefined) {
      lines.push(`# HELP ${family.name} ${family.help}`);
    }
    if (family.type !== undefined) {
      lines.push(`# TYPE ${family.name} ${family.type}`);
    }
    if (family.unit !== undefined) {
      lines.push(`# UNIT ${family.name} ${family.unit}`);
    }
    lines.push(...family.samples);
  }

  return {
    text: lines.length > 0 ? `${lines.join('\n')}\n` : '',
    invalidProcesses,
    emptyProcesses,
    droppedFamilies,
    metadataConflicts,
  };
};

/**
 * What the drift agent gets to read. It has no access to the repository, so
 * everything it may base a finding on is put in the context here, and only
 * files git tracks inside the document's own watches ever leave the runner.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const MAX_CONTEXT_BYTES = Number(process.env.MAX_CONTEXT_BYTES || 300000);

export const parseMap = (text) => {
  const entries = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trimEnd();
    if (line.trim() === '') {
      continue;
    }
    const doc = line.match(/^- doc:\s*(.+)$/);
    const watch = line.match(/^\s+-\s*(.+)$/);
    if (doc) {
      entries.push({ doc: doc[1].trim(), watches: [] });
    } else if (watch && entries.length > 0) {
      entries.at(-1).watches.push(watch[1].trim().replace(/^["']|["']$/g, ''));
    }
  }
  return entries;
};

export const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

export const gitLines = (args) => git(args).split('\n').filter(Boolean);

export const watchedFiles = (watches) =>
  watches.length === 0 ? [] : gitLines(['ls-files', '--', ...watches.map((w) => `:(glob)${w}`)]);

export const watchesOf = (doc) => {
  const entry = parseMap(fs.readFileSync(process.env.MAP_FILE || '.github/docs-drift/docs-map.yml', 'utf8')).find(
    (e) => e.doc === doc,
  );
  if (!entry) {
    throw new Error(`${doc} is not in the drift map`);
  }
  return entry.watches;
};

// Only paths that can name something in this repository: an inline code span
// whose first segment is a top-level entry, or a relative link. A URL path
// such as `/api/v1/x`, an anchor or a `.../` shorthand would otherwise read as
// a missing file.
const namedPaths = (doc, text) => {
  const topLevel = new Set(gitLines(['ls-files']).map((f) => f.split('/')[0]));
  const found = new Set();
  for (const [, span] of text.matchAll(/`([^`\s]+\/[^`\s]*)`/g)) {
    const candidate = span
      .replace(/#.*$/, '')
      .replace(/:\d+(-\d+)?$/, '')
      .replace(/[.,;)]+$/, '');
    if (!/[*?<>{}$]|:\/\/|\.\.\.|…/.test(candidate) && topLevel.has(candidate.split('/')[0])) {
      found.add(path.posix.normalize(candidate));
    }
  }
  for (const [, link] of text.matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)) {
    if (/^[a-z]+:/i.test(link)) {
      continue;
    }
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(doc), link));
    if (!resolved.startsWith('..')) {
      found.add(resolved);
    }
  }
  return [...found].sort();
};

// A gitignored path, such as a file the dev stack writes, is never in a
// checkout: absent here says nothing about the document.
const ignoredByGit = (paths) =>
  new Set(
    spawnSync('git', ['check-ignore', '--no-index', '--stdin'], { input: paths.join('\n'), encoding: 'utf8' })
      .stdout.split('\n')
      .filter(Boolean),
  );

// The agent cannot look at the tree, so a named path's existence is stated:
// it is the only evidence a missing file can have.
const namedPathsSection = (named) => {
  if (named.length === 0) {
    return [];
  }
  const ignored = ignoredByGit(named);
  const status = (p) => {
    if (fs.existsSync(p)) {
      return 'exists';
    }
    return ignored.has(p) || ignored.has(p.replace(/\/$/, '')) ? 'ignored by git, created locally' : 'missing';
  };
  return [`## Paths named in the document\n\n${named.map((p) => `- ${p}: ${status(p)}`).join('\n')}`];
};

const numbered = (text) =>
  text
    .split('\n')
    .map((line, i) => `${i + 1}\t${line}`)
    .join('\n');

// Longer than any fence inside a file, so a file holding ``` cannot close it.
const fence = (text) => '`'.repeat(Math.max(3, ...[...text.matchAll(/`{3,}/g)].map((m) => m[0].length + 1)));

const block = (text, lang = '') => {
  const f = fence(text);
  return `${f}${lang}\n${text}\n${f}`;
};

const listing = (title, intro, files) =>
  files.length === 0 ? [] : [`## ${title}\n\n${intro}\n\n${files.map((f) => `- ${f}`).join('\n')}`];

const bytesOf = (parts) => parts.reduce((n, p) => n + Buffer.byteLength(p) + 2, 0);

/** Each file's section, or the reason it cannot be sent. */
const sectionsOf = (files, sectionOf) =>
  files.map((file) => {
    const content = fs.readFileSync(file);
    return content.includes(0) ? { file, binary: true } : { file, section: sectionOf(file, content.toString('utf8')) };
  });

/**
 * One context: the head, then the files in order while the budget allows. A
 * file that does not fit is listed as omitted rather than cut, so the agent
 * knows it exists and that it did not read it.
 */
const oneContext = (head, sections) => {
  const parts = [...head];
  const files = [];
  const omitted = [];
  for (const s of sections) {
    if (s.binary || bytesOf([...parts, s.section]) > MAX_CONTEXT_BYTES) {
      omitted.push(s.binary ? `${s.file} (binary)` : s.file);
    } else {
      parts.push(s.section);
      files.push(s.file);
    }
  }
  parts.push(...listing('Files omitted for size', 'These exist but their content is not in this context:', omitted));
  return { context: parts.join('\n\n'), files, omitted };
};

const OTHER_CALLS = 'These exist and are audited in a separate call: never conclude anything from their content being absent here.';
const NOT_SENT = 'These exist but no call carries their content:';

// Room for the title and note of a part. Its fences are counted apart: `block`
// makes them longer than any backtick run inside.
const PART_OVERHEAD = 1000;

const longestTicks = (line) => Math.max(0, ...[...line.matchAll(/`{3,}/g)].map((m) => m[0].length));

const fencesFor = (ticks) => 2 * Math.max(3, ticks + 1);

/**
 * Consecutive lines grouped into parts that each fit `budget` once rendered,
 * or null when they cannot be: a single line longer than that has nowhere to
 * be cut.
 */
const cutLines = (lines, budget, render) => {
  const room = budget - PART_OVERHEAD;
  const runs = [];
  let from = 0;
  let bytes = 0;
  let ticks = 0;
  for (let i = 0; i < lines.length; i++) {
    const size = Buffer.byteLength(lines[i]) + 1;
    const own = longestTicks(lines[i]);
    if (size + fencesFor(own) > room) {
      return null;
    }
    if (bytes + size + fencesFor(Math.max(ticks, own)) > room) {
      runs.push([from, i]);
      from = i;
      bytes = 0;
      ticks = 0;
    }
    bytes += size;
    ticks = Math.max(ticks, own);
  }
  runs.push([from, lines.length]);
  const parts = runs.map(([a, b]) => render(lines.slice(a, b).join('\n'), a + 1, b, lines.length));
  // A title past PART_OVERHEAD, such as an absurdly long path, would otherwise overflow the call.
  return parts.every((part) => Buffer.byteLength(part) + 2 <= budget) ? parts : null;
};

/**
 * What one file sends: a single section when it fits a call, otherwise its diff
 * and its numbered content cut at line boundaries, each part saying which lines
 * it holds. A diff that cannot be cut gives way to a note, since the audit
 * judges the current content. Null when that content cannot be sent.
 */
const piecesOf = (file, content, diff, budget) => {
  const whole = `## File \`${file}\`\n\n${diff ? `${block(diff, 'diff')}\n\n` : ''}${block(numbered(content))}`;
  if (Buffer.byteLength(whole) + 2 <= budget) {
    return [whole];
  }
  const contentParts = cutLines(
    numbered(content).split('\n'),
    budget,
    (text, a, b, n) =>
      a === 1 && b === n
        ? `## File \`${file}\`\n\n${block(text)}`
        : `## File \`${file}\`, lines ${a} to ${b} of ${n}\n\nThe other lines of this file are in other parts.\n\n${block(text)}`,
  );
  if (!contentParts) {
    return null;
  }
  const diffParts = diff
    ? cutLines(
      diff.split('\n'),
      budget,
      (text, a, b, n) => `## Diff of \`${file}\`, diff lines ${a} to ${b} of ${n}\n\n${block(text, 'diff')}`,
    )
    : [];
  return [
    ...(diffParts || [`## Diff of \`${file}\`\n\nNot sent: it cannot be cut to fit one call. The current content follows.`]),
    ...contentParts,
  ];
};

/**
 * The contexts of one detection, sharing the head. Every required file is sent,
 * over as many calls as it takes and in parts when one is larger than a call.
 * An optional file only fills the room the required ones leave, whole.
 */
const packContexts = (head, required, optional) => {
  const all = [...required, ...optional].map((s) => s.file);
  const reserve =
    bytesOf(listing('Files in other calls', OTHER_CALLS, all.map((f) => `${f} (its other lines)`))) +
    bytesOf(listing('Files omitted for size', NOT_SENT, all.map((f) => `${f} (a line longer than one call)`)));
  const budget = MAX_CONTEXT_BYTES - bytesOf(head) - reserve;
  if (budget < 4 * PART_OVERHEAD) {
    throw new Error(`the document and its file list fill a ${MAX_CONTEXT_BYTES}-byte call on their own`);
  }
  const groups = [];
  const omitted = [];
  const place = (file, piece) => {
    const bytes = Buffer.byteLength(piece) + 2;
    const last = groups.at(-1);
    if (last && last.bytes + bytes <= budget) {
      last.items.push({ file, piece });
      last.bytes += bytes;
    } else {
      groups.push({ items: [{ file, piece }], bytes });
    }
  };
  for (const s of required) {
    const pieces = s.binary ? null : piecesOf(s.file, s.content, s.diff, budget);
    if (pieces) {
      pieces.forEach((piece) => place(s.file, piece));
    } else {
      omitted.push(s.binary ? `${s.file} (binary)` : `${s.file} (a line longer than one call)`);
    }
  }
  if (groups.length === 0) {
    groups.push({ items: [], bytes: 0 });
  }
  for (const s of optional) {
    const piece = s.binary ? '' : piecesOf(s.file, s.content, '', Infinity)[0];
    const bytes = Buffer.byteLength(piece) + 2;
    const room = s.binary ? undefined : groups.find((g) => g.bytes + bytes <= budget);
    if (room) {
      room.items.push({ file: s.file, piece });
      room.bytes += bytes;
    } else {
      omitted.push(s.binary ? `${s.file} (binary)` : s.file);
    }
  }
  const callsOf = new Map();
  groups.forEach((g, k) => g.items.forEach(({ file }) => callsOf.set(file, new Set([...(callsOf.get(file) || []), k]))));
  const contexts = groups.map((g, k) => {
    const mine = [...new Set(g.items.map((i) => i.file))];
    const elsewhere = [...callsOf]
      .filter(([, calls]) => [...calls].some((c) => c !== k))
      .map(([file, calls]) => (calls.has(k) ? `${file} (its other lines)` : file));
    const parts = [
      ...head,
      ...g.items.map((i) => i.piece),
      ...listing('Files in other calls', OTHER_CALLS, elsewhere),
      ...listing('Files omitted for size', NOT_SENT, omitted),
    ];
    return { context: parts.join('\n\n'), files: mine, omitted };
  });
  return { contexts, omitted };
};

const documentSection = (doc) => `## Document \`${doc}\`\n\n${block(fs.readFileSync(doc, 'utf8'), 'markdown')}`;

/**
 * The contexts of one detection: the task, the document, the paths it names,
 * the list of every watched file, then the files, over as many calls as they
 * take. A deep audit needs every watched file. An incremental one needs the
 * changed files, with their diff, and adds unchanged neighbours where room is
 * left. `unaudited` names what no call carries and the audit needed.
 */
export const detectContexts = (pair, base) => {
  const { doc } = pair;
  const watches = watchesOf(doc);
  const watched = watchedFiles(watches).filter((f) => f !== doc);
  const changed = (pair.changed || []).filter((f) => watched.includes(f));
  const deep = (pair.changed || []).length === 0;
  const head = [
    `## Task input\n\n${block(JSON.stringify({ doc, watches, changed: pair.changed || [] }, null, 2), 'json')}`,
    documentSection(doc),
    ...namedPathsSection(namedPaths(doc, fs.readFileSync(doc, 'utf8'))),
    ...listing('Watched files', "Every file in this document's watches:", watched),
  ];
  const read = (file) => {
    const content = fs.readFileSync(file);
    if (content.includes(0)) {
      return { file, binary: true };
    }
    const diff = !deep && base && changed.includes(file) ? git(['diff', `${base}..HEAD`, '--', file]) : '';
    return { file, content: content.toString('utf8'), diff };
  };
  if (deep) {
    const { contexts, omitted } = packContexts(head, watched.map(read), []);
    return { contexts, unaudited: omitted };
  }
  // A change to the document alone still needs code to be checked against.
  const { contexts, omitted } = packContexts(
    head,
    changed.map(read),
    watched.filter((f) => !changed.includes(f)).map(read),
  );
  return { contexts, unaudited: omitted.filter((f) => changed.includes(f.replace(/ \(.*\)$/, ''))) };
};

/**
 * The context of one fix: the finding, the document, the paths it names and the
 * evidence files it cites.
 */
export const fixContext = (finding) => {
  const { doc } = finding;
  const watched = new Set(watchedFiles(watchesOf(doc)));
  const cited = [...new Set((finding.evidence || []).map((e) => String(e).replace(/[:#]\d.*$/, '')))];
  const named = namedPaths(doc, fs.readFileSync(doc, 'utf8'));
  const parts = [
    `## Finding\n\n${block(JSON.stringify(finding, null, 2), 'json')}`,
    documentSection(doc),
    ...namedPathsSection(named),
  ];
  const outside = cited.filter((f) => !watched.has(f) && !named.includes(f));
  if (outside.length > 0) {
    parts.push(
      `## Evidence not provided\n\nOutside the document's watched files:\n\n${outside.map((f) => `- ${f}`).join('\n')}`,
    );
  }
  return oneContext(
    parts,
    sectionsOf(
      cited.filter((f) => watched.has(f)),
      (file, content) => `## File \`${file}\`\n\n${block(numbered(content))}`,
    ),
  );
};

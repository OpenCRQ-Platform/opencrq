/**
 * Prints which documents the drift check would audit and the size of what each
 * agent call would carry, without calling any AI.
 *
 *   node .github/docs-drift/scripts/dry-run.js             # deep mode
 *   node .github/docs-drift/scripts/dry-run.js <since-sha> # incremental mode
 *   node .github/docs-drift/scripts/dry-run.js --site <dir> # the site map, deep mode
 *
 * <dir> holds the documentation site's mirror, or at least its docs/content:
 * the site map's pages are read there, and the code from this repository's
 * working tree.
 */
import fs from 'node:fs';
import path from 'node:path';

import { detectContexts, gitLines as git, parseMap } from './drift-context.js';
import { unmapped as unmappedSitePages } from './site-findings.js';

const site = process.argv[2] === '--site' ? path.resolve(process.argv[3] || '') : null;
if (site && !fs.existsSync(path.join(site, 'docs/content'))) {
  console.error(`${process.argv[3] || '(none)'} is not a checkout of the documentation site's mirror`);
  process.exit(2);
}
const MAP = site ? '.github/docs-drift/site-map.yml' : '.github/docs-drift/docs-map.yml';
if (site) {
  process.env.DOC_ROOT = site;
  process.env.MAP_FILE = MAP;
}
const since = site ? null : process.argv[2] || null;
const mapText = fs.readFileSync(MAP, 'utf8');
const entries = parseMap(mapText);
let problems = 0;
let audited = 0;

const mapped = new Set(entries.map((e) => e.doc));
const unmapped = site
  ? unmappedSitePages(site, mapText)
  : git(['ls-files', '--', ':(glob)docs/**/*.md']).filter((f) => !mapped.has(f));
if (unmapped.length > 0) {
  console.log(
    site
      ? 'UNMAPPED  every OpenCRQ page of the site, and every deploy page naming OpenCRQ, has to be in the map or listed as unaudited'
      : 'UNMAPPED  every markdown file under docs/ has to be in the map',
  );
  unmapped.forEach((f) => console.log(`          ${f}`));
  problems += unmapped.length;
}

for (const { doc, watches } of entries) {
  if (!fs.existsSync(path.join(site || '.', doc))) {
    console.log(`BROKEN  ${doc}  <-- document does not exist`);
    problems++;
    continue;
  }
  const specs = watches.map((w) => `:(glob)${w}`);
  const dead = watches.filter((w) => git(['ls-files', '--', `:(glob)${w}`]).length === 0);
  if (dead.length > 0) {
    console.log(`DEAD    ${doc}`);
    dead.forEach((w) => console.log(`          watch matches no tracked file: ${w}`));
    problems++;
  }
  const changed = since ? git(['diff', '--name-only', `${since}..HEAD`, '--', ...specs, doc]) : [];
  const watched = git(['ls-files', '--', ...specs]).length;
  const willAudit = !since || changed.length > 0;
  if (willAudit) {
    audited++;
  }
  // What the agent call would carry, so the size cap is set from real numbers.
  const audit = willAudit ? detectContexts({ doc, changed }, since) : null;
  const kb = audit ? audit.contexts.map((c) => Math.round(Buffer.byteLength(c.context) / 1024)) : [];
  const calls = kb.length > 1 ? `${kb.length} calls of ${kb.join(' + ')} KB` : `${kb[0]} KB`;
  const unaudited = audit?.unaudited.length ? `, ${audit.unaudited.length} not sent` : '';
  const sent = audit ? `, ${calls} sent${unaudited}` : '';
  console.log(
    `${since ? (willAudit ? 'AUDIT ' : 'skip  ') : 'deep  '}  ${doc}  ` +
      `(${watched} watched file${watched === 1 ? '' : 's'}${since ? `, ${changed.length} changed` : ''}${sent})`,
  );
  changed.slice(0, 5).forEach((c) => console.log(`          ${c}`));
  if (changed.length > 5) {
    console.log(`          ... and ${changed.length - 5} more`);
  }
}

console.log(`\n${audited}/${entries.length} documents would be audited${since ? ` since ${since}` : ' (deep mode)'}.`);
console.log(problems === 0 ? 'Map is healthy.' : `${problems} map problem(s) to fix.`);
process.exit(problems === 0 ? 0 : 1);

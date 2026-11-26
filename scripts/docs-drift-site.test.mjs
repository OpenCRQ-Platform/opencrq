/**
 * Pins what the site audit lets through to the documentation site's public mirror, and how a
 * finding is recognised across runs. Run with `yarn test:scripts`.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { check, fingerprint, marker, namesCode, parseMarkers, render, tracking, triage, unmapped } = await import(
  pathToFileURL(path.join(ROOT, '.github/docs-drift/scripts/site-findings.js'))
);

const TOP = ['.github', 'back', 'docker', 'docs', 'front', 'module', 'utils'];
const DOC = 'docs/content/opencrq/use/search.md';
const PAGE =
  '# Search\n\nThe search covers assets, scenarios and findings.\nIt returns at most 50 results\nper type, sorted by relevance.\n';
const LONG = 'It returns at most 50 results per type, sorted by relevance.';
const SHORT = 'It returns at most 50 results per type';

const finding = (excerpt, extra = {}) => ({
  doc: DOC,
  doc_excerpt: excerpt,
  evidence: ['module/src/search.ts:12'],
  explanation: 'OpenCRQ returns at most 20 results per type.',
  suggested_fix: 'Say 20.',
  ...extra,
});
const readPage = (doc) => (doc === DOC ? PAGE : null);
const issue = (findings, state = 'open', stateReason = null) => ({
  url: 'https://github.com/o/r/issues/1',
  state,
  state_reason: stateReason,
  body: findings.map((f) => marker('docs-drift', { ...f, id: fingerprint(f.doc, f.doc_excerpt) })).join('\n'),
});

describe('docs drift site findings', () => {
  it('lets a product or file name the site uses through, and holds back a text naming the code', () => {
    assert.equal(namesCode('OpenCRQ requires Node.js 24.', TOP), false);
    assert.equal(namesCode('The service in docker-compose.yml is named opencrq.', TOP), false);
    assert.equal(namesCode('See https://filigran.io/docs/deploy/install/opencrq/ and prometheus.yml.', TOP), false);
    assert.equal(namesCode('The handler in sync-handler.ts does it.', TOP), true);
    assert.equal(namesCode('See `module/src/modules/x` for it.', TOP), true);
    assert.equal(namesCode('The default lives in config/default.json.', TOP), true);
    assert.equal(namesCode('Fine.\n```\nconst a = 1\n```', TOP), true);
  });

  it('keeps a finding on a mapped page with a well-formed id, a suggested fix that is not a string emptied', () => {
    const checked = check(
      [
        { ...finding(LONG), id: 'aaaaaaaaaaaa', suggested_fix: {} },
        { ...finding(LONG), id: 'nothex' },
        { ...finding(LONG), id: 'bbbbbbbbbbbb', doc: 'docs/content/other.md' },
        { ...finding(LONG), id: 'cccccccccccc', explanation: 'Read back/src/x.ts.' },
      ],
      { mapped: [DOC], topLevel: TOP },
    );
    assert.deepEqual(
      checked.map((f) => [f.id, f.suggested_fix, f.public]),
      [
        ['aaaaaaaaaaaa', '', true],
        ['cccccccccccc', 'Say 20.', false],
      ],
    );
  });

  it('drops a finding whose excerpt is not a passage of its page, and reports a passage once per run', () => {
    const { todo, unquoted } = triage(
      [finding('It returns at most 20 results'), finding(LONG), finding(`  ${LONG.replace(/ /g, '\n')} `)],
      { readPage },
    );
    assert.equal(unquoted, 1);
    assert.deepEqual(
      todo.map((f) => f.id),
      [fingerprint(DOC, LONG)],
    );
  });

  it('treats a passage quoted longer or shorter than an open report as known, but not a short shared phrase', () => {
    const open = issue([finding(SHORT)]);
    assert.equal(triage([finding(LONG)], { readPage, issues: [open] }).known.length, 1);
    const phrase = issue([finding('at most 50')]);
    assert.equal(triage([finding(LONG)], { readPage, issues: [phrase] }).todo.length, 1);
  });

  it('reports again a passage of an issue closed as completed, never one closed as not planned', () => {
    const completed = issue([finding(LONG)], 'closed', 'completed');
    const dismissed = issue([finding(LONG)], 'closed', 'not_planned');
    assert.equal(triage([finding(LONG)], { readPage, issues: [completed] }).todo.length, 1);
    assert.deepEqual(triage([finding(LONG)], { readPage, issues: [dismissed] }).known, [
      { doc: DOC, url: dismissed.url, state: 'not_planned' },
    ]);
  });

  it('lists a finding the mirror did not get once on the tracking issue, and sends it when a run reaches the mirror', () => {
    const [f] = triage([finding(LONG)], { readPage }).todo;
    const first = tracking([f], { posted: false });
    assert.equal(first.lines.length, 1);
    const comments = [{ url: 'https://github.com/o/r/issues/2#c1', body: first.lines.join('\n') }];
    const [again] = triage([finding(LONG)], { readPage, comments }).todo;
    assert.equal(again.unsent, comments[0].url);
    assert.deepEqual(tracking([again], { posted: false }), { lines: [], repeats: 1 });
    assert.equal(tracking([again], { posted: true }).lines.length, 1);
  });

  it('never lists a held finding again', () => {
    const [f] = triage([finding(LONG)], { readPage }).todo;
    const { lines } = tracking([f], { held: [f.id], posted: false });
    const comments = [{ url: 'https://github.com/o/r/issues/2#c1', body: lines.join('\n') }];
    assert.equal(triage([finding(LONG)], { readPage, comments }).known[0].state, 'kept off the mirror');
  });

  it('renders the issue with each page linked, every mention muted and a marker that reads back', () => {
    const f = { ...finding(LONG, { explanation: 'Ask @someone about it.' }), id: fingerprint(DOC, LONG) };
    const body = render([f], { site: 'https://filigran.io/docs', release: '0.261123.0' });
    assert.match(body, /- https:\/\/filigran\.io\/docs\/opencrq\/use\/search\/\n/);
    assert.match(body, /\*\*Version:\*\* OpenCRQ 0\.261123\.0/);
    assert.doesNotMatch(body, /@someone/);
    assert.deepEqual(parseMarkers(body), [{ kind: 'docs-drift', id: f.id, doc: DOC, excerpt: LONG }]);
  });

  it('requires a map entry for every OpenCRQ page and every deploy page naming OpenCRQ not listed as unaudited', () => {
    const site = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-drift-site-'));
    const page = (p, text) => {
      fs.mkdirSync(path.join(site, path.dirname(p)), { recursive: true });
      fs.writeFileSync(path.join(site, p), text);
    };
    page(DOC, PAGE);
    page('docs/content/opencrq/index.md', '# OpenCRQ\n');
    page('docs/content/deploy/plan/sizing.md', 'OpenCRQ needs 4 GB.\n');
    page('docs/content/deploy/index.md', 'OpenCTI, OpenAEV, OpenCRQ.\n');
    page('docs/content/deploy/plan/network.md', 'OpenCTI only.\n');
    page('docs/content/reference/opencrq/configuration.md', 'OpenCRQ settings.\n');
    const map = `# unaudited: docs/content/deploy/index.md  the platform overview\n\n- doc: ${DOC}\n  watches:\n    - src/**\n`;
    assert.deepEqual(unmapped(site, map), ['docs/content/deploy/plan/sizing.md', 'docs/content/opencrq/index.md']);
  });
});

/**
 * What the site audit keeps of the agent's findings and how it publishes them.
 * The findings come from an external agent that read private code, and the
 * mirror's issues are public: everything here sits between the two.
 *
 *   site-findings.js triage <report.json> <site-dir> <reported.json> <out-dir>
 *   site-findings.js check <todo.json> <map> <out-dir>
 *   site-findings.js tracking <todo.json> <held.json> <posted: true|false>
 *   site-findings.js unmapped <site-dir> <map>
 *
 * <reported.json> is {issues, comments}: the mirror issues this workflow opened
 * ({url, state, state_reason, body}) and its comments on the tracking issue
 * ({url, body}). `check` reads SITE_URL and RELEASE from the environment. Step
 * outputs go to $GITHUB_OUTPUT, stdout outside a workflow.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { gitLines, parseMap } from './drift-context.js';

const normalize = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();

export const fingerprint = (doc, excerpt) =>
  createHash('sha1').update(`${doc}|${normalize(excerpt)}`).digest('hex').slice(0, 12);

// The passage travels with its id, so a later run can recognise it quoted a
// sentence longer or shorter.
export const marker = (kind, finding) =>
  `<!-- ${kind}:${finding.id} ${Buffer.from(
    JSON.stringify({ doc: finding.doc, excerpt: normalize(finding.doc_excerpt) }),
  ).toString('base64url')} -->`;

export const parseMarkers = (body) =>
  [...String(body ?? '').matchAll(/<!-- (docs-drift(?:-held|-unsent)?):([0-9a-f]{12})(?: ([A-Za-z0-9_-]+))? -->/g)].map(
    ([, kind, id, payload]) => {
      try {
        const { doc, excerpt } = JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8'));
        return { kind, id, doc, excerpt };
      } catch {
        return { kind, id, doc: null, excerpt: null };
      }
    },
  );

// Below this length, a passage contained in another is a phrase both happen to
// share rather than the same drift.
const MIN_OVERLAP = 30;

const samePassage = (a, b) =>
  a === b || (Math.min(a.length, b.length) >= MIN_OVERLAP && (a.includes(b) || b.includes(a)));

// A closed issue still holds its passages only when it was dismissed: one
// closed as completed with a passage left unfixed has it reported again.
const DISMISSED = new Set(['not_planned', 'duplicate']);

/**
 * Splits the agent's findings into those to report and those already reported.
 * A finding whose excerpt is not a passage of its page is dropped: the excerpt
 * is published as a quote of the page. A finding an earlier run could not send
 * to the mirror is reported again, carrying `unsent`, the comment that listed it.
 */
export const triage = (findings, { readPage, issues = [], comments = [] }) => {
  const reports = [
    ...issues
      .filter((i) => i.state === 'open' || DISMISSED.has(i.state_reason))
      .flatMap((i) =>
        parseMarkers(i.body)
          .filter((m) => m.kind === 'docs-drift')
          .map((m) => ({ ...m, url: i.url, state: i.state === 'open' ? 'open' : i.state_reason })),
      ),
    ...comments.flatMap((c) =>
      parseMarkers(c.body)
        .filter((m) => m.kind !== 'docs-drift')
        .map((m) => ({ ...m, url: c.url, state: m.kind === 'docs-drift-held' ? 'kept off the mirror' : 'unsent' })),
    ),
  ];
  const pages = new Map();
  const page = (doc) => {
    if (!pages.has(doc)) {
      const text = readPage(doc);
      pages.set(doc, text == null ? null : normalize(text));
    }
    return pages.get(doc);
  };
  const todo = [];
  const known = [];
  let unquoted = 0;
  for (const f of findings) {
    const excerpt = normalize(f.doc_excerpt);
    const text = page(f.doc);
    if (excerpt === '' || text == null || !text.includes(excerpt)) {
      unquoted++;
      continue;
    }
    const id = fingerprint(f.doc, excerpt);
    if (todo.some((t) => t.doc === f.doc && samePassage(normalize(t.doc_excerpt), excerpt))) {
      continue;
    }
    const seen = reports.find((r) => r.id === id || (r.doc === f.doc && r.excerpt && samePassage(r.excerpt, excerpt)));
    if (seen && seen.state !== 'unsent') {
      known.push({ doc: f.doc, url: seen.url, state: seen.state });
    } else {
      todo.push({ ...f, id, ...(seen ? { unsent: seen.url } : {}) });
    }
  }
  return { todo, known, unquoted };
};

const SOURCE_FILE = /[\w-]\.(?:tsx?|mjs|cjs|sql)\b/;
const PATH_WITH_EXTENSION = /[\w.-]+\/[\w./-]*\.[A-Za-z]{1,5}\b/;

/**
 * Whether a text published for the documentation team names the private code:
 * a code fence, a source file, a path to a file, or a path under a top-level
 * entry of this repository. A product or file name the site itself uses, such
 * as `Node.js` or `docker-compose.yml`, passes.
 */
export const namesCode = (text, topLevel) => {
  const t = String(text ?? '').replace(/https?:\/\/\S+/g, ' ');
  if (/`{3}/.test(t) || SOURCE_FILE.test(t) || PATH_WITH_EXTENSION.test(t)) {
    return true;
  }
  return topLevel.some((d) => new RegExp(`(^|[\\s\`"'(])${d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`).test(t));
};

/** Keeps the findings on a mapped page with a well-formed id, and marks those the mirror may show. */
export const check = (findings, { mapped, topLevel }) =>
  findings
    .filter((f) => /^[0-9a-f]{12}$/.test(f.id ?? '') && mapped.includes(f.doc))
    .map((f) => {
      const suggested = typeof f.suggested_fix === 'string' ? f.suggested_fix : '';
      return {
        ...f,
        suggested_fix: suggested,
        public: !namesCode(`${f.explanation}\n${suggested}`, topLevel),
      };
    });

// An `@login` written by the agent would notify that person on a public repository.
const mute = (text) => String(text ?? '').replace(/@(?=[A-Za-z0-9])/g, '@\u200b');

const pageUrl = (doc, site) =>
  `${site}/${doc.replace(/^docs\/content\//, '').replace(/(\/index)?\.md$/, '')}/`;

const quote = (text) =>
  mute(text)
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');

export const render = (findings, { site, release }) => {
  const pages = [...new Set(findings.map((f) => f.doc))];
  const finding = (f) =>
    [
      quote(f.doc_excerpt),
      mute(f.explanation),
      ...(f.suggested_fix ? [`**Suggested fix:** ${mute(f.suggested_fix)}`] : []),
      marker('docs-drift', f),
    ].join('\n\n');
  return [
    `**Pages:**\n\n${pages.map((d) => `- ${pageUrl(d, site)}`).join('\n')}`,
    `**Version:** OpenCRQ ${release}`,
    `### What should change?\n\nOpenCRQ's documentation drift check compared these pages with the code of OpenCRQ ${release}` +
      ' and found passages that code contradicts. Close this issue as completed once they are fixed: a passage' +
      ' that still reads the same is reported again. Close it as not planned to dismiss them for good.',
    ...pages.map(
      (d) =>
        `#### ${pageUrl(d, site)}\n\n${findings
          .filter((f) => f.doc === d)
          .map(finding)
          .join('\n\n')}`,
    ),
  ].join('\n\n');
};

/**
 * The tracking comment's list of new findings. One the mirror did not get
 * carries a marker, so a later run does not list it again: `docs-drift-held`
 * for good, `docs-drift-unsent` until a run reaches the mirror. A finding an
 * earlier run already listed as unsent is counted in `repeats` instead.
 */
export const tracking = (todo, { held = [], posted = false }) => {
  const lines = [];
  let repeats = 0;
  for (const f of todo) {
    const isHeld = held.includes(f.id);
    if (f.unsent && !posted && !isHeld) {
      repeats++;
      continue;
    }
    const kind = isHeld ? 'docs-drift-held' : posted ? null : 'docs-drift-unsent';
    const evidence = (f.evidence ?? []).map((e) => `\`${e}\``).join(', ');
    const tail = kind ? ` ${marker(kind, f)}` : '';
    lines.push(
      `- ${isHeld ? '**Kept off the mirror.** ' : ''}\`${f.doc}\`: ${mute(normalize(f.doc_excerpt).slice(0, 200))}` +
        `\n  ${mute(normalize(f.explanation))}\n  Evidence: ${evidence}${tail}`,
    );
  }
  return { lines, repeats };
};

// Shared deploy pages a map leaves out on purpose, one `# unaudited: <path>` header line each.
const parseUnaudited = (text) => [...text.matchAll(/^# unaudited: (\S+)/gm)].map(([, doc]) => doc);

/**
 * The pages of the site that a map entry has to cover: every OpenCRQ page, and
 * every deploy page naming OpenCRQ that the map does not list as unaudited.
 */
export const unmapped = (siteDir, mapText) => {
  const mapped = new Set([...parseMap(mapText).map((e) => e.doc), ...parseUnaudited(mapText)]);
  return fs
    .readdirSync(path.join(siteDir, 'docs/content'), { recursive: true })
    .map((f) => `docs/content/${f.split(path.sep).join('/')}`)
    .filter(
      (f) =>
        /^docs\/content\/opencrq\/.+\.md$/.test(f) ||
        (/^docs\/content\/deploy\/.+\.md$/.test(f) &&
          /\bOpenCRQ\b/.test(fs.readFileSync(path.join(siteDir, f), 'utf8'))),
    )
    .filter((f) => !mapped.has(f))
    .sort();
};

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (dir, name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
const output = (values) =>
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT || '/dev/stdout',
    Object.entries(values)
      .map(([k, v]) => `${k}=${v}\n`)
      .join(''),
  );

const main = ([command, ...args]) => {
  switch (command) {
    case 'triage': {
      const [report, siteDir, reported, out] = args;
      const { issues, comments } = readJson(reported);
      const readPage = (doc) => {
        const file = path.join(siteDir, doc);
        return doc.startsWith('docs/content/') && !doc.includes('..') && fs.existsSync(file)
          ? fs.readFileSync(file, 'utf8')
          : null;
      };
      const { todo, known, unquoted } = triage(readJson(report).findings ?? [], { readPage, issues, comments });
      writeJson(out, 'todo.json', todo);
      writeJson(out, 'known.json', known);
      const retried = todo.filter((f) => f.unsent).length;
      output({ todo: todo.length, new: todo.length - retried, retried, known: known.length, unquoted });
      return;
    }
    case 'check': {
      const [todoFile, map, out] = args;
      const topLevel = [...new Set(gitLines(['ls-files']).map((f) => f.split('/')[0]))];
      const mapped = parseMap(fs.readFileSync(map, 'utf8')).map((e) => e.doc);
      const checked = check(readJson(todoFile), { mapped, topLevel });
      const visible = checked.filter((f) => f.public);
      writeJson(
        out,
        'held.json',
        checked.filter((f) => !f.public).map((f) => f.id),
      );
      if (visible.length > 0) {
        fs.writeFileSync(
          path.join(out, 'site-issue.md'),
          render(visible, { site: process.env.SITE_URL, release: process.env.RELEASE }),
        );
      }
      output({ public: visible.length });
      return;
    }
    case 'tracking': {
      const [todoFile, heldFile, posted] = args;
      const { lines, repeats } = tracking(readJson(todoFile), {
        held: fs.existsSync(heldFile) ? readJson(heldFile) : [],
        posted: posted === 'true',
      });
      if (repeats > 0) {
        console.log(`- Still not on the site's mirror, already listed by an earlier run: ${repeats}`);
      }
      if (lines.length > 0) {
        console.log('- New findings, with the code they rest on:');
        lines.forEach((l) => console.log(l.replace(/^/gm, '  ')));
      }
      return;
    }
    case 'unmapped': {
      const [siteDir, map] = args;
      console.log(JSON.stringify(unmapped(siteDir, fs.readFileSync(map, 'utf8'))));
      return;
    }
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(2);
  }
};

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}

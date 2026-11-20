/**
 * Pins the commit of the XTM One repository whose OpenCRQ tools the back tests hold against the router.
 *
 * Usage: node scripts/xtm-one-contract.mjs [--ref <ref>]
 *   --ref  branch, tag or commit of the XTM One repository to pin (default: main)
 *
 * Renovate moves the pin as XTM One's main moves. This is for a deliberate break, which pins the
 * XTM One commit that follows it in the pull request that makes it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PIN_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../back/src/features/xtm-one/contract/xtm-one-contract.json');
const pin = JSON.parse(fs.readFileSync(PIN_FILE, 'utf8'));
const { repository: REPOSITORY, files: SOURCES } = pin;

let ref = 'main';
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--ref' && args[i + 1] && !args[i + 1].startsWith('--')) {
    ref = args[++i];
  } else {
    console.error('usage: node scripts/xtm-one-contract.mjs [--ref <ref>]');
    process.exit(2);
  }
}

const commit = await fetch(`https://api.github.com/repos/${REPOSITORY}/commits/${encodeURIComponent(ref)}`, { headers: { Accept: 'application/vnd.github.sha' } });
if (!commit.ok) {
  throw new Error(`${REPOSITORY} answered HTTP ${commit.status} for the ref ${ref}`);
}
const sha = (await commit.text()).trim();

const missing = [];
for (const source of SOURCES) {
  const file = await fetch(`https://raw.githubusercontent.com/${REPOSITORY}/${sha}/${source}`, { method: 'HEAD' });
  if (!file.ok) {
    missing.push(source);
  }
}
if (missing.length > 0) {
  throw new Error(`${REPOSITORY}@${sha} does not hold ${missing.join(', ')}`);
}

const previous = pin.commit;
fs.writeFileSync(PIN_FILE, `${JSON.stringify({ ...pin, commit: sha }, null, 2)}\n`);
console.log(previous === sha ? `XTM One contract: already pinned at ${REPOSITORY}@${sha}.` : `XTM One contract: pinned at ${REPOSITORY}@${sha} (was ${previous}).`);

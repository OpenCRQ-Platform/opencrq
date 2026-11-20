/**
 * Runs one call of the drift agent, an XTM One agent reached as an MCP tool.
 *
 *   node ask-agent.js detect <pair.json>    # prints {"findings":[...],"unaudited":[...],"failedCalls":[...]}
 *   node ask-agent.js fix <finding.json>    # edits the document in place, exit 3 when nothing to change
 *   node ask-agent.js context <detect|fix> <file.json>   # prints the context, calls nothing
 *   node ask-agent.js check                 # fails unless the key reaches the agent
 *
 * The agent answers text and touches nothing: this script writes the files.
 */
import fs from 'node:fs';

import { detectContexts, fixContext } from './drift-context.js';

const NOTHING_TO_CHANGE = 3;

const env = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
};

const prompt = (task) => fs.readFileSync(`${process.env.PROMPTS_DIR || '.github/docs-drift/prompts'}/${task}.md`, 'utf8');

const lastEvent = (stream) =>
  stream
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .at(-1)
    .slice(5);

const RATE_LIMIT_RETRIES = 3;

const sleep = (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

/** An HTTP refusal, kept apart so that a dead key reads as one rather than as a failed call. */
class Refused extends Error {
  constructor(status, text) {
    const body = text.replace(/\s+/g, ' ');
    super(
      status === 401 || status === 403
        ? `the XTM One key was refused (HTTP ${status}: ${body.slice(0, 200)}). Create a key as described at the top ` +
            'of docs-drift-check.yml, then update the DOCS_DRIFT_AGENT_API_KEY secret'
        : `HTTP ${status}: ${body.slice(0, 300)}`,
    );
  }
}

// One POST per call: the endpoint keeps no session and needs no handshake.
// The key's own rate limit answers 429 before any agent runs, so a retry
// repeats no work.
const post = async (method, params, timeoutSeconds) => {
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(env('DOCS_DRIFT_AGENT_MCP_URL'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env('DOCS_DRIFT_AGENT_API_KEY')}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-06-18',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutSeconds * 1000),
    });
    const body = await response.text();
    if (response.status === 429 && attempt < RATE_LIMIT_RETRIES) {
      const wait = Math.min(Number(response.headers.get('retry-after')) || 30, 120);
      console.error(`rate limited, retrying in ${wait}s`);
      await sleep(wait);
      continue;
    }
    if (!response.ok) {
      throw new Refused(response.status, body);
    }
    const streamed = response.headers.get('content-type')?.includes('text/event-stream');
    const reply = JSON.parse(streamed ? lastEvent(body) : body);
    if (reply.error) {
      throw new Error(`MCP error ${reply.error.code}: ${reply.error.message}`);
    }
    return reply.result;
  }
};

// Lists the tools the key reaches: costs no agent run.
const check = async () => {
  const result = await post('tools/list', {}, 60);
  const names = (result?.tools || []).map((t) => t.name);
  if (!names.includes(env('DOCS_DRIFT_AGENT'))) {
    throw new Error(
      `the XTM One key does not reach the ${env('DOCS_DRIFT_AGENT')} agent (it reaches: ${names.join(', ') || 'none'}). ` +
        "Restrict the key to that agent, and check that the key's owner still sees it",
    );
  }
  console.log(`the key reaches ${env('DOCS_DRIFT_AGENT')}`);
};

// The server runs `context` then `message`, so the instructions come last.
const callAgent = async (message, context) => {
  const result = await post(
    'tools/call',
    { name: env('DOCS_DRIFT_AGENT'), arguments: { message, context } },
    Number(process.env.AGENT_TIMEOUT_SECONDS || 600),
  );
  const text = (result?.content || []).map((c) => c.text || '').join('');
  if (result?.isError) {
    throw new Error(`agent run failed: ${text.slice(0, 300)}`);
  }
  return text;
};

const parseAnswer = (text) => {
  const lines = text.trim().split('\n');
  const fenced = lines.length > 1 && /^`{3,}\w*$/.test(lines[0]) && /^`{3,}$/.test(lines.at(-1));
  const json = fenced ? lines.slice(1, -1).join('\n') : text.trim();
  try {
    return JSON.parse(json);
  } catch {
    throw new Error(`the answer is not JSON: ${text.slice(0, 200)}`);
  }
};

// The fingerprint the workflow gives a finding: two calls quoting the same
// passage found the same drift.
const passage = (f) => String(f.doc_excerpt).replace(/\s+/g, ' ').trim();

const detect = async (pair) => {
  const { contexts, unaudited } = detectContexts(pair, process.env.BASE);
  if (unaudited.length > 0) {
    console.error(`::warning::${pair.doc}: ${unaudited.length} file(s) could not be sent`);
  }
  const findings = new Map();
  const failedCalls = [];
  for (const [k, { context, files }] of contexts.entries()) {
    try {
      const answer = parseAnswer(await callAgent(prompt('detect'), context));
      if (!Array.isArray(answer.findings)) {
        throw new Error('the answer has no findings array');
      }
      // A finding is only trusted for the document this call audited.
      const own = answer.findings.filter((f) => f?.doc === pair.doc);
      if (own.length < answer.findings.length) {
        console.error(`::warning::${pair.doc}: dropped ${answer.findings.length - own.length} finding(s) about another document`);
      }
      own.forEach((f) => findings.set(passage(f), findings.get(passage(f)) ?? f));
    } catch (error) {
      // One failed call of a split document loses its share, not the others'.
      if (contexts.length === 1) {
        throw error;
      }
      console.error(`::warning::${pair.doc}: call ${k + 1} of ${contexts.length} failed: ${error.message}`);
      failedCalls.push({ call: k + 1, files, why: error.message.slice(0, 200) });
    }
  }
  if (failedCalls.length === contexts.length) {
    throw new Error(`every call failed, the first with: ${failedCalls[0].why}`);
  }
  console.log(
    JSON.stringify({
      findings: [...findings.values()],
      unaudited,
      failedCalls: failedCalls.map((f) => `call ${f.call} of ${contexts.length} (${f.files.length} files): ${f.why}`),
    }),
  );
};

// Overlapping matches count: `---` occurs three times in `-----`.
const occurrences = (text, part) => {
  let count = 0;
  for (let at = text.indexOf(part); at !== -1; at = text.indexOf(part, at + 1)) {
    count++;
  }
  return count;
};

const fix = async (finding) => {
  const { context } = fixContext(finding);
  const answer = parseAnswer(await callAgent(prompt('fix'), context));
  if (!Array.isArray(answer.edits)) {
    throw new Error('the answer has no edits array');
  }
  const original = fs.readFileSync(finding.doc, 'utf8');
  // Every passage is located in the original, never in a text earlier edits
  // changed: an ambiguous passage could otherwise become unique and land wrong.
  const spans = answer.edits
    .map((edit, i) => {
      if (typeof edit?.old !== 'string' || typeof edit?.new !== 'string' || edit.old === '') {
        throw new Error(`edit ${i + 1} is not an old/new pair`);
      }
      const count = occurrences(original, edit.old);
      if (count !== 1) {
        throw new Error(`edit ${i + 1}: its passage occurs ${count} times in the document`);
      }
      const at = original.indexOf(edit.old);
      return { n: i + 1, at, end: at + edit.old.length, text: edit.new };
    })
    .sort((a, b) => a.at - b.at);
  spans.forEach((span, k) => {
    if (k > 0 && span.at < spans[k - 1].end) {
      throw new Error(`edits ${spans[k - 1].n} and ${span.n} overlap`);
    }
  });
  let text = '';
  let from = 0;
  for (const span of spans) {
    text += original.slice(from, span.at) + span.text;
    from = span.end;
  }
  text += original.slice(from);
  if (text === original) {
    process.exit(NOTHING_TO_CHANGE);
  }
  fs.writeFileSync(finding.doc, text);
};

const [task, ...args] = process.argv.slice(2);
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

try {
  if (task === 'detect') {
    await detect(read(args[0]));
  } else if (task === 'fix') {
    await fix(read(args[0]));
  } else if (task === 'check') {
    await check();
  } else if (task === 'context') {
    const item = read(args[1]);
    const contexts = args[0] === 'fix' ? [fixContext(item)] : detectContexts(item, process.env.BASE).contexts;
    console.log(contexts.map((c) => c.context).join('\n\n<<<<<<<< next call >>>>>>>>\n\n'));
  } else {
    throw new Error(`unknown task ${task}: detect, fix, check or context`);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

/**
 * Claude Code adapter for the shared guards.
 *
 * Wired from `.claude/settings.json`, one entry per matcher, the matcher name passed as an
 * argument so the guard is chosen without depending on a payload field.
 *
 * Input:  {"tool_name":"Read","tool_input":{"file_path":"...","limit":40}}, or a Bash command
 * Refuse: {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",...}}
 */

import fs from 'node:fs';

import { guardBash, guardRead, guardWrite } from './guards.mjs';

const WRITERS = new Set(['Edit', 'Write', 'NotebookEdit']);

let payload = {};
try {
  payload = JSON.parse(fs.readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}

const tool = payload.tool_name ?? process.argv[2];
const input = payload.tool_input ?? {};
const path = input.file_path;

const reason = tool === 'Bash'
  ? guardBash({ command: input.command })
  : WRITERS.has(tool)
    ? guardWrite({ path })
    : guardRead({ path, ranged: input.limit != null || input.offset != null });

if (reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
}

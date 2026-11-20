# `.agents`

What Claude Code, the development assistant, and the Copilot pull request reviewer need that neither can find on its own. The shared body is `AGENTS.md` at the repository root; what lives here is everything that could not be written once and read by both. Which file each one actually loads is in `instructions/agent-hub.md`.

```
.agents/
├── instructions/   rendered into .github/instructions (reviewer) and .claude/rules
└── hooks/          the Claude Code guards and their adapter
```

Skills are **not** here: they live in `.claude/skills/`, where Claude Code reads them. Instructions are written here once and rendered into what Claude Code and the reviewer each read:

```bash
yarn agent:build      # render the instructions
yarn agent:check      # what CI runs: stale, missing or orphaned render, dead glob, broken link
```

Never edit a rendered file. Each carries a banner naming its source, and CI rejects the change.

Why the split falls this way, what the frontmatter fields do, and how to re-verify which directory an assistant actually reads: `instructions/agent-hub.md`, which loads by itself on any file under `.agents/`.

## Hooks

`hooks/guards.mjs` holds the decisions, `hooks/claude.mjs` translates Claude Code's payload and refusal format. Wiring lives in `.claude/settings.json`. See the `hooks` instruction for the contracts.

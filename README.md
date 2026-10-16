<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <img src="assets/logo-light.svg" alt="microkanban" height="56">
  </picture>
</h1>

[![test](https://github.com/JanTcz/cli-kanban/actions/workflows/test.yml/badge.svg)](https://github.com/JanTcz/cli-kanban/actions/workflows/test.yml)
[![coverage: 100%](https://img.shields.io/badge/coverage-100%25-brightgreen)](https://github.com/JanTcz/cli-kanban/actions/workflows/test.yml "Lines, branches and functions of src/; npm test fails below 100 %")
[![npm](https://img.shields.io/npm/v/microkanban)](https://www.npmjs.com/package/microkanban)
[![Socket Badge](https://socket.dev/api/badge/npm/package/microkanban)](https://socket.dev/npm/package/microkanban)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**A kanban board that lives in your repository, for you and your coding agents.**
One folder per state, one Markdown file per ticket. Moving a ticket is a
rename, and the ticket keeps its own history: every transition, every note,
every ticked acceptance criterion. It's diffable, reviewable and survives
the end of an agent's context window.

```
kanban/
  backlog/   MK-7-dark-mode.md
  todo/      MK-5-rate-limit-the-api.md   PROJ-142-export-to-csv.md
  doing/     MK-4-fix-the-login-form.md
  testing/
  blocked/   MK-6-payment-webhooks.md
  done/      MK-1-… MK-2-… MK-3-…
  .archive/  sprint-1/ …
```

Three ways to use it:

- **`npx microkanban`**, a CLI for you and for scripts: JSON on a pipe, a
  short summary on a terminal.
- **An MCP server** (`microkanban mcp`) with a tool for every operation, for any
  agent that speaks MCP.
- **A plugin for Claude Code and Codex**: the MCP server plus a skill that
  tells the agent *how* to work with the board: pick up a ticket, move it to
  doing, tick its criteria, write down decisions, hand it over to testing.

**Why a folder and not a tracker:**

- **The agent's memory outlives the session.** A to-do list in the agent's
  context is gone after compaction, a crash or a hand-over to a subagent; a
  ticket file isn't. The next session reads where the last one stopped.
- **It travels with the code.** Branches, pull requests and reviews see the
  board change together with the code that changed it.
- **Next to Jira or GitHub, or instead of them.** Use your tracker's keys
  (`PROJ-142`) and the board is the working copy; or let it number tickets
  itself (`MK-1`, `MK-2`, …).
- **No dependencies, no service, no account.** Plain ESM, Node 20 or newer.

## Getting started

### Claude Code

```
/plugin marketplace add JanTcz/cli-kanban
/plugin install microkanban@cli-kanban
```

### Codex

```bash
codex plugin marketplace add JanTcz/cli-kanban
```

then enable `microkanban@cli-kanban` in the plugin list (or in
`.codex/config.toml`: `[plugins."microkanban@cli-kanban"]` with `enabled = true`).

### Any other MCP client

```json
{
  "mcpServers": {
    "microkanban": { "command": "npx", "args": ["-y", "microkanban@0", "mcp"] }
  }
}
```

The skill is plain [Agent Skills](https://agentskills.io) Markdown: copy
[`agents/skills/microkanban/`](agents/skills/microkanban/SKILL.md) into the
agent's skills folder.

### The board

```bash
npx microkanban init      # kanban/ with a folder per state (.gitkeep in each, commit it)
```

Without `init` the first `add` creates what it needs. The board is the nearest
`kanban/` folder above the current directory, or `kanban/` in the root of the
git repository; `--root` or `MICROKANBAN_ROOT` points elsewhere.

## The CLI

```bash
microkanban add "Fix the login form" --state=todo --note="- [ ] validation
- [ ] error message"                          # MK-1, the next free number
microkanban add PROJ-142 "Export to CSV"       # a key from your tracker
microkanban summary                            # counts per state, what's in doing
microkanban list --state=todo                  # alias: ls
microkanban show MK-1
microkanban move MK-1 doing --note="started"   # alias: mv
microkanban check MK-1 2                       # tick the 2nd checkbox (--uncheck)
microkanban append MK-1 --section=Notes --note="Chose zod: the API uses it already"
microkanban move MK-1 testing --note="verify: npm test, then the form by hand"
microkanban close MK-1 --note="merged in #42"  # to done/
microkanban close MK-1 --archive --sprint=s1   # to .archive/s1/
microkanban audit                              # exit 1 when it finds something
```

| Command | Does |
|---|---|
| `init` | Creates `kanban/<state>/` for every state |
| `add [KEY] [TITLE]` | A new ticket (default state `backlog`); `--slug`, `--note`, `--sprint`, `--prefix` |
| `summary` | Ticket counts per state and the tickets in doing |
| `list` | Tickets by state; `--state`, `--ticket` |
| `show KEY` | The ticket's file |
| `move KEY STATE` | Moves it and records the transition; `--note` |
| `append KEY NOTE` | Adds a note at the end, or at the end of `--section` (created when missing) |
| `check KEY N` | Ticks the N-th `- [ ]` checkbox; `--uncheck` |
| `close KEY` | To `done/`, or with `--archive` to `.archive/<--sprint or date>/` |
| `audit` | Files without a key, keys on the board twice, tickets in doing longer than `--max-doing-age` (48 h) or blocked longer than `--max-blocked-age` (72 h) |
| `mcp` | The MCP server on stdin/stdout |

Output is JSON when stdout isn't a terminal (or with `--json`), a summary
otherwise (or with `--text`). Exit codes: `0` done, `1` the board doesn't
allow it (unknown ticket, key exists, `audit` found something), `2` wrong
arguments.

States: `backlog → todo → doing → testing → done`, and `blocked` from anywhere.

## A ticket

```markdown
---
ticket: MK-4
state: doing
created: 2026-10-16T08:12:03.000Z
---

# MK-4: Fix the login form

- [x] validation
- [ ] error message

## Transition 2026-10-16T09:30:11.000Z todo → doing
started

## Notes

Chose zod: the API uses it already.
```

The file name is `<KEY>-<slug>.md`; the key is any `PREFIX-NUMBER`. The tools
keep `state:` in the frontmatter in step with the folder and append a
`## Transition` for every move, so `git log -p` and the file itself both tell
the story. Everything else in the file is yours: edit it by hand as you like.

## The MCP server

`microkanban mcp` speaks MCP over stdio (protocol versions 2024-11-05 to
2025-06-18). Every tool returns the same JSON as the CLI, as text and as
`structuredContent`; a ticket that doesn't exist is a tool result with
`isError`, not a protocol error.

| Tool | |
|---|---|
| `kanban_summary` | Counts per state and the tickets in doing. Cheap; agents call it first |
| `kanban_list` | Tickets, by `state` or `ticket` |
| `kanban_show` | One ticket's file |
| `kanban_add` | `title`, optional `ticket`, `state`, `note`, `slug`, `sprint`, `prefix` |
| `kanban_move` | `ticket`, `to`, `note` |
| `kanban_append` | `ticket`, `note`, `section` |
| `kanban_check` | `ticket`, `item`, `uncheck` |
| `kanban_close` | `ticket`, `note`, `archive`, `sprint` |
| `kanban_audit` | `max_doing_hours`, `max_blocked_hours` |
| `kanban_init` | Creates the board |

The server finds the board like the CLI does, from `MICROKANBAN_ROOT`,
`CLAUDE_PROJECT_DIR` or its working directory.

## As a library

```js
import { Board, findRoot } from 'microkanban';

const board = new Board(findRoot());
const { ticket } = board.add({ title: 'Nightly backup', state: 'todo' });
board.move(ticket, 'doing', { note: 'cron job drafted' });
console.log(board.summary().counts);
```

Every method returns the JSON the CLI prints and throws a `KanbanError`
(`code` `usage` or `op`) when it can't. Types are in `src/index.d.ts`.

## This repository

```
src/board.js      the board: every operation, no I/O besides the kanban/ folder
src/cli.js        the microkanban command
src/mcp.js        the MCP server (JSON-RPC 2.0 over stdio)
bin/              microkanban
agents/           the plugin: skill, .mcp.json, Claude Code and Codex manifests
.claude-plugin/   the Claude Code marketplace (this repository)
.agents/plugins/  the Codex marketplace (this repository)
test/             node:test, 100 % coverage of src/ enforced by npm test
```

```bash
npm test          # all tests; fails below 100 % lines, branches or functions
```

### Releasing

Bump `version` in `package.json` and both `agents/*/plugin.json`, then push a
tag `v<version>`. `.github/workflows/release.yml` checks that the tag and the
three versions match, runs the tests and publishes to npm with provenance
(Trusted Publishing, no token in the repository).

## Origin

microkanban grew up inside a larger agent framework, where it tracked over a hundred
tickets worked on by parallel coding agents. This is the board on its own,
with the framework's specifics taken out, and its file format unchanged: boards
from there work here as they are.

## License

[MIT](LICENSE) © 2026 Jan Truhlar

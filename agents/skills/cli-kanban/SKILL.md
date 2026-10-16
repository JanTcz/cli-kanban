---
name: cli-kanban
description: Track work on the project's kanban board, a kanban/ folder of Markdown tickets (one folder per state). Use when the project has a kanban/ folder, when the user mentions tickets, the board, backlog, todo or doing, when starting or finishing a non-trivial task, or when asked to plan work into tickets.
---

# cli-kanban

The board is the `kanban/` folder in the project. A ticket is a Markdown file
`<KEY>-<slug>.md`; its state is the folder it is in:

```
backlog → todo → doing → testing → done
                   ↓  ↑
                  blocked
```

Use the `kanban_*` MCP tools when they are available. Otherwise run the CLI:
`npx -y cli-kanban@0 <command>` (JSON output when piped). Never move or
rename ticket files by hand: the tools record every transition in the ticket.

## When you start

1. `kanban_summary` (CLI: `summary`) to see what is in doing.
   If the task you were given matches a ticket, use that one and read it with
   `kanban_show`: its notes and checkboxes are the context you start from.
2. If there is no ticket for non-trivial work, create one: `kanban_add` with a
   short imperative title, `state: todo`, and a note with the context and the
   acceptance criteria as `- [ ]` checkboxes. Use the key from the user's
   tracker (Jira, GitHub, …) when there is one; otherwise let it number itself.
3. `kanban_move` the ticket to `doing`. Keep at most two tickets in doing.

## While you work

- Tick acceptance criteria as they are met: `kanban_check` with the checkbox
  number (counted from 1, in the order they appear).
- Record decisions, findings and dead ends with `kanban_append`, in a
  `Notes` section. Write what the next person (or agent) needs, not a diary.
- Waiting on someone or something outside your control: `kanban_move` to
  `blocked` with a note saying exactly what is needed, from whom.

## When you finish

- Ready but not yet verified (tests, review, the user's check): `kanban_move`
  to `testing` with a note on how to verify it.
- Verified: `kanban_close` with a one-line note on the outcome.
- Do not close a ticket whose checkboxes are not all ticked; say which are
  open instead.

## Housekeeping

`kanban_audit` lists files without a ticket key, keys on the board twice and
tickets that have sat in doing or blocked too long. Report what it finds;
fix only what the user asks you to.

## CLI equivalents

```bash
npx -y cli-kanban@0 list --state=doing
npx -y cli-kanban@0 add "Fix the login form" --state=todo --note="- [ ] validation"
npx -y cli-kanban@0 move KB-3 doing --note="started"
npx -y cli-kanban@0 check KB-3 1
npx -y cli-kanban@0 append KB-3 --section=Notes --note="Chose X because Y"
npx -y cli-kanban@0 close KB-3 --note="merged in #42"
```

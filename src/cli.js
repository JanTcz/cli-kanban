// The `cli-kanban` command. JSON on a pipe (or with --json), a short summary on a terminal.

import fs from 'node:fs';
import { Board, KanbanError, STATES, findRoot } from './board.js';
import { serve } from './mcp.js';

export const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const BOOLEAN = new Set(['json', 'text', 'help', 'archive', 'uncheck', 'version']);

export const USAGE = `cli-kanban ${VERSION}: a kanban board of Markdown files, for you and your coding agents

Usage: cli-kanban <command> [arguments] [--flags]

  init                                    create kanban/ with a folder per state
  add [TICKET] [TITLE] [--state=backlog]  new ticket; without TICKET the next free KB-<n>
      [--slug=s] [--note=text] [--sprint=id] [--prefix=KB]
  summary                                 ticket counts per state and what is in doing
  list [--state=s] [--ticket=KEY]         tickets by state (alias: ls)
  show TICKET                             the ticket's file
  move TICKET STATE [--note=text]         move to another state (alias: mv)
  append TICKET NOTE [--section=heading]  add a note, at the end or under a heading
  check TICKET N [--uncheck]              tick the N-th checkbox
  close TICKET [--note=text] [--archive] [--sprint=id]
                                          move to done, or to kanban/.archive/<sprint|date>/
  audit [--max-doing-age=48] [--max-blocked-age=72]
                                          orphan files, duplicate keys, stale tickets (exit 1)
  mcp                                     MCP server on stdin/stdout

States: ${STATES.join(', ')}
Global: --root=<dir> (the kanban folder, also CLI_KANBAN_ROOT), --json, --text, --help, --version
`;

/** `--a=b`, `--a b`, boolean flags and positionals; `--` ends the flags. */
export function parseArgs(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (a === '-h') {
      flags.help = true;
    } else if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
      if (eq !== -1) flags[name] = a.slice(eq + 1);
      else if (BOOLEAN.has(name)) flags[name] = true;
      else if (i + 1 < args.length) flags[name] = args[++i];
      else throw new KanbanError(`--${name} needs a value`, 'usage');
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function hours(value, name, fallback) {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new KanbanError(`--${name} must be a number of hours`, 'usage');
  return n;
}

function need(value, what) {
  if (!value) throw new KanbanError(`${what} is required`, 'usage');
  return value;
}

const text = {
  init: (r) => (r.created.length ? `created ${r.root}/ (${r.created.join(', ')})` : `${r.root}/ already exists`),
  add: (r) => `added ${r.ticket} → ${r.path}`,
  list: (r) => {
    if (!r.count) return `no tickets in ${r.root}/`;
    const lines = [];
    for (const state of STATES) {
      const here = r.entries.filter((e) => e.state === state);
      if (!here.length) continue;
      lines.push(`${state} (${here.length})`);
      for (const e of here) lines.push(`  ${e.ticket.padEnd(10)} ${e.title}`);
    }
    return lines.join('\n');
  },
  summary: (r) =>
    r.exists
      ? [
          STATES.map((s) => `${s} ${r.counts[s]}`).join(' · '),
          ...r.doing.map((d) => `doing: ${d.ticket} ${d.title}`),
        ].join('\n')
      : `no board at ${r.root}/ (cli-kanban init creates it)`,
  show: (r) => r.content.trimEnd(),
  move: (r) => `moved ${r.ticket}: ${r.from} → ${r.to}`,
  close: (r) => `closed ${r.ticket} → ${r.path}`,
  append: (r) => `appended to ${r.ticket}${r.section ? ` under "${r.section}"` : ''}`,
  check: (r) => `${r.checked ? 'ticked' : 'unticked'} ${r.ticket} #${r.item} (${r.done}/${r.total}): ${r.text}`,
  audit: (r) => {
    if (r.ok) return 'board is clean';
    return [
      ...r.orphans.map((o) => `orphan (no ticket key): ${o.path}`),
      ...r.duplicates.map((d) => `duplicate ${d.ticket}: ${d.paths.join(', ')}`),
      ...r.stale_doing.map((s) => `stale doing ${s.ticket}: ${s.age_hours} h (limit ${r.limits.doing} h)`),
      ...r.stale_blocked.map((s) => `stale blocked ${s.ticket}: ${s.age_hours} h (limit ${r.limits.blocked} h)`),
    ].join('\n');
  },
};

function run(board, command, positional, flags) {
  const [a, b, ...rest] = positional;
  switch (command) {
    case 'init':
      return board.init();
    case 'add': {
      // `add ABC-1 Title`, `add "Title"`, `add ABC-1 --slug=x`
      let ticket = a;
      let title = [b, ...rest].filter(Boolean).join(' ');
      if (a && !/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(a)) {
        ticket = undefined;
        title = positional.join(' ');
      }
      return board.add({
        ticket,
        title: title || undefined,
        slug: flags.slug,
        state: flags.state,
        note: flags.note,
        sprint: flags.sprint,
        prefix: flags.prefix,
      });
    }
    case 'summary':
      return board.summary();
    case 'list':
    case 'ls':
      return board.list({ state: flags.state ?? a, ticket: flags.ticket });
    case 'show':
      return board.show(need(a, 'show: TICKET'));
    case 'move':
    case 'mv':
      return board.move(need(a, 'move: TICKET'), need(flags.to ?? b, 'move: the target STATE'), { note: flags.note });
    case 'append':
      return board.append(need(a, 'append: TICKET'), flags.note ?? [b, ...rest].join(' '), { section: flags.section });
    case 'check':
      return board.check(need(a, 'check: TICKET'), need(b, 'check: the checkbox number N'), { uncheck: Boolean(flags.uncheck) });
    case 'close':
      return board.close(need(a, 'close: TICKET'), { note: flags.note, archive: Boolean(flags.archive), sprint: flags.sprint });
    case 'audit':
      return board.audit({
        maxDoingHours: hours(flags['max-doing-age'], 'max-doing-age', 48),
        maxBlockedHours: hours(flags['max-blocked-age'], 'max-blocked-age', 72),
      });
    default:
      throw new KanbanError(`unknown command "${command}"; cli-kanban --help lists them`, 'usage');
  }
}

/**
 * @param {string[]} args  the arguments after the command name
 * @returns {Promise<number>} the exit code
 */
export async function main(args, io = {}) {
  const {
    stdout = process.stdout,
    stderr = process.stderr,
    stdin = process.stdin,
    cwd = process.cwd(),
    env = process.env,
    isTTY = Boolean(stdout.isTTY),
    now,
  } = io;
  try {
    const { flags, positional } = parseArgs(args);
    const [command, ...rest] = positional;
    if (flags.version) {
      stdout.write(VERSION + '\n');
      return 0;
    }
    if (flags.help || !command || command === 'help') {
      stdout.write(USAGE);
      return 0;
    }
    const root = flags.root ? findRoot({ cwd, env: { CLI_KANBAN_ROOT: flags.root } }) : findRoot({ cwd, env });
    const board = new Board(root, { now });
    if (command === 'mcp') {
      await serve({ board, input: stdin, output: stdout, version: VERSION });
      return 0;
    }
    const result = run(board, command, rest, flags);
    const json = flags.json || (!isTTY && !flags.text);
    stdout.write((json ? JSON.stringify(result) : text[result.op](result)) + '\n');
    return result.op === 'audit' && !result.ok ? 1 : 0;
  } catch (err) {
    if (!(err instanceof KanbanError)) throw err;
    stderr.write(`cli-kanban: ${err.message}\n`);
    return err.code === 'usage' ? 2 : 1;
  }
}

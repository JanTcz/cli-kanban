import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { main, parseArgs, USAGE, VERSION } from '../src/cli.js';
import { KanbanError } from '../src/board.js';
import { clock, project, sink } from './helpers.js';

const BIN = fileURLToPath(new URL('../bin/cli-kanban.js', import.meta.url));

/** Runs the CLI in a project; `tty` picks the text output. */
function cli(t, { tty = false } = {}) {
  const cwd = project(t);
  const now = clock();
  const run = async (...args) => {
    const stdout = sink(tty);
    const stderr = sink();
    const code = await main(args, { stdout, stderr, cwd, env: {}, now });
    return { code, out: stdout.text, err: stderr.text, json: () => JSON.parse(stdout.text) };
  };
  run.cwd = cwd;
  run.now = now;
  return run;
}

test('parseArgs: = and space values, booleans, -h and --', () => {
  assert.deepEqual(parseArgs(['add', '--state=todo', '--note', 'a b', '--archive', '-h', '--', '--x']), {
    flags: { state: 'todo', note: 'a b', archive: true, help: true },
    positional: ['add', '--x'],
  });
  assert.throws(() => parseArgs(['--note']), (e) => e instanceof KanbanError && e.code === 'usage');
});

test('--help, help, no command, --version', async (t) => {
  const run = cli(t);
  for (const args of [['--help'], ['help'], [], ['-h']]) assert.equal((await run(...args)).out, USAGE);
  assert.equal((await run('--version')).out, VERSION + '\n');
  assert.match(VERSION, /^\d+\.\d+\.\d+/);
});

test('JSON on a pipe, text on a terminal, --json and --text override', async (t) => {
  const pipe = cli(t);
  assert.deepEqual((await pipe('init')).json().op, 'init');
  assert.match((await pipe('list', '--text')).out, /^no tickets in kanban\/\n$/);
  const tty = cli(t, { tty: true });
  assert.match((await tty('init')).out, /^created kanban\/ \(backlog, todo, doing, testing, blocked, done\)\n$/);
  assert.equal((await tty('init')).out, 'kanban/ already exists\n');
  assert.equal((await tty('list', '--json')).json().count, 0);
});

test('a ticket through the whole board, as text', async (t) => {
  const run = cli(t, { tty: true });
  await run('init');
  assert.equal((await run('add', 'Fix', 'the', 'login', '--state', 'todo', '--note=- [ ] a\n- [ ] b')).out, 'added KB-1 → kanban/todo/KB-1-fix-the-login.md\n');
  assert.equal((await run('add', 'abc-7', 'From', 'Jira')).out, 'added ABC-7 → kanban/backlog/ABC-7-from-jira.md\n');
  assert.equal((await run('add', 'GH-3', '--slug=from-github', '--sprint=s1')).out, 'added GH-3 → kanban/backlog/GH-3-from-github.md\n');
  assert.equal((await run('add', 'Web', 'task', '--prefix=web')).out, 'added WEB-1 → kanban/backlog/WEB-1-web-task.md\n');
  assert.equal(
    (await run('ls')).out,
    'backlog (3)\n  ABC-7      From Jira\n  GH-3       from-github\n  WEB-1      Web task\ntodo (1)\n  KB-1       Fix the login\n',
  );
  assert.equal((await run('list', 'todo')).out, 'todo (1)\n  KB-1       Fix the login\n');
  assert.equal((await run('list', '--ticket=gh-3')).out, 'backlog (1)\n  GH-3       from-github\n');
  assert.equal((await run('mv', 'KB-1', 'doing', '--note=go')).out, 'moved KB-1: todo → doing\n');
  assert.equal((await run('move', 'KB-1', '--to=testing')).out, 'moved KB-1: doing → testing\n');
  assert.equal((await run('check', 'KB-1', '2')).out, 'ticked KB-1 #2 (1/2): - [x] b\n');
  assert.equal((await run('check', 'KB-1', '2', '--uncheck')).out, 'unticked KB-1 #2 (0/2): - [ ] b\n');
  assert.equal((await run('append', 'KB-1', 'plain', 'note')).out, 'appended to KB-1\n');
  assert.equal((await run('append', 'KB-1', '--note=n', '--section=Notes')).out, 'appended to KB-1 under "Notes"\n');
  const shown = (await run('show', 'KB-1')).out;
  assert.match(shown, /^---\nticket: KB-1\nstate: testing\n/);
  assert.match(shown, /plain note\n\n## Notes\n\nn\n$/);
  assert.equal((await run('close', 'KB-1', '--note=ok')).out, 'closed KB-1 → kanban/done/KB-1-fix-the-login.md\n');
  assert.equal((await run('close', 'ABC-7', '--archive', '--sprint=s1')).out, 'closed ABC-7 → kanban/.archive/s1/ABC-7-from-jira.md\n');
  assert.equal((await run('audit')).out, 'board is clean\n');
  assert.equal((await run('summary')).out, 'backlog 2 · todo 0 · doing 0 · testing 0 · blocked 0 · done 1\n');
  await run('mv', 'GH-3', 'doing');
  assert.match((await run('summary')).out, /doing 1 .*\ndoing: GH-3 from-github\n$/);
});

test('summary without a board', async (t) => {
  const run = cli(t, { tty: true });
  assert.equal((await run('summary')).out, 'no board at kanban/ (cli-kanban init creates it)\n');
});

test('audit: a problem exits 1 and lists it', async (t) => {
  const run = cli(t, { tty: true });
  await run('init');
  await run('add', 'A-1', 'x', '--state=doing');
  await run('add', 'A-2', 'y', '--state=blocked');
  const kanban = path.join(run.cwd, 'kanban');
  fs.writeFileSync(path.join(kanban, 'todo', 'loose.md'), '');
  fs.writeFileSync(path.join(kanban, 'todo', 'A-1.md'), '');
  const old = new Date('2026-01-01T00:00:00Z');
  for (const f of ['doing/A-1-x.md', 'blocked/A-2-y.md']) fs.utimesSync(path.join(kanban, f), old, old);
  run.now.advance(100);
  const r = await run('audit', '--max-doing-age=1', '--max-blocked-age', '2');
  assert.equal(r.code, 1);
  assert.equal(
    r.out,
    'orphan (no ticket key): kanban/todo/loose.md\n' +
      'duplicate A-1: kanban/todo/A-1.md, kanban/doing/A-1-x.md\n' +
      'stale doing A-1: 100 h (limit 1 h)\n' +
      'stale blocked A-2: 100 h (limit 2 h)\n',
  );
  assert.equal((await run('audit', '--max-doing-age=-1')).code, 2);
});

test('errors: usage exits 2, board state exits 1, both on stderr', async (t) => {
  const run = cli(t);
  await run('init');
  for (const args of [['frobnicate'], ['show'], ['move', 'A-1'], ['move'], ['check', 'A-1'], ['check'], ['close'], ['append'], ['add']]) {
    const r = await run(...args);
    assert.equal(r.code, 2, args.join(' '));
    assert.match(r.err, /^cli-kanban: /);
    assert.equal(r.out, '');
  }
  const r = await run('show', 'A-1');
  assert.equal(r.code, 1);
  assert.equal(r.err, 'cli-kanban: ticket A-1 is not on the board (kanban/)\n');
});

test('--root and CLI_KANBAN_ROOT pick the board', async (t) => {
  const cwd = project(t);
  const out = sink();
  await main(['init', '--root=boards/team'], { stdout: out, stderr: sink(), cwd, env: {} });
  assert.ok(fs.existsSync(path.join(cwd, 'boards', 'team', 'todo')));
  const out2 = sink();
  await main(['list'], { stdout: out2, stderr: sink(), cwd, env: { CLI_KANBAN_ROOT: 'boards/team' } });
  assert.equal(JSON.parse(out2.text).root, 'team');
});

test('other failures are not swallowed', async (t) => {
  const cwd = project(t);
  fs.writeFileSync(path.join(cwd, 'kanban'), 'a file, not a folder');
  await assert.rejects(main(['init'], { stdout: sink(), stderr: sink(), cwd, env: {} }), /EEXIST|ENOTDIR/);
});

test('mcp: serves on stdin and stdout', async (t) => {
  const cwd = project(t);
  const stdout = sink();
  const stdin = Readable.from(['{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n']);
  assert.equal(await main(['mcp'], { stdout, stderr: sink(), stdin, cwd, env: {} }), 0);
  assert.equal(JSON.parse(stdout.text).result.tools[0].name, 'kanban_summary');
});

test('defaults to the process streams', async (t) => {
  const write = process.stdout.write;
  let out = '';
  process.stdout.write = (s) => ((out += s), true);
  try {
    assert.equal(await main(['--version']), 0);
  } finally {
    process.stdout.write = write;
  }
  assert.equal(out, VERSION + '\n');
});

test('the bin runs the CLI and sets the exit code', (t) => {
  const cwd = project(t);
  const ok = spawnSync(process.execPath, [BIN, 'add', 'Hello', '--json'], { cwd, encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.equal(JSON.parse(ok.stdout).path, 'kanban/backlog/KB-1-hello.md');
  const bad = spawnSync(process.execPath, [BIN, 'nope'], { cwd, encoding: 'utf8' });
  assert.equal(bad.status, 2);
});

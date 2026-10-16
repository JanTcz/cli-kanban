import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  Board,
  KanbanError,
  STATES,
  findRoot,
  normalizeKey,
  validateState,
  slugify,
  parseFilename,
  countTransitions,
} from '../src/board.js';
import { board, clock, project, read } from './helpers.js';

const usage = (fn) => assert.throws(fn, (e) => e instanceof KanbanError && e.code === 'usage');
const op = (fn, re) => assert.throws(fn, (e) => e instanceof KanbanError && e.code === 'op' && re.test(e.message));

test('findRoot: CLI_KANBAN_ROOT wins, relative to cwd', () => {
  assert.equal(findRoot({ cwd: '/a/b', env: { CLI_KANBAN_ROOT: 'board' } }), path.resolve('/a/b/board'));
});

test('findRoot: the nearest kanban/ folder above the start', (t) => {
  const dir = project(t);
  fs.mkdirSync(path.join(dir, 'kanban'));
  fs.mkdirSync(path.join(dir, 'src', 'deep'), { recursive: true });
  assert.equal(findRoot({ cwd: path.join(dir, 'src', 'deep'), env: {} }), path.join(dir, 'kanban'));
});

test('findRoot: the git repository when there is no board yet', (t) => {
  const dir = project(t);
  fs.mkdirSync(path.join(dir, 'pkg'));
  assert.equal(findRoot({ cwd: path.join(dir, 'pkg'), env: {} }), path.join(dir, 'kanban'));
});

test('findRoot: CLAUDE_PROJECT_DIR is the start', (t) => {
  const dir = project(t);
  assert.equal(findRoot({ cwd: '/', env: { CLAUDE_PROJECT_DIR: dir } }), path.join(dir, 'kanban'));
});

test('findRoot: ./kanban when nothing is found up to the filesystem root', (t) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cli-kanban-bare-')));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  assert.equal(findRoot({ cwd: dir, env: {} }), path.join(dir, 'kanban'));
});

test('findRoot: defaults to the process', () => {
  assert.ok(findRoot().endsWith('kanban'));
});

test('normalizeKey, validateState, slugify, parseFilename, countTransitions', () => {
  assert.equal(normalizeKey(' abc-12 '), 'ABC-12');
  assert.equal(normalizeKey('P2X-3'), 'P2X-3');
  usage(() => normalizeKey('12'));
  usage(() => normalizeKey(undefined));
  assert.equal(validateState('doing'), 'doing');
  usage(() => validateState('wip'));
  assert.equal(slugify('  Opravit přihlášení – rychle!  '), 'opravit-prihlaseni-rychle');
  assert.equal(slugify('a'.repeat(59) + ' b'), 'a'.repeat(59));
  assert.deepEqual(parseFilename('abc-1-some-slug.md'), { ticket: 'ABC-1', slug: 'some-slug' });
  assert.deepEqual(parseFilename('ABC-1.md'), { ticket: 'ABC-1', slug: '' });
  assert.equal(parseFilename('notes.md'), null);
  assert.equal(countTransitions('# x'), 0);
  assert.equal(countTransitions('## Transition a\n## Transition b\n'), 2);
});

test('init creates a folder per state once, with .gitkeep', (t) => {
  const dir = project(t);
  const b = new Board(path.join(dir, 'kanban'));
  assert.equal(b.exists, false);
  assert.deepEqual(b.init(), { op: 'init', root: 'kanban', created: STATES });
  assert.ok(fs.existsSync(path.join(dir, 'kanban', 'doing', '.gitkeep')));
  assert.deepEqual(b.init().created, []);
  assert.equal(b.exists, true);
});

test('add: numbers automatically, writes frontmatter, title and note', (t) => {
  const b = board(t);
  const r = b.add({ title: 'Fix the login', state: 'todo', note: '- [ ] form\n', sprint: 's1' });
  assert.deepEqual(r, { op: 'add', ticket: 'KB-1', state: 'todo', path: 'kanban/todo/KB-1-fix-the-login.md' });
  assert.equal(
    read(b, r.path),
    '---\nticket: KB-1\nstate: todo\ncreated: 2026-01-01T00:00:00.000Z\nsprint: s1\n---\n\n# KB-1: Fix the login\n\n- [ ] form\n',
  );
  assert.equal(b.add({ title: 'Second' }).ticket, 'KB-2');
  assert.equal(b.add({ title: 'Other', prefix: 'web' }).ticket, 'WEB-1');
});

test('add: a key of your own, a slug only, or a key only', (t) => {
  const b = board(t);
  assert.equal(b.add({ ticket: 'jira-40', slug: 'From Jira' }).path, 'kanban/backlog/JIRA-40-from-jira.md');
  assert.match(read(b, 'kanban/backlog/JIRA-40-from-jira.md'), /# JIRA-40: from-jira/);
  assert.equal(b.add({ ticket: 'GH-5' }).path, 'kanban/backlog/GH-5.md');
  assert.match(read(b, 'kanban/backlog/GH-5.md'), /# GH-5: GH-5\n$/);
  assert.equal(b.nextKey('JIRA'), 'JIRA-41');
});

test('add: refuses nothing to name it by, bad states, bad prefixes and existing keys', (t) => {
  const b = board(t);
  usage(() => b.add());
  usage(() => b.add({ title: 'x', state: 'wip' }));
  usage(() => b.add({ title: 'x', prefix: '9' }));
  b.add({ ticket: 'A-1', title: 'x' });
  op(() => b.add({ ticket: 'a-1', title: 'y' }), /already exists in kanban\/backlog\/A-1-x\.md/);
  b.close('A-1', { archive: true, sprint: 's' });
  op(() => b.add({ ticket: 'A-1', title: 'y' }), /already exists in the archive/);
  assert.equal(b.add({ title: 'z', prefix: 'a' }).ticket, 'A-2');
});

test('list, find, show', (t) => {
  const b = board(t);
  b.add({ ticket: 'B-2', title: 'Two', state: 'todo' });
  b.add({ ticket: 'B-1', title: 'One', state: 'doing' });
  fs.writeFileSync(path.join(b.root, 'todo', 'README.md'), 'not a ticket');
  const all = b.list();
  assert.equal(all.count, 2);
  assert.deepEqual(all.entries.map((e) => [e.ticket, e.state, e.title]), [['B-2', 'todo', 'Two'], ['B-1', 'doing', 'One']]);
  assert.equal(all.entries[0].file, undefined);
  assert.deepEqual(b.list({ state: 'doing' }).entries.map((e) => e.ticket), ['B-1']);
  assert.deepEqual(b.list({ ticket: 'b-2' }).entries.map((e) => e.ticket), ['B-2']);
  usage(() => b.list({ state: 'nope' }));
  assert.equal(b.find('B-9'), null);
  op(() => b.get('B-9'), /B-9 is not on the board \(kanban\/\)/);
  const s = b.show('b-1');
  assert.equal(s.op, 'show');
  assert.match(s.content, /# B-1: One/);
});

test('titles: AIG-style headings and files without one', (t) => {
  const b = board(t);
  fs.writeFileSync(path.join(b.root, 'todo', 'AIG-240-kanban-cli.md'), '---\nticket: AIG-240\n---\n\n# AIG-240 — kanban-cli\n');
  fs.writeFileSync(path.join(b.root, 'todo', 'X-1.md'), 'no heading');
  assert.deepEqual(b.list().entries.map((e) => e.title), ['kanban-cli', '']);
});

test('move: renames, records the transition, updates the state field', (t) => {
  const now = clock();
  const b = board(t, { now });
  b.add({ title: 'Task', state: 'todo' });
  now.advance(1);
  const r = b.move('kb-1', 'doing', { note: 'picked up\n' });
  assert.deepEqual(r, { op: 'move', ticket: 'KB-1', from: 'todo', to: 'doing', path: 'kanban/doing/KB-1-task.md', transitions: 1 });
  assert.ok(!fs.existsSync(path.join(b.root, 'todo', 'KB-1-task.md')));
  const c = read(b, r.path);
  assert.match(c, /^state: doing$/m);
  assert.match(c, /\n## Transition 2026-01-01T01:00:00.000Z todo → doing\npicked up\n$/);
  assert.equal(b.move('KB-1', 'testing').transitions, 2);
  assert.match(read(b, 'kanban/testing/KB-1-task.md'), /doing → testing\n$/);
  op(() => b.move('KB-1', 'testing'), /already in testing/);
  usage(() => b.move('KB-1', 'review'));
});

test('move: a file without frontmatter, and frontmatter without a state', (t) => {
  const b = board(t);
  fs.writeFileSync(path.join(b.root, 'todo', 'X-1.md'), '# X-1: plain\n');
  fs.writeFileSync(path.join(b.root, 'todo', 'X-2.md'), '---\nticket: X-2\n---\n# X-2: fm\n');
  b.move('X-1', 'doing');
  b.move('X-2', 'doing');
  assert.match(read(b, 'kanban/doing/X-1.md'), /^# X-1: plain\n\n## Transition/);
  assert.match(read(b, 'kanban/doing/X-2.md'), /^---\nticket: X-2\nstate: doing\n---\n/);
});

test('close: to done, or into the archive by sprint or by date', (t) => {
  const b = board(t);
  b.add({ ticket: 'C-1', title: 'a', state: 'testing' });
  b.add({ ticket: 'C-2', title: 'b', state: 'doing' });
  b.add({ ticket: 'C-3', title: 'c' });
  assert.deepEqual(b.close('C-1', { note: 'verified' }), { op: 'close', ticket: 'C-1', from: 'testing', path: 'kanban/done/C-1-a.md', archived: false });
  assert.match(read(b, 'kanban/done/C-1-a.md'), /testing → done\nverified\n$/);
  op(() => b.close('C-1'), /already in done/);
  assert.equal(b.close('C-1', { archive: true, sprint: 'sprint-1' }).path, 'kanban/.archive/sprint-1/C-1-a.md');
  assert.equal(b.close('C-2', { archive: true }).path, 'kanban/.archive/2026-01-01/C-2-b.md');
  assert.equal(b.close('C-3').archived, false);
  fs.writeFileSync(path.join(b.root, '.archive', 'sprint-1', 'notes.md'), '');
  assert.deepEqual(b.allKeys().sort(), ['C-1', 'C-2', 'C-3']);
});

test('append: at the end, under an existing section, or a new section', (t) => {
  const b = board(t);
  const { path: p } = b.add({ ticket: 'D-1', title: 'x', note: '## Notes\n\nfirst\n\n\n## Log\n\nl1' });
  assert.deepEqual(b.append('D-1', 'second\n', { section: 'Notes' }), { op: 'append', ticket: 'D-1', path: p, section: 'Notes' });
  b.append('D-1', 'l2', { section: 'Log' });
  b.append('D-1', 'q', { section: 'Questions' });
  b.append('D-1', 'tail');
  assert.equal(
    read(b, p).split('# D-1: x\n')[1],
    '\n## Notes\n\nfirst\n\nsecond\n\n## Log\n\nl1\n\nl2\n\n## Questions\n\nq\n\ntail\n',
  );
  assert.equal(b.append('D-1', 'more').section, null);
  usage(() => b.append('D-1', ''));
});

test('check: ticks and unticks the n-th checkbox', (t) => {
  const b = board(t);
  const { path: p } = b.add({ ticket: 'E-1', title: 'x', note: '- [ ] one\n* [ ] two\n  + [X] three' });
  assert.deepEqual(b.check('E-1', '2'), { op: 'check', ticket: 'E-1', item: 2, checked: true, done: 2, total: 3, text: '* [x] two' });
  assert.equal(b.check('E-1', 3, { uncheck: true }).done, 1);
  assert.match(read(b, p), /- \[ \] one\n\* \[x\] two\n  \+ \[ \] three\n$/);
  usage(() => b.check('E-1', 0));
  usage(() => b.check('E-1', 'x'));
  op(() => b.check('E-1', 4), /has 3 checkboxes, not 4/);
  b.add({ ticket: 'E-2', title: 'y', note: '- [ ] only' });
  op(() => b.check('E-2', 2), /has 1 checkbox, not 2/);
});

test('audit: orphans, duplicates and stale tickets', (t) => {
  const now = clock();
  const b = board(t, { now });
  assert.equal(b.audit().ok, true);
  b.add({ ticket: 'F-1', title: 'a', state: 'doing' });
  b.add({ ticket: 'F-2', title: 'b', state: 'blocked' });
  fs.writeFileSync(path.join(b.root, 'todo', 'idea.md'), '');
  fs.writeFileSync(path.join(b.root, 'todo', 'F-1-copy.md'), '');
  const old = new Date('2026-01-01T00:00:00Z');
  for (const f of ['doing/F-1-a.md', 'blocked/F-2-b.md']) fs.utimesSync(path.join(b.root, f), old, old);
  now.advance(50);
  const r = b.audit();
  assert.equal(r.ok, false);
  assert.deepEqual(r.orphans, [{ path: 'kanban/todo/idea.md' }]);
  assert.deepEqual(r.duplicates, [{ ticket: 'F-1', paths: ['kanban/todo/F-1-copy.md', 'kanban/doing/F-1-a.md'] }]);
  assert.deepEqual(r.stale_doing, [{ ticket: 'F-1', path: 'kanban/doing/F-1-a.md', age_hours: 50 }]);
  assert.deepEqual(r.stale_blocked, []);
  assert.deepEqual(b.audit({ maxDoingHours: 100, maxBlockedHours: 10 }).stale_blocked.map((s) => s.ticket), ['F-2']);
});

test('summary', (t) => {
  const b = board(t);
  b.add({ ticket: 'G-1', title: 'Now', state: 'doing' });
  b.add({ ticket: 'G-2', title: 'Later', state: 'todo' });
  const s = b.summary();
  assert.equal(s.exists, true);
  assert.deepEqual(s.counts, { backlog: 0, todo: 1, doing: 1, testing: 0, blocked: 0, done: 0 });
  assert.deepEqual(s.doing, [{ ticket: 'G-1', title: 'Now' }]);
  assert.equal(new Board(path.join(path.dirname(b.root), 'none')).summary().exists, false);
});

test('a board on its own works with the real clock', (t) => {
  const b = new Board(path.join(project(t), 'kanban'));
  assert.match(b.add({ title: 'x' }).path, /KB-1-x\.md$/);
});

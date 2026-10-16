// The board: a `kanban/` folder with one folder per state and one Markdown file per ticket.
// The state of a ticket is the folder it is in; moving a ticket is a rename.

import fs from 'node:fs';
import path from 'node:path';

export const STATES = ['backlog', 'todo', 'doing', 'testing', 'blocked', 'done'];
export const DEFAULT_PREFIX = 'MK';

const KEY = /^[A-Z][A-Z0-9]*-\d+$/;
const FILE = /^([A-Za-z][A-Za-z0-9]*-\d+)(?:-(.+))?\.md$/;
const CHECKBOX = /^(\s*[-*+] \[)([ xX])(\])/;

/** An error the caller made (`usage`, exit code 2) or a state the board is in (`op`, exit code 1). */
export class KanbanError extends Error {
  constructor(message, code = 'op') {
    super(message);
    this.name = 'KanbanError';
    this.code = code;
  }
}

/**
 * Where the board is: MICROKANBAN_ROOT, else the nearest `kanban/` folder or git
 * repository above the project directory (CLAUDE_PROJECT_DIR or cwd), else `./kanban`.
 */
export function findRoot({ cwd = process.cwd(), env = process.env } = {}) {
  if (env.MICROKANBAN_ROOT) return path.resolve(cwd, env.MICROKANBAN_ROOT);
  const start = path.resolve(cwd, env.CLAUDE_PROJECT_DIR || '.');
  let dir = start;
  while (!isDir(path.join(dir, 'kanban')) && !fs.existsSync(path.join(dir, '.git'))) {
    if (path.dirname(dir) === dir) return path.join(start, 'kanban');
    dir = path.dirname(dir);
  }
  return path.join(dir, 'kanban');
}

export function normalizeKey(key) {
  const k = String(key ?? '').trim().toUpperCase();
  if (!KEY.test(k)) throw new KanbanError(`invalid ticket key "${key}": expected PREFIX-NUMBER, e.g. ABC-12`, 'usage');
  return k;
}

export function validateState(state) {
  if (!STATES.includes(state)) {
    throw new KanbanError(`invalid state "${state}": one of ${STATES.join(', ')}`, 'usage');
  }
  return state;
}

/** "Fix the login – page" → "fix-the-login-page" */
export function slugify(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
}

export function parseFilename(name) {
  const m = FILE.exec(name);
  return m ? { ticket: m[1].toUpperCase(), slug: m[2] ?? '' } : null;
}

export function countTransitions(content) {
  return (content.match(/^## Transition /gm) ?? []).length;
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readDir(dir) {
  return isDir(dir) ? fs.readdirSync(dir).sort() : [];
}

function titleOf(content) {
  const m = /^# (.+)$/m.exec(content);
  return m ? m[1].replace(/^[A-Za-z][A-Za-z0-9]*-\d+(:| —)\s*/, '').trim() : '';
}

/** Sets `key: value` in the YAML frontmatter, adding the line when missing. */
function setField(content, key, value) {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(content);
  if (!fm) return content;
  const line = `${key}: ${value}`;
  const re = new RegExp(`^${key}:.*$`, 'm');
  const body = re.test(fm[1]) ? fm[1].replace(re, line) : `${fm[1]}\n${line}`;
  return `---\n${body}\n---\n${content.slice(fm[0].length)}`;
}

export class Board {
  /**
   * @param {string} root  the `kanban/` folder
   * @param {{ now?: () => Date }} [opts]
   */
  constructor(root, { now = () => new Date() } = {}) {
    this.root = path.resolve(root);
    this.now = now;
  }

  get exists() {
    return isDir(this.root);
  }

  /** A path for output: relative to the project the board belongs to. */
  rel(p) {
    return path.relative(path.dirname(this.root), p).split(path.sep).join('/');
  }

  init() {
    const created = [];
    for (const state of STATES) {
      const dir = path.join(this.root, state);
      if (isDir(dir)) continue;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, '.gitkeep'), '');
      created.push(state);
    }
    return { op: 'init', root: this.rel(this.root), created };
  }

  /** Every ticket on the board, in state order, then by key. */
  entries() {
    const out = [];
    for (const state of STATES) {
      for (const name of readDir(path.join(this.root, state))) {
        const parsed = parseFilename(name);
        if (!parsed) continue;
        const file = path.join(this.root, state, name);
        out.push({
          ticket: parsed.ticket,
          state,
          slug: parsed.slug,
          title: titleOf(fs.readFileSync(file, 'utf8')),
          path: this.rel(file),
          updated: fs.statSync(file).mtime.toISOString(),
          file,
        });
      }
    }
    return out;
  }

  list({ state, ticket } = {}) {
    if (state) validateState(state);
    const key = ticket ? normalizeKey(ticket) : null;
    const entries = this.entries()
      .filter((e) => (!state || e.state === state) && (!key || e.ticket === key))
      .map(({ file, ...e }) => e);
    return { op: 'list', root: this.rel(this.root), count: entries.length, entries };
  }

  find(ticket) {
    const key = normalizeKey(ticket);
    return this.entries().find((e) => e.ticket === key) ?? null;
  }

  get(ticket) {
    const found = this.find(ticket);
    if (!found) throw new KanbanError(`ticket ${normalizeKey(ticket)} is not on the board (${this.rel(this.root)}/)`);
    return found;
  }

  show(ticket) {
    const { file, ...entry } = this.get(ticket);
    return { op: 'show', ...entry, content: fs.readFileSync(file, 'utf8') };
  }

  /** Keys in the archive too, so a closed number is never handed out again. */
  allKeys() {
    const keys = this.entries().map((e) => e.ticket);
    const archive = path.join(this.root, '.archive');
    for (const sprint of readDir(archive)) {
      for (const name of readDir(path.join(archive, sprint))) {
        const parsed = parseFilename(name);
        if (parsed) keys.push(parsed.ticket);
      }
    }
    return keys;
  }

  nextKey(prefix = DEFAULT_PREFIX) {
    const p = String(prefix).toUpperCase();
    normalizeKey(`${p}-1`);
    const max = this.allKeys()
      .filter((k) => k.startsWith(`${p}-`))
      .reduce((m, k) => Math.max(m, Number(k.slice(p.length + 1))), 0);
    return `${p}-${max + 1}`;
  }

  add({ ticket, title, slug, state = 'backlog', note, sprint, prefix } = {}) {
    validateState(state);
    if (!ticket && !title && !slug) throw new KanbanError('add: give a title (or a ticket key, or --slug)', 'usage');
    const key = ticket ? normalizeKey(ticket) : this.nextKey(prefix);
    if (this.allKeys().includes(key)) {
      const where = this.find(key);
      throw new KanbanError(`ticket ${key} already exists${where ? ` in ${where.path}` : ' in the archive'}`);
    }
    const s = slugify(slug || title || '');
    const name = s ? `${key}-${s}.md` : `${key}.md`;
    const file = path.join(this.root, state, name);
    const now = this.now().toISOString();
    const fm = ['---', `ticket: ${key}`, `state: ${state}`, `created: ${now}`];
    if (sprint) fm.push(`sprint: ${sprint}`);
    fm.push('---', '', `# ${key}: ${title || s || key}`, '');
    if (note) fm.push(note.trimEnd(), '');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, fm.join('\n'), { flag: 'wx' });
    return { op: 'add', ticket: key, state, path: this.rel(file) };
  }

  /** Appends the transition, then renames: one atomic step on the same filesystem. */
  transition(entry, to, note, dest) {
    let content = fs.readFileSync(entry.file, 'utf8');
    content = setField(content, 'state', to);
    content += `\n## Transition ${this.now().toISOString()} ${entry.state} → ${to}\n${note ? note.trimEnd() + '\n' : ''}`;
    fs.writeFileSync(entry.file, content);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(entry.file, dest);
    return countTransitions(content);
  }

  move(ticket, to, { note } = {}) {
    validateState(to);
    const entry = this.get(ticket);
    if (entry.state === to) throw new KanbanError(`ticket ${entry.ticket} is already in ${to}`);
    const dest = path.join(this.root, to, path.basename(entry.file));
    const transitions = this.transition(entry, to, note, dest);
    return { op: 'move', ticket: entry.ticket, from: entry.state, to, path: this.rel(dest), transitions };
  }

  close(ticket, { note, archive = false, sprint } = {}) {
    const entry = this.get(ticket);
    if (entry.state === 'done' && !archive) throw new KanbanError(`ticket ${entry.ticket} is already in done`);
    const dir = archive
      ? path.join(this.root, '.archive', sprint || this.now().toISOString().slice(0, 10))
      : path.join(this.root, 'done');
    const dest = path.join(dir, path.basename(entry.file));
    this.transition(entry, 'done', note, dest);
    return { op: 'close', ticket: entry.ticket, from: entry.state, path: this.rel(dest), archived: archive };
  }

  /** Adds a note at the end, or at the end of the `## section` (created when missing). */
  append(ticket, note, { section } = {}) {
    if (!note) throw new KanbanError('append: a note is required', 'usage');
    const entry = this.get(ticket);
    const lines = fs.readFileSync(entry.file, 'utf8').replace(/\n+$/, '').split('\n');
    const at = section ? lines.findIndex((l) => l.trim() === `## ${section}`) : -1;
    if (at === -1) {
      if (section) lines.push('', `## ${section}`);
      lines.push('', note.trimEnd());
    } else {
      const next = lines.findIndex((l, i) => i > at && l.startsWith('## '));
      const end = next === -1 ? lines.length : next;
      let start = end;
      while (lines[start - 1] === '') start--;
      lines.splice(start, end - start, '', note.trimEnd(), ...(next === -1 ? [] : ['']));
    }
    fs.writeFileSync(entry.file, lines.join('\n') + '\n');
    return { op: 'append', ticket: entry.ticket, path: entry.path, section: section ?? null };
  }

  /** Ticks (or unticks) the n-th `- [ ]` checkbox of the ticket, counted from 1. */
  check(ticket, n, { uncheck = false } = {}) {
    const index = Number(n);
    if (!Number.isInteger(index) || index < 1) throw new KanbanError(`check: item must be a number from 1, got "${n}"`, 'usage');
    const entry = this.get(ticket);
    const lines = fs.readFileSync(entry.file, 'utf8').split('\n');
    const boxes = lines.flatMap((l, i) => (CHECKBOX.test(l) ? [i] : []));
    if (index > boxes.length) {
      throw new KanbanError(`ticket ${entry.ticket} has ${boxes.length} checkbox${boxes.length === 1 ? '' : 'es'}, not ${index}`);
    }
    const i = boxes[index - 1];
    lines[i] = lines[i].replace(CHECKBOX, `$1${uncheck ? ' ' : 'x'}$3`);
    fs.writeFileSync(entry.file, lines.join('\n'));
    const done = lines.filter((l) => /^\s*[-*+] \[[xX]\]/.test(l)).length;
    return { op: 'check', ticket: entry.ticket, item: index, checked: !uncheck, done, total: boxes.length, text: lines[i].trim() };
  }

  /**
   * Files without a ticket key, keys on the board twice, and tickets sitting in
   * doing or blocked longer than the limits (hours since the file last changed).
   */
  audit({ maxDoingHours = 48, maxBlockedHours = 72 } = {}) {
    const orphans = [];
    for (const state of STATES) {
      for (const name of readDir(path.join(this.root, state))) {
        if (name.endsWith('.md') && !parseFilename(name)) orphans.push({ path: this.rel(path.join(this.root, state, name)) });
      }
    }
    const entries = this.entries();
    const seen = new Map();
    for (const e of entries) seen.set(e.ticket, [...(seen.get(e.ticket) ?? []), e.path]);
    const duplicates = [...seen].filter(([, paths]) => paths.length > 1).map(([ticket, paths]) => ({ ticket, paths }));
    const now = this.now().getTime();
    const stale = (state, limit) =>
      entries
        .filter((e) => e.state === state)
        .map((e) => ({ ticket: e.ticket, path: e.path, age_hours: Math.round((now - Date.parse(e.updated)) / 360_000) / 10 }))
        .filter((e) => e.age_hours > limit);
    const stale_doing = stale('doing', maxDoingHours);
    const stale_blocked = stale('blocked', maxBlockedHours);
    const ok = !orphans.length && !duplicates.length && !stale_doing.length && !stale_blocked.length;
    return { op: 'audit', ok, orphans, duplicates, stale_doing, stale_blocked, limits: { doing: maxDoingHours, blocked: maxBlockedHours } };
  }

  /** Ticket counts per state, and what is in doing. */
  summary() {
    const entries = this.entries();
    const counts = Object.fromEntries(STATES.map((s) => [s, entries.filter((e) => e.state === s).length]));
    const doing = entries.filter((e) => e.state === 'doing').map((e) => ({ ticket: e.ticket, title: e.title }));
    return { op: 'summary', root: this.rel(this.root), exists: this.exists, counts, doing };
  }
}

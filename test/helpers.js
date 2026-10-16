import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Board } from '../src/board.js';

/** A fresh project folder with a git marker, removed after the test. */
export function project(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-kanban-'));
  fs.mkdirSync(path.join(dir, '.git'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A clock that starts at a fixed time and can be moved forward. */
export function clock(start = '2026-01-01T00:00:00.000Z') {
  let t = Date.parse(start);
  const now = () => new Date(t);
  now.advance = (hours) => {
    t += hours * 3_600_000;
  };
  return now;
}

export function board(t, opts) {
  const dir = project(t);
  const b = new Board(path.join(dir, 'kanban'), { now: clock(), ...opts });
  b.init();
  return b;
}

export const read = (b, rel) => fs.readFileSync(path.join(path.dirname(b.root), rel), 'utf8');

/** A writable stream stand-in that keeps what was written. */
export function sink(isTTY = false) {
  const chunks = [];
  return { isTTY, write: (s) => chunks.push(s), get text() { return chunks.join(''); } };
}

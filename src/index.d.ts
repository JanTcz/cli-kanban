export type State = 'backlog' | 'todo' | 'doing' | 'testing' | 'blocked' | 'done';

export const STATES: readonly State[];
export const DEFAULT_PREFIX: string;
export const VERSION: string;

export class KanbanError extends Error {
  /** `usage`: a wrong argument (CLI exit 2); `op`: the board doesn't allow it (exit 1). */
  code: 'usage' | 'op';
}

export interface Entry {
  ticket: string;
  state: State;
  slug: string;
  title: string;
  /** Relative to the folder the board is in, e.g. `kanban/todo/ABC-1-fix.md`. */
  path: string;
  /** ISO time the file last changed. */
  updated: string;
}

export interface AddOptions {
  ticket?: string;
  title?: string;
  slug?: string;
  state?: State;
  note?: string;
  sprint?: string;
  prefix?: string;
}

export class Board {
  constructor(root: string, opts?: { now?: () => Date });
  readonly root: string;
  readonly exists: boolean;
  init(): { op: 'init'; root: string; created: State[] };
  list(filter?: { state?: State; ticket?: string }): { op: 'list'; root: string; count: number; entries: Entry[] };
  find(ticket: string): (Entry & { file: string }) | null;
  show(ticket: string): Entry & { op: 'show'; content: string };
  nextKey(prefix?: string): string;
  add(opts: AddOptions): { op: 'add'; ticket: string; state: State; path: string };
  move(ticket: string, to: State, opts?: { note?: string }): { op: 'move'; ticket: string; from: State; to: State; path: string; transitions: number };
  close(ticket: string, opts?: { note?: string; archive?: boolean; sprint?: string }): { op: 'close'; ticket: string; from: State; path: string; archived: boolean };
  append(ticket: string, note: string, opts?: { section?: string }): { op: 'append'; ticket: string; path: string; section: string | null };
  check(ticket: string, n: number | string, opts?: { uncheck?: boolean }): { op: 'check'; ticket: string; item: number; checked: boolean; done: number; total: number; text: string };
  audit(opts?: { maxDoingHours?: number; maxBlockedHours?: number }): {
    op: 'audit';
    ok: boolean;
    orphans: { path: string }[];
    duplicates: { ticket: string; paths: string[] }[];
    stale_doing: { ticket: string; path: string; age_hours: number }[];
    stale_blocked: { ticket: string; path: string; age_hours: number }[];
    limits: { doing: number; blocked: number };
  };
  summary(): { op: 'summary'; root: string; exists: boolean; counts: Record<State, number>; doing: { ticket: string; title: string }[] };
}

/** The `kanban/` folder: MICROKANBAN_ROOT, else the nearest kanban/ or git repository above the project. */
export function findRoot(opts?: { cwd?: string; env?: Record<string, string | undefined> }): string;
export function normalizeKey(key: string): string;
export function slugify(text: string): string;
export function parseFilename(name: string): { ticket: string; slug: string } | null;
export function countTransitions(content: string): number;

export const TOOLS: { name: string; description: string; inputSchema: object }[];
export function handle(message: object, ctx: { board: Board; version: string }): object | undefined;
export function serve(opts: { board: Board; input: NodeJS.ReadableStream; output: { write(s: string): unknown }; version: string }): Promise<void>;
/** Runs the CLI; resolves to the exit code. */
export function main(args: string[], io?: object): Promise<number>;

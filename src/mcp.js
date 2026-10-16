// An MCP server on stdio (JSON-RPC 2.0, one message per line), with no dependencies.
// The tools are the board's operations; every result is the same JSON the CLI prints.

import readline from 'node:readline';
import { KanbanError, STATES } from './board.js';

export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS =
  'A kanban board of Markdown files in the project\'s kanban/ folder: the state of a ticket is the folder it is in. ' +
  'Check kanban_summary at the start of a task. Move the ticket you work on to doing, note decisions with kanban_append, ' +
  'tick its acceptance checkboxes with kanban_check, move it to testing when it is ready for verification and close it when verified.';

const ticket = { type: 'string', description: 'Ticket key, e.g. ABC-12' };
const state = { type: 'string', enum: STATES };
const note = { type: 'string', description: 'Markdown text' };

function tool(name, description, properties = {}, required = [], readOnly = false) {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties, required, additionalProperties: false },
    annotations: { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: readOnly },
  };
}

export const TOOLS = [
  tool('kanban_summary', 'Ticket counts per state and the tickets in doing. Cheap; call it first.', {}, [], true),
  tool('kanban_list', 'Tickets on the board with their state, title and path, optionally filtered.', { state, ticket }, [], true),
  tool('kanban_show', 'The full Markdown file of one ticket.', { ticket }, ['ticket'], true),
  tool(
    'kanban_add',
    'Create a ticket. Without a ticket key it gets the next free <prefix>-<n>.',
    {
      title: { type: 'string', description: 'Short imperative title' },
      ticket: { ...ticket, description: 'Key from your tracker, e.g. a Jira or GitHub key; omit to number automatically' },
      state: { ...state, description: 'Initial state, default backlog' },
      note: { ...note, description: 'Body: context, acceptance criteria as "- [ ]" checkboxes' },
      slug: { type: 'string' },
      sprint: { type: 'string' },
      prefix: { type: 'string', description: 'Key prefix for automatic numbering, default KB' },
    },
  ),
  tool('kanban_move', 'Move a ticket to another state; records the transition and an optional note.', { ticket, to: state, note }, ['ticket', 'to']),
  tool('kanban_append', 'Add a note to a ticket, at the end or at the end of a "## section".', { ticket, note, section: { type: 'string' } }, ['ticket', 'note']),
  tool(
    'kanban_check',
    'Tick (or untick) the n-th "- [ ]" checkbox of a ticket, counted from 1.',
    { ticket, item: { type: 'integer', minimum: 1 }, uncheck: { type: 'boolean' } },
    ['ticket', 'item'],
  ),
  tool(
    'kanban_close',
    'Move a ticket to done, or with archive to kanban/.archive/<sprint or date>/.',
    { ticket, note, archive: { type: 'boolean' }, sprint: { type: 'string' } },
    ['ticket'],
  ),
  tool(
    'kanban_audit',
    'Files without a ticket key, keys on the board twice, tickets too long in doing or blocked.',
    { max_doing_hours: { type: 'number', minimum: 0 }, max_blocked_hours: { type: 'number', minimum: 0 } },
    [],
    true,
  ),
  tool('kanban_init', 'Create the kanban/ folder with a folder per state. Safe to repeat.'),
];

const CALLS = {
  kanban_summary: (b) => b.summary(),
  kanban_list: (b, a) => b.list(a),
  kanban_show: (b, a) => b.show(a.ticket),
  kanban_add: (b, a) => b.add(a),
  kanban_move: (b, a) => b.move(a.ticket, a.to, a),
  kanban_append: (b, a) => b.append(a.ticket, a.note, a),
  kanban_check: (b, a) => b.check(a.ticket, a.item, a),
  kanban_close: (b, a) => b.close(a.ticket, a),
  kanban_audit: (b, a) => b.audit({ maxDoingHours: a.max_doing_hours, maxBlockedHours: a.max_blocked_hours }),
  kanban_init: (b) => b.init(),
};

class RpcError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** Answers one JSON-RPC request; `undefined` for a notification. */
export function handle(message, { board, version }) {
  const { id, method, params = {} } = message;
  const isRequest = id !== undefined && id !== null;
  try {
    let result;
    switch (method) {
      case 'initialize':
        result = {
          protocolVersion: PROTOCOL_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'cli-kanban', version },
          instructions: INSTRUCTIONS,
        };
        break;
      case 'ping':
        result = {};
        break;
      case 'tools/list':
        result = { tools: TOOLS };
        break;
      case 'tools/call':
        result = callTool(board, params.name, params.arguments ?? {});
        break;
      default:
        if (!isRequest) return undefined;
        throw new RpcError(-32601, `method not found: ${method}`);
    }
    return isRequest ? { jsonrpc: '2.0', id, result } : undefined;
  } catch (err) {
    if (!isRequest) return undefined;
    return { jsonrpc: '2.0', id, error: { code: err.code, message: err.message } };
  }
}

function callTool(board, name, args) {
  const call = CALLS[name];
  if (!call) throw new RpcError(-32602, `unknown tool: ${name}`);
  try {
    const result = call(board, args);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result };
  } catch (err) {
    if (!(err instanceof KanbanError)) throw new RpcError(-32603, err.message);
    return { content: [{ type: 'text', text: err.message }], isError: true };
  }
}

/** Serves until the input ends. */
export async function serve({ board, input, output, version }) {
  const send = (msg) => output.write(JSON.stringify(msg) + '\n');
  for await (const line of readline.createInterface({ input, crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
      continue;
    }
    const reply = handle(message, { board, version });
    if (reply) send(reply);
  }
}

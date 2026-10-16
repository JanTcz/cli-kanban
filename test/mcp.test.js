import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Board } from '../src/board.js';
import { PROTOCOL_VERSIONS, TOOLS, handle, serve } from '../src/mcp.js';
import { board, project, sink } from './helpers.js';

const rpc = (b, method, params, id = 1) => handle({ jsonrpc: '2.0', id, method, params }, { board: b, version: '9.9.9' });
const notify = (b, method, params) => handle({ jsonrpc: '2.0', method, params }, { board: b, version: '9.9.9' });
const call = (b, name, args) => rpc(b, 'tools/call', { name, arguments: args }).result;

test('initialize: the client\'s protocol version when supported, else the newest', (t) => {
  const b = board(t);
  const r = rpc(b, 'initialize', { protocolVersion: '2025-03-26' }).result;
  assert.equal(r.protocolVersion, '2025-03-26');
  assert.deepEqual(r.serverInfo, { name: 'cli-kanban', version: '9.9.9' });
  assert.deepEqual(r.capabilities, { tools: {} });
  assert.match(r.instructions, /kanban_summary/);
  assert.equal(rpc(b, 'initialize', { protocolVersion: '1999-01-01' }).result.protocolVersion, PROTOCOL_VERSIONS[0]);
  assert.equal(rpc(b, 'initialize').result.protocolVersion, PROTOCOL_VERSIONS[0]);
});

test('ping, tools/list, unknown methods, notifications', (t) => {
  const b = board(t);
  assert.deepEqual(rpc(b, 'ping'), { jsonrpc: '2.0', id: 1, result: {} });
  const tools = rpc(b, 'tools/list').result.tools;
  assert.deepEqual(tools, TOOLS);
  for (const tool of tools) {
    assert.match(tool.name, /^kanban_[a-z]+$/);
    assert.equal(tool.inputSchema.type, 'object');
    for (const r of tool.inputSchema.required) assert.ok(r in tool.inputSchema.properties, `${tool.name}.${r}`);
  }
  assert.deepEqual(rpc(b, 'resources/list').error, { code: -32601, message: 'method not found: resources/list' });
  assert.equal(notify(b, 'notifications/initialized'), undefined);
  assert.equal(rpc(b, 'ping', {}, null), undefined);
  assert.equal(notify(b, 'tools/call', { name: 'nope' }), undefined);
  assert.deepEqual(rpc(b, 'tools/call', { name: 'nope' }).error, { code: -32602, message: 'unknown tool: nope' });
});

test('every tool works on the board and returns the result as text and structured', (t) => {
  const dir = project(t);
  const b = new Board(path.join(dir, 'kanban'));
  assert.deepEqual(call(b, 'kanban_init').structuredContent.created.length, 6);
  const added = call(b, 'kanban_add', { title: 'Do it', state: 'todo', note: '- [ ] one' });
  assert.equal(added.structuredContent.ticket, 'KB-1');
  assert.deepEqual(JSON.parse(added.content[0].text), added.structuredContent);
  assert.equal(call(b, 'kanban_add', { ticket: 'J-4', title: 'Jira' }).structuredContent.ticket, 'J-4');
  assert.equal(call(b, 'kanban_move', { ticket: 'KB-1', to: 'doing', note: 'go' }).structuredContent.to, 'doing');
  assert.equal(call(b, 'kanban_check', { ticket: 'KB-1', item: 1 }).structuredContent.done, 1);
  assert.equal(call(b, 'kanban_check', { ticket: 'KB-1', item: 1, uncheck: true }).structuredContent.done, 0);
  assert.equal(call(b, 'kanban_append', { ticket: 'KB-1', note: 'why', section: 'Notes' }).structuredContent.section, 'Notes');
  assert.match(call(b, 'kanban_show', { ticket: 'KB-1' }).structuredContent.content, /## Notes\n\nwhy\n$/);
  assert.deepEqual(call(b, 'kanban_summary').structuredContent.doing, [{ ticket: 'KB-1', title: 'Do it' }]);
  assert.equal(call(b, 'kanban_list', { state: 'backlog' }).structuredContent.count, 1);
  assert.equal(call(b, 'kanban_list').structuredContent.count, 2);
  assert.equal(call(b, 'kanban_audit', { max_doing_hours: 0, max_blocked_hours: 0 }).structuredContent.op, 'audit');
  assert.equal(call(b, 'kanban_audit').structuredContent.ok, true);
  assert.equal(call(b, 'kanban_close', { ticket: 'KB-1', archive: true, sprint: 's' }).structuredContent.archived, true);
});

test('a board error is a tool result with isError, anything else a JSON-RPC error', (t) => {
  const b = board(t);
  assert.deepEqual(call(b, 'kanban_move', { ticket: 'X-1', to: 'doing' }), {
    content: [{ type: 'text', text: 'ticket X-1 is not on the board (kanban/)' }],
    isError: true,
  });
  const dir = project(t);
  fs.writeFileSync(path.join(dir, 'kanban'), 'a file');
  const broken = rpc(new Board(path.join(dir, 'kanban')), 'tools/call', { name: 'kanban_init' });
  assert.equal(broken.error.code, -32603);
});

test('serve: one message per line, skips blank lines, answers parse errors', async (t) => {
  const b = board(t);
  const output = sink();
  const input = Readable.from([
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}\n\n',
    '{"jsonrpc":"2.0","method":"notifications/initialized"}\n',
    'not json\n',
    '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"kanban_summary"}}\n',
  ]);
  await serve({ board: b, input, output, version: '1.0.0' });
  const replies = output.text.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(replies.map((r) => r.id), [1, null, 2]);
  assert.equal(replies[1].error.code, -32700);
  assert.equal(replies[2].result.structuredContent.op, 'summary');
});

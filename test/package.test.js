// The package, the plugins and the marketplaces agree with each other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as api from '../src/index.js';

const json = (p) => JSON.parse(fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const exists = (p) => fs.existsSync(new URL(`../${p}`, import.meta.url));
const pkg = json('package.json');

test('the entry point exports the API', () => {
  for (const name of ['Board', 'KanbanError', 'STATES', 'findRoot', 'serve', 'handle', 'TOOLS', 'main', 'VERSION']) {
    assert.ok(name in api, name);
  }
});

test('both plugin manifests have the package version and point at files that exist', () => {
  const claude = json('agents/.claude-plugin/plugin.json');
  const codex = json('agents/.codex-plugin/plugin.json');
  for (const m of [claude, codex]) {
    assert.equal(m.name, 'microkanban');
    assert.equal(m.version, pkg.version);
    assert.equal(m.license, pkg.license);
  }
  for (const p of [codex.skills, codex.mcpServers, codex.interface.composerIcon, codex.interface.logo]) {
    assert.match(p, /^\.\//);
    assert.ok(exists(`agents/${p.slice(2)}`), p);
  }
});

test('the MCP config runs this package\'s major version', () => {
  const server = json('agents/.mcp.json').mcpServers.microkanban;
  assert.equal(server.command, 'npx');
  assert.deepEqual(server.args, ['-y', `${pkg.name}@${pkg.version.split('.')[0]}`, 'mcp']);
});

test('the skill has the frontmatter agents need', () => {
  const skill = fs.readFileSync(new URL('../agents/skills/microkanban/SKILL.md', import.meta.url), 'utf8');
  const fm = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(skill);
  assert.ok(fm);
  assert.equal(fm[1], 'microkanban');
  assert.ok(fm[2].length < 1024);
  for (const tool of api.TOOLS.map((t) => t.name).filter((n) => n !== 'kanban_init' && n !== 'kanban_list')) {
    assert.ok(skill.includes(tool), `the skill mentions ${tool}`);
  }
});

test('both marketplaces list the plugin folder', () => {
  const claude = json('.claude-plugin/marketplace.json');
  const codex = json('.agents/plugins/marketplace.json');
  assert.equal(claude.plugins[0].source, './agents');
  assert.equal(codex.plugins[0].source.path, './agents');
  for (const m of [claude, codex]) assert.equal(m.plugins[0].name, 'microkanban');
});

test('the npm package ships the plugin', () => {
  assert.deepEqual(pkg.files, ['src', 'bin', 'agents']);
  assert.equal(pkg.bin.microkanban, './bin/microkanban.js');
});

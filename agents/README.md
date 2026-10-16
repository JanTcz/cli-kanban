# The microkanban plugin

One folder for every coding agent: the `microkanban` skill
(`skills/microkanban/SKILL.md`, Agent Skills standard) and the MCP server
(`.mcp.json`, which runs `npx -y microkanban@0 mcp`).

| Agent | Manifest | Install |
|---|---|---|
| Claude Code | `.claude-plugin/plugin.json` | `/plugin marketplace add JanTcz/cli-kanban`, then `/plugin install microkanban@cli-kanban` |
| Codex | `.codex-plugin/plugin.json` | `codex plugin marketplace add JanTcz/cli-kanban`, then enable `microkanban@cli-kanban` |
| Others | none | copy `skills/microkanban/` into the agent's skills folder and the server from `.mcp.json` into its MCP config |

The marketplaces are in the repository root: `.claude-plugin/marketplace.json`
and `.agents/plugins/marketplace.json`.

# The microkanban plugin

One folder for every coding agent: the `microkanban` skill
(`skills/microkanban/SKILL.md`, Agent Skills standard) and the MCP server
(`.mcp.json`, which runs `npx -y microkanban@0 mcp`).

| Agent | Manifest | Install |
|---|---|---|
| Claude Code | `.claude-plugin/plugin.json` | `/plugin marketplace add JanTcz/marketplace`, then `/plugin install microkanban@jantcz` |
| Codex | `.codex-plugin/plugin.json` | `codex plugin marketplace add JanTcz/marketplace`, then enable `microkanban@jantcz` |
| Others | none | copy `skills/microkanban/` into the agent's skills folder and the server from `.mcp.json` into its MCP config |

The marketplace that lists it is [JanTcz/marketplace](https://github.com/JanTcz/marketplace).

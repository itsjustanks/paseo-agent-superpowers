# paseo-agent-superpowers

**A [Paseo](https://paseo.sh) plugin that gives your agents multiple accounts: see every Claude Code / Codex account slot, wire each one into Paseo as its own provider, and keep MCP servers consistent across all of them — from a panel.**

Built on [agent-auth](https://github.com/itsjustanks/agent-auth), which manages the account slots themselves (one folder per account email, each with its own live credential store — no credential copying, ever).

## What you get

A sidebar surface (**Agent Superpowers**, also in the Command Center) showing:

- **Accounts** — every slot across Claude Code and Codex with live status: logged in, not logged in (with the exact terminal command to fix it), or **wrong account** (slot folder says one email, the login inside is another).
- **Wire into Paseo** — one click adds a slot as a Paseo custom provider (`extends` the native claude/codex integration, points `CLAUDE_CONFIG_DIR`/`CODEX_HOME` at the slot). Each wired slot is an independent quota pool: five agents on three Claude accounts genuinely run on three separate rate limits. A banner reminds you that Paseo loads new providers on the next daemon restart.
- **Diagnose** — runs Paseo's own provider diagnostic on a wired slot to confirm it resolves and is authenticated.
- **MCP servers** — how many MCP server definitions each slot has versus your primary (so drift is visible), how many OAuth grants live in each slot, and a one-click **Sync definitions to all slots** (runs `agent-auth sync`: definitions and project trust only — never tokens).

## Install

```sh
git clone https://github.com/itsjustanks/paseo-agent-superpowers
cd paseo-agent-superpowers
npm install
npm run typecheck
paseo plugin install "$(pwd)"
```

Requires Paseo ≥ 0.5 with plugins enabled (Settings → Plugins). **The [agent-auth](https://github.com/itsjustanks/agent-auth) CLI is optional** — the plugin is fully standalone (MCP sync, wiring, health, editing are all built in); agent-auth adds one-command logins and hot-switching of the plain `claude`/`codex` commands. The panel also detects hand-rolled slot layouts in `~/.claude-accounts` / `~/.codex-accounts` (read-only, labeled "external").

**Scope**: the MCP tab manages **user-level** (global) servers — each provider's own config. Project-level servers (a repo's `.mcp.json`) belong to that repo and are never touched.

## What stays in the terminal

The browser OAuth login itself — it's an interactive flow. The panel shows the exact `agent-auth login …` command for any slot that needs it; everything else (status, wiring, diagnostics, MCP sync) is in the panel.

## Security

Plugin backend code runs trusted on your daemon machine. This plugin's handlers read only **account emails and key names** from slot configs to compute status — token material is never read into results, logged, or sent anywhere. Provider wiring goes through Paseo's own `config.patch` API. MCP sync copies definitions, never credentials.

## License

MIT

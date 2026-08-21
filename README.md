# paseo-agent-superpowers

**A [Paseo](https://paseo.sh) plugin for people running more than one AI coding account: see every account and provider connector with live health, wire each account in as its own parallel provider, and manage MCP servers across all of them from one table.**

Two sidebar tabs:

## 👥 Agent Sync

One card per provider connector — **Claude Code, Codex, Kimi Code, Grok** — each with a health dot and Paseo's own diagnostic one click away. Inside each card, a table of every account under it:

- the **primary** account (the login your plain `claude` / `codex` uses), shown by email
- every **account slot** with live state: 🟢 logged in · 🟠 login needed · 🔴 wrong account (the slot folder says one email, the login inside is another)
- **Wire into Paseo** — one click adds that account as a Paseo custom provider (`extends` the native integration, pointing `CLAUDE_CONFIG_DIR` / `CODEX_HOME` at the slot). Each wired account is an independent quota pool: five agents across three Claude accounts genuinely run on three separate rate limits. A banner reminds you Paseo loads new providers at the next daemon restart.

## 🔌 MCP

A universal manager for **user-level** MCP servers across every provider on the machine — Claude Code and Codex primaries (labeled with their actual account), every wired provider, every account slot, plus Kimi Code and Grok. One row per server, one column-equivalent per destination:

- **Sticky header** with search and **All / Gaps / Issues** tabs
- **Health check** — HTTP servers get a real request (a 401/403 is reported as **auth needed**, which is the honest answer to "does this need authorizing?"); stdio servers get a binary-on-PATH check. 🟢 / 🟠 / 🔴 per server.
- **Expand** a server for its destination table: present or missing per destination, add or remove there
- **Edit** — every destination's own definition, side by side. Different auth per account is expected and supported: change one account's header and save just that destination, or take one destination's version and **Use for ALL**.
- **Reveal secrets** — masked (`•••last4`) by default; one tap shows the stored values. Masked values are preserved on save, so you can never accidentally copy one account's token into another.
- **Rename everywhere** — rewrites a server's key across every config that has it (copy-then-delete, so a failure can never lose the definition)
- **Add server** — http or stdio, headers/env as `KEY=VALUE` lines, targeting all destinations or specific ones
- **Sync accounts** — pushes user-level definitions and project trust from each primary into its account slots

Every write backs up the target config first (last 5 kept). A config file that exists but cannot be parsed is never overwritten.

## Install

```sh
git clone https://github.com/itsjustanks/paseo-agent-superpowers
cd paseo-agent-superpowers
npm install
npm run typecheck
paseo plugin install "$(pwd)"
```

Requires Paseo ≥ 0.5 with plugins enabled (Settings → Plugins). Tested against 0.5.0-beta.2.

**Nothing else is required.** Every provider and account it finds is one you already have — the plugin installs no software and creates no accounts. Providers you don't use simply don't appear.

### Optional: the agent-auth CLI

[**agent-auth**](https://github.com/itsjustanks/agent-auth) is the companion CLI that creates and logs in account slots (`agent-auth add claude you@work.com`) and can hot-switch which account the plain `claude` / `codex` command uses. The plugin is fully standalone without it — it reads whatever slots exist and does its own MCP sync — but with agent-auth installed, logins become one command and the panel points you at it. The panel also reads hand-rolled slot layouts in `~/.claude-accounts` / `~/.codex-accounts`.

### Scope: user-level, not project-level

The MCP tab manages **user-level** (global) servers — each provider's own config, available in all your projects. A repo's own project-level servers (`.mcp.json` in the repository) belong to that repo and are never read or written.

## What stays in the terminal

Browser OAuth — both account logins and per-server MCP authorization. Those flows are owned by each CLI and are **provider-specific and per-account**: Claude Code authorizes an MCP server with `/mcp` inside a session on that account; other CLIs have their own flow. No panel can do them for you. What this panel does is show exactly which account or server needs authorizing, and hand you the command.

## Troubleshooting

- **Buttons stop responding after a plugin update/reload** — an already-open panel keeps the old client bundle with a dead session. Navigate to another sidebar item and back (or reopen the Paseo window).
- **A wired provider errors about a path that doesn't exist** — Paseo builds its provider registry at daemon startup; config changes only take effect after `paseo restart`. Restart when no agents are mid-task.
- **A slot shows "login needed" although Paseo lists the provider** — listed means *configured*, not *authenticated*. Run the login command the panel shows.
- **An edit disappeared** — a running CLI session can rewrite its own config from memory. Make config changes when that provider isn't mid-session, or re-apply after.

## Security

Plugin backend code runs trusted and unsandboxed on your daemon machine (that is true of every Paseo plugin). Specifically, this one:

- reads MCP config files and, from credential-adjacent files, **only** the account email used for identity checks — never token material
- masks secret values in the UI by default; full values are shown only when you press **Reveal secrets**, and never leave your machine
- strips URL query strings from displayed summaries (some providers put tokens in URLs)
- backs up every config file before writing it, and refuses to overwrite a file it cannot parse
- changes Paseo providers through Paseo's own `config.patch` API, never by editing the daemon config file
- copies MCP *definitions* between accounts, never credentials — OAuth grants stay in each account's own store

## License

MIT

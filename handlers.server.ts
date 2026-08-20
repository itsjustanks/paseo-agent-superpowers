import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { Slot } from "./contracts.shared";

const HOME = homedir();
const AGENT_AUTH_ROOT = join(process.env.AGENT_AUTH_HOME ?? join(HOME, ".agent-auth"), "accounts");
// Hand-rolled slot layouts some setups use outside agent-auth (read-only here).
const EXTERNAL_ROOTS: Array<{ provider: "claude" | "codex"; root: string }> = [
  { provider: "claude", root: join(HOME, ".claude-accounts") },
  { provider: "codex", root: join(HOME, ".codex-accounts") },
];

// Set after a provider is wired; Paseo builds its provider registry at startup,
// so new providers appear only after a daemon restart.
let needsRestart = false;

function listDirs(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name));
  } catch {
    return [];
  }
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// Only the account email is ever read from credential-adjacent files — no token
// material leaves the handler.
function slotEmail(provider: "claude" | "codex", dir: string): string {
  if (provider === "claude") {
    const config = readJson(join(dir, ".claude.json"));
    const account = config?.oauthAccount as { emailAddress?: string } | undefined;
    return account?.emailAddress ?? "";
  }
  const auth = readJson(join(dir, "auth.json"));
  const idToken = (auth?.tokens as { id_token?: string } | undefined)?.id_token;
  if (!idToken) return "";
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString());
    return typeof payload.email === "string" ? payload.email : "";
  } catch {
    return "";
  }
}

function credFile(provider: "claude" | "codex"): string {
  return provider === "claude" ? ".credentials.json" : "auth.json";
}

function envVarFor(provider: "claude" | "codex"): string {
  return provider === "claude" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME";
}

function collectSlots(): Array<Omit<Slot, "wiredProviderId">> {
  const slots: Array<Omit<Slot, "wiredProviderId">> = [];
  const seen = new Set<string>();
  const add = (provider: "claude" | "codex", dir: string, source: "agent-auth" | "external") => {
    if (seen.has(dir)) return;
    seen.add(dir);
    const email = basename(dir);
    const loggedIn = existsSync(join(dir, credFile(provider)));
    const actualEmail = loggedIn ? slotEmail(provider, dir) : "";
    slots.push({
      provider,
      email,
      dir,
      source,
      loggedIn,
      actualEmail,
      wrongAccount: loggedIn && actualEmail !== "" && actualEmail !== email,
    });
  };
  for (const provider of ["claude", "codex"] as const) {
    for (const dir of listDirs(join(AGENT_AUTH_ROOT, provider))) add(provider, dir, "agent-auth");
  }
  for (const { provider, root } of EXTERNAL_ROOTS) {
    for (const dir of listDirs(root)) add(provider, dir, "external");
  }
  return slots;
}

type ProviderOverrides = Record<string, { env?: Record<string, string> } | undefined>;

function providerIdForDir(overrides: ProviderOverrides, provider: "claude" | "codex", dir: string): string | null {
  const envVar = envVarFor(provider);
  for (const [id, override] of Object.entries(overrides)) {
    if (override?.env?.[envVar] === dir) return id;
  }
  return null;
}

function slugForEmail(provider: string, email: string): string {
  return `${provider}-${email.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

function agentAuthInstalled(): boolean {
  const paths = (process.env.PATH ?? "").split(":").concat([join(HOME, ".local", "bin")]);
  return paths.some((p) => p && existsSync(join(p, "agent-auth")));
}

function countMcpOauthGrants(provider: "claude" | "codex", dir: string): number {
  // Counts credential-store entries beyond the account login itself — key names
  // only, values are never read into the result.
  if (provider !== "claude") return 0;
  const creds = readJson(join(dir, ".credentials.json"));
  if (!creds) return 0;
  return Object.keys(creds).filter((key) => key !== "claudeAiOauth").length;
}

function claudeMcpNames(configPath: string): string[] {
  const config = readJson(configPath);
  return Object.keys((config?.mcpServers as Record<string, unknown> | undefined) ?? {});
}

function codexMcpNames(configPath: string): string[] {
  try {
    const text = readFileSync(configPath, "utf8");
    return [...text.matchAll(/^\[mcp_servers\.([^\]]+)\]/gm)].map((match) => match[1] ?? "");
  } catch {
    return [];
  }
}

const CLAUDE_PRIMARY = join(HOME, ".claude.json");
const CODEX_PRIMARY = join(HOME, ".codex", "config.toml");

type ClaudeMcpDef = {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
};

function claudeMcpDefs(): Record<string, ClaudeMcpDef> {
  const config = readJson(CLAUDE_PRIMARY);
  return (config?.mcpServers as Record<string, ClaudeMcpDef> | undefined) ?? {};
}

function backupFile(path: string): void {
  if (!existsSync(path)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  copyFileSync(path, `${path}.bak-superpowers-${stamp}`);
}

function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = `${path}.tmp-superpowers`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}

// Extract one [mcp_servers.<name>] block (with subtables) from codex TOML.
function codexServerBlock(text: string, name: string): { start: number; end: number } | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const header = new RegExp(`^\\[mcp_servers\\.${escaped}(?:\\.[^\\]]+)?\\]`, "m");
  const startMatch = header.exec(text);
  if (!startMatch) return null;
  const start = startMatch.index;
  const rest = text.slice(start);
  const next = rest.split("\n").findIndex((line, index) => {
    if (index === 0) return false;
    const isHeader = /^\s*\[/.test(line);
    return isHeader && !new RegExp(`^\\s*\\[mcp_servers\\.${escaped}[.\\]]`).test(line);
  });
  if (next === -1) return { start, end: text.length };
  const offset = rest.split("\n").slice(0, next).join("\n").length + 1;
  return { start, end: start + offset };
}

function tomlString(value: string): string {
  return JSON.stringify(value); // valid TOML basic string
}

export async function handleScan(_input: Record<string, never>, { paseo }: PluginHandlerContext) {
  const { config } = await paseo.config.get();
  const overrides = ((config as { agents?: { providers?: ProviderOverrides } }).agents?.providers ??
    {}) as ProviderOverrides;
  const slots = collectSlots().map((slot) => ({
    ...slot,
    wiredProviderId: providerIdForDir(overrides, slot.provider, slot.dir),
  }));
  return { slots, agentAuthInstalled: agentAuthInstalled(), needsRestart };
}

export async function handleWireProvider(
  { provider, email, dir }: { provider: "claude" | "codex"; email: string; dir: string },
  { paseo }: PluginHandlerContext,
) {
  const providerId = slugForEmail(provider, email);
  await paseo.config.patch({
    agents: {
      providers: {
        [providerId]: {
          extends: provider,
          label: `${provider === "claude" ? "Claude" : "Codex"} · ${email}`,
          description: `${provider} pinned to ${email} (wired by agent-superpowers)`,
          env: { [envVarFor(provider)]: dir },
        },
      },
    },
  } as never);
  needsRestart = true;
  return { providerId, needsRestart };
}

export async function handleDiagnoseProvider({ providerId }: { providerId: string }, { paseo }: PluginHandlerContext) {
  try {
    const result = await paseo.providers.diagnostic(providerId as never);
    return { summary: JSON.stringify(result, null, 2).slice(0, 2000) };
  } catch (error) {
    return { summary: `diagnostic failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function handleMcpOverview() {
  const primaryClaude = claudeMcpNames(join(HOME, ".claude.json"));
  const primaryCodex = codexMcpNames(join(HOME, ".codex", "config.toml"));
  const slots = collectSlots().map((slot) => {
    const defined =
      slot.provider === "claude"
        ? claudeMcpNames(join(slot.dir, ".claude.json")).length
        : codexMcpNames(join(slot.dir, "config.toml")).length;
    return {
      provider: slot.provider,
      email: slot.email,
      definedServers: defined,
      primaryServers: slot.provider === "claude" ? primaryClaude.length : primaryCodex.length,
      oauthGrants: countMcpOauthGrants(slot.provider, slot.dir),
    };
  });
  return {
    primaryClaudeServers: primaryClaude.length,
    primaryCodexServers: primaryCodex.length,
    slots,
  };
}

export async function handleMcpList() {
  const claudeDefs = claudeMcpDefs();
  const codexNames = codexMcpNames(CODEX_PRIMARY);
  const slots = collectSlots();
  const claudeSlots = slots.filter((slot) => slot.provider === "claude");
  const codexSlots = slots.filter((slot) => slot.provider === "codex");
  const slotNames = new Map<string, Set<string>>();
  for (const slot of claudeSlots) {
    slotNames.set(slot.dir, new Set(claudeMcpNames(join(slot.dir, ".claude.json"))));
  }
  for (const slot of codexSlots) {
    slotNames.set(slot.dir, new Set(codexMcpNames(join(slot.dir, "config.toml"))));
  }
  const allNames = [...new Set([...Object.keys(claudeDefs), ...codexNames])].sort();
  const servers = allNames.map((name) => {
    const def = claudeDefs[name];
    const definedIn: Array<"claude" | "codex"> = [];
    if (def) definedIn.push("claude");
    if (codexNames.includes(name)) definedIn.push("codex");
    const transport: "stdio" | "http" | "sse" | "unknown" = def?.command
      ? "stdio"
      : def?.type === "sse"
        ? "sse"
        : def?.url
          ? "http"
          : definedIn.includes("codex")
            ? "stdio"
            : "unknown";
    // Key names only — env/header VALUES never leave the handler.
    const hasInline = Boolean(
      (def?.env && Object.keys(def.env).length > 0) || (def?.headers && Object.keys(def.headers).length > 0),
    );
    const detail = def?.command
      ? [def.command, ...(def.args ?? [])].join(" ").slice(0, 80)
      : (def?.url ?? "defined in codex config.toml").slice(0, 80);
    const cover = (group: typeof claudeSlots) =>
      `${group.filter((slot) => slotNames.get(slot.dir)?.has(name)).length}/${group.length}`;
    return {
      name,
      definedIn,
      transport,
      detail,
      authStyle: hasInline ? ("inline-credentials" as const) : ("oauth-or-none" as const),
      claudeSlotCoverage: cover(claudeSlots),
      codexSlotCoverage: cover(codexSlots),
    };
  });
  return { servers };
}

export async function handleMcpCopy({ name, from, to }: { name: string; from: "claude" | "codex"; to: "claude" | "codex" }) {
  if (from === to) return { ok: false, message: "source and target are the same provider" };
  if (from === "codex") {
    return { ok: false, message: "codex → claude copy is not supported yet — add it in claude with: claude mcp add" };
  }
  const def = claudeMcpDefs()[name];
  if (!def) return { ok: false, message: `no claude definition for '${name}'` };
  if (!def.command) {
    return { ok: false, message: `'${name}' is ${def.url ? "an HTTP/SSE" : "a non-stdio"} server — codex runs stdio MCP servers only` };
  }
  let text = "";
  try {
    text = readFileSync(CODEX_PRIMARY, "utf8");
  } catch {
    return { ok: false, message: `cannot read ${CODEX_PRIMARY}` };
  }
  if (codexServerBlock(text, name)) return { ok: false, message: `'${name}' already exists in codex config` };
  backupFile(CODEX_PRIMARY);
  const lines = [`\n[mcp_servers.${name}]`, `command = ${tomlString(def.command)}`];
  if (def.args?.length) lines.push(`args = [${def.args.map(tomlString).join(", ")}]`);
  if (def.env && Object.keys(def.env).length > 0) {
    lines.push(`[mcp_servers.${name}.env]`);
    for (const [key, value] of Object.entries(def.env)) lines.push(`${key} = ${tomlString(value)}`);
  }
  writeFileSync(CODEX_PRIMARY, `${text.replace(/\n*$/, "\n")}${lines.join("\n")}\n`);
  return { ok: true, message: `'${name}' added to codex config (backup saved). Run sync to push it into slots.` };
}

export async function handleMcpRemove({ name, from }: { name: string; from: "claude" | "codex" }) {
  if (from === "claude") {
    const config = readJson(CLAUDE_PRIMARY);
    const servers = (config?.mcpServers as Record<string, unknown> | undefined) ?? {};
    if (!config || !(name in servers)) return { ok: false, message: `no claude definition for '${name}'` };
    backupFile(CLAUDE_PRIMARY);
    delete servers[name];
    config.mcpServers = servers;
    writeJsonAtomic(CLAUDE_PRIMARY, config);
    return { ok: true, message: `'${name}' removed from claude config (backup saved). Sync to propagate to slots. Note: a running Claude Code session may rewrite this file from memory.` };
  }
  let text = "";
  try {
    text = readFileSync(CODEX_PRIMARY, "utf8");
  } catch {
    return { ok: false, message: `cannot read ${CODEX_PRIMARY}` };
  }
  let block = codexServerBlock(text, name);
  if (!block) return { ok: false, message: `no codex definition for '${name}'` };
  backupFile(CODEX_PRIMARY);
  while (block) {
    text = text.slice(0, block.start) + text.slice(block.end);
    block = codexServerBlock(text, name);
  }
  writeFileSync(CODEX_PRIMARY, text);
  return { ok: true, message: `'${name}' removed from codex config (backup saved). Sync to propagate to slots.` };
}

export async function handleMcpSync(): Promise<{ ok: boolean; log: string }> {
  return await new Promise((resolve) => {
    const env = { ...process.env, PATH: `${process.env.PATH ?? ""}:${join(HOME, ".local", "bin")}` };
    execFile("agent-auth", ["sync"], { env, timeout: 30_000 }, (error, stdout, stderr) => {
      if (error) {
        const hint = agentAuthInstalled()
          ? String(stderr || error.message)
          : "agent-auth is not installed — see https://github.com/itsjustanks/agent-auth";
        resolve({ ok: false, log: hint });
        return;
      }
      resolve({ ok: true, log: String(stdout).trim() });
    });
  });
}

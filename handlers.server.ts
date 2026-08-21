import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { Destination, Slot } from "./contracts.shared";

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

// ---------------------------------------------------------------- fs helpers

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

// ---------------------------------------------------------------- accounts / slots

// Only the account email is ever read from credential-adjacent files — no token
// material leaves the handler.
function claudeAccountEmail(configDir: string): string {
  const config = readJson(configDir === HOME ? join(HOME, ".claude.json") : join(configDir, ".claude.json"));
  const account = config?.oauthAccount as { emailAddress?: string } | undefined;
  return account?.emailAddress ?? "";
}

function codexAccountEmail(codexHome: string): string {
  const auth = readJson(join(codexHome, "auth.json"));
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
    const actualEmail = loggedIn
      ? provider === "claude"
        ? claudeAccountEmail(dir)
        : codexAccountEmail(dir)
      : "";
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

type ProviderOverrides = Record<
  string,
  { extends?: string; env?: Record<string, string>; enabled?: boolean; label?: string } | undefined
>;

async function providerOverrides(paseo: PluginHandlerContext["paseo"]): Promise<ProviderOverrides> {
  const { config } = await paseo.config.get();
  return ((config as { agents?: { providers?: ProviderOverrides } }).agents?.providers ?? {}) as ProviderOverrides;
}

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

// ---------------------------------------------------------------- MCP formats

type McpDef = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  type?: string;
};

// json-mcp: a JSON file with a top-level `mcpServers` object. Claude Code's
// ~/.claude.json and Kimi Code's mcp.json both use this shape.
function jsonMcpRead(path: string): Record<string, McpDef> {
  const config = readJson(path);
  return (config?.mcpServers as Record<string, McpDef> | undefined) ?? {};
}

function jsonMcpWrite(path: string, name: string, def: McpDef | null): void {
  const config = readJson(path) ?? {};
  const servers = (config.mcpServers as Record<string, McpDef> | undefined) ?? {};
  if (def === null) delete servers[name];
  else servers[name] = def;
  config.mcpServers = servers;
  backupFile(path);
  writeJsonAtomic(path, config);
}

// toml-mcp: [mcp_servers.<name>] tables. Codex and Grok both use this shape.
function tomlString(value: string): string {
  return JSON.stringify(value);
}

function tomlMcpNames(path: string): string[] {
  try {
    const text = readFileSync(path, "utf8");
    return [...new Set([...text.matchAll(/^\[mcp_servers\.([^\].]+)/gm)].map((match) => match[1] ?? ""))];
  } catch {
    return [];
  }
}

function tomlServerBlock(text: string, name: string): { start: number; end: number } | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const header = new RegExp(`^\\[mcp_servers\\.${escaped}(?:\\.[^\\]]+)?\\]`, "m");
  const startMatch = header.exec(text);
  if (!startMatch) return null;
  const start = startMatch.index;
  const rest = text.slice(start);
  const lines = rest.split("\n");
  const next = lines.findIndex((line, index) => {
    if (index === 0) return false;
    return /^\s*\[/.test(line) && !new RegExp(`^\\s*\\[mcp_servers\\.${escaped}[.\\]]`).test(line);
  });
  if (next === -1) return { start, end: text.length };
  const offset = lines.slice(0, next).join("\n").length + 1;
  return { start, end: start + offset };
}

// Minimal parse of one server block — enough to re-create the definition elsewhere.
function tomlMcpReadOne(path: string, name: string): McpDef | null {
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const block = tomlServerBlock(text, name);
  if (!block) return null;
  const body = text.slice(block.start, block.end);
  const def: McpDef = {};
  const grab = (key: string) => new RegExp(`^${key}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`, "m").exec(body)?.[1];
  const url = grab("url");
  const command = grab("command");
  if (url) def.url = JSON.parse(`"${url}"`);
  if (command) def.command = JSON.parse(`"${command}"`);
  const argsMatch = /^args\s*=\s*\[([^\]]*)\]/m.exec(body);
  if (argsMatch) {
    def.args = [...argsMatch[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => JSON.parse(`"${match[1]}"`));
  }
  for (const sub of ["env", "headers"] as const) {
    const subHeader = body.indexOf(`[mcp_servers.${name}.${sub}]`);
    if (subHeader === -1) continue;
    const subBody = body.slice(subHeader).split("\n").slice(1);
    const record: Record<string, string> = {};
    for (const line of subBody) {
      if (/^\s*\[/.test(line)) break;
      const pair = /^\s*([A-Za-z0-9_-]+)\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(line);
      if (pair) record[pair[1]] = JSON.parse(`"${pair[2]}"`);
    }
    if (Object.keys(record).length > 0) def[sub] = record;
  }
  return def;
}

function tomlMcpWrite(path: string, name: string, def: McpDef | null): void {
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    text = "";
  }
  backupFile(path);
  let block = tomlServerBlock(text, name);
  while (block) {
    text = text.slice(0, block.start) + text.slice(block.end);
    block = tomlServerBlock(text, name);
  }
  if (def) {
    const lines = [`\n[mcp_servers.${name}]`];
    if (def.command) lines.push(`command = ${tomlString(def.command)}`);
    if (def.args?.length) lines.push(`args = [${def.args.map(tomlString).join(", ")}]`);
    if (def.url) lines.push(`url = ${tomlString(def.url)}`);
    for (const sub of ["env", "headers"] as const) {
      const record = def[sub];
      if (record && Object.keys(record).length > 0) {
        lines.push(`[mcp_servers.${name}.${sub}]`);
        for (const [key, value] of Object.entries(record)) lines.push(`${key} = ${tomlString(value)}`);
      }
    }
    text = `${text.replace(/\n*$/, "\n")}${lines.join("\n")}\n`;
  }
  writeFileSync(path, text);
}

function destRead(dest: Destination): Record<string, McpDef> {
  if (dest.format === "json-mcp") return jsonMcpRead(dest.configPath);
  const names = tomlMcpNames(dest.configPath);
  const defs: Record<string, McpDef> = {};
  for (const name of names) {
    const def = tomlMcpReadOne(dest.configPath, name);
    if (def) defs[name] = def;
  }
  return defs;
}

function destNames(dest: Destination): string[] {
  return dest.format === "json-mcp" ? Object.keys(jsonMcpRead(dest.configPath)) : tomlMcpNames(dest.configPath);
}

function destWrite(dest: Destination, name: string, def: McpDef | null): void {
  if (dest.format === "json-mcp") jsonMcpWrite(dest.configPath, name, def);
  else tomlMcpWrite(dest.configPath, name, def);
}

// ---------------------------------------------------------------- destinations

async function buildDestinations(paseo: PluginHandlerContext["paseo"]): Promise<Destination[]> {
  const overrides = await providerOverrides(paseo);
  const destinations: Destination[] = [];
  const seen = new Set<string>();
  const push = (dest: Destination) => {
    if (seen.has(dest.configPath) || !existsSync(dirname(dest.configPath))) return;
    seen.add(dest.configPath);
    destinations.push(dest);
  };

  const enabled = (id: string) => overrides[id]?.enabled !== false;

  if (enabled("claude")) {
    const account = claudeAccountEmail(HOME);
    push({
      id: join(HOME, ".claude.json"),
      label: `Claude · ${account || "primary"} (primary)`,
      provider: "claude",
      account,
      configPath: join(HOME, ".claude.json"),
      format: "json-mcp",
    });
  }
  if (enabled("codex")) {
    const account = codexAccountEmail(join(HOME, ".codex"));
    push({
      id: join(HOME, ".codex", "config.toml"),
      label: `Codex · ${account || "primary"} (primary)`,
      provider: "codex",
      account,
      configPath: join(HOME, ".codex", "config.toml"),
      format: "toml-mcp",
    });
  }
  if (enabled("kimi") && existsSync(join(HOME, ".kimi-code"))) {
    push({
      id: join(HOME, ".kimi-code", "mcp.json"),
      label: "Kimi Code",
      provider: "kimi",
      account: "",
      configPath: join(HOME, ".kimi-code", "mcp.json"),
      format: "json-mcp",
    });
  }
  if (enabled("grok") && existsSync(join(HOME, ".grok"))) {
    push({
      id: join(HOME, ".grok", "config.toml"),
      label: "Grok",
      provider: "grok",
      account: "",
      configPath: join(HOME, ".grok", "config.toml"),
      format: "toml-mcp",
    });
  }
  // Derived per-account providers (extends claude/codex with a config-dir env).
  for (const [id, override] of Object.entries(overrides)) {
    const base = override?.extends;
    if (base !== "claude" && base !== "codex") continue;
    if (override?.enabled === false) continue;
    const dir = override?.env?.[envVarFor(base)];
    if (!dir) continue;
    const configPath = base === "claude" ? join(dir, ".claude.json") : join(dir, "config.toml");
    const account = base === "claude" ? claudeAccountEmail(dir) : codexAccountEmail(dir);
    push({
      id: configPath,
      label: `${base === "claude" ? "Claude" : "Codex"} · ${account || basename(dir)} (${id})`,
      provider: base,
      account: account || basename(dir),
      configPath,
      format: base === "claude" ? "json-mcp" : "toml-mcp",
    });
  }
  // Slots that exist but are not wired as providers yet.
  for (const slot of collectSlots()) {
    const configPath = slot.provider === "claude" ? join(slot.dir, ".claude.json") : join(slot.dir, "config.toml");
    push({
      id: configPath,
      label: `${slot.provider === "claude" ? "Claude" : "Codex"} · ${slot.email} (slot)`,
      provider: slot.provider,
      account: slot.email,
      configPath,
      format: slot.provider === "claude" ? "json-mcp" : "toml-mcp",
    });
  }
  return destinations;
}

// ---------------------------------------------------------------- handlers

export async function handleScan(_input: Record<string, never>, { paseo }: PluginHandlerContext) {
  const overrides = await providerOverrides(paseo);
  const slots = collectSlots().map((slot) => ({
    ...slot,
    wiredProviderId: providerIdForDir(overrides, slot.provider, slot.dir),
  }));
  return {
    slots,
    primaryAccounts: { claude: claudeAccountEmail(HOME), codex: codexAccountEmail(join(HOME, ".codex")) },
    agentAuthInstalled: agentAuthInstalled(),
    needsRestart,
  };
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

export async function handleProviderHealth(_input: Record<string, never>, { paseo }: PluginHandlerContext) {
  const overrides = await providerOverrides(paseo);
  const ids = new Set<string>(["claude", "codex", "kimi", "grok"]);
  for (const [id, override] of Object.entries(overrides)) {
    if (override?.enabled === false) ids.delete(id);
    else ids.add(id);
  }
  for (const skip of ["cursor", "devin", "copilot", "opencode", "pi"]) {
    if (overrides[skip]?.enabled === false) ids.delete(skip);
  }
  const providers = await Promise.all(
    [...ids].map(async (id) => {
      try {
        const result = await paseo.providers.diagnostic(id as never);
        const text = JSON.stringify(result);
        const ok = !/"error"|not logged|login required|unauthorized|failed/i.test(text);
        const models = /"models"\s*:\s*\[/.test(text) ? (text.match(/"id"\s*:/g)?.length ?? 0) : 0;
        const summary = ok
          ? `ok${models ? ` · ~${models} models` : ""}`
          : text.slice(0, 160);
        return { id, label: overrides[id]?.label ?? id, ok, summary };
      } catch (error) {
        return {
          id,
          label: overrides[id]?.label ?? id,
          ok: false,
          summary: `diagnostic failed: ${error instanceof Error ? error.message : String(error)}`.slice(0, 160),
        };
      }
    }),
  );
  providers.sort((a, b) => a.id.localeCompare(b.id));
  return { providers };
}

export async function handleMcpMatrix(_input: Record<string, never>, { paseo }: PluginHandlerContext) {
  const destinations = await buildDestinations(paseo);
  const nameSets = new Map<string, Set<string>>();
  for (const dest of destinations) nameSets.set(dest.id, new Set(destNames(dest)));
  const allNames = [...new Set([...nameSets.values()].flatMap((set) => [...set]))].sort();

  const servers = allNames.map((name) => {
    const presentIn = destinations.filter((dest) => nameSets.get(dest.id)?.has(name)).map((dest) => dest.id);
    // Best definition for display: prefer a json-mcp source.
    let def: McpDef | null = null;
    for (const dest of destinations) {
      if (!nameSets.get(dest.id)?.has(name)) continue;
      const candidate = dest.format === "json-mcp" ? jsonMcpRead(dest.configPath)[name] : tomlMcpReadOne(dest.configPath, name);
      if (candidate) {
        def = candidate;
        if (dest.format === "json-mcp") break;
      }
    }
    const transport: "stdio" | "http" | "unknown" = def?.command ? "stdio" : def?.url ? "http" : "unknown";
    // Key names only — env/header VALUES never leave the handler.
    const hasInline = Boolean(
      (def?.env && Object.keys(def.env).length > 0) || (def?.headers && Object.keys(def.headers).length > 0),
    );
    const rawDetail = def?.command ? [def.command, ...(def.args ?? [])].join(" ") : (def?.url ?? "");
    // Strip query strings — URLs sometimes carry tokens.
    const detail = rawDetail.replace(/\?.*/, "?…").slice(0, 80);
    return {
      name,
      transport,
      detail,
      authStyle: hasInline ? ("inline-credentials" as const) : ("oauth-or-none" as const),
      presentIn,
    };
  });
  return { destinations, servers };
}

function parseKvLines(text: string | undefined): Record<string, string> {
  const record: Record<string, string> = {};
  for (const line of (text ?? "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    record[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return record;
}

function applyDefToTargets(
  destinations: Destination[],
  targets: string[],
  name: string,
  def: McpDef,
): { written: string[]; skipped: string[] } {
  const written: string[] = [];
  const skipped: string[] = [];
  for (const target of targets) {
    const dest = destinations.find((candidate) => candidate.id === target);
    if (!dest) {
      skipped.push(`${target}: unknown destination`);
      continue;
    }
    try {
      destWrite(dest, name, def);
      written.push(dest.label);
    } catch (error) {
      skipped.push(`${dest.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { written, skipped };
}

export async function handleMcpAdd(
  input: { name: string; kind: "stdio" | "http"; command?: string; url?: string; kvLines?: string; targets: string[] },
  { paseo }: PluginHandlerContext,
) {
  if (!/^[A-Za-z0-9_-]+$/.test(input.name)) {
    return { ok: false, message: "name must be letters, numbers, hyphens, underscores" };
  }
  const def: McpDef = {};
  if (input.kind === "stdio") {
    const parts = (input.command ?? "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return { ok: false, message: "stdio server needs a command" };
    def.command = parts[0];
    if (parts.length > 1) def.args = parts.slice(1);
    const env = parseKvLines(input.kvLines);
    if (Object.keys(env).length > 0) def.env = env;
  } else {
    if (!input.url?.trim()) return { ok: false, message: "http server needs a URL" };
    def.url = input.url.trim();
    const headers = parseKvLines(input.kvLines);
    if (Object.keys(headers).length > 0) def.headers = headers;
  }
  const destinations = await buildDestinations(paseo);
  const { written, skipped } = applyDefToTargets(destinations, input.targets, input.name, def);
  return {
    ok: written.length > 0,
    message: [
      written.length ? `added '${input.name}' to: ${written.join(", ")} (backups saved)` : "nothing written",
      ...skipped,
    ].join("\n"),
  };
}

export async function handleMcpApply(
  { name, targets, sourceDestId }: { name: string; targets: string[]; sourceDestId?: string },
  { paseo }: PluginHandlerContext,
) {
  const destinations = await buildDestinations(paseo);
  let def: McpDef | null = null;
  if (sourceDestId) {
    const source = destinations.find((candidate) => candidate.id === sourceDestId);
    def = source ? destReadOne(source, name) : null;
    if (!def) return { ok: false, message: `'${name}' not found in the selected source destination` };
  } else {
    def = findDef(destinations, name);
  }
  if (!def) return { ok: false, message: `no existing definition of '${name}' found anywhere` };
  const { written, skipped } = applyDefToTargets(destinations, targets, name, def);
  return {
    ok: written.length > 0,
    message: [
      written.length ? `applied '${name}' to: ${written.join(", ")} (backups saved)` : "nothing written",
      ...skipped,
    ].join("\n"),
  };
}

export async function handleMcpRemove({ name, targets }: { name: string; targets: string[] }, { paseo }: PluginHandlerContext) {
  const destinations = await buildDestinations(paseo);
  const removed: string[] = [];
  const skipped: string[] = [];
  for (const target of targets) {
    const dest = destinations.find((candidate) => candidate.id === target);
    if (!dest) {
      skipped.push(`${target}: unknown destination`);
      continue;
    }
    try {
      destWrite(dest, name, null);
      removed.push(dest.label);
    } catch (error) {
      skipped.push(`${dest.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    ok: removed.length > 0,
    message: [
      removed.length
        ? `removed '${name}' from: ${removed.join(", ")} (backups saved). Note: a running CLI session may rewrite its own config from memory.`
        : "nothing removed",
      ...skipped,
    ].join("\n"),
  };
}

function findDef(destinations: Destination[], name: string): McpDef | null {
  let def: McpDef | null = null;
  for (const dest of destinations) {
    const candidate =
      dest.format === "json-mcp" ? jsonMcpRead(dest.configPath)[name] : tomlMcpReadOne(dest.configPath, name);
    if (candidate) {
      def = candidate;
      if (dest.format === "json-mcp") break;
    }
  }
  return def;
}

function maskValue(value: string): string {
  return value.length > 4 ? `•••${value.slice(-4)}` : "•••";
}

function destReadOne(dest: Destination, name: string): McpDef | null {
  return dest.format === "json-mcp" ? (jsonMcpRead(dest.configPath)[name] ?? null) : tomlMcpReadOne(dest.configPath, name);
}

export async function handleMcpDefAll({ name, reveal }: { name: string; reveal: boolean }, { paseo }: PluginHandlerContext) {
  const destinations = await buildDestinations(paseo);
  const rows = destinations.map((dest) => {
    const def = destReadOne(dest, name);
    if (!def) return { destId: dest.id, found: false, kind: "http" as const, command: "", url: "", kvLines: "" };
    const kind = def.command ? ("stdio" as const) : ("http" as const);
    const record = (kind === "stdio" ? def.env : def.headers) ?? {};
    const kvLines = Object.entries(record)
      .map(([key, value]) => `${key}=${reveal ? value : maskValue(value)}`)
      .join("\n");
    return {
      destId: dest.id,
      found: true,
      kind,
      command: def.command ? [def.command, ...(def.args ?? [])].join(" ") : "",
      url: def.url ?? "",
      kvLines,
    };
  });
  return { rows };
}

export async function handleMcpEditOne(
  input: { name: string; destId: string; kind: "stdio" | "http"; command?: string; url?: string; kvLines?: string },
  { paseo }: PluginHandlerContext,
) {
  const destinations = await buildDestinations(paseo);
  const dest = destinations.find((candidate) => candidate.id === input.destId);
  if (!dest) return { ok: false, message: `unknown destination ${input.destId}` };
  // Masked values restore from THIS destination's stored secret — per-account
  // auth settings are the point.
  const stored = destReadOne(dest, input.name);
  const storedRecord = (input.kind === "stdio" ? stored?.env : stored?.headers) ?? {};
  const parsed = parseKvLines(input.kvLines);
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    record[key] = value.startsWith("•••") ? (storedRecord[key] ?? "") : value;
    if (record[key] === "") delete record[key];
  }
  const def: McpDef = {};
  if (input.kind === "stdio") {
    const parts = (input.command ?? "").trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return { ok: false, message: "stdio server needs a command" };
    def.command = parts[0];
    if (parts.length > 1) def.args = parts.slice(1);
    if (Object.keys(record).length > 0) def.env = record;
  } else {
    if (!input.url?.trim()) return { ok: false, message: "http server needs a URL" };
    def.url = input.url.trim();
    if (Object.keys(record).length > 0) def.headers = record;
  }
  try {
    destWrite(dest, input.name, def);
    return { ok: true, message: `updated '${input.name}' in ${dest.label} (backup saved)` };
  } catch (error) {
    return { ok: false, message: `${dest.label}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function handleMcpRename({ name, newName }: { name: string; newName: string }, { paseo }: PluginHandlerContext) {
  if (!/^[A-Za-z0-9_-]+$/.test(newName)) {
    return { ok: false, message: "new name must be letters, numbers, hyphens, underscores" };
  }
  if (newName === name) return { ok: false, message: "new name is the same" };
  const destinations = await buildDestinations(paseo);
  const renamed: string[] = [];
  const skipped: string[] = [];
  for (const dest of destinations) {
    const def = destReadOne(dest, name);
    if (!def) continue;
    if (destReadOne(dest, newName)) {
      skipped.push(`${dest.label}: '${newName}' already exists there`);
      continue;
    }
    try {
      destWrite(dest, newName, def); // write the copy first, then remove the old —
      destWrite(dest, name, null); //   a failure in between leaves both, never neither
      renamed.push(dest.label);
    } catch (error) {
      skipped.push(`${dest.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (renamed.length === 0) return { ok: false, message: ["nothing renamed", ...skipped].join("\n") };
  return {
    ok: true,
    message: [
      `renamed '${name}' → '${newName}' in: ${renamed.join(", ")} (backups saved). OAuth grants keyed to the old name may need re-authorizing in each CLI.`,
      ...skipped,
    ].join("\n"),
  };
}

function binaryOnPath(command: string): boolean {
  if (command.includes("/")) return existsSync(command);
  const paths = (process.env.PATH ?? "").split(":").concat([join(HOME, ".local", "bin")]);
  return paths.some((dir) => dir && existsSync(join(dir, command)));
}

async function probeHttp(url: string, headers: Record<string, string> | undefined) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { method: "GET", headers, signal: controller.signal, redirect: "manual" });
    const code = response.status;
    if (code === 401 || code === 403) return { status: "auth-required" as const, note: `HTTP ${code} — authentication needed` };
    if (code >= 200 && code < 400) return { status: "ok" as const, note: `HTTP ${code}` };
    if (code === 404 || code === 405 || code === 406) return { status: "ok" as const, note: `reachable (HTTP ${code})` };
    return { status: "warn" as const, note: `HTTP ${code}` };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { status: "down" as const, note: reason.includes("abort") ? "timeout after 5s" : reason.slice(0, 80) };
  } finally {
    clearTimeout(timer);
  }
}

export async function handleMcpHealth(_input: Record<string, never>, { paseo }: PluginHandlerContext) {
  const destinations = await buildDestinations(paseo);
  const names = [...new Set(destinations.flatMap((dest) => destNames(dest)))].sort();
  const results = await Promise.all(
    names.map(async (name) => {
      const def = findDef(destinations, name);
      if (!def) return { name, status: "unknown" as const, note: "no readable definition" };
      if (def.command) {
        return binaryOnPath(def.command)
          ? { name, status: "ok" as const, note: `binary '${def.command}' found` }
          : { name, status: "binary-missing" as const, note: `'${def.command}' not on PATH` };
      }
      if (def.url) {
        const probe = await probeHttp(def.url, def.headers);
        return { name, ...probe };
      }
      return { name, status: "unknown" as const, note: "no command or url" };
    }),
  );
  return { results };
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

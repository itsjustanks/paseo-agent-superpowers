import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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

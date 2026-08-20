import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";

export const SlotSchema = z.object({
  provider: z.enum(["claude", "codex"]),
  email: z.string(),
  dir: z.string(),
  source: z.enum(["agent-auth", "external"]),
  loggedIn: z.boolean(),
  actualEmail: z.string(),
  wrongAccount: z.boolean(),
  wiredProviderId: z.string().nullable(),
});
export type Slot = z.infer<typeof SlotSchema>;

export const scan = defineRpc({
  name: "superpowers.scan",
  input: z.object({}),
  output: z.object({
    slots: z.array(SlotSchema),
    agentAuthInstalled: z.boolean(),
    needsRestart: z.boolean(),
  }),
});

export const wireProvider = defineRpc({
  name: "superpowers.wire-provider",
  input: z.object({
    provider: z.enum(["claude", "codex"]),
    email: z.string(),
    dir: z.string(),
  }),
  output: z.object({ providerId: z.string(), needsRestart: z.boolean() }),
});

export const diagnoseProvider = defineRpc({
  name: "superpowers.diagnose-provider",
  input: z.object({ providerId: z.string() }),
  output: z.object({ summary: z.string() }),
});

export const providerHealth = defineRpc({
  name: "superpowers.provider-health",
  input: z.object({}),
  output: z.object({
    providers: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        ok: z.boolean(),
        summary: z.string(),
      }),
    ),
  }),
});

// ---- universal MCP management -------------------------------------------------

export const DestinationSchema = z.object({
  id: z.string(), // stable: the config file path
  label: z.string(), // "Claude · you@work.com (primary)"
  provider: z.string(), // claude | codex | kimi | grok | <custom paseo id>
  account: z.string(), // email, or "" when the CLI has no per-account identity here
  configPath: z.string(),
  format: z.enum(["json-mcp", "toml-mcp"]),
});
export type Destination = z.infer<typeof DestinationSchema>;

export const McpServerRowSchema = z.object({
  name: z.string(),
  transport: z.enum(["stdio", "http", "unknown"]),
  detail: z.string(),
  authStyle: z.enum(["inline-credentials", "oauth-or-none"]),
  presentIn: z.array(z.string()), // destination ids
});
export type McpServerRow = z.infer<typeof McpServerRowSchema>;

export const mcpMatrix = defineRpc({
  name: "superpowers.mcp-matrix",
  input: z.object({}),
  output: z.object({
    destinations: z.array(DestinationSchema),
    servers: z.array(McpServerRowSchema),
  }),
});

export const mcpAdd = defineRpc({
  name: "superpowers.mcp-add",
  input: z.object({
    name: z.string().min(1),
    kind: z.enum(["stdio", "http"]),
    command: z.string().optional(), // stdio: full command line (first token = binary)
    url: z.string().optional(), // http
    kvLines: z.string().optional(), // env (stdio) or headers (http), one KEY=VALUE per line
    targets: z.array(z.string()).min(1), // destination ids
  }),
  output: z.object({ ok: z.boolean(), message: z.string() }),
});

export const mcpApply = defineRpc({
  name: "superpowers.mcp-apply",
  input: z.object({ name: z.string(), targets: z.array(z.string()).min(1) }),
  output: z.object({ ok: z.boolean(), message: z.string() }),
});

export const mcpRemove = defineRpc({
  name: "superpowers.mcp-remove",
  input: z.object({ name: z.string(), targets: z.array(z.string()).min(1) }),
  output: z.object({ ok: z.boolean(), message: z.string() }),
});

export const mcpSync = defineRpc({
  name: "superpowers.mcp-sync",
  input: z.object({}),
  output: z.object({ ok: z.boolean(), log: z.string() }),
});

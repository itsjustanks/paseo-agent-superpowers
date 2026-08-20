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

export const mcpOverview = defineRpc({
  name: "superpowers.mcp-overview",
  input: z.object({}),
  output: z.object({
    primaryClaudeServers: z.number(),
    primaryCodexServers: z.number(),
    slots: z.array(
      z.object({
        provider: z.enum(["claude", "codex"]),
        email: z.string(),
        definedServers: z.number(),
        primaryServers: z.number(),
        oauthGrants: z.number(),
      }),
    ),
  }),
});

export const mcpSync = defineRpc({
  name: "superpowers.mcp-sync",
  input: z.object({}),
  output: z.object({ ok: z.boolean(), log: z.string() }),
});

export const McpServerSchema = z.object({
  name: z.string(),
  definedIn: z.array(z.enum(["claude", "codex"])),
  transport: z.enum(["stdio", "http", "sse", "unknown"]),
  detail: z.string(),
  authStyle: z.enum(["inline-credentials", "oauth-or-none"]),
  claudeSlotCoverage: z.string(),
  codexSlotCoverage: z.string(),
});
export type McpServer = z.infer<typeof McpServerSchema>;

export const mcpList = defineRpc({
  name: "superpowers.mcp-list",
  input: z.object({}),
  output: z.object({ servers: z.array(McpServerSchema) }),
});

export const mcpCopy = defineRpc({
  name: "superpowers.mcp-copy",
  input: z.object({ name: z.string(), from: z.enum(["claude", "codex"]), to: z.enum(["claude", "codex"]) }),
  output: z.object({ ok: z.boolean(), message: z.string() }),
});

export const mcpRemove = defineRpc({
  name: "superpowers.mcp-remove",
  input: z.object({ name: z.string(), from: z.enum(["claude", "codex"]) }),
  output: z.object({ ok: z.boolean(), message: z.string() }),
});

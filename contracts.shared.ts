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

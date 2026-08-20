import type { PluginContext } from "@getpaseo/plugin";
import { AgentSyncSurface } from "./agents.client";
import { diagnoseProvider, mcpCopy, mcpList, mcpOverview, mcpRemove, mcpSync, scan, wireProvider } from "./contracts.shared";
import {
  handleDiagnoseProvider,
  handleMcpCopy,
  handleMcpList,
  handleMcpOverview,
  handleMcpRemove,
  handleMcpSync,
  handleScan,
  handleWireProvider,
} from "./handlers.server";
import { McpSurface } from "./mcp.client";

export default function contribute(plugin: PluginContext) {
  plugin.handle(scan, handleScan);
  plugin.handle(wireProvider, handleWireProvider);
  plugin.handle(diagnoseProvider, handleDiagnoseProvider);
  plugin.handle(mcpOverview, handleMcpOverview);
  plugin.handle(mcpList, handleMcpList);
  plugin.handle(mcpCopy, handleMcpCopy);
  plugin.handle(mcpRemove, handleMcpRemove);
  plugin.handle(mcpSync, handleMcpSync);

  plugin.addSurface("agent-sync", AgentSyncSurface);
  plugin.addSurface("mcp", McpSurface);
  plugin.addSidebarItem({
    id: "agent-sync",
    title: "Agent Sync",
    icon: "Users",
    surface: "agent-sync",
  });
  plugin.addSidebarItem({
    id: "mcp",
    title: "MCP",
    icon: "Plug",
    surface: "mcp",
  });
  plugin.addCommandCenterItem({
    id: "open-agent-sync",
    title: "Open Agent Sync (accounts)",
    icon: "Users",
    keywords: ["accounts", "providers", "auth", "agent-auth"],
    context: "global",
    onSelect({ openSurface }) {
      openSurface("agent-sync");
    },
  });
  plugin.addCommandCenterItem({
    id: "open-mcp",
    title: "Open MCP management",
    icon: "Plug",
    keywords: ["mcp", "servers", "sync"],
    context: "global",
    onSelect({ openSurface }) {
      openSurface("mcp");
    },
  });
  return () => {};
}

import type { PluginContext } from "@getpaseo/plugin";
import { diagnoseProvider, mcpOverview, mcpSync, scan, wireProvider } from "./contracts.shared";
import {
  handleDiagnoseProvider,
  handleMcpOverview,
  handleMcpSync,
  handleScan,
  handleWireProvider,
} from "./handlers.server";
import { MainSurface } from "./main.client";

export default function contribute(plugin: PluginContext) {
  plugin.handle(scan, handleScan);
  plugin.handle(wireProvider, handleWireProvider);
  plugin.handle(diagnoseProvider, handleDiagnoseProvider);
  plugin.handle(mcpOverview, handleMcpOverview);
  plugin.handle(mcpSync, handleMcpSync);

  plugin.addSurface("main", MainSurface);
  plugin.addSidebarItem({
    id: "main",
    title: "Agent Superpowers",
    icon: "Zap",
    surface: "main",
  });
  plugin.addCommandCenterItem({
    id: "open-superpowers",
    title: "Open Agent Superpowers (accounts & MCP)",
    icon: "Zap",
    keywords: ["accounts", "mcp", "providers", "auth"],
    context: "global",
    onSelect({ openSurface }) {
      openSurface("main");
    },
  });
  return () => {};
}

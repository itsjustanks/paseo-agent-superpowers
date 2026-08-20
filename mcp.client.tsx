import type { PluginSurfaceProps } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { mcpCopy, mcpList, mcpRemove, mcpSync, type McpServer } from "./contracts.shared";
import { Badge, Btn, Dot, makeStyles } from "./ui.client";

export function McpSurface({ theme, layout }: PluginSurfaceProps) {
  const queryClient = useQueryClient();
  const callList = useRpc(mcpList);
  const callCopy = useRpc(mcpCopy);
  const callRemove = useRpc(mcpRemove);
  const callSync = useRpc(mcpSync);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const styles = useMemo(() => makeStyles(theme, layout.compact), [theme, layout.compact]);

  const listQuery = useQuery({ queryKey: ["superpowers", "mcp-list"], queryFn: () => callList({}) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["superpowers"] });

  const copyMutation = useMutation({
    mutationFn: (server: McpServer) => callCopy({ name: server.name, from: "claude", to: "codex" }),
    onSuccess: (result) => {
      setMessage(result.message);
      refresh();
    },
  });
  const removeMutation = useMutation({
    mutationFn: (input: { name: string; from: "claude" | "codex" }) => callRemove(input),
    onSuccess: (result) => {
      setMessage(result.message);
      setConfirmRemove(null);
      refresh();
    },
  });
  const syncMutation = useMutation({
    mutationFn: () => callSync({}),
    onSuccess: (result) => {
      setMessage(result.log);
      refresh();
    },
  });

  const servers = listQuery.data?.servers ?? [];

  const coverageTone = (coverage: string) => {
    const [have, total] = coverage.split("/").map(Number);
    if (!total) return styles.muted;
    return have >= total ? styles.muted : styles.danger;
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>MCP</Text>
        <View style={styles.row}>
          <Btn
            label={syncMutation.isPending ? "Syncing…" : "Sync to all slots"}
            onPress={() => syncMutation.mutate()}
            theme={theme}
            disabled={syncMutation.isPending}
          />
          <Btn label="Refresh" onPress={refresh} theme={theme} kind="quiet" />
        </View>
      </View>
      <Text style={styles.subtitle}>
        Every MCP server across your Claude Code and Codex configs, with per-account coverage. Copy definitions across
        providers, remove them, and sync them into every account slot. Definitions only — tokens never move.
      </Text>

      {message ? <Text style={styles.monoText}>{message}</Text> : null}
      {listQuery.isLoading ? <Text style={styles.muted}>Reading MCP configs…</Text> : null}
      {listQuery.error ? <Text style={styles.danger}>{String(listQuery.error)}</Text> : null}
      {!listQuery.isLoading && servers.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.text}>No MCP servers found in ~/.claude.json or ~/.codex/config.toml.</Text>
        </View>
      ) : null}

      {servers.map((server) => (
        <View key={server.name} style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={styles.row}>
              <Dot color={server.definedIn.length === 2 ? theme.colors.accent : theme.colors.foregroundMuted} />
              <Text style={styles.strong}>{server.name}</Text>
              {server.definedIn.map((provider) => (
                <Badge key={provider} label={provider} theme={theme} tone="accent" />
              ))}
              <Badge label={server.transport} theme={theme} />
              <Badge
                label={server.authStyle === "inline-credentials" ? "creds in definition" : "OAuth / no auth"}
                theme={theme}
              />
            </View>
            <View style={styles.row}>
              {server.definedIn.includes("claude") && !server.definedIn.includes("codex") && server.transport === "stdio" ? (
                <Btn label="Copy to codex" kind="quiet" theme={theme} onPress={() => copyMutation.mutate(server)} />
              ) : null}
              {confirmRemove === server.name ? (
                <>
                  <Btn
                    label={`Really remove from ${server.definedIn[0]}?`}
                    kind="danger"
                    theme={theme}
                    onPress={() => removeMutation.mutate({ name: server.name, from: server.definedIn[0] as "claude" | "codex" })}
                  />
                  <Btn label="Cancel" kind="quiet" theme={theme} onPress={() => setConfirmRemove(null)} />
                </>
              ) : (
                <Btn label="Remove" kind="danger" theme={theme} onPress={() => setConfirmRemove(server.name)} />
              )}
            </View>
          </View>
          <Text style={styles.monoText}>{server.detail}</Text>
          <View style={styles.row}>
            <Text style={coverageTone(server.claudeSlotCoverage)}>claude slots {server.claudeSlotCoverage}</Text>
            <Text style={coverageTone(server.codexSlotCoverage)}>codex slots {server.codexSlotCoverage}</Text>
          </View>
        </View>
      ))}

      <Text style={styles.muted}>
        OAuth-based servers authorize once per account slot, in that slot's own store — sharing those tokens across
        accounts is the credential-copying this tool exists to avoid. Removals and copies back up the config file first.
      </Text>
    </ScrollView>
  );
}

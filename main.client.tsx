import type { PluginSurfaceProps } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { diagnoseProvider, mcpOverview, mcpSync, scan, wireProvider, type Slot } from "./contracts.shared";

export function MainSurface({ theme, layout }: PluginSurfaceProps) {
  const queryClient = useQueryClient();
  const callScan = useRpc(scan);
  const callWire = useRpc(wireProvider);
  const callDiagnose = useRpc(diagnoseProvider);
  const callMcpOverview = useRpc(mcpOverview);
  const callMcpSync = useRpc(mcpSync);
  const [diagnosis, setDiagnosis] = useState<string | null>(null);
  const [syncLog, setSyncLog] = useState<string | null>(null);

  const styles = useMemo(() => {
    const pad = layout.compact ? 12 : 20;
    return {
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: { padding: pad, gap: pad },
      title: { color: theme.colors.foreground, fontSize: layout.compact ? 18 : 22, fontWeight: "600" as const },
      section: { color: theme.colors.foreground, fontSize: layout.compact ? 15 : 17, fontWeight: "600" as const, marginTop: 8 },
      row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, flexWrap: "wrap" as const },
      text: { color: theme.colors.foreground, fontSize: 13 },
      muted: { color: theme.colors.foregroundMuted, fontSize: 12 },
      danger: { color: theme.colors.statusDanger, fontSize: 12 },
      mono: { color: theme.colors.foregroundMuted, fontSize: 11, fontFamily: "Menlo" },
      button: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: theme.colors.accent },
      buttonText: { color: theme.colors.accentForeground, fontSize: 12, fontWeight: "600" as const },
      banner: { padding: 10, borderRadius: 8, backgroundColor: theme.colors.accent },
      bannerText: { color: theme.colors.accentForeground, fontSize: 12 },
      card: { gap: 6, paddingVertical: 8 },
    };
  }, [theme, layout.compact]);

  const scanQuery = useQuery({ queryKey: ["superpowers", "scan"], queryFn: () => callScan({}) });
  const mcpQuery = useQuery({ queryKey: ["superpowers", "mcp"], queryFn: () => callMcpOverview({}) });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["superpowers"] });
  };

  const wireMutation = useMutation({
    mutationFn: (slot: Slot) => callWire({ provider: slot.provider, email: slot.email, dir: slot.dir }),
    onSuccess: refresh,
  });
  const syncMutation = useMutation({
    mutationFn: () => callMcpSync({}),
    onSuccess: (result) => {
      setSyncLog(result.log);
      refresh();
    },
  });

  const statusMark = (slot: Slot) => (slot.wrongAccount ? "[!]" : slot.loggedIn ? "[x]" : "[ ]");

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.row}>
        <Text style={styles.title}>Agent Superpowers</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh" onPress={refresh} style={styles.button}>
          <Text style={styles.buttonText}>Refresh</Text>
        </Pressable>
      </View>
      <Text style={styles.muted}>
        Multi-account slots for Claude Code and Codex, wired into Paseo as parallel providers. Powered by agent-auth.
      </Text>

      {scanQuery.data?.needsRestart ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            Provider wiring changed — restart the Paseo daemon to load new providers (do it when no agents are mid-task).
          </Text>
        </View>
      ) : null}

      <Text style={styles.section}>Accounts</Text>
      {scanQuery.isLoading ? <Text style={styles.muted}>Scanning slots…</Text> : null}
      {scanQuery.error ? <Text style={styles.danger}>{String(scanQuery.error)}</Text> : null}
      {scanQuery.data?.slots.length === 0 ? (
        <Text style={styles.muted}>
          No account slots found. In a terminal: agent-auth add claude you@example.com
        </Text>
      ) : null}
      {scanQuery.data?.slots.map((slot) => (
        <View key={slot.dir} style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.text}>
              {statusMark(slot)} {slot.provider} · {slot.email}
            </Text>
            <Text style={styles.muted}>({slot.source})</Text>
          </View>
          {slot.wrongAccount ? (
            <Text style={styles.danger}>
              Logged in as {slot.actualEmail} — wrong account. Rerun: agent-auth login {slot.provider} {slot.email}
            </Text>
          ) : null}
          {!slot.loggedIn ? (
            <Text style={styles.mono}>terminal: agent-auth login {slot.provider} {slot.email}</Text>
          ) : null}
          <View style={styles.row}>
            {slot.wiredProviderId ? (
              <>
                <Text style={styles.muted}>Paseo provider: {slot.wiredProviderId}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Diagnose provider ${slot.wiredProviderId}`}
                  onPress={() => {
                    void callDiagnose({ providerId: slot.wiredProviderId as string }).then((result) =>
                      setDiagnosis(result.summary),
                    );
                  }}
                  style={styles.button}
                >
                  <Text style={styles.buttonText}>Diagnose</Text>
                </Pressable>
              </>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Wire ${slot.email} into Paseo`}
                onPress={() => wireMutation.mutate(slot)}
                style={styles.button}
              >
                <Text style={styles.buttonText}>Wire into Paseo</Text>
              </Pressable>
            )}
          </View>
        </View>
      ))}
      {wireMutation.error ? <Text style={styles.danger}>{String(wireMutation.error)}</Text> : null}
      {diagnosis ? <Text style={styles.mono}>{diagnosis}</Text> : null}

      <Text style={styles.section}>MCP servers</Text>
      {mcpQuery.data ? (
        <Text style={styles.muted}>
          Primary: {mcpQuery.data.primaryClaudeServers} Claude MCP servers · {mcpQuery.data.primaryCodexServers} Codex MCP
          servers
        </Text>
      ) : null}
      {mcpQuery.data?.slots.map((slot) => (
        <View key={`${slot.provider}-${slot.email}`} style={styles.row}>
          <Text style={styles.text}>
            {slot.provider} · {slot.email}
          </Text>
          <Text style={slot.definedServers >= slot.primaryServers ? styles.muted : styles.danger}>
            {slot.definedServers}/{slot.primaryServers} definitions synced
          </Text>
          {slot.provider === "claude" ? <Text style={styles.muted}>{slot.oauthGrants} OAuth grants in slot</Text> : null}
        </View>
      ))}
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sync MCP definitions into all slots"
          onPress={() => syncMutation.mutate()}
          style={styles.button}
        >
          <Text style={styles.buttonText}>{syncMutation.isPending ? "Syncing…" : "Sync definitions to all slots"}</Text>
        </Pressable>
      </View>
      {syncLog ? <Text style={styles.mono}>{syncLog}</Text> : null}
      <Text style={styles.muted}>
        Definition sync copies MCP server configs and project trust — never tokens. OAuth-based MCP servers authorize once
        per slot (in that slot's own store) and refresh in place, same as the account login.
      </Text>
      {scanQuery.data && !scanQuery.data.agentAuthInstalled ? (
        <Text style={styles.danger}>
          agent-auth CLI not found — install it for logins and MCP sync: github.com/itsjustanks/agent-auth
        </Text>
      ) : null}
    </ScrollView>
  );
}

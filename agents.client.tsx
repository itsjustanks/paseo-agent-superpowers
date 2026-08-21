import type { PluginSurfaceProps } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { diagnoseProvider, providerHealth, scan, wireProvider, type Slot } from "./contracts.shared";
import { Badge, Btn, Dot, makeStyles } from "./ui.client";

export function AgentSyncSurface({ theme, layout }: PluginSurfaceProps) {
  const queryClient = useQueryClient();
  const callScan = useRpc(scan);
  const callWire = useRpc(wireProvider);
  const callDiagnose = useRpc(diagnoseProvider);
  const callHealth = useRpc(providerHealth);
  const [diagnosis, setDiagnosis] = useState<Record<string, string>>({});
  const styles = useMemo(() => makeStyles(theme, layout.compact), [theme, layout.compact]);

  const scanQuery = useQuery({ queryKey: ["superpowers", "scan"], queryFn: () => callScan({}) });
  const healthQuery = useQuery({ queryKey: ["superpowers", "provider-health"], queryFn: () => callHealth({}) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["superpowers"] });

  const wireMutation = useMutation({
    mutationFn: (slot: Slot) => callWire({ provider: slot.provider, email: slot.email, dir: slot.dir }),
    onSuccess: refresh,
  });

  const slots = scanQuery.data?.slots ?? [];
  const primaries = scanQuery.data?.primaryAccounts;
  const healthById = new Map((healthQuery.data?.providers ?? []).map((provider) => [provider.id, provider]));

  const tableRow = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: theme.colors.foregroundMuted + "1a",
  };

  const slotDot = (slot: Slot) =>
    slot.wrongAccount ? theme.colors.statusDanger : slot.loggedIn ? theme.colors.accent : theme.colors.foregroundMuted;

  const diagnoseBtn = (providerId: string, key: string) => (
    <Btn
      label="Diagnose"
      kind="quiet"
      theme={theme}
      onPress={() => {
        void callDiagnose({ providerId }).then((result) =>
          setDiagnosis((previous) => ({ ...previous, [key]: previous[key] ? "" : result.summary })),
        );
      }}
    />
  );

  const providerCard = (
    provider: "claude" | "codex" | "kimi" | "grok",
    title: string,
    rows: React.ReactNode,
  ) => {
    const health = healthById.get(provider);
    return (
      <View key={provider} style={styles.card}>
        <View style={styles.rowBetween}>
          <View style={styles.row}>
            <Dot color={health ? (health.ok ? theme.colors.accent : theme.colors.statusDanger) : theme.colors.foregroundMuted} />
            <Text style={styles.strong}>{title}</Text>
            {health ? <Text style={health.ok ? styles.muted : styles.danger}>{health.summary}</Text> : <Text style={styles.muted}>checking…</Text>}
          </View>
          {diagnoseBtn(provider, provider)}
        </View>
        {diagnosis[provider] ? <Text style={styles.monoText}>{diagnosis[provider]}</Text> : null}
        {rows}
      </View>
    );
  };

  const slotRow = (slot: Slot) => (
    <View key={slot.dir} style={tableRow}>
      <Dot color={slotDot(slot)} />
      <Text style={[styles.text, { flex: 1 }]} numberOfLines={1}>
        {slot.email}
      </Text>
      {slot.source === "external" ? <Badge label="external" theme={theme} /> : null}
      {slot.wrongAccount ? <Badge label={`wrong: ${slot.actualEmail}`} theme={theme} tone="danger" /> : null}
      {!slot.loggedIn ? <Badge label="login needed" theme={theme} tone="danger" /> : null}
      {slot.wiredProviderId ? (
        <>
          <Badge label={slot.wiredProviderId} theme={theme} tone="accent" />
          {diagnoseBtn(slot.wiredProviderId, slot.dir)}
        </>
      ) : (
        <Btn label="Wire into Paseo" theme={theme} onPress={() => wireMutation.mutate(slot)} />
      )}
    </View>
  );

  const primaryRow = (provider: "claude" | "codex") => {
    const account = provider === "claude" ? primaries?.claude : primaries?.codex;
    return (
      <View style={tableRow}>
        <Dot color={account ? theme.colors.accent : theme.colors.foregroundMuted} />
        <Text style={[styles.text, { flex: 1 }]} numberOfLines={1}>
          {account || "not logged in"}
        </Text>
        <Badge label="primary" theme={theme} tone="accent" />
        <Text style={styles.muted}>builtin `{provider}`</Text>
      </View>
    );
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Agent Sync</Text>
        <Btn label="Refresh" onPress={refresh} theme={theme} kind="quiet" />
      </View>
      <Text style={styles.subtitle}>
        Every provider connector with its health, and every account under it. Wire an account into Paseo and it becomes a
        parallel provider on its own rate limit.
      </Text>

      {scanQuery.data?.needsRestart ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            Provider wiring changed — restart the Paseo daemon (when no agents are mid-task) to load new providers.
          </Text>
        </View>
      ) : null}
      {scanQuery.error ? <Text style={styles.danger}>{String(scanQuery.error)}</Text> : null}
      {wireMutation.error ? <Text style={styles.danger}>{String(wireMutation.error)}</Text> : null}

      {providerCard(
        "claude",
        "Claude Code",
        <>
          {primaryRow("claude")}
          {slots.filter((slot) => slot.provider === "claude").map(slotRow)}
        </>,
      )}
      {providerCard(
        "codex",
        "Codex",
        <>
          {primaryRow("codex")}
          {slots.filter((slot) => slot.provider === "codex").map(slotRow)}
        </>,
      )}
      {providerCard("kimi", "Kimi Code", null)}
      {providerCard("grok", "Grok", null)}

      {slots.some((slot) => !slot.loggedIn || slot.wrongAccount) ? (
        <Text style={styles.monoText}>
          fix logins in a terminal: agent-auth login &lt;provider&gt; &lt;email&gt; — or `claude-auth all` / `codex-auth all`
        </Text>
      ) : null}
      {scanQuery.data && !scanQuery.data.agentAuthInstalled ? (
        <Text style={styles.danger}>agent-auth CLI not found — install it for logins: github.com/itsjustanks/agent-auth</Text>
      ) : null}
    </ScrollView>
  );
}

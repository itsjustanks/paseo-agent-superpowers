import type { PluginSurfaceProps } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { diagnoseProvider, scan, wireProvider, type Slot } from "./contracts.shared";
import { Badge, Btn, Dot, makeStyles } from "./ui.client";

export function AgentSyncSurface({ theme, layout }: PluginSurfaceProps) {
  const queryClient = useQueryClient();
  const callScan = useRpc(scan);
  const callWire = useRpc(wireProvider);
  const callDiagnose = useRpc(diagnoseProvider);
  const [diagnosis, setDiagnosis] = useState<Record<string, string>>({});
  const styles = useMemo(() => makeStyles(theme, layout.compact), [theme, layout.compact]);

  const scanQuery = useQuery({ queryKey: ["superpowers", "scan"], queryFn: () => callScan({}) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["superpowers"] });

  const wireMutation = useMutation({
    mutationFn: (slot: Slot) => callWire({ provider: slot.provider, email: slot.email, dir: slot.dir }),
    onSuccess: refresh,
  });

  const dotColor = (slot: Slot) =>
    slot.wrongAccount ? theme.colors.statusDanger : slot.loggedIn ? theme.colors.accent : theme.colors.foregroundMuted;

  const slots = scanQuery.data?.slots ?? [];
  const grouped: Array<{ provider: "claude" | "codex"; items: Slot[] }> = (["claude", "codex"] as const)
    .map((provider) => ({ provider, items: slots.filter((slot) => slot.provider === provider) }))
    .filter((group) => group.items.length > 0);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Agent Sync</Text>
        <Btn label="Refresh" onPress={refresh} theme={theme} kind="quiet" />
      </View>
      <Text style={styles.subtitle}>
        One account per folder, each with its own live login. Wire a slot into Paseo and it becomes a parallel provider on
        its own rate limit.
      </Text>

      {scanQuery.data?.needsRestart ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            Provider wiring changed — restart the Paseo daemon (when no agents are mid-task) to load new providers.
          </Text>
        </View>
      ) : null}

      {scanQuery.isLoading ? <Text style={styles.muted}>Scanning account slots…</Text> : null}
      {scanQuery.error ? <Text style={styles.danger}>{String(scanQuery.error)}</Text> : null}
      {!scanQuery.isLoading && slots.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.text}>No account slots yet.</Text>
          <Text style={styles.monoText}>terminal: agent-auth add claude you@example.com</Text>
        </View>
      ) : null}

      {grouped.map((group) => (
        <View key={group.provider} style={{ gap: 8 }}>
          <Text style={styles.strong}>
            {group.provider === "claude" ? "Claude Code" : "Codex"} · {group.items.length}{" "}
            {group.items.length === 1 ? "account" : "accounts"}
          </Text>
          {group.items.map((slot) => (
            <View key={slot.dir} style={styles.card}>
              <View style={styles.rowBetween}>
                <View style={styles.row}>
                  <Dot color={dotColor(slot)} />
                  <Text style={styles.strong}>{slot.email}</Text>
                  {slot.source === "external" ? <Badge label="external" theme={theme} /> : null}
                  {slot.wiredProviderId ? <Badge label={`provider: ${slot.wiredProviderId}`} theme={theme} tone="accent" /> : null}
                </View>
                {slot.wiredProviderId ? (
                  <Btn
                    label="Diagnose"
                    kind="quiet"
                    theme={theme}
                    onPress={() => {
                      void callDiagnose({ providerId: slot.wiredProviderId as string }).then((result) =>
                        setDiagnosis((previous) => ({ ...previous, [slot.dir]: result.summary })),
                      );
                    }}
                  />
                ) : (
                  <Btn label="Wire into Paseo" theme={theme} onPress={() => wireMutation.mutate(slot)} />
                )}
              </View>
              {slot.wrongAccount ? (
                <Text style={styles.danger}>
                  Logged in as {slot.actualEmail} — wrong account. Rerun: agent-auth login {slot.provider} {slot.email}
                </Text>
              ) : null}
              {!slot.loggedIn ? (
                <Text style={styles.monoText}>not logged in — terminal: agent-auth login {slot.provider} {slot.email}</Text>
              ) : null}
              {diagnosis[slot.dir] ? <Text style={styles.monoText}>{diagnosis[slot.dir]}</Text> : null}
            </View>
          ))}
        </View>
      ))}

      {wireMutation.error ? <Text style={styles.danger}>{String(wireMutation.error)}</Text> : null}
      {scanQuery.data && !scanQuery.data.agentAuthInstalled ? (
        <Text style={styles.danger}>
          agent-auth CLI not found — install it for logins: github.com/itsjustanks/agent-auth
        </Text>
      ) : null}
    </ScrollView>
  );
}

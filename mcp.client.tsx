import type { PluginSurfaceProps, PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { mcpAdd, mcpApply, mcpMatrix, mcpRemove, mcpSync, type Destination, type McpServerRow } from "./contracts.shared";
import { Badge, Btn, Dot, makeStyles } from "./ui.client";

function shortLabel(dest: Destination): string {
  const who = dest.account || dest.provider;
  const suffix = dest.label.includes("(primary)") ? " ·1°" : "";
  return `${dest.provider}:${who.split("@")[0]}${suffix}`;
}

function DestChip({
  dest,
  present,
  theme,
  onPress,
}: {
  dest: Destination;
  present: boolean;
  theme: PluginTheme;
  onPress: () => void;
}) {
  const color = present ? theme.colors.accent : theme.colors.foregroundMuted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${dest.label}: ${present ? "present — tap to remove" : "missing — tap to add"}`}
      onPress={onPress}
      style={{
        borderWidth: 1,
        borderColor: color + (present ? "" : "55"),
        backgroundColor: present ? color + "22" : "transparent",
        borderRadius: 999,
        paddingVertical: 3,
        paddingHorizontal: 9,
      }}
    >
      <Text style={{ color: present ? color : theme.colors.foregroundMuted, fontSize: 10, fontWeight: "600" }}>
        {present ? "✓ " : "+ "}
        {shortLabel(dest)}
      </Text>
    </Pressable>
  );
}

export function McpSurface({ theme, layout }: PluginSurfaceProps) {
  const queryClient = useQueryClient();
  const callMatrix = useRpc(mcpMatrix);
  const callAdd = useRpc(mcpAdd);
  const callApply = useRpc(mcpApply);
  const callRemove = useRpc(mcpRemove);
  const callSync = useRpc(mcpSync);
  const styles = useMemo(() => makeStyles(theme, layout.compact), [theme, layout.compact]);

  const [message, setMessage] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<{ name: string; destId: string } | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [formName, setFormName] = useState("");
  const [formKind, setFormKind] = useState<"stdio" | "http">("http");
  const [formTarget, setFormTarget] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formCommand, setFormCommand] = useState("");
  const [formKv, setFormKv] = useState("");
  const [formTargets, setFormTargets] = useState<Set<string>>(new Set());

  const matrixQuery = useQuery({ queryKey: ["superpowers", "mcp-matrix"], queryFn: () => callMatrix({}) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["superpowers"] });
  const onResult = (result: { message?: string; log?: string }) => {
    setMessage(result.message ?? result.log ?? null);
    setPendingRemove(null);
    refresh();
  };

  const addMutation = useMutation({ mutationFn: () => {
    const targets = formTargets.size > 0 ? [...formTargets] : (matrixQuery.data?.destinations ?? []).map((d) => d.id);
    return callAdd({
      name: formName.trim(),
      kind: formKind,
      command: formCommand,
      url: formUrl,
      kvLines: formKv,
      targets,
    });
  }, onSuccess: (result) => { onResult(result); if (result.ok) { setShowAdd(false); setFormName(""); setFormUrl(""); setFormCommand(""); setFormKv(""); setFormTargets(new Set()); } } });
  const applyMutation = useMutation({
    mutationFn: (input: { name: string; targets: string[] }) => callApply(input),
    onSuccess: onResult,
  });
  const removeMutation = useMutation({
    mutationFn: (input: { name: string; targets: string[] }) => callRemove(input),
    onSuccess: onResult,
  });
  const syncMutation = useMutation({ mutationFn: () => callSync({}), onSuccess: onResult });

  const destinations = matrixQuery.data?.destinations ?? [];
  const servers = matrixQuery.data?.servers ?? [];
  const inputStyle = {
    borderWidth: 1,
    borderColor: theme.colors.foregroundMuted + "44",
    borderRadius: 7,
    paddingVertical: 6,
    paddingHorizontal: 9,
    color: theme.colors.foreground,
    fontSize: 12,
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>MCP</Text>
        <View style={styles.row}>
          <Btn label={showAdd ? "Close" : "Add server"} onPress={() => setShowAdd((v) => !v)} theme={theme} />
          <Btn
            label={syncMutation.isPending ? "Syncing…" : "Sync slots"}
            onPress={() => syncMutation.mutate()}
            theme={theme}
            kind="quiet"
            disabled={syncMutation.isPending}
          />
          <Btn label="Refresh" onPress={refresh} theme={theme} kind="quiet" />
        </View>
      </View>
      <Text style={styles.subtitle}>
        One matrix for every MCP-capable provider Paseo knows — Claude Code, Codex, Kimi, Grok, and every account slot,
        each labeled with its account. Tap a greyed chip to add a server there; tap a lit chip to remove it there.
        Definitions only — OAuth tokens never move.
      </Text>

      {destinations.length > 0 ? (
        <View style={styles.row}>
          {destinations.map((dest) => (
            <Badge key={dest.id} label={dest.label} theme={theme} />
          ))}
        </View>
      ) : null}

      {showAdd ? (
        <View style={styles.card}>
          <Text style={styles.strong}>Add MCP server</Text>
          <TextInput
            placeholder="name (e.g. my-server)"
            placeholderTextColor={theme.colors.foregroundMuted}
            value={formName}
            onChangeText={setFormName}
            autoCapitalize="none"
            style={inputStyle}
          />
          <View style={styles.row}>
            <Btn label={`type: ${formKind}`} kind="quiet" theme={theme} onPress={() => setFormKind((k) => (k === "http" ? "stdio" : "http"))} />
          </View>
          {formKind === "http" ? (
            <TextInput
              placeholder="https://example.com/mcp"
              placeholderTextColor={theme.colors.foregroundMuted}
              value={formUrl}
              onChangeText={setFormUrl}
              autoCapitalize="none"
              style={inputStyle}
            />
          ) : (
            <TextInput
              placeholder="command with args, e.g. npx -y some-mcp-server"
              placeholderTextColor={theme.colors.foregroundMuted}
              value={formCommand}
              onChangeText={setFormCommand}
              autoCapitalize="none"
              style={inputStyle}
            />
          )}
          <TextInput
            placeholder={formKind === "http" ? "headers, one per line: Authorization=Bearer …" : "env, one per line: API_KEY=…"}
            placeholderTextColor={theme.colors.foregroundMuted}
            value={formKv}
            onChangeText={setFormKv}
            autoCapitalize="none"
            multiline
            numberOfLines={2}
            style={[inputStyle, { minHeight: 48 }]}
          />
          <Text style={styles.muted}>Targets — none selected = all:</Text>
          <View style={styles.row}>
            {destinations.map((dest) => (
              <DestChip
                key={dest.id}
                dest={dest}
                present={formTargets.has(dest.id)}
                theme={theme}
                onPress={() =>
                  setFormTargets((previous) => {
                    const next = new Set(previous);
                    if (next.has(dest.id)) next.delete(dest.id);
                    else next.add(dest.id);
                    return next;
                  })
                }
              />
            ))}
          </View>
          <View style={styles.row}>
            <Btn
              label={addMutation.isPending ? "Adding…" : formTargets.size > 0 ? `Add to ${formTargets.size} selected` : "Add to ALL"}
              theme={theme}
              onPress={() => addMutation.mutate()}
              disabled={addMutation.isPending || !formName.trim()}
            />
          </View>
        </View>
      ) : null}

      {message ? <Text style={styles.monoText}>{message}</Text> : null}
      {matrixQuery.isLoading ? <Text style={styles.muted}>Reading configs…</Text> : null}
      {matrixQuery.error ? <Text style={styles.danger}>{String(matrixQuery.error)}</Text> : null}

      {servers.map((server: McpServerRow) => (
        <View key={server.name} style={styles.card}>
          <View style={styles.rowBetween}>
            <View style={styles.row}>
              <Dot color={server.presentIn.length === destinations.length ? theme.colors.accent : theme.colors.foregroundMuted} />
              <Text style={styles.strong}>{server.name}</Text>
              <Badge label={server.transport} theme={theme} />
              <Badge label={server.authStyle === "inline-credentials" ? "creds in definition" : "OAuth / none"} theme={theme} />
              <Text style={styles.muted}>
                {server.presentIn.length}/{destinations.length}
              </Text>
            </View>
            {server.presentIn.length < destinations.length ? (
              <Btn
                label="Add to all"
                kind="quiet"
                theme={theme}
                onPress={() =>
                  applyMutation.mutate({
                    name: server.name,
                    targets: destinations.filter((dest) => !server.presentIn.includes(dest.id)).map((dest) => dest.id),
                  })
                }
              />
            ) : null}
          </View>
          {server.detail ? <Text style={styles.monoText}>{server.detail}</Text> : null}
          <View style={styles.row}>
            {destinations.map((dest) => {
              const present = server.presentIn.includes(dest.id);
              return (
                <DestChip
                  key={dest.id}
                  dest={dest}
                  present={present}
                  theme={theme}
                  onPress={() => {
                    if (present) setPendingRemove({ name: server.name, destId: dest.id });
                    else applyMutation.mutate({ name: server.name, targets: [dest.id] });
                  }}
                />
              );
            })}
          </View>
          {pendingRemove?.name === server.name ? (
            <View style={styles.row}>
              <Btn
                label={`Remove '${server.name}' from ${shortLabel(destinations.find((d) => d.id === pendingRemove.destId) ?? destinations[0])}?`}
                kind="danger"
                theme={theme}
                onPress={() => removeMutation.mutate({ name: server.name, targets: [pendingRemove.destId] })}
              />
              <Btn label="Cancel" kind="quiet" theme={theme} onPress={() => setPendingRemove(null)} />
            </View>
          ) : null}
        </View>
      ))}

      <Text style={styles.muted}>
        Every write backs up the target config first. OAuth-based servers still authorize once per account — tokens live in
        each account's own store and never move.
      </Text>
    </ScrollView>
  );
}

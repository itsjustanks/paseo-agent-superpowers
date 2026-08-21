import type { PluginSurfaceProps, PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import {
  mcpAdd,
  mcpApply,
  mcpDef,
  mcpEdit,
  mcpHealth,
  mcpMatrix,
  mcpRemove,
  mcpSync,
  type Destination,
  type McpHealth,
  type McpServerRow,
} from "./contracts.shared";
import { Badge, Btn, Dot, makeStyles } from "./ui.client";

function shortLabel(dest: Destination): string {
  const who = dest.account ? dest.account.split("@")[0] : dest.provider;
  const primary = dest.label.includes("(primary)") ? " ·1°" : "";
  return `${dest.provider}:${who}${primary}`;
}

function healthTone(theme: PluginTheme, status: McpHealth["status"]) {
  if (status === "ok") return theme.colors.accent;
  if (status === "unknown") return theme.colors.foregroundMuted;
  return theme.colors.statusDanger;
}

function healthLabel(status: McpHealth["status"]) {
  switch (status) {
    case "ok":
      return "healthy";
    case "auth-required":
      return "auth needed";
    case "binary-missing":
      return "binary missing";
    case "down":
      return "down";
    case "warn":
      return "warning";
    default:
      return "unknown";
  }
}

export function McpSurface({ theme, layout }: PluginSurfaceProps) {
  const queryClient = useQueryClient();
  const callMatrix = useRpc(mcpMatrix);
  const callAdd = useRpc(mcpAdd);
  const callApply = useRpc(mcpApply);
  const callRemove = useRpc(mcpRemove);
  const callSync = useRpc(mcpSync);
  const callDef = useRpc(mcpDef);
  const callEdit = useRpc(mcpEdit);
  const callHealth = useRpc(mcpHealth);
  const styles = useMemo(() => makeStyles(theme, layout.compact), [theme, layout.compact]);

  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [gapsOnly, setGapsOnly] = useState(false);
  const [health, setHealth] = useState<Map<string, McpHealth> | null>(null);
  const [healthRunning, setHealthRunning] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<{ name: string; destId: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // add/edit form state — mode 'add' or the server name being edited
  const [formMode, setFormMode] = useState<null | "add" | string>(null);
  const [formName, setFormName] = useState("");
  const [formKind, setFormKind] = useState<"stdio" | "http">("http");
  const [formUrl, setFormUrl] = useState("");
  const [formCommand, setFormCommand] = useState("");
  const [formKv, setFormKv] = useState("");
  const [formTargets, setFormTargets] = useState<Set<string>>(new Set());

  const matrixQuery = useQuery({ queryKey: ["superpowers", "mcp-matrix"], queryFn: () => callMatrix({}) });
  const destinations = matrixQuery.data?.destinations ?? [];
  const servers = matrixQuery.data?.servers ?? [];

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["superpowers"] });
  const onResult = (result: { message?: string; log?: string }) => {
    setMessage(result.message ?? result.log ?? null);
    setPendingRemove(null);
    refresh();
  };
  const closeForm = () => {
    setFormMode(null);
    setFormName("");
    setFormUrl("");
    setFormCommand("");
    setFormKv("");
    setFormTargets(new Set());
  };

  const addMutation = useMutation({
    mutationFn: () => {
      const targets = formTargets.size > 0 ? [...formTargets] : destinations.map((dest) => dest.id);
      return callAdd({ name: formName.trim(), kind: formKind, command: formCommand, url: formUrl, kvLines: formKv, targets });
    },
    onSuccess: (result) => {
      onResult(result);
      if (result.ok) closeForm();
    },
  });
  const editMutation = useMutation({
    mutationFn: (serverName: string) => {
      const row = servers.find((server) => server.name === serverName);
      const targets = formTargets.size > 0 ? [...formTargets] : (row?.presentIn ?? []);
      return callEdit({ name: serverName, kind: formKind, command: formCommand, url: formUrl, kvLines: formKv, targets });
    },
    onSuccess: (result) => {
      onResult(result);
      if (result.ok) closeForm();
    },
  });
  const applyMutation = useMutation({
    mutationFn: (input: { name: string; targets: string[] }) => callApply(input),
    onSuccess: onResult,
  });
  const removeMutation = useMutation({
    mutationFn: (input: { name: string; targets: string[] }) => callRemove(input),
    onSuccess: onResult,
  });
  const syncMutation = useMutation({ mutationFn: () => callSync({}), onSuccess: onResult });

  const startEdit = (server: McpServerRow) => {
    void callDef({ name: server.name }).then((def) => {
      if (!def.found) {
        setMessage(`could not read a definition for ${server.name}`);
        return;
      }
      setFormMode(server.name);
      setFormName(server.name);
      setFormKind(def.kind);
      setFormUrl(def.url);
      setFormCommand(def.command);
      setFormKv(def.kvMasked);
      setFormTargets(new Set(server.presentIn)); // default: apply edit everywhere it exists
      setExpanded(server.name);
    });
  };

  const runHealth = () => {
    setHealthRunning(true);
    void callHealth({})
      .then((result) => setHealth(new Map(result.results.map((entry) => [entry.name, entry]))))
      .finally(() => setHealthRunning(false));
  };

  const filtered = servers.filter((server) => {
    if (search && !server.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (gapsOnly && server.presentIn.length >= destinations.length) return false;
    return true;
  });

  const inputStyle = {
    borderWidth: 1,
    borderColor: theme.colors.foregroundMuted + "44",
    borderRadius: 7,
    paddingVertical: 6,
    paddingHorizontal: 9,
    color: theme.colors.foreground,
    fontSize: 12,
  };
  const tableRow = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingVertical: 3,
    borderTopWidth: 1,
    borderTopColor: theme.colors.foregroundMuted + "1a",
  };

  const renderForm = (mode: "add" | string) => (
    <View style={{ gap: 8 }}>
      {mode === "add" ? (
        <TextInput
          placeholder="name (e.g. my-server)"
          placeholderTextColor={theme.colors.foregroundMuted}
          value={formName}
          onChangeText={setFormName}
          autoCapitalize="none"
          style={inputStyle}
        />
      ) : null}
      {mode === "add" ? (
        <View style={styles.row}>
          <Btn label={`type: ${formKind}`} kind="quiet" theme={theme} onPress={() => setFormKind((k) => (k === "http" ? "stdio" : "http"))} />
        </View>
      ) : null}
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
        placeholder={formKind === "http" ? "headers: Authorization=Bearer …" : "env: API_KEY=…"}
        placeholderTextColor={theme.colors.foregroundMuted}
        value={formKv}
        onChangeText={setFormKv}
        autoCapitalize="none"
        multiline
        numberOfLines={3}
        style={[inputStyle, { minHeight: 56 }]}
      />
      {mode !== "add" ? (
        <Text style={styles.muted}>Masked values (•••) keep the stored secret — replace one to change it.</Text>
      ) : null}
      <Text style={styles.muted}>
        Targets — {mode === "add" ? "none selected = all destinations" : "defaults to everywhere it exists"}:
      </Text>
      <View style={styles.row}>
        {destinations.map((dest) => {
          const selected = formTargets.has(dest.id);
          return (
            <Pressable
              key={dest.id}
              accessibilityRole="button"
              accessibilityLabel={`${dest.label}: ${selected ? "selected" : "not selected"}`}
              onPress={() =>
                setFormTargets((previous) => {
                  const next = new Set(previous);
                  if (next.has(dest.id)) next.delete(dest.id);
                  else next.add(dest.id);
                  return next;
                })
              }
              style={{
                borderWidth: 1,
                borderColor: selected ? theme.colors.accent : theme.colors.foregroundMuted + "55",
                backgroundColor: selected ? theme.colors.accent + "22" : "transparent",
                borderRadius: 999,
                paddingVertical: 3,
                paddingHorizontal: 9,
              }}
            >
              <Text style={{ color: selected ? theme.colors.accent : theme.colors.foregroundMuted, fontSize: 10, fontWeight: "600" }}>
                {shortLabel(dest)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.row}>
        <Btn
          label={
            mode === "add"
              ? addMutation.isPending
                ? "Adding…"
                : formTargets.size > 0
                  ? `Add to ${formTargets.size} selected`
                  : "Add to ALL"
              : editMutation.isPending
                ? "Saving…"
                : `Save to ${formTargets.size || "all existing"} destinations`
          }
          theme={theme}
          onPress={() => (mode === "add" ? addMutation.mutate() : editMutation.mutate(mode))}
          disabled={addMutation.isPending || editMutation.isPending || (mode === "add" && !formName.trim())}
        />
        <Btn label="Cancel" kind="quiet" theme={theme} onPress={closeForm} />
      </View>
    </View>
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>MCP</Text>
        <View style={styles.row}>
          <Btn label={healthRunning ? "Checking…" : "Health check"} onPress={runHealth} theme={theme} kind="quiet" disabled={healthRunning} />
          <Btn label="Add server" onPress={() => (formMode === "add" ? closeForm() : (closeForm(), setFormMode("add")))} theme={theme} />
          <Btn label={syncMutation.isPending ? "Syncing…" : "Sync slots"} onPress={() => syncMutation.mutate()} theme={theme} kind="quiet" disabled={syncMutation.isPending} />
          <Btn label="Refresh" onPress={refresh} theme={theme} kind="quiet" />
        </View>
      </View>

      <View style={styles.row}>
        <TextInput
          placeholder="Search servers…"
          placeholderTextColor={theme.colors.foregroundMuted}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          style={[inputStyle, { flex: 1, minWidth: 140 }]}
        />
        <Btn label={gapsOnly ? "Showing gaps" : "All servers"} kind="quiet" theme={theme} onPress={() => setGapsOnly((v) => !v)} />
        <Text style={styles.muted}>
          {filtered.length}/{servers.length} servers · {destinations.length} destinations
        </Text>
      </View>

      {formMode === "add" ? <View style={styles.card}>{renderForm("add")}</View> : null}
      {message ? <Text style={styles.monoText}>{message}</Text> : null}
      {matrixQuery.isLoading ? <Text style={styles.muted}>Reading configs…</Text> : null}
      {matrixQuery.error ? <Text style={styles.danger}>{String(matrixQuery.error)}</Text> : null}

      {filtered.map((server) => {
        const serverHealth = health?.get(server.name);
        const isOpen = expanded === server.name;
        return (
          <View key={server.name} style={styles.card}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${server.name} details`} onPress={() => setExpanded(isOpen ? null : server.name)}>
              <View style={styles.rowBetween}>
                <View style={styles.row}>
                  <Dot color={serverHealth ? healthTone(theme, serverHealth.status) : server.presentIn.length === destinations.length ? theme.colors.accent : theme.colors.foregroundMuted} />
                  <Text style={styles.strong}>{server.name}</Text>
                  <Badge label={server.transport} theme={theme} />
                  <Badge label={server.authStyle === "inline-credentials" ? "creds inline" : "OAuth / none"} theme={theme} />
                  {serverHealth ? (
                    <Badge label={healthLabel(serverHealth.status)} theme={theme} tone={serverHealth.status === "ok" ? "accent" : serverHealth.status === "unknown" ? undefined : "danger"} />
                  ) : null}
                  <Text style={styles.muted}>
                    {server.presentIn.length}/{destinations.length}
                  </Text>
                </View>
                <View style={styles.row}>
                  <Btn label="Edit" kind="quiet" theme={theme} onPress={() => startEdit(server)} />
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
              </View>
            </Pressable>
            {serverHealth && serverHealth.status !== "ok" ? <Text style={styles.danger}>{serverHealth.note}</Text> : null}
            {server.detail ? <Text style={styles.monoText}>{server.detail}</Text> : null}

            {isOpen ? (
              formMode === server.name ? (
                renderForm(server.name)
              ) : (
                <View>
                  {destinations.map((dest) => {
                    const present = server.presentIn.includes(dest.id);
                    const confirming = pendingRemove?.name === server.name && pendingRemove.destId === dest.id;
                    return (
                      <View key={dest.id} style={tableRow}>
                        <Text style={[styles.text, { flex: 1 }]} numberOfLines={1}>
                          {dest.label}
                        </Text>
                        <Text style={present ? { color: theme.colors.accent, fontSize: 12 } : styles.muted}>{present ? "✓" : "—"}</Text>
                        {confirming ? (
                          <>
                            <Btn label="Confirm remove" kind="danger" theme={theme} onPress={() => removeMutation.mutate({ name: server.name, targets: [dest.id] })} />
                            <Btn label="Cancel" kind="quiet" theme={theme} onPress={() => setPendingRemove(null)} />
                          </>
                        ) : present ? (
                          <Btn label="Remove" kind="danger" theme={theme} onPress={() => setPendingRemove({ name: server.name, destId: dest.id })} />
                        ) : (
                          <Btn label="Add" kind="quiet" theme={theme} onPress={() => applyMutation.mutate({ name: server.name, targets: [dest.id] })} />
                        )}
                      </View>
                    );
                  })}
                </View>
              )
            ) : null}
          </View>
        );
      })}

      <Text style={styles.muted}>
        Tap a server to expand its destination table. Every write backs up the target config first. OAuth tokens live in
        each account's own store and never move.
      </Text>
    </ScrollView>
  );
}

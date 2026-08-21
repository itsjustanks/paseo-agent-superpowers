import type { PluginTheme } from "@getpaseo/plugin";
import React from "react";
import { Pressable, Text, View } from "react-native";

export function makeStyles(theme: PluginTheme, compact: boolean) {
  const pad = compact ? 12 : 20;
  const mono = compact ? "monospace" : "Menlo";
  return {
    pad,
    mono,
    screen: { flex: 1, backgroundColor: theme.colors.surface0 },
    content: { padding: pad, gap: 10, maxWidth: 760, width: "100%" as const, alignSelf: "center" as const },
    headerRow: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const },
    title: { color: theme.colors.foreground, fontSize: compact ? 17 : 20, fontWeight: "700" as const },
    subtitle: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
    card: {
      borderWidth: 1,
      borderColor: theme.colors.foregroundMuted + "33",
      borderRadius: 10,
      padding: compact ? 10 : 14,
      gap: 8,
    },
    row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, flexWrap: "wrap" as const },
    rowBetween: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      gap: 8,
      flexWrap: "wrap" as const,
    },
    text: { color: theme.colors.foreground, fontSize: 13 },
    strong: { color: theme.colors.foreground, fontSize: 13, fontWeight: "600" as const },
    muted: { color: theme.colors.foregroundMuted, fontSize: 12 },
    danger: { color: theme.colors.statusDanger, fontSize: 12 },
    monoText: { color: theme.colors.foregroundMuted, fontSize: 11, fontFamily: mono },
    banner: { padding: 10, borderRadius: 8, backgroundColor: theme.colors.accent },
    bannerText: { color: theme.colors.accentForeground, fontSize: 12 },
  };
}

export function Dot({ color }: { color: string }) {
  return <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: color }} />;
}

// Traffic-light status colors — fixed semantics across themes.
export const STATUS = {
  green: "#22c55e",
  orange: "#f59e0b",
  red: "#ef4444",
} as const;

export function Badge({ label, theme, tone }: { label: string; theme: PluginTheme; tone?: "danger" | "accent" }) {
  const color =
    tone === "danger" ? theme.colors.statusDanger : tone === "accent" ? theme.colors.accent : theme.colors.foregroundMuted;
  return (
    <View style={{ borderWidth: 1, borderColor: color + "66", borderRadius: 999, paddingVertical: 2, paddingHorizontal: 8 }}>
      <Text style={{ color, fontSize: 10, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

export function Btn({
  label,
  onPress,
  theme,
  kind = "primary",
  disabled,
}: {
  label: string;
  onPress: () => void;
  theme: PluginTheme;
  kind?: "primary" | "quiet" | "danger";
  disabled?: boolean;
}) {
  const background = kind === "primary" ? theme.colors.accent : "transparent";
  const border = kind === "danger" ? theme.colors.statusDanger : kind === "quiet" ? theme.colors.foregroundMuted + "66" : theme.colors.accent;
  const color = kind === "primary" ? theme.colors.accentForeground : kind === "danger" ? theme.colors.statusDanger : theme.colors.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={{
        paddingVertical: 5,
        paddingHorizontal: 10,
        borderRadius: 7,
        backgroundColor: background,
        borderWidth: 1,
        borderColor: border,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text style={{ color, fontSize: 11, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

import { Badge, Group, SegmentedControl, Stack, Switch, Text } from "@mantine/core";
import { OVERLAYS } from "./overlays";
import type { OverlayScope } from "./overlays";

interface LayerState {
  on: boolean;
  scope: OverlayScope;
}

interface LayersPanelProps {
  /** Whether the fog-of-war / sensor-awareness overlay is active. */
  showFog: boolean;
  /** Toggle fog on or off. */
  onFogChange: (value: boolean) => void;
  /** Per-overlay on/scope state, keyed by overlay id. */
  overlays: Record<string, LayerState>;
  /** Called when a specific overlay's enabled or scope state changes. */
  onOverlayChange: (id: string, patch: Partial<LayerState>) => void;
}

/**
 * Unified layer-toggle list for the battle controls dock.
 *
 * Fog of war is listed first with a Switch only (no scope control — it always
 * covers the whole battle). Each visual overlay follows with a Switch and an
 * Active/All scope selector. A header badge shows how many layers are currently
 * active so the count is visible without opening anything.
 */
export function LayersPanel({ showFog, onFogChange, overlays, onOverlayChange }: LayersPanelProps) {
  const activeCount =
    (showFog ? 1 : 0) + OVERLAYS.filter((o) => overlays[o.id]?.on === true).length;

  return (
    <Stack gap={6}>
      <Group gap={6} align="center">
        <Text size="xs" fw={600} c="dimmed" style={{ textTransform: "uppercase", letterSpacing: "0.1em" }}>
          Layers
        </Text>
        {activeCount > 0 && (
          <Badge size="xs" variant="light" color="amber">
            {activeCount} on
          </Badge>
        )}
      </Group>

      {/* Fog of war — always-scope, so only a Switch */}
      <Group gap={8} align="center" wrap="nowrap">
        <Switch
          size="xs"
          label="Fog of war"
          checked={showFog}
          onChange={(e) => onFogChange(e.currentTarget.checked)}
        />
      </Group>

      {/* Visual overlays — Switch + Active/All scope */}
      {OVERLAYS.map((def) => {
        const state = overlays[def.id];
        if (state === undefined) return null;
        return (
          <Group key={def.id} gap={8} align="center" wrap="nowrap">
            <Switch
              size="xs"
              label={def.label}
              checked={state.on}
              style={{ flex: 1, minWidth: 0 }}
              onChange={(e) => onOverlayChange(def.id, { on: e.currentTarget.checked })}
            />
            <SegmentedControl
              size="xs"
              value={state.scope}
              onChange={(val) =>
                onOverlayChange(def.id, { scope: val === "all" ? "all" : "active" })
              }
              data={[
                { label: "Active", value: "active" },
                { label: "All", value: "all" },
              ]}
            />
          </Group>
        );
      })}
    </Stack>
  );
}

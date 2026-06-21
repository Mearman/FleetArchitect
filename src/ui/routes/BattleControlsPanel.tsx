import { Stack, Tabs, Text } from "@mantine/core";
import type { BattleFrame } from "@/schema/battle";
import type { DescriptorMap } from "@/ui/cellLayout";
import { LayersPanel } from "./LayersPanel";
import { ModuleStatusPanel } from "./ModuleStatusPanel";
import type { OverlayScope } from "./overlays";

interface LayerState {
  on: boolean;
  scope: OverlayScope;
}

interface BattleControlsPanelProps {
  /** Fog-of-war toggle state. */
  showFog: boolean;
  onFogChange: (value: boolean) => void;
  /** Per-overlay on/scope state, keyed by id. */
  overlays: Record<string, LayerState>;
  onOverlayChange: (id: string, patch: Partial<LayerState>) => void;
  /** Latest discrete frame for the module-status readout, or null if unavailable. */
  frame: BattleFrame | null;
  /** Static per-ship cell descriptors for the module-status readout. */
  descriptors: DescriptorMap;
  /** Active tab, controlled by the parent so the Route can deep-link to MODULES. */
  activeTab: "layers" | "modules";
  onTabChange: (tab: "layers" | "modules") => void;
}

/**
 * Tabbed battle-controls panel housed in the right dock (desktop) or the
 * controls bottom-sheet Drawer (mobile).
 *
 * LAYERS tab — unified fog + overlay toggle list (replaces the gear popover
 * and the bespoke fog ActionIcon).
 *
 * MODULES tab — per-ship module HP readout (replaces the floating statusOverlay
 * and the separate ModulePanelDrawer).
 */
export function BattleControlsPanel({
  showFog,
  onFogChange,
  overlays,
  onOverlayChange,
  frame,
  descriptors,
  activeTab,
  onTabChange,
}: BattleControlsPanelProps) {
  return (
    <Tabs
      value={activeTab}
      onChange={(val) => {
        if (val === "layers" || val === "modules") onTabChange(val);
      }}
      variant="pills"
      radius={0}
    >
      <Tabs.List grow mb="xs">
        <Tabs.Tab value="layers" fz="xs">
          Layers
        </Tabs.Tab>
        <Tabs.Tab value="modules" fz="xs">
          Modules
        </Tabs.Tab>
      </Tabs.List>

      <Tabs.Panel value="layers">
        <LayersPanel
          showFog={showFog}
          onFogChange={onFogChange}
          overlays={overlays}
          onOverlayChange={onOverlayChange}
        />
      </Tabs.Panel>

      <Tabs.Panel value="modules">
        {frame !== null ? (
          <ModuleStatusPanel frame={frame} descriptors={descriptors} />
        ) : (
          <Stack align="center" gap="xs" py="md">
            <Text size="xs" c="dimmed">
              No battle running
            </Text>
          </Stack>
        )}
      </Tabs.Panel>
    </Tabs>
  );
}

import { Drawer } from "@mantine/core";
import type { BattleFrame } from "@/schema/battle";
import type { DescriptorMap } from "@/ui/cellLayout";
import { ModuleStatusPanel } from "./ModuleStatusPanel";

/**
 * Mobile-only bottom drawer wrapping the module status panel.
 * On desktop the panel renders as a side overlay instead (see BattleRoute.tsx).
 */
export function ModulePanelDrawer({
  opened,
  frame,
  descriptors,
  onClose,
}: {
  opened: boolean;
  frame: BattleFrame | null;
  descriptors: DescriptorMap;
  onClose: () => void;
}) {
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="bottom"
      title="Module Status"
      size="60%"
    >
      {frame !== null ? (
        <ModuleStatusPanel frame={frame} descriptors={descriptors} />
      ) : null}
    </Drawer>
  );
}

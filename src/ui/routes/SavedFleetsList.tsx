import { ActionIcon, ScrollArea, Text, Tooltip } from "@mantine/core";
import { IconPlus, IconTrash } from "@tabler/icons-react";
import { AnnunciatorButton } from "@/ui/components/Annunciator";
import { panelLabel } from "@/ui/components/panel.css";
import { hardwareKey, hardwareKeySmall } from "@/ui/theme/controls.css";
import type { Fleet } from "@/schema/fleet";
import { FACTION_PALETTE } from "./battleConstants";
import { fleetListFaction, fleetListName, fleetListRow } from "./FleetBuilderRoute.css";

interface SavedFleetsListProps {
  fleets: readonly Fleet[];
  activeId: string | null;
  onLoad: (fleet: Fleet) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}

/**
 * Left-wing saved-fleet browser. Groups fleets by faction (using the
 * {@link FACTION_PALETTE} accent colour), shows a load/delete affordance per
 * row, and a "New" hardware-key button. Only user-authored fleets show the
 * delete control.
 */
export function SavedFleetsList({
  fleets,
  activeId,
  onLoad,
  onDelete,
  onNew,
}: SavedFleetsListProps) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "0.5rem",
        }}
      >
        <div className={panelLabel} style={{ marginBottom: 0, borderBottom: "none" }}>
          Saved fleets
        </div>
        <AnnunciatorButton
          tint="green"
          className={hardwareKey}
          onClick={onNew}
          aria-label="New fleet"
        >
          <IconPlus size={12} style={{ marginRight: 2 }} />
          New
        </AnnunciatorButton>
      </div>

      <ScrollArea.Autosize mah={400} offsetScrollbars>
        {fleets.length === 0 ? (
          <Text size="sm" c="dimmed">
            No fleets yet.
          </Text>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {fleets.map((fleet) => {
              const palette = FACTION_PALETTE[fleet.faction];
              const accent = palette === undefined ? "#9aa0a6" : palette.accent;
              return (
                <div
                  key={fleet.id}
                  className={fleetListRow}
                  data-active={fleet.id === activeId ? "true" : undefined}
                  style={fleet.id === activeId ? { borderColor: accent } : undefined}
                >
                  <button
                    type="button"
                    className={fleetListName}
                    onClick={() => onLoad(fleet)}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "inherit" }}
                  >
                    {fleet.name}
                  </button>
                  <span
                    className={fleetListFaction}
                    style={{ color: accent, borderColor: accent }}
                  >
                    {fleet.faction}
                  </span>
                  {fleet.source === "user" && (
                    <Tooltip label="Delete fleet">
                      <ActionIcon
                        size="xs"
                        variant="subtle"
                        className={hardwareKeySmall}
                        aria-label={`Delete fleet ${fleet.name}`}
                        onClick={() => onDelete(fleet.id)}
                      >
                        <IconTrash size={11} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea.Autosize>
    </div>
  );
}

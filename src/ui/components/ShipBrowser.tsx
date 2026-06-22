import { SimpleGrid } from "@mantine/core";
import type { ReactNode } from "react";
import type { ShipDesign } from "@/schema/ship";
import { FACTION_PALETTE } from "@/ui/routes/battleConstants";
import { groupByFactionAndClass } from "@/ui/shipGrouping";
import { ShipCard } from "./ShipCard";
import {
  shipBrowser,
  shipBrowserClass,
  shipBrowserClassHeader,
  shipBrowserEmpty,
  shipBrowserFaction,
  shipBrowserFactionHeader,
} from "./shipBrowser.css";

interface ShipBrowserProps {
  designs: readonly ShipDesign[];
  /** When set, only this faction's group is shown. */
  factionFilter?: string;
  onSelect?: (design: ShipDesign) => void;
  /** Per-card action slot (e.g. delete or add), built from the design. */
  renderAction?: (design: ShipDesign) => ReactNode;
  /** Id of the currently selected design, lighting its card. */
  selectedId?: string | null;
  /** Shown when there is nothing to browse. */
  emptyLabel?: string;
}

/** Neutral accent for factions absent from the palette. */
const DEFAULT_ACCENT = "#9aa0a6";

/** Default empty-state copy. */
const DEFAULT_EMPTY = "No ships";

/**
 * Grouped, visual ship browser: a faction header (accent-tinted) over class
 * sub-headers, each holding a responsive grid of {@link ShipCard}s. Filterable
 * to a single faction. Clicking a card invokes `onSelect`.
 */
export function ShipBrowser({
  designs,
  factionFilter,
  onSelect,
  renderAction,
  selectedId,
  emptyLabel,
}: ShipBrowserProps) {
  const groups = groupByFactionAndClass(designs).filter(
    (group) => factionFilter === undefined || group.faction === factionFilter,
  );

  if (groups.length === 0) {
    return (
      <div className={shipBrowserEmpty}>
        {emptyLabel === undefined ? DEFAULT_EMPTY : emptyLabel}
      </div>
    );
  }

  return (
    <div className={shipBrowser}>
      {groups.map((group) => {
        const palette = FACTION_PALETTE[group.faction];
        const accent = palette === undefined ? DEFAULT_ACCENT : palette.accent;
        return (
          <section key={group.faction} className={shipBrowserFaction}>
            <h3 className={shipBrowserFactionHeader} style={{ color: accent }}>
              {group.faction}
            </h3>
            {group.classes.map((classGroup) => (
              <div key={classGroup.classification} className={shipBrowserClass}>
                <h4 className={shipBrowserClassHeader}>{classGroup.classification}</h4>
                <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="xs" verticalSpacing="xs">
                  {classGroup.ships.map((design) => (
                    <ShipCard
                      key={design.id}
                      design={design}
                      selected={selectedId === design.id}
                      onSelect={onSelect}
                      action={renderAction === undefined ? undefined : renderAction(design)}
                    />
                  ))}
                </SimpleGrid>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

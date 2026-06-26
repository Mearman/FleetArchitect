import {
  Anchor,
  Button,
  Collapse,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconBucketDroplet,
  IconHistory,
  IconSwords,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { createId, nowIso } from "@/domain/id";
import { analyseShipDesign } from "@/domain/stats";
import { catalog } from "@/data/catalog";
import { ShareButton } from "@/ui/components/ShareButton";
import { VersionHistoryPanel } from "@/ui/components/VersionHistoryPanel";
import { CassettePanel } from "@/ui/components/CassettePanel";
import { ShipBrowser } from "@/ui/components/ShipBrowser";
import { useFleets, useShipDesigns } from "@/ui/hooks/storage";
import {
  deleteFleet,
  listFleetRevisions,
  restoreFleetRevision,
  saveFleet,
} from "@/storage/db";
import {
  defaultOrders,
} from "@/schema/fleet";
import type { Fleet, FleetShip, Orders } from "@/schema/fleet";
import { flatFormation, flattenShipLeaves } from "@/schema/formation";
import type { ShipDesign } from "@/schema/ship";
import { panelLabel } from "@/ui/components/panel.css";
import { hardwareKey } from "@/ui/theme/controls.css";
import { BudgetReadout } from "./BudgetReadout";
import { FleetRowCard } from "./FleetRowCard";
import { SavedFleetsList } from "./SavedFleetsList";
import {
  actionBar,
  browserWing,
  centre,
  centreBody,
  centreFooter,
  rosterRegion,
  routeRoot,
  titleStrip,
  wing,
  wingBody,
  workspace,
} from "./FleetBuilderRoute.css";

/** A fleet row carries a local React key alongside the schema's FleetShip. */
interface FleetRow extends FleetShip {
  rowId: string;
}

interface WorkingFleet {
  id: string | null;
  createdAt: string | null;
  name: string;
  faction: string;
  rows: FleetRow[];
}

function blankFleet(): WorkingFleet {
  return { id: null, createdAt: null, name: "", faction: "Terran", rows: [] };
}

function toFleetShip(row: FleetRow): FleetShip {
  return {
    designId: row.designId,
    position: row.position,
    facing: row.facing,
    orders: row.orders,
  };
}

export function FleetBuilderRoute() {
  const fleets = useFleets();
  const designs = useShipDesigns();
  const [working, setWorking] = useState<WorkingFleet>(blankFleet);
  const [advancedOpen, setAdvancedOpen] = useState<ReadonlySet<string>>(new Set());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revisions, setRevisions] = useState<Fleet[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const factions = catalog().factions();

  function toggleAdvanced(rowId: string) {
    setAdvancedOpen((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) {
        next.delete(rowId);
      } else {
        next.add(rowId);
      }
      return next;
    });
  }

  const designMap = useMemo(
    () => new Map((designs ?? []).map((d) => [d.id, d])),
    [designs],
  );

  const factionDesigns = useMemo(
    () => (designs ?? []).filter((d) => d.faction === working.faction),
    [designs, working.faction],
  );

  const pointBreakdown = useMemo(() => {
    const costs: { rowId: string; cost: number; missing: boolean }[] = [];
    for (const row of working.rows) {
      const design = designMap.get(row.designId);
      if (design === undefined) {
        costs.push({ rowId: row.rowId, cost: 0, missing: true });
        continue;
      }
      const { stats } = analyseShipDesign(design, catalog());
      costs.push({ rowId: row.rowId, cost: stats.cost, missing: false });
    }
    return costs;
  }, [working.rows, designMap]);

  const total = pointBreakdown.reduce((sum, p) => sum + p.cost, 0);
  const overBudget = total > 20000;

  if (fleets === undefined || designs === undefined) {
    return (
      <Text c="dimmed" role="status" aria-live="polite">
        Loading…
      </Text>
    );
  }

  function addShip(design: ShipDesign) {
    const index = working.rows.length;
    const row: FleetRow = {
      rowId: createId("row"),
      designId: design.id,
      position: {
        x: -300 + (index % 3) * 50,
        y: ((index % 5) - 2) * 80,
      },
      facing: 0,
      orders: { ...defaultOrders },
    };
    setWorking((prev) => ({ ...prev, rows: [...prev.rows, row] }));
  }

  function updateRow(rowId: string, patch: Partial<FleetRow>) {
    setWorking((prev) => ({
      ...prev,
      rows: prev.rows.map((row) =>
        row.rowId === rowId ? { ...row, ...patch } : row,
      ),
    }));
  }

  function updateOrders(rowId: string, patch: Partial<Orders>) {
    setWorking((prev) => ({
      ...prev,
      rows: prev.rows.map((row) =>
        row.rowId === rowId ? { ...row, orders: { ...row.orders, ...patch } } : row,
      ),
    }));
  }

  function removeRow(rowId: string) {
    setWorking((prev) => ({
      ...prev,
      rows: prev.rows.filter((row) => row.rowId !== rowId),
    }));
  }

  async function save() {
    const now = nowIso();
    const fleet: Fleet = {
      id: working.id ?? createId("fleet"),
      name: working.name.trim() || "Untitled Fleet",
      faction: working.faction.trim() || "Unaligned",
      formation: flatFormation(working.rows.map(toFleetShip)),
      createdAt: working.createdAt ?? now,
      updatedAt: now,
      source: "user",
      revision: 1,
    };
    await saveFleet(fleet);
    setWorking((prev) => ({
      ...prev,
      id: fleet.id,
      createdAt: fleet.createdAt,
    }));
    notifications.show({
      title: "Fleet saved",
      message: `${fleet.name} is ready for battle.`,
      color: "teal",
    });
  }

  async function remove(id: string) {
    await deleteFleet(id);
    if (working.id === id) setWorking(blankFleet());
    notifications.show({ message: "Fleet deleted", color: "gray" });
  }

  function load(fleet: Fleet) {
    setWorking({
      id: fleet.id,
      createdAt: fleet.createdAt,
      name: fleet.name,
      faction: fleet.faction,
      rows: flattenShipLeaves(fleet.formation).map((ship) => ({
        ...ship,
        rowId: createId("row"),
      })),
    });
  }

  async function openHistory() {
    const id = working.id;
    if (id === null) {
      setRevisions([]);
      setHistoryOpen((prev) => !prev);
      return;
    }
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    setHistoryLoading(true);
    setHistoryOpen(true);
    const list = await listFleetRevisions(id);
    setRevisions(list);
    setHistoryLoading(false);
  }

  async function restoreRevision(revision: number) {
    if (working.id === null) return;
    const restored = await restoreFleetRevision(working.id, revision);
    load(restored);
    const list = await listFleetRevisions(restored.id);
    setRevisions(list);
    notifications.show({
      title: "Revision restored",
      message: `Fleet rolled back to revision ${revision}.`,
      color: "teal",
    });
  }

  const canBuild = designs.length > 0;

  return (
    <div className={routeRoot}>
      {/* Slim title strip — replaces the large <h1> */}
      <div className={titleStrip}>Fleet Builder</div>

      {/* Three-zone console row */}
      <div className={workspace}>
        {/* LEFT WING: saved fleets */}
        <CassettePanel label="Fleets" className={wing}>
          <div className={wingBody}>
            <SavedFleetsList
              fleets={fleets}
              activeId={working.id}
              onLoad={load}
              onDelete={(id) => void remove(id)}
              onNew={() => setWorking(blankFleet())}
            />
          </div>
        </CassettePanel>

        {/* CENTRE: working fleet roster */}
        <CassettePanel className={centre}>
          <div className={centreBody}>
            {/* Fleet identity inputs — natural height */}
            <Group grow align="flex-start">
              <TextInput
                label="Fleet name"
                value={working.name}
                onChange={(e) =>
                  setWorking((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="e.g. 3rd Strike Wing"
              />
              <Select
                label="Faction"
                data={factions.map((f) => ({ value: f, label: f }))}
                value={working.faction}
                onChange={(f) => {
                  if (f !== null) setWorking((prev) => ({ ...prev, faction: f }));
                }}
              />
            </Group>

            {/* Roster label */}
            <div className={panelLabel} style={{ marginTop: 4 }}>
              Ships ({working.rows.length})
            </div>

            {/* Roster — fills remaining height and scrolls internally on desktop */}
            <div className={rosterRegion}>
              {!canBuild ? (
                <Text size="sm" c="dimmed">
                  <Anchor component={Link} to="/ships" size="sm">
                    Design a ship
                  </Anchor>{" "}
                  first before building a fleet.
                </Text>
              ) : working.rows.length === 0 ? (
                <Text size="sm" c="dimmed">
                  Click a ship in the browser on the right to add it to your fleet.
                </Text>
              ) : (
                <Stack gap={6}>
                  {working.rows.map((row) => {
                    const design = designMap.get(row.designId);
                    if (design === undefined) return null;
                    const pointEntry = pointBreakdown.find(
                      (p) => p.rowId === row.rowId,
                    );
                    const cost = pointEntry === undefined ? 0 : pointEntry.cost;
                    return (
                      <FleetRowCard
                        key={row.rowId}
                        rowId={row.rowId}
                        design={design}
                        orders={row.orders}
                        position={row.position}
                        facing={row.facing}
                        cost={cost}
                        overBudget={overBudget}
                        advancedOpen={advancedOpen.has(row.rowId)}
                        onUpdateOrders={updateOrders}
                        onUpdatePosition={(id, x, y) =>
                          updateRow(id, { position: { x, y } })
                        }
                        onUpdateFacing={(id, f) => updateRow(id, { facing: f })}
                        onToggleAdvanced={toggleAdvanced}
                        onRemove={removeRow}
                      />
                    );
                  })}
                </Stack>
              )}
            </div>

            {/* Footer: budget gauge + version history + action bar — pinned below roster */}
            <div className={centreFooter}>
              <BudgetReadout total={total} />

              <Collapse expanded={historyOpen}>
                <VersionHistoryPanel
                  loading={historyLoading}
                  revisions={revisions}
                  onRestore={(revision) => void restoreRevision(revision)}
                  entityLabel="fleet"
                />
              </Collapse>

              <div className={actionBar}>
                <ShareButton
                  shareable={{
                    kind: "fleet",
                    value: {
                      id: working.id ?? "draft",
                      name: working.name || "Untitled",
                      faction: working.faction || "Unaligned",
                      formation: flatFormation(working.rows.map(toFleetShip)),
                      createdAt: working.createdAt ?? nowIso(),
                      updatedAt: nowIso(),
                      source: "user",
                      revision: 1,
                    },
                  }}
                />
                {working.id !== null ? (
                  <Tooltip label="View version history">
                    <Button
                      variant={historyOpen ? "filled" : "default"}
                      className={hardwareKey}
                      leftSection={<IconHistory size={16} />}
                      onClick={() => void openHistory()}
                    >
                      History
                    </Button>
                  </Tooltip>
                ) : null}
                <Button
                  className={hardwareKey}
                  onClick={() => void save()}
                  disabled={working.rows.length === 0}
                  leftSection={<IconBucketDroplet size={16} />}
                >
                  Save fleet
                </Button>
                <Button
                  component={Link}
                  to="/battle"
                  variant="light"
                  className={hardwareKey}
                  leftSection={<IconSwords size={16} />}
                  disabled={working.id === null}
                >
                  Go to battle
                </Button>
              </div>
            </div>
          </div>
        </CassettePanel>

        {/* RIGHT WING: ship browser */}
        <CassettePanel label="Ship Browser" className={browserWing}>
          <div className={wingBody}>
            {factionDesigns.length === 0 ? (
              <Text size="sm" c="dimmed">
                {designs.length === 0 ? (
                  <>
                    No ships designed yet.{" "}
                    <Anchor component={Link} to="/ships" size="sm">
                      Open the ship designer
                    </Anchor>{" "}
                    to create some.
                  </>
                ) : (
                  `No ${working.faction} ships designed yet.`
                )}
              </Text>
            ) : (
              <ShipBrowser
                designs={factionDesigns}
                factionFilter={working.faction}
                onSelect={addShip}
                renderAction={() => undefined}
              />
            )}
          </div>
        </CassettePanel>
      </div>
    </div>
  );
}

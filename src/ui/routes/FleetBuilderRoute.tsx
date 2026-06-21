import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Checkbox,
  Collapse,
  Container,
  Group,
  NumberInput,
  Paper,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  Slider,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconBucketDroplet,
  IconHistory,
  IconPlus,
  IconSwords,
  IconTrash,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { createId, nowIso } from "@/domain/id";
import { analyseShipDesign } from "@/domain/stats";
import { DEFAULT_FLEET_BUDGET } from "@/domain/points";
import { catalog } from "@/data/catalog";
import { ShareButton } from "@/ui/components/ShareButton";
import { VersionHistoryPanel } from "@/ui/components/VersionHistoryPanel";
import { useFleets, useShipDesigns } from "@/ui/hooks/storage";
import {
  deleteFleet,
  listFleetRevisions,
  restoreFleetRevision,
  saveFleet,
} from "@/storage/db";
import {
  EngageRange,
  EngagementStance,
  TargetPriority,
  defaultOrders,
} from "@/schema/fleet";
import type { Fleet, FleetShip, Orders } from "@/schema/fleet";
import { panelLabel } from "@/ui/components/panel.css";
import { glitchEnter } from "@/ui/fx/CrtOverlay.css";

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

function toNumber(val: number | string | undefined, fallback = 0): number {
  return typeof val === "number" && Number.isFinite(val) ? val : fallback;
}

const STANCES = EngagementStance.options;
const PRIORITIES = TargetPriority.options;
const RANGES = EngageRange.options;

const STANCE_LABEL: Record<EngagementStance, string> = {
  aggressive: "Aggressive",
  balanced: "Balanced",
  defensive: "Defensive",
  evasive: "Evasive",
};

const PRIORITY_LABEL: Record<TargetPriority, string> = {
  nearest: "Nearest",
  weakest: "Weakest",
  strongest: "Strongest",
  highestCost: "Highest cost",
};

const RANGE_LABEL: Record<EngageRange, string> = {
  short: "Short",
  medium: "Medium",
  long: "Long",
  hold: "Hold",
};

export function FleetBuilderRoute() {
  const fleets = useFleets();
  const designs = useShipDesigns();
  const [working, setWorking] = useState<WorkingFleet>(blankFleet);
  const [addDesignId, setAddDesignId] = useState<string | null>(null);
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

  /** Only show designs that match the fleet's faction in the picker, so
   *  a player can't accidentally mix faction parts across a fleet. */
  const designOptions = useMemo(
    () =>
      (designs ?? [])
        .filter((d) => d.faction === working.faction)
        .map((d) => ({ value: d.id, label: d.name })),
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
  const overBudget = total > DEFAULT_FLEET_BUDGET;

  if (fleets === undefined || designs === undefined) {
    return (
      <Text c="dimmed" role="status" aria-live="polite">
        Loading…
      </Text>
    );
  }

  function addShip(designId: string) {
    const index = working.rows.length;
    const row: FleetRow = {
      rowId: createId("row"),
      designId,
      position: {
        x: -300 + (index % 3) * 50,
        y: ((index % 5) - 2) * 80,
      },
      facing: 0,
      orders: { ...defaultOrders },
    };
    setWorking((prev) => ({ ...prev, rows: [...prev.rows, row] }));
    setAddDesignId(null);
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
      ships: working.rows.map(toFleetShip),
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
      rows: fleet.ships.map((ship) => ({ ...ship, rowId: createId("row") })),
    });
  }

  /** Fetch revisions for the current fleet and open the history panel. */
  async function openHistory() {
    const id = working.id;
    if (id === null) {
      setRevisions([]);
      setHistoryOpen((prev) => !prev);
      return;
    }
    // If the panel is already open, just close it — no need to re-fetch.
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

  /** Restore the working fleet to a prior revision. Archives the current HEAD
   *  and loads the restored snapshot. */
  async function restoreRevision(revision: number) {
    if (working.id === null) return;
    const restored = await restoreFleetRevision(working.id, revision);
    load(restored);
    // Reload the history list so the just-archived HEAD appears.
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
    <Container size="xl" py="lg" className={glitchEnter}>
    <Stack gap="lg">
      <Title order={1}>Fleet Builder</Title>

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

      <Group gap="lg" align="flex-start" wrap="wrap">
        <Paper p="md" withBorder style={{ flex: "1 1 280px" }}>
          <Stack gap="xs">
            <Group justify="space-between">
              <div className={panelLabel}>
                Saved fleets
              </div>
              <Button
                size="xs"
                variant="light"
                leftSection={<IconPlus size={14} />}
                onClick={() => setWorking(blankFleet())}
              >
                New
              </Button>
            </Group>
            <ScrollArea.Autosize mah={360} offsetScrollbars>
              <Stack gap={6}>
                {fleets.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    No fleets yet.
                  </Text>
                ) : (
                  fleets.map((fleet) => (
                    <Group
                      key={fleet.id}
                      justify="space-between"
                      wrap="nowrap"
                    >
                      <Button
                        size="xs"
                        variant={fleet.id === working.id ? "filled" : "subtle"}
                        fullWidth
                        justify="flex-start"
                        onClick={() => load(fleet)}
                      >
                        {fleet.name}
                      </Button>
                      <Tooltip label="Delete">
                        <ActionIcon
                          color="red"
                          variant="subtle"
                          aria-label={`Delete fleet ${fleet.name}`}
                          onClick={() => remove(fleet.id)}
                        >
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                  ))
                )}
              </Stack>
            </ScrollArea.Autosize>
          </Stack>
        </Paper>

        <Stack gap="md" style={{ flex: "1 1 480px" }}>
          <Paper p="md" withBorder>
            <Stack gap="xs">
              <Group justify="space-between" align="flex-end">
                <div className={panelLabel}>
                  Ships ({working.rows.length})
                </div>
                <Select
                  placeholder="Add a ship design…"
                  data={designOptions}
                  value={addDesignId}
                  onChange={(id) => {
                    if (id !== null) addShip(id);
                  }}
                  disabled={!canBuild}
                  searchable
                  maw={240}
                  style={{ flex: 1, minWidth: 0 }}
                />
              </Group>
              {!canBuild ? (
                <Text size="sm" c="dimmed">
                  <Anchor component={Link} to="/ships" size="sm">
                    Design a ship
                  </Anchor>{" "}
                  first before building a fleet.
                </Text>
              ) : working.rows.length === 0 ? (
                <Text size="sm" c="dimmed">
                  Add ships to compose your fleet.
                </Text>
              ) : (
                <Stack gap="sm">
                  {working.rows.map((row) => {
                    const cost = pointBreakdown.find(
                      (p) => p.rowId === row.rowId,
                    );
                    return (
                      <Paper
                        key={row.rowId}
                        p="sm"
                        withBorder
                        style={{ background: "rgba(255,255,255,0.02)" }}
                      >
                        <Stack gap="xs">
                          <Group justify="space-between" wrap="nowrap">
                            <Select
                              size="xs"
                              label="Ship design"
                              data={designOptions}
                              value={row.designId}
                              onChange={(id) => {
                                if (id !== null)
                                  updateRow(row.rowId, { designId: id });
                              }}
                              style={{ flex: 1 }}
                            />
                            <Badge
                              size="xs"
                              variant="light"
                              color={overBudget ? "red" : "indigo"}
                            >
                              {cost?.cost ?? 0} pts
                            </Badge>
                            <ActionIcon
                              size="md"
                              color="red"
                              variant="subtle"
                              aria-label="Remove ship"
                              onClick={() => removeRow(row.rowId)}
                            >
                              <IconTrash size={14} />
                            </ActionIcon>
                          </Group>

                          <Stack gap={4}>
                            <Text size="xs" c="dimmed">
                              Stance
                            </Text>
                            <SegmentedControl
                              size="xs"
                              fullWidth
                              data={STANCES.map((s) => ({
                                value: s,
                                label: STANCE_LABEL[s],
                              }))}
                              value={row.orders.stance}
                              onChange={(val) =>
                                updateOrders(row.rowId, {
                                  stance: EngagementStance.parse(val),
                                })
                              }
                            />
                          </Stack>

                          <Group grow align="flex-start">
                            <Select
                              size="xs"
                              label="Target"
                              data={PRIORITIES.map((p) => ({
                                value: p,
                                label: PRIORITY_LABEL[p],
                              }))}
                              value={row.orders.targetPriority}
                              onChange={(val) => {
                                if (val !== null)
                                  updateOrders(row.rowId, {
                                    targetPriority: TargetPriority.parse(val),
                                  });
                              }}
                            />
                            <Select
                              size="xs"
                              label="Engage"
                              data={RANGES.map((r) => ({
                                value: r,
                                label: RANGE_LABEL[r],
                              }))}
                              value={row.orders.engageRange}
                              onChange={(val) => {
                                if (val !== null)
                                  updateOrders(row.rowId, {
                                    engageRange: EngageRange.parse(val),
                                  });
                              }}
                            />
                          </Group>

                          <Button
                            size="xs"
                            variant="subtle"
                            onClick={() => toggleAdvanced(row.rowId)}
                          >
                            {advancedOpen.has(row.rowId)
                              ? "Hide advanced"
                              : "Show advanced"}
                          </Button>

                          <Collapse expanded={advancedOpen.has(row.rowId)}>
                            <Stack gap="xs">
                              <Group grow>
                                <NumberInput
                                  size="xs"
                                  label="X"
                                  value={row.position.x}
                                  onChange={(val) =>
                                    updateRow(row.rowId, {
                                      position: {
                                        ...row.position,
                                        x: toNumber(val),
                                      },
                                    })
                                  }
                                />
                                <NumberInput
                                  size="xs"
                                  label="Y"
                                  value={row.position.y}
                                  onChange={(val) =>
                                    updateRow(row.rowId, {
                                      position: {
                                        ...row.position,
                                        y: toNumber(val),
                                      },
                                    })
                                  }
                                />
                                <NumberInput
                                  size="xs"
                                  label="Facing"
                                  value={row.facing}
                                  step={0.1}
                                  onChange={(val) =>
                                    updateRow(row.rowId, {
                                      facing: toNumber(val),
                                    })
                                  }
                                />
                              </Group>

                              <Stack gap={4}>
                                <Group justify="space-between">
                                  <Text size="xs" c="dimmed">
                                    Retreat below
                                  </Text>
                                  <Text size="xs" c="dimmed">
                                    {Math.round(row.orders.retreatThreshold * 100)}%
                                  </Text>
                                </Group>
                                <Slider
                                  size="md"
                                  min={0}
                                  max={1}
                                  step={0.05}
                                  value={row.orders.retreatThreshold}
                                  onChange={(val) =>
                                    updateOrders(row.rowId, {
                                      retreatThreshold: val,
                                    })
                                  }
                                />
                              </Stack>

                              <Checkbox
                                size="xs"
                                label="Focus fire (concentrate fleet on one target)"
                                checked={row.orders.focusFire}
                                onChange={(e) =>
                                  updateOrders(row.rowId, {
                                    focusFire: e.currentTarget.checked,
                                  })
                                }
                              />

                              <Stack gap={4}>
                                <Group justify="space-between">
                                  <Text size="xs" c="dimmed">
                                    Vulnerable target weight
                                  </Text>
                                  <Text size="xs" c="dimmed">
                                    {Math.round(
                                      row.orders.vulnerableTargetWeight * 100,
                                    )}
                                    %
                                  </Text>
                                </Group>
                                <Slider
                                  size="md"
                                  min={0}
                                  max={1}
                                  step={0.05}
                                  value={row.orders.vulnerableTargetWeight}
                                  onChange={(val) =>
                                    updateOrders(row.rowId, {
                                      vulnerableTargetWeight: val,
                                    })
                                  }
                                />
                              </Stack>

                              <Stack gap={4}>
                                <Group justify="space-between">
                                  <Text size="xs" c="dimmed">
                                    Formation keeping
                                  </Text>
                                  <Text size="xs" c="dimmed">
                                    {Math.round(
                                      row.orders.formationKeeping * 100,
                                    )}
                                    %
                                  </Text>
                                </Group>
                                <Slider
                                  size="md"
                                  min={0}
                                  max={1}
                                  step={0.05}
                                  value={row.orders.formationKeeping}
                                  onChange={(val) =>
                                    updateOrders(row.rowId, {
                                      formationKeeping: val,
                                    })
                                  }
                                />
                              </Stack>

                              <Stack gap={4}>
                                <Group justify="space-between">
                                  <Text size="xs" c="dimmed">
                                    Range-keeping band
                                  </Text>
                                  <Text size="xs" c="dimmed">
                                    ±
                                    {Math.round(
                                      row.orders.rangeKeepingBand * 50,
                                    )}
                                    %
                                  </Text>
                                </Group>
                                <Slider
                                  size="md"
                                  min={0.1}
                                  max={0.9}
                                  step={0.05}
                                  value={row.orders.rangeKeepingBand}
                                  onChange={(val) =>
                                    updateOrders(row.rowId, {
                                      rangeKeepingBand: val,
                                    })
                                  }
                                />
                              </Stack>
                            </Stack>
                          </Collapse>
                        </Stack>
                      </Paper>
                    );
                  })}
                </Stack>
              )}
            </Stack>
          </Paper>

          <Paper p="md" withBorder>
            <Group justify="space-between" mb={6}>
              <div className={panelLabel}>
                Point budget
              </div>
              <Text
                size="sm"
                fw={600}
                c={overBudget ? "red.4" : "gray.1"}
              >
                {total} / {DEFAULT_FLEET_BUDGET}
              </Text>
            </Group>
            <Progress
              value={Math.min(100, (total / DEFAULT_FLEET_BUDGET) * 100)}
              color={overBudget ? "red" : "indigo"}
              size="sm"
            />
            {overBudget && (
              <Text size="xs" c="red.4" mt={4}>
                Over budget — the battle will still run, but this exceeds the
                default cap.
              </Text>
            )}
          </Paper>

          {/* Version history panel */}
          <Collapse expanded={historyOpen}>
            <VersionHistoryPanel
              loading={historyLoading}
              revisions={revisions}
              onRestore={(revision) => void restoreRevision(revision)}
              entityLabel="fleet"
            />
          </Collapse>

          <Group justify="space-between">
            <ShareButton
              shareable={{
                kind: "fleet",
                value: {
                  id: working.id ?? "draft",
                  name: working.name || "Untitled",
                  faction: working.faction || "Unaligned",
                  ships: working.rows.map(toFleetShip),
                  createdAt: working.createdAt ?? nowIso(),
                  updatedAt: nowIso(),
                  source: "user",
                  revision: 1,
                },
              }}
            />
            <Group gap="xs">
              {working.id !== null ? (
                <Tooltip label="View version history">
                  <Button
                    variant={historyOpen ? "light" : "subtle"}
                    color={historyOpen ? "orange" : undefined}
                    leftSection={<IconHistory size={16} />}
                    onClick={() => void openHistory()}
                  >
                    History
                  </Button>
                </Tooltip>
              ) : null}
              <Button
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
                leftSection={<IconSwords size={16} />}
                disabled={working.id === null}
              >
                Go to battle
              </Button>
            </Group>
          </Group>
        </Stack>
      </Group>
    </Stack>
    </Container>
  );
}

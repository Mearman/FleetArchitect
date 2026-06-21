import {
  ActionIcon,
  Badge,
  Button,
  Checkbox,
  Collapse,
  Container,
  Grid,
  Group,
  NumberInput,
  Paper,
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
  IconCopy,
  IconDeviceFloppy,
  IconHistory,
  IconLock,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { computeCompartments } from "@/domain/interior";
import { analyseShipDesign } from "@/domain/stats";
import { createId, nowIso } from "@/domain/id";
import { catalog } from "@/data/catalog";
import { cellAt } from "@/domain/grid";
import { FaultList } from "@/ui/components/FaultList";
import { ShareButton } from "@/ui/components/ShareButton";
import { StatReadout } from "@/ui/components/StatReadout";
import { VersionHistoryPanel } from "@/ui/components/VersionHistoryPanel";
import { useShipDesigns } from "@/ui/hooks/storage";
import {
  copyDesign,
  deleteShipDesign,
  listDesignRevisions,
  restoreDesignRevision,
  saveShipDesign,
} from "@/storage/db";
import type { GridCell } from "@/schema/grid";
import type { ShipDesign } from "@/schema/ship";
import {
  type Brush,
  type WorkingDesign,
  FACINGS,
  MAX_DIM,
} from "./designerConstants";
import {
  applyCellBrush,
  applyEdgeBrush,
  blankDesign,
  clampDim,
  isEdgeBrush,
} from "./designerGrid";
import { BehaviourPanel } from "./BehaviourPanel";
import { DesignerPalette } from "./DesignerPalette";
import { type BreachSet, GridBoard } from "./GridBoard";
import { CommsConfig, SensorConfig } from "./ModuleConfig";
import { panelLabel } from "@/ui/components/panel.css";
import { CrtScreen } from "@/ui/fx/CrtScreen";
import { zoomInner, zoomScreen, zoomViewport } from "./ShipDesignerRoute.css";

/** Zoom range for the pan/zoom viewport, as a fraction of natural size.
 *  `1.0` is the natural fit; higher values zoom in for fine edge placement
 *  on large ships. The lower bound lets the whole ship fit a wide viewport. */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.1;
const ZOOM_DEFAULT = 1;

/** Nominal cell pitch (cell + 2px gap) used to size the zoomable inner wrapper
 *  so the viewport scrolls correctly when zoomed. The grid itself uses `1fr`
 *  columns and `aspect-ratio: 1`, so this is the design-time pitch the layout
 *  resolves to at zoom 1. */
const CELL_PITCH_PX = 44;

export function ShipDesignerRoute() {
  const designs = useShipDesigns();
  const factions = catalog().factions();
  const [working, setWorking] = useState<WorkingDesign>(() => blankDesign());
  const [brush, setBrush] = useState<Brush>({ kind: "scaffold-deck" });
  const [selected, setSelected] = useState<{ col: number; row: number } | null>(
    null,
  );
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  const [showAirtightness, setShowAirtightness] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revisions, setRevisions] = useState<ShipDesign[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  /** Modules available for the current design's faction. */
  const moduleDefs = catalog().modulesForFaction(working.faction);

  /** Whether the working design is read-only (a preset). The Copy action is
   *  the only way to make changes to a preset's grid — it clones to a new
   *  `source:"user"` record and drops the id so the next save creates it. */
  const readOnly = working.source === "preset";

  const analysis = useMemo(() => {
    const design: ShipDesign = {
      id: working.id ?? "draft",
      name: working.name || "Draft",
      faction: working.faction || "Unaligned",
      grid: working.grid,
      createdAt: working.createdAt ?? nowIso(),
      updatedAt: nowIso(),
      source: working.source,
      revision: 1,
      shipStance: working.shipStance,
      crewPriority: working.crewPriority,
      rules: working.rules,
    };
    return analyseShipDesign(design, catalog());
  }, [working]);

  /** Breached-compartment cells, derived from the layered-cell flood-fill. A
   *  cell is breached if it belongs to a compartment whose perimeter has an
   *  open edge or open door. Only deck cells can be in a compartment. */
  const breached = useMemo<BreachSet>(() => {
    if (!showAirtightness) return new Set();
    const out = new Set<string>();
    for (const compartment of computeCompartments(working.grid)) {
      if (compartment.airtight) continue;
      for (const key of compartment.cells) out.add(key);
    }
    return out;
  }, [working.grid, showAirtightness]);

  // Load revisions whenever the history panel opens or the active design changes.
  // Must run unconditionally (before any early returns) to satisfy the rules of hooks.
  useEffect(() => {
    const id = working.id;
    let cancelled = false;
    void (async () => {
      if (!historyOpen || id === null) {
        if (!cancelled) setRevisions([]);
        return;
      }
      if (!cancelled) setHistoryLoading(true);
      const list = await listDesignRevisions(id);
      if (!cancelled) {
        setRevisions(list);
        setHistoryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [historyOpen, working.id]);

  if (designs === undefined) {
    return (
      <Text c="dimmed" role="status" aria-live="polite">
        Loading…
      </Text>
    );
  }

  /** Paint a whole cell with the active cell-brush. Edge brushes are
   *  no-ops here (they go through `paintEdge`). */
  function paint(col: number, row: number) {
    if (readOnly) return;
    if (isEdgeBrush(brush)) return;
    setWorking((prev) => {
      const idx = row * prev.grid.cols + col;
      const cells = prev.grid.cells.slice();
      const prevCell = cells[idx];
      if (prevCell === undefined) return prev;
      const next = applyCellBrush(brush, prevCell);
      if (next === null) return prev;
      cells[idx] = next;
      return { ...prev, grid: { ...prev.grid, cells } };
    });
    setSelected({ col, row });
  }

  /** Paint an edge of the cell at (col, row) on side `dir`. Only edge brushes
   *  act here; cell brushes are no-ops. */
  function paintEdge(
    col: number,
    row: number,
    dir: "n" | "e" | "s" | "w",
  ) {
    if (readOnly) return;
    if (!isEdgeBrush(brush)) return;
    setWorking((prev) => {
      const idx = row * prev.grid.cols + col;
      const cells = prev.grid.cells.slice();
      const prevCell = cells[idx];
      if (prevCell === undefined) return prev;
      const next = applyEdgeBrush(brush, prevCell, dir);
      if (next === null) return prev;
      cells[idx] = next;
      return { ...prev, grid: { ...prev.grid, cells } };
    });
    setSelected({ col, row });
  }

  function setSelectedFacing(facing: number) {
    if (selected === null || readOnly) return;
    setWorking((prev) => {
      const idx = selected.row * prev.grid.cols + selected.col;
      const cell = prev.grid.cells[idx];
      if (cell === undefined || cell.kind !== "solid" || cell.equipment === undefined) return prev;
      const cells = prev.grid.cells.slice();
      cells[idx] = { ...cell, equipment: { ...cell.equipment, facing } };
      return { ...prev, grid: { ...prev.grid, cells } };
    });
  }

  function setSelectedCommsChannel(channel: number) {
    if (selected === null || readOnly) return;
    setWorking((prev) => {
      const idx = selected.row * prev.grid.cols + selected.col;
      const cell = prev.grid.cells[idx];
      if (cell === undefined || cell.kind !== "solid" || cell.equipment === undefined) return prev;
      const cells = prev.grid.cells.slice();
      cells[idx] = { ...cell, equipment: { ...cell.equipment, channel } };
      return { ...prev, grid: { ...prev.grid, cells } };
    });
  }

  function setSelectedCommsBearing(commsBearing: number) {
    if (selected === null || readOnly) return;
    setWorking((prev) => {
      const idx = selected.row * prev.grid.cols + selected.col;
      const cell = prev.grid.cells[idx];
      if (cell === undefined || cell.kind !== "solid" || cell.equipment === undefined) return prev;
      const cells = prev.grid.cells.slice();
      cells[idx] = { ...cell, equipment: { ...cell.equipment, commsBearing } };
      return { ...prev, grid: { ...prev.grid, cells } };
    });
  }

  function setSelectedCommsRange(commsRange: number) {
    if (selected === null || readOnly) return;
    setWorking((prev) => {
      const idx = selected.row * prev.grid.cols + selected.col;
      const cell = prev.grid.cells[idx];
      if (cell === undefined || cell.kind !== "solid" || cell.equipment === undefined) return prev;
      const cells = prev.grid.cells.slice();
      cells[idx] = { ...cell, equipment: { ...cell.equipment, commsRange } };
      return { ...prev, grid: { ...prev.grid, cells } };
    });
  }

  function setSelectedSensorBearing(sensorBearing: number) {
    if (selected === null || readOnly) return;
    setWorking((prev) => {
      const idx = selected.row * prev.grid.cols + selected.col;
      const cell = prev.grid.cells[idx];
      if (cell === undefined || cell.kind !== "solid" || cell.equipment === undefined) return prev;
      const cells = prev.grid.cells.slice();
      cells[idx] = { ...cell, equipment: { ...cell.equipment, sensorBearing } };
      return { ...prev, grid: { ...prev.grid, cells } };
    });
  }

  function setSelectedSensorRangeSetting(sensorRangeSetting: number) {
    if (selected === null || readOnly) return;
    setWorking((prev) => {
      const idx = selected.row * prev.grid.cols + selected.col;
      const cell = prev.grid.cells[idx];
      if (cell === undefined || cell.kind !== "solid" || cell.equipment === undefined) return prev;
      const cells = prev.grid.cells.slice();
      cells[idx] = { ...cell, equipment: { ...cell.equipment, sensorRangeSetting } };
      return { ...prev, grid: { ...prev.grid, cells } };
    });
  }

  function resize(cols: number, rows: number) {
    if (readOnly) return;
    setWorking((prev) => {
      const cells: GridCell[] = [];
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          const existing =
            c < prev.grid.cols && r < prev.grid.rows
              ? prev.grid.cells[r * prev.grid.cols + c]
              : undefined;
          cells.push(existing ?? { kind: "empty" });
        }
      }
      // Drop any hardwire connection whose endpoints fall outside the new bounds.
      const connections = prev.grid.connections.filter(
        (cn) =>
          cn.from.col < cols &&
          cn.from.row < rows &&
          cn.to.col < cols &&
          cn.to.row < rows,
      );
      return { ...prev, grid: { cols, rows, cells, connections, shape: prev.grid.shape } };
    });
    setSelected(null);
  }

  async function save() {
    if (readOnly) return;
    const now = nowIso();
    const design: ShipDesign = {
      id: working.id ?? createId("design"),
      name: working.name.trim() || "Untitled Design",
      faction: working.faction.trim() || "Unaligned",
      grid: working.grid,
      createdAt: working.createdAt ?? now,
      updatedAt: now,
      source: "user",
      revision: 1,
      shipStance: working.shipStance,
      crewPriority: working.crewPriority,
      rules: working.rules,
    };
    await saveShipDesign(design);
    setWorking((prev) => ({ ...prev, id: design.id, createdAt: design.createdAt }));
    notifications.show({
      title: "Design saved",
      message: `${design.name} is in your roster.`,
      color: "teal",
    });
  }

  async function remove(id: string) {
    await deleteShipDesign(id);
    if (working.id === id) setWorking(blankDesign());
    notifications.show({ message: "Design deleted", color: "gray" });
  }

  /** Load a design into the working state, preserving its provenance. A preset
   *  loads read-only; a user design loads editable. */
  function load(design: ShipDesign) {
    setWorking({
      id: design.id,
      createdAt: design.createdAt,
      name: design.name,
      faction: design.faction,
      grid: design.grid,
      source: design.source,
      shipStance: design.shipStance,
      crewPriority: design.crewPriority,
      rules: design.rules,
    });
    setSelected(null);
  }

  /** Copy the working design to a new editable user record using the DB copy
   *  function. The copy is saved immediately and loaded into the working state.
   *  For presets this is the primary way to create an editable version. */
  async function copyAndLoad() {
    const sourceId = working.id;
    if (sourceId === null) {
      // Unsaved draft — fall back to in-memory copy.
      setWorking((prev) => ({
        ...prev,
        id: null,
        createdAt: null,
        source: "user",
        name: prev.name.trim() ? `${prev.name} (copy)` : "",
      }));
      notifications.show({
        title: "Copied to a new design",
        message: "Edit freely and save to keep your copy.",
        color: "teal",
      });
      return;
    }
    const copy = await copyDesign(sourceId);
    load(copy);
    setHistoryOpen(false);
    notifications.show({
      title: "Copied to a new design",
      message: `"${copy.name}" is ready to edit.`,
      color: "teal",
    });
  }

  /** Fetch revisions for the current design and open the history panel. */
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
    const list = await listDesignRevisions(id);
    setRevisions(list);
    setHistoryLoading(false);
  }

  /** Restore the working design to a prior revision. Archives the current HEAD
   *  and loads the restored snapshot. */
  async function restoreRevision(revision: number) {
    if (working.id === null) return;
    const restored = await restoreDesignRevision(working.id, revision);
    load(restored);
    // Reload the history list so the just-archived HEAD appears.
    const list = await listDesignRevisions(restored.id);
    setRevisions(list);
    notifications.show({
      title: "Revision restored",
      message: `Design rolled back to revision ${revision}.`,
      color: "teal",
    });
  }

  const grid = working.grid;
  const selectedCell =
    selected === null ? undefined : cellAt(selected.col, selected.row, grid);
  const selectedModuleDef =
    selectedCell?.kind === "solid" && selectedCell.equipment !== undefined
      ? catalog().module(selectedCell.equipment.moduleId)
      : undefined;
  const selectedFacing =
    selectedCell?.kind === "solid" && selectedCell.equipment !== undefined
      ? selectedCell.equipment.facing
      : undefined;

  // Pixel width of the zoomable inner wrapper, so the viewport scrolls
  // correctly when zoomed. Derived from the nominal cell pitch and the zoom
  // factor; the height comes from the grid's natural aspect ratio.
  const innerWidthPx = grid.cols * CELL_PITCH_PX * zoom;

  return (
    <Container size="xl" py="lg">
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <Title order={1}>Ship Designer</Title>
        {readOnly ? (
          <Badge size="lg" color="grape" leftSection={<IconLock size={14} />}>
            Preset — read only
          </Badge>
        ) : null}
      </Group>

      <Grid>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Paper p="md" withBorder>
            <Group justify="space-between" mb="sm">
              <Text className={panelLabel}>Your designs</Text>
              <Button
                size="xs"
                variant="light"
                leftSection={<IconPlus size={14} />}
                onClick={() => setWorking(blankDesign())}
              >
                New
              </Button>
            </Group>
            <ScrollArea.Autosize mah={420} offsetScrollbars>
              <Stack gap={6}>
                {designs.length === 0 ? (
                  <Text size="sm" c="dimmed">
                    No saved designs yet. Build one and save it.
                  </Text>
                ) : (
                  designs.map((design) => (
                    <Group key={design.id} justify="space-between" wrap="nowrap">
                      <Button
                        variant={design.id === working.id ? "filled" : "subtle"}
                        size="xs"
                        fullWidth
                        justify="space-between"
                        onClick={() => load(design)}
                        leftSection={
                          design.source === "preset" ? (
                            <IconLock size={12} />
                          ) : null
                        }
                      >
                        <span>{design.name}</span>
                      </Button>
                      {design.source === "preset" ? null : (
                        <Tooltip label="Delete">
                          <ActionIcon
                            color="red"
                            variant="subtle"
                            aria-label={`Delete design ${design.name}`}
                            onClick={() => remove(design.id)}
                          >
                            <IconTrash size={14} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </Group>
                  ))
                )}
              </Stack>
            </ScrollArea.Autosize>
          </Paper>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 8 }}>
          <Stack gap="md">
            <Group grow align="flex-start">
              <TextInput
                label="Name"
                value={working.name}
                onChange={(e) =>
                  setWorking((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="e.g. Sabre Mk II"
                disabled={readOnly}
              />
              <Select
                label="Faction"
                data={factions.map((f) => ({ value: f, label: f }))}
                value={working.faction}
                disabled={readOnly}
                onChange={(f) => {
                  if (f !== null) {
                    // Switching faction clears the brush if it's equipment from
                    // the old faction — avoid leaving an invalid brush selected.
                    setBrush((prev) => {
                      if (prev.kind !== "equipment") return prev;
                      const mod = catalog().module(prev.moduleId);
                      if (mod === undefined || mod.faction !== f) {
                        return { kind: "scaffold-deck" };
                      }
                      return prev;
                    });
                    setWorking((prev) => ({ ...prev, faction: f }));
                  }
                }}
              />
            </Group>

            <Group grow align="flex-end">
              <NumberInput
                label="Columns"
                min={1}
                max={MAX_DIM}
                value={grid.cols}
                disabled={readOnly}
                onChange={(v) => resize(clampDim(v, grid.cols), grid.rows)}
              />
              <NumberInput
                label="Rows"
                min={1}
                max={MAX_DIM}
                value={grid.rows}
                disabled={readOnly}
                onChange={(v) => resize(grid.cols, clampDim(v, grid.rows))}
              />
              <Stack gap={4}>
                <Text size="xs" c="dimmed">
                  Zoom ({zoom.toFixed(1)}x)
                </Text>
                <Slider
                  size="md"
                  value={zoom}
                  onChange={setZoom}
                  min={ZOOM_MIN}
                  max={ZOOM_MAX}
                  step={ZOOM_STEP}
                  style={{ flex: 1 }}
                />
              </Stack>
            </Group>

            <Grid>
              <Grid.Col span={{ base: 12, md: 6 }}>
                <Paper p="md" withBorder>
                  <Group justify="space-between" mb="xs">
                    <Text className={panelLabel}>Grid</Text>
                    <Checkbox
                      size="xs"
                      label="Show airtightness"
                      checked={showAirtightness}
                      onChange={(e) =>
                        setShowAirtightness(e.currentTarget.checked)
                      }
                    />
                  </Group>
                  <div className={zoomScreen}>
                    <div className={zoomViewport} style={{ touchAction: "none" }}>
                      <div
                        className={zoomInner}
                        style={{
                          transform: `scale(${zoom})`,
                          width: innerWidthPx,
                        }}
                      >
                        <GridBoard
                          grid={grid}
                          selected={selected}
                          breached={breached}
                          showAirtightness={showAirtightness}
                          onPaint={paint}
                          onEdge={paintEdge}
                        />
                      </div>
                    </div>
                    {/* CRT screen effects, pinned over the viewport (outside the scroll container). */}
                    <CrtScreen />
                  </div>
                  {readOnly ? (
                    <Text size="xs" c="grape" mt="sm">
                      This is a bundled preset. Use Copy to edit a duplicate.
                    </Text>
                  ) : null}
                  {selectedCell !== undefined &&
                  selectedCell.kind === "solid" &&
                  selectedCell.equipment !== undefined &&
                  selectedFacing !== undefined ? (
                    <Stack gap={4} mt="sm">
                      <Text size="xs" c="dimmed">
                        Facing of selected equipment cell
                      </Text>
                      <SegmentedControl
                        size="xs"
                        data={FACINGS}
                        value={`${selectedFacing}`}
                        onChange={(v) => setSelectedFacing(Number(v))}
                      />
                    </Stack>
                  ) : null}
                  {selectedCell !== undefined &&
                  selectedCell.kind === "solid" &&
                  selectedCell.equipment !== undefined &&
                  selectedModuleDef?.effect.kind === "comms" ? (
                    <CommsConfig
                      cell={selectedCell.equipment}
                      effect={selectedModuleDef.effect}
                      onChannelChange={setSelectedCommsChannel}
                      onBearingChange={setSelectedCommsBearing}
                      onRangeChange={setSelectedCommsRange}
                    />
                  ) : null}
                  {selectedCell !== undefined &&
                  selectedCell.kind === "solid" &&
                  selectedCell.equipment !== undefined &&
                  selectedModuleDef?.effect.kind === "sensor" ? (
                    <SensorConfig
                      cell={selectedCell.equipment}
                      effect={selectedModuleDef.effect}
                      onBearingChange={setSelectedSensorBearing}
                      onRangeChange={setSelectedSensorRangeSetting}
                    />
                  ) : null}
                </Paper>
              </Grid.Col>

              <Grid.Col span={{ base: 12, md: 6 }}>
                <Stack gap="md">
                  <DesignerPalette
                    brush={brush}
                    onChange={setBrush}
                    modules={moduleDefs}
                    readOnly={readOnly}
                  />
                  <BehaviourPanel
                    shipStance={working.shipStance}
                    crewPriority={working.crewPriority}
                    rules={working.rules}
                    readOnly={readOnly}
                    onStanceChange={(s) =>
                      setWorking((prev) => ({ ...prev, shipStance: s }))
                    }
                    onPriorityChange={(p) =>
                      setWorking((prev) => ({ ...prev, crewPriority: p }))
                    }
                    onRulesChange={(r) =>
                      setWorking((prev) => ({ ...prev, rules: r }))
                    }
                  />
                </Stack>
              </Grid.Col>
            </Grid>

            <Paper p="md" withBorder>
              <StatReadout stats={analysis.stats} />
            </Paper>

            <FaultList faults={analysis.faults} />

            {/* Version history panel */}
            <Collapse expanded={historyOpen}>
              <VersionHistoryPanel
                loading={historyLoading}
                revisions={revisions}
                onRestore={(revision) => void restoreRevision(revision)}
                entityLabel="design"
              />
            </Collapse>

            <Group justify="space-between">
              <Group gap="sm">
                <ShareButton
                  shareable={{
                    kind: "shipDesign",
                    value: {
                      id: working.id ?? "draft",
                      name: working.name || "Untitled",
                      faction: working.faction || "Unaligned",
                      grid: working.grid,
                      createdAt: working.createdAt ?? nowIso(),
                      updatedAt: nowIso(),
                      source: working.source,
                      revision: 1,
                      shipStance: working.shipStance,
                      crewPriority: working.crewPriority,
                      rules: working.rules,
                    },
                  }}
                />
                {readOnly ? (
                  <Button
                    variant="filled"
                    color="grape"
                    leftSection={<IconCopy size={16} />}
                    onClick={() => void copyAndLoad()}
                  >
                    Copy to edit
                  </Button>
                ) : (
                  <Button
                    variant="light"
                    leftSection={<IconCopy size={16} />}
                    onClick={() => void copyAndLoad()}
                  >
                    Copy design
                  </Button>
                )}
              </Group>
              {!readOnly ? (
                <Group gap="sm">
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
                    leftSection={<IconDeviceFloppy size={16} />}
                  >
                    Save design
                  </Button>
                </Group>
              ) : null}
            </Group>
          </Stack>
        </Grid.Col>
      </Grid>
    </Stack>
    </Container>
  );
}

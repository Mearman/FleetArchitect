import {
  ActionIcon,
  Badge,
  Button,
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
import { IconDeviceFloppy, IconPlus, IconTrash } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { analyseShipDesign } from "@/domain/stats";
import { createId, nowIso } from "@/domain/id";
import { catalog } from "@/data/catalog";
import { cellAt } from "@/domain/grid";
import { FaultList } from "@/ui/components/FaultList";
import { ShareButton } from "@/ui/components/ShareButton";
import { StatReadout } from "@/ui/components/StatReadout";
import { useShipDesigns } from "@/ui/hooks/storage";
import { storage } from "@/storage/db";
import type { GridCell, HullTileType, ModuleCell, TileGrid } from "@/schema/grid";
import type { CommsEffect, SensorEffect } from "@/schema/module";
import type { ShipDesign } from "@/schema/ship";
import {
  cellInner,
  facingTick,
  gridBoard,
  gridCell as gridCellClass,
} from "./ShipDesignerRoute.css";

const DEFAULT_COLS = 5;
const DEFAULT_ROWS = 5;
const MAX_DIM = 12;

interface WorkingDesign {
  id: string | null;
  createdAt: string | null;
  name: string;
  faction: string;
  grid: TileGrid;
}

/** A blank grid of the given size, with a fusion reactor (the command module)
 *  in the centre so a fresh design starts from something that can grow into a
 *  valid ship. */
function blankGrid(cols: number, rows: number): TileGrid {
  const cells: GridCell[] = Array.from({ length: cols * rows }, () => ({
    kind: "empty",
  }));
  const centre = Math.floor(rows / 2) * cols + Math.floor(cols / 2);
  cells[centre] = { kind: "module", moduleId: "mod-reactor-fusion", facing: 0 };
  return { cols, rows, cells };
}

function blankDesign(): WorkingDesign {
  return {
    id: null,
    createdAt: null,
    name: "",
    faction: "Terran",
    grid: blankGrid(DEFAULT_COLS, DEFAULT_ROWS),
  };
}

/** The thing the user is painting with. `empty` clears a cell; `hull` paints a
 *  hull tile of the chosen type; `module` paints a module cell; `floor` paints
 *  walkable interior decking (corridor or crew-quarters space). */
type Brush =
  | { kind: "empty" }
  | { kind: "hull"; tile: HullTileType }
  | { kind: "module"; moduleId: string }
  | { kind: "floor" };

const HULL_TILES: HullTileType[] = ["block", "edge", "corner", "strut"];

/** Display colour per cell kind for the board. Sensor and comms modules get
 *  distinct colours so they stand out from generic modules at a glance. */
function cellColour(cell: GridCell): string {
  switch (cell.kind) {
    case "empty":
      return "transparent";
    case "hull":
      return "#8794b8";
    case "module": {
      const mod = catalog().module(cell.moduleId);
      if (mod?.effect.kind === "sensor") return "#4ecb9e";   // teal-green
      if (mod?.effect.kind === "comms")  return "#b87fff";   // purple
      return "#6ea8ff";
    }
    case "floor":
      // Warm amber-tan: visually distinct from the steel-blue hull and the
      // bright-blue module, clearly readable at small cell sizes.
      return "#c9a84c";
  }
}

/** Short label drawn inside a cell. Sensor cells get "S", comms cells get
 *  "K" (for communications) to distinguish them from generic module cells. */
function cellLabel(cell: GridCell): string {
  if (cell.kind === "empty") return "";
  if (cell.kind === "hull") return cell.tile.charAt(0).toUpperCase();
  if (cell.kind === "floor") return "~";
  const mod = catalog().module(cell.moduleId);
  if (mod === undefined) return "?";
  if (mod.effect.kind === "sensor") return "S";
  if (mod.effect.kind === "comms") return "K";
  return mod.name.charAt(0).toUpperCase();
}

/** The four cardinal facings, in radians, ship-local (0 = forward / +x). */
const FACINGS: { value: string; label: string }[] = [
  { value: "0", label: "Fwd" },
  { value: `${Math.PI / 2}`, label: "Down" },
  { value: `${Math.PI}`, label: "Aft" },
  { value: `${-Math.PI / 2}`, label: "Up" },
];

/** Convert the active brush to the cell it paints. */
function brushToCell(brush: Brush): GridCell {
  switch (brush.kind) {
    case "empty":
      return { kind: "empty" };
    case "hull":
      return { kind: "hull", tile: brush.tile };
    case "module":
      return { kind: "module", moduleId: brush.moduleId, facing: 0 };
    case "floor":
      return { kind: "floor" };
  }
}

/** Clamp a NumberInput value (which may be a string while typing) to a valid
 *  integer dimension, falling back to the previous value on a blank field. */
function clampDim(value: string | number, fallback: number): number {
  const n = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, MAX_DIM);
}

function brushLabel(brush: Brush): string {
  if (brush.kind === "module") {
    return catalog().module(brush.moduleId)?.name ?? "module";
  }
  if (brush.kind === "hull") return `hull (${brush.tile})`;
  if (brush.kind === "floor") return "floor / corridor";
  return "empty";
}

export function ShipDesignerRoute() {
  const designs = useShipDesigns();
  const factions = catalog().factions();
  const [working, setWorking] = useState<WorkingDesign>(() => blankDesign());
  const [brush, setBrush] = useState<Brush>({ kind: "hull", tile: "block" });
  const [selected, setSelected] = useState<{ col: number; row: number } | null>(
    null,
  );

  /** Modules available for the current design's faction. */
  const moduleDefs = catalog().modulesForFaction(working.faction);

  const analysis = useMemo(() => {
    const design: ShipDesign = {
      id: working.id ?? "draft",
      name: working.name || "Draft",
      faction: working.faction || "Unaligned",
      grid: working.grid,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    return analyseShipDesign(design, catalog());
  }, [working]);

  if (designs === undefined) {
    return <Text c="dimmed">Loading…</Text>;
  }

  function paint(col: number, row: number) {
    setWorking((prev) => {
      const idx = row * prev.grid.cols + col;
      const cells = prev.grid.cells.slice();
      cells[idx] = brushToCell(brush);
      return { ...prev, grid: { ...prev.grid, cells } };
    });
    setSelected({ col, row });
  }

  function setSelectedFacing(facing: number) {
    if (selected === null) return;
    setWorking((prev) => {
      const idx = selected.row * prev.grid.cols + selected.col;
      const cell = prev.grid.cells[idx];
      if (cell === undefined || cell.kind !== "module") return prev;
      const cells = prev.grid.cells.slice();
      cells[idx] = { ...cell, facing };
      return { ...prev, grid: { ...prev.grid, cells } };
    });
  }

  /** Write the per-instance channel override for the selected comms cell. */
  function setSelectedCommsChannel(channel: number) {
    if (selected === null) return;
    setWorking((prev) => {
      const idx = selected.row * prev.grid.cols + selected.col;
      const cell = prev.grid.cells[idx];
      if (cell === undefined || cell.kind !== "module") return prev;
      const cells = prev.grid.cells.slice();
      cells[idx] = { ...cell, channel };
      return { ...prev, grid: { ...prev.grid, cells } };
    });
  }

  /** Write the per-instance bearing override for directional/laser comms cells. */
  function setSelectedCommsBearing(commsBearing: number) {
    if (selected === null) return;
    setWorking((prev) => {
      const idx = selected.row * prev.grid.cols + selected.col;
      const cell = prev.grid.cells[idx];
      if (cell === undefined || cell.kind !== "module") return prev;
      const cells = prev.grid.cells.slice();
      cells[idx] = { ...cell, commsBearing };
      return { ...prev, grid: { ...prev.grid, cells } };
    });
  }

  /** Write the per-instance range setting for variable-type comms cells. */
  function setSelectedCommsRange(commsRange: number) {
    if (selected === null) return;
    setWorking((prev) => {
      const idx = selected.row * prev.grid.cols + selected.col;
      const cell = prev.grid.cells[idx];
      if (cell === undefined || cell.kind !== "module") return prev;
      const cells = prev.grid.cells.slice();
      cells[idx] = { ...cell, commsRange };
      return { ...prev, grid: { ...prev.grid, cells } };
    });
  }

  /** Write the per-instance bearing override for directional/dish sensor cells. */
  function setSelectedSensorBearing(sensorBearing: number) {
    if (selected === null) return;
    setWorking((prev) => {
      const idx = selected.row * prev.grid.cols + selected.col;
      const cell = prev.grid.cells[idx];
      if (cell === undefined || cell.kind !== "module") return prev;
      const cells = prev.grid.cells.slice();
      cells[idx] = { ...cell, sensorBearing };
      return { ...prev, grid: { ...prev.grid, cells } };
    });
  }

  /** Write the per-instance range setting for variable-type sensor cells. */
  function setSelectedSensorRangeSetting(sensorRangeSetting: number) {
    if (selected === null) return;
    setWorking((prev) => {
      const idx = selected.row * prev.grid.cols + selected.col;
      const cell = prev.grid.cells[idx];
      if (cell === undefined || cell.kind !== "module") return prev;
      const cells = prev.grid.cells.slice();
      cells[idx] = { ...cell, sensorRangeSetting };
      return { ...prev, grid: { ...prev.grid, cells } };
    });
  }

  function resize(cols: number, rows: number) {
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
      return { ...prev, grid: { cols, rows, cells } };
    });
    setSelected(null);
  }

  async function save() {
    const now = nowIso();
    const design: ShipDesign = {
      id: working.id ?? createId("design"),
      name: working.name.trim() || "Untitled Design",
      faction: working.faction.trim() || "Unaligned",
      grid: working.grid,
      createdAt: working.createdAt ?? now,
      updatedAt: now,
    };
    await storage().ships.save(design);
    setWorking((prev) => ({ ...prev, id: design.id, createdAt: design.createdAt }));
    notifications.show({
      title: "Design saved",
      message: `${design.name} is in your roster.`,
      color: "teal",
    });
  }

  async function remove(id: string) {
    await storage().ships.remove(id);
    if (working.id === id) setWorking(blankDesign());
    notifications.show({ message: "Design deleted", color: "gray" });
  }

  function load(design: ShipDesign) {
    setWorking({
      id: design.id,
      createdAt: design.createdAt,
      name: design.name,
      faction: design.faction,
      grid: design.grid,
    });
    setSelected(null);
  }

  const grid = working.grid;
  const selectedCell =
    selected === null ? undefined : cellAt(selected.col, selected.row, grid);
  // Resolved definition for the selected module cell (undefined if no module selected).
  const selectedModuleDef =
    selectedCell?.kind === "module"
      ? catalog().module(selectedCell.moduleId)
      : undefined;

  return (
    <Stack gap="lg">
      <Title order={2}>Ship Designer</Title>

      <Grid>
        <Grid.Col span={{ base: 12, md: 4 }}>
          <Paper p="md" withBorder>
            <Group justify="space-between" mb="sm">
              <Text fw={600}>Your designs</Text>
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
                      >
                        <span>{design.name}</span>
                      </Button>
                      <Tooltip label="Delete">
                        <ActionIcon
                          color="red"
                          variant="subtle"
                          onClick={() => remove(design.id)}
                        >
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Tooltip>
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
              />
              <Select
                label="Faction"
                data={factions.map((f) => ({ value: f, label: f }))}
                value={working.faction}
                onChange={(f) => {
                  if (f !== null) {
                    // Switching faction clears the brush if it's a module from
                    // the old faction — avoid leaving an invalid brush selected.
                    setBrush((prev) => {
                      if (prev.kind !== "module") return prev;
                      const mod = catalog().module(prev.moduleId);
                      if (mod === undefined || mod.faction !== f) {
                        return { kind: "hull", tile: "block" };
                      }
                      return prev;
                    });
                    setWorking((prev) => ({ ...prev, faction: f }));
                  }
                }}
              />
            </Group>

            <Group grow>
              <NumberInput
                label="Columns"
                min={1}
                max={MAX_DIM}
                value={grid.cols}
                onChange={(v) => resize(clampDim(v, grid.cols), grid.rows)}
              />
              <NumberInput
                label="Rows"
                min={1}
                max={MAX_DIM}
                value={grid.rows}
                onChange={(v) => resize(grid.cols, clampDim(v, grid.rows))}
              />
            </Group>

            <Grid>
              <Grid.Col span={{ base: 12, lg: 6 }}>
                <Paper p="md" withBorder>
                  <Text size="sm" fw={600} mb="xs">
                    Grid
                  </Text>
                  <GridBoard grid={grid} selected={selected} onPaint={paint} />
                  {selectedCell !== undefined && selectedCell.kind === "module" ? (
                    <Stack gap={4} mt="sm">
                      <Text size="xs" c="dimmed">
                        Facing of selected module cell
                      </Text>
                      <SegmentedControl
                        size="xs"
                        data={FACINGS}
                        value={`${selectedCell.facing}`}
                        onChange={(v) => setSelectedFacing(Number(v))}
                      />
                    </Stack>
                  ) : null}
                  {selectedCell !== undefined &&
                  selectedCell.kind === "module" &&
                  selectedModuleDef?.effect.kind === "comms" ? (
                    <CommsConfig
                      cell={selectedCell}
                      effect={selectedModuleDef.effect}
                      onChannelChange={setSelectedCommsChannel}
                      onBearingChange={setSelectedCommsBearing}
                      onRangeChange={setSelectedCommsRange}
                    />
                  ) : null}
                  {selectedCell !== undefined &&
                  selectedCell.kind === "module" &&
                  selectedModuleDef?.effect.kind === "sensor" ? (
                    <SensorConfig
                      cell={selectedCell}
                      effect={selectedModuleDef.effect}
                      onBearingChange={setSelectedSensorBearing}
                      onRangeChange={setSelectedSensorRangeSetting}
                    />
                  ) : null}
                </Paper>
              </Grid.Col>

              <Grid.Col span={{ base: 12, lg: 6 }}>
                <Paper p="md" withBorder>
                  <Text size="sm" fw={600} mb="xs">
                    Palette
                  </Text>
                  <Stack gap="xs">
                    <Button
                      size="xs"
                      variant={brush.kind === "empty" ? "filled" : "light"}
                      color="gray"
                      onClick={() => setBrush({ kind: "empty" })}
                    >
                      Erase (empty)
                    </Button>
                    <Group gap={4}>
                      {HULL_TILES.map((tile) => (
                        <Button
                          key={tile}
                          size="xs"
                          variant={
                            brush.kind === "hull" && brush.tile === tile
                              ? "filled"
                              : "light"
                          }
                          onClick={() => setBrush({ kind: "hull", tile })}
                        >
                          {tile}
                        </Button>
                      ))}
                      <Button
                        size="xs"
                        variant={brush.kind === "floor" ? "filled" : "light"}
                        color="yellow"
                        onClick={() => setBrush({ kind: "floor" })}
                        title="Paint walkable interior decking — corridors and crew space"
                      >
                        floor / corridor
                      </Button>
                    </Group>
                    <Select
                      label="Module"
                      placeholder="Pick a module to paint"
                      data={moduleDefs.map((m) => ({
                        value: m.id,
                        label: `${m.name} — ${m.cost} pts`,
                      }))}
                      value={brush.kind === "module" ? brush.moduleId : null}
                      onChange={(moduleId) =>
                        moduleId !== null && setBrush({ kind: "module", moduleId })
                      }
                      searchable
                    />
                    <Badge variant="light" color="indigo">
                      Brush: {brushLabel(brush)}
                    </Badge>
                  </Stack>
                </Paper>
              </Grid.Col>
            </Grid>

            <Paper p="md" withBorder>
              <StatReadout stats={analysis.stats} />
            </Paper>

            <FaultList faults={analysis.faults} />

            <Group justify="space-between">
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
                  },
                }}
              />
              <Button onClick={save} leftSection={<IconDeviceFloppy size={16} />}>
                Save design
              </Button>
            </Group>
          </Stack>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}

function GridBoard({
  grid,
  selected,
  onPaint,
}: {
  grid: TileGrid;
  selected: { col: number; row: number } | null;
  onPaint: (col: number, row: number) => void;
}) {
  return (
    <div
      className={gridBoard}
      style={{ gridTemplateColumns: `repeat(${grid.cols}, 1fr)` }}
    >
      {grid.cells.map((cell, idx) => {
        const col = idx % grid.cols;
        const row = Math.floor(idx / grid.cols);
        const isSelected =
          selected !== null && selected.col === col && selected.row === row;
        return (
          <button
            key={`${col}-${row}`}
            type="button"
            className={gridCellClass}
            onClick={() => onPaint(col, row)}
            style={{
              background: cellColour(cell),
              outline: isSelected ? "2px solid #ffd86e" : "none",
            }}
            aria-label={`cell ${col},${row}`}
          >
            <span className={cellInner}>
              {cell.kind === "module" ? (
                <span
                  className={facingTick}
                  style={{
                    transform: `rotate(${cell.facing + Math.PI / 2}rad)`,
                  }}
                />
              ) : null}
              {cellLabel(cell)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Per-instance comms configuration panel for a selected comms module cell.
 * Shows a channel selector always; a bearing control for directional/laser
 * units; and a range slider for variable units.
 */
function CommsConfig({
  cell,
  effect,
  onChannelChange,
  onBearingChange,
  onRangeChange,
}: {
  cell: ModuleCell;
  effect: CommsEffect;
  onChannelChange: (channel: number) => void;
  onBearingChange: (bearing: number) => void;
  onRangeChange: (range: number) => void;
}) {
  // Effective per-instance values, falling back to the module definition's defaults.
  const effectiveChannel = cell.channel ?? effect.channel;
  const effectiveBearing = cell.commsBearing ?? effect.bearing;
  const effectiveRange = cell.commsRange ?? effect.range;

  const showBearing =
    effect.commsType === "directional" ||
    effect.commsType === "dish" ||
    effect.commsType === "laser";
  const showRange = effect.commsType === "variable";

  // Bearing expressed as degrees for display, stored as radians.
  const bearingDeg = Math.round((effectiveBearing * 180) / Math.PI);

  // Channel options: 0–7 is a reasonable range for the designer.
  const CHANNEL_OPTIONS: { value: string; label: string }[] = Array.from(
    { length: 8 },
    (_, i) => ({ value: `${i}`, label: `Ch ${i}` }),
  );

  // Bearing options: the four cardinal directions plus diagonals (0°, 45°, …, 315°).
  const BEARING_OPTIONS: { value: string; label: string }[] = [
    { value: "0",    label: "Fwd (0°)" },
    { value: "45",   label: "45°" },
    { value: "90",   label: "Stbd (90°)" },
    { value: "135",  label: "135°" },
    { value: "180",  label: "Aft (180°)" },
    { value: "225",  label: "225°" },
    { value: "270",  label: "Port (270°)" },
    { value: "315",  label: "315°" },
  ];

  const rangeMin = effect.minRange ?? 0;
  const rangeMax = effect.maxRange ?? effect.range;

  return (
    <Stack gap={6} mt="sm">
      <Text size="xs" c="dimmed">
        Comms configuration
      </Text>

      {/* Channel selector — always shown for comms cells */}
      <Select
        label="Channel"
        size="xs"
        data={CHANNEL_OPTIONS}
        value={`${effectiveChannel}`}
        onChange={(v) => {
          if (v !== null) onChannelChange(Number.parseInt(v, 10));
        }}
      />

      {/* Fixed bearing — directional, dish, and laser units */}
      {showBearing ? (
        <Select
          label={`Bearing (current: ${bearingDeg}°)`}
          size="xs"
          data={BEARING_OPTIONS}
          value={`${bearingDeg}`}
          onChange={(v) => {
            if (v !== null) {
              const deg = Number.parseInt(v, 10);
              onBearingChange((deg * Math.PI) / 180);
            }
          }}
        />
      ) : null}

      {/* Range slider — variable units only */}
      {showRange ? (
        <Stack gap={2}>
          <Text size="xs">
            Range: {effectiveRange.toFixed(0)} units
          </Text>
          <Slider
            size="xs"
            min={rangeMin}
            max={rangeMax}
            value={effectiveRange}
            onChange={onRangeChange}
          />
        </Stack>
      ) : null}
    </Stack>
  );
}

/**
 * Per-instance sensor configuration panel for a selected sensor module cell.
 * Shows a fixed bearing control for directional/dish units and a range slider
 * for variable units; omni units need no per-instance tuning.
 */
function SensorConfig({
  cell,
  effect,
  onBearingChange,
  onRangeChange,
}: {
  cell: ModuleCell;
  effect: SensorEffect;
  onBearingChange: (bearing: number) => void;
  onRangeChange: (range: number) => void;
}) {
  // Effective per-instance values, falling back to the module definition's defaults.
  const effectiveBearing = cell.sensorBearing ?? effect.bearing;
  const effectiveRange = cell.sensorRangeSetting ?? effect.detectionRange;

  // Directional and dish units have a fixed facing the designer can aim.
  // Variable units are electronically steered via the range dial instead.
  // Omni units need no per-instance tuning.
  const showBearing =
    effect.sensorType === "directional" || effect.sensorType === "dish";
  const showRange = effect.sensorType === "variable";

  // Bearing expressed as degrees for display, stored as radians.
  const bearingDeg = Math.round((effectiveBearing * 180) / Math.PI);

  // Bearing options: the four cardinal directions plus diagonals (0°, 45°, …, 315°).
  const BEARING_OPTIONS: { value: string; label: string }[] = [
    { value: "0",    label: "Fwd (0°)" },
    { value: "45",   label: "45°" },
    { value: "90",   label: "Stbd (90°)" },
    { value: "135",  label: "135°" },
    { value: "180",  label: "Aft (180°)" },
    { value: "225",  label: "225°" },
    { value: "270",  label: "Port (270°)" },
    { value: "315",  label: "315°" },
  ];

  const rangeMin = effect.minRange ?? 0;
  const rangeMax = effect.maxRange ?? effect.detectionRange;

  return (
    <Stack gap={6} mt="sm">
      <Text size="xs" c="dimmed">
        Sensor configuration
      </Text>

      {/* Fixed bearing — directional and dish units */}
      {showBearing ? (
        <Select
          label={`Bearing (current: ${bearingDeg}°)`}
          size="xs"
          data={BEARING_OPTIONS}
          value={`${bearingDeg}`}
          onChange={(v) => {
            if (v !== null) {
              const deg = Number.parseInt(v, 10);
              onBearingChange((deg * Math.PI) / 180);
            }
          }}
        />
      ) : null}

      {/* Range slider — variable units only. Raising range narrows the arc. */}
      {showRange ? (
        <Stack gap={2}>
          <Text size="xs">
            Range: {effectiveRange.toFixed(0)} units
          </Text>
          <Slider
            size="xs"
            min={rangeMin}
            max={rangeMax}
            value={effectiveRange}
            onChange={onRangeChange}
          />
        </Stack>
      ) : null}
    </Stack>
  );
}

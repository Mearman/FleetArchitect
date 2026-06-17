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
import type { GridCell, HullTileType, TileGrid } from "@/schema/grid";
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
 *  hull tile of the chosen type; `module` paints a module cell. */
type Brush =
  | { kind: "empty" }
  | { kind: "hull"; tile: HullTileType }
  | { kind: "module"; moduleId: string };

const HULL_TILES: HullTileType[] = ["block", "edge", "corner", "strut"];

/** Display colour per cell kind for the board. */
function cellColour(cell: GridCell): string {
  switch (cell.kind) {
    case "empty":
      return "transparent";
    case "hull":
      return "#8794b8";
    case "module":
      return "#6ea8ff";
  }
}

/** Short label drawn inside a cell. */
function cellLabel(cell: GridCell): string {
  if (cell.kind === "empty") return "";
  if (cell.kind === "hull") return cell.tile.charAt(0).toUpperCase();
  const mod = catalog().module(cell.moduleId);
  return mod === undefined ? "?" : mod.name.charAt(0).toUpperCase();
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

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
import type { GridCell } from "@/schema/grid";
import type { ShipDesign } from "@/schema/ship";
import {
  type Brush,
  type WorkingDesign,
  FACINGS,
  MAX_DIM,
} from "./designerConstants";
import {
  blankDesign,
  brushLabel,
  brushToCell,
  clampDim,
} from "./designerGrid";
import { GridBoard } from "./GridBoard";
import { CommsConfig, SensorConfig } from "./ModuleConfig";

export function ShipDesignerRoute() {
  const designs = useShipDesigns();
  const factions = catalog().factions();
  const [working, setWorking] = useState<WorkingDesign>(() => blankDesign());
  const [brush, setBrush] = useState<Brush>({ kind: "scaffold-armor" });
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
      source: "user",
      revision: 1,
      shipStance: "balanced",
      crewPriority: "combat",
      rules: [],
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
      if (cell === undefined || cell.kind !== "solid" || cell.equipment === undefined) return prev;
      const cells = prev.grid.cells.slice();
      cells[idx] = { ...cell, equipment: { ...cell.equipment, facing } };
      return { ...prev, grid: { ...prev.grid, cells } };
    });
  }

  /** Write the per-instance channel override for the selected comms cell. */
  function setSelectedCommsChannel(channel: number) {
    if (selected === null) return;
    setWorking((prev) => {
      const idx = selected.row * prev.grid.cols + selected.col;
      const cell = prev.grid.cells[idx];
      if (cell === undefined || cell.kind !== "solid" || cell.equipment === undefined) return prev;
      const cells = prev.grid.cells.slice();
      cells[idx] = { ...cell, equipment: { ...cell.equipment, channel } };
      return { ...prev, grid: { ...prev.grid, cells } };
    });
  }

  /** Write the per-instance bearing override for directional/laser comms cells. */
  function setSelectedCommsBearing(commsBearing: number) {
    if (selected === null) return;
    setWorking((prev) => {
      const idx = selected.row * prev.grid.cols + selected.col;
      const cell = prev.grid.cells[idx];
      if (cell === undefined || cell.kind !== "solid" || cell.equipment === undefined) return prev;
      const cells = prev.grid.cells.slice();
      cells[idx] = { ...cell, equipment: { ...cell.equipment, commsBearing } };
      return { ...prev, grid: { ...prev.grid, cells } };
    });
  }

  /** Write the per-instance range setting for variable-type comms cells. */
  function setSelectedCommsRange(commsRange: number) {
    if (selected === null) return;
    setWorking((prev) => {
      const idx = selected.row * prev.grid.cols + selected.col;
      const cell = prev.grid.cells[idx];
      if (cell === undefined || cell.kind !== "solid" || cell.equipment === undefined) return prev;
      const cells = prev.grid.cells.slice();
      cells[idx] = { ...cell, equipment: { ...cell.equipment, commsRange } };
      return { ...prev, grid: { ...prev.grid, cells } };
    });
  }

  /** Write the per-instance bearing override for directional/dish sensor cells. */
  function setSelectedSensorBearing(sensorBearing: number) {
    if (selected === null) return;
    setWorking((prev) => {
      const idx = selected.row * prev.grid.cols + selected.col;
      const cell = prev.grid.cells[idx];
      if (cell === undefined || cell.kind !== "solid" || cell.equipment === undefined) return prev;
      const cells = prev.grid.cells.slice();
      cells[idx] = { ...cell, equipment: { ...cell.equipment, sensorBearing } };
      return { ...prev, grid: { ...prev.grid, cells } };
    });
  }

  /** Write the per-instance range setting for variable-type sensor cells. */
  function setSelectedSensorRangeSetting(sensorRangeSetting: number) {
    if (selected === null) return;
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
      shipStance: "balanced",
      crewPriority: "combat",
      rules: [],
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
  // Resolved definition for the selected equipment cell (undefined if no
  // equipment selected).
  const selectedModuleDef =
    selectedCell?.kind === "solid" && selectedCell.equipment !== undefined
      ? catalog().module(selectedCell.equipment.moduleId)
      : undefined;
  // Facing of the selected equipment cell (if any), for the SegmentedControl.
  const selectedFacing =
    selectedCell?.kind === "solid" && selectedCell.equipment !== undefined
      ? selectedCell.equipment.facing
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
                    // Switching faction clears the brush if it's equipment from
                    // the old faction — avoid leaving an invalid brush selected.
                    setBrush((prev) => {
                      if (prev.kind !== "equipment") return prev;
                      const mod = catalog().module(prev.moduleId);
                      if (mod === undefined || mod.faction !== f) {
                        return { kind: "scaffold-armor" };
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
                      <Button
                        size="xs"
                        variant={brush.kind === "scaffold-armor" ? "filled" : "light"}
                        onClick={() => setBrush({ kind: "scaffold-armor" })}
                        title="Solid, impassable armor plate — high HP/mass, no equipment, no walkable surface"
                      >
                        armor
                      </Button>
                      <Button
                        size="xs"
                        variant={brush.kind === "scaffold-deck" ? "filled" : "light"}
                        color="yellow"
                        onClick={() => setBrush({ kind: "scaffold-deck" })}
                        title="Walkable crew floor — corridors and equipment-mounting surface"
                      >
                        deck
                      </Button>
                      <Button
                        size="xs"
                        variant={brush.kind === "scaffold-bare" ? "filled" : "light"}
                        color="gray"
                        onClick={() => setBrush({ kind: "scaffold-bare" })}
                        title="Low-mass framing — scaffold-connected, not walkable"
                      >
                        bare
                      </Button>
                    </Group>
                    <Select
                      label="Equipment"
                      placeholder="Pick a module to mount on deck"
                      data={moduleDefs.map((m) => ({
                        value: m.id,
                        label: `${m.name} — ${m.cost} pts`,
                      }))}
                      value={brush.kind === "equipment" ? brush.moduleId : null}
                      onChange={(moduleId) =>
                        moduleId !== null && setBrush({ kind: "equipment", moduleId })
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
                    source: "user",
                    revision: 1,
                    shipStance: "balanced",
                    crewPriority: "combat",
                    rules: [],
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

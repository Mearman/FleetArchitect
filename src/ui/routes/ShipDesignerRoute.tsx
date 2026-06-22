import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Collapse,
  Group,
  NumberInput,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconCopy,
  IconDeviceFloppy,
  IconHistory,
  IconLock,
  IconMinus,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { computeCompartments } from "@/domain/interior";
import { analyseShipDesign } from "@/domain/stats";
import { createId, nowIso } from "@/domain/id";
import { catalog } from "@/data/catalog";
import { cellAt } from "@/domain/grid";
import { AnnunciatorButton } from "@/ui/components/Annunciator";
import { CassettePanel } from "@/ui/components/CassettePanel";
import { FaultList } from "@/ui/components/FaultList";
import { panelLabel, panelScrews } from "@/ui/components/panel.css";
import { bezelGroup, bezelStrip, screenChassis } from "@/ui/components/screen.css";
import { ShareButton } from "@/ui/components/ShareButton";
import { ShipBrowser } from "@/ui/components/ShipBrowser";
import { StatReadout } from "@/ui/components/StatReadout";
import { VersionHistoryPanel } from "@/ui/components/VersionHistoryPanel";
import { CrtScreen } from "@/ui/fx/CrtScreen";
import { screenPowerOn } from "@/ui/fx/CrtOverlay.css";
import { hardwareKey, hardwareKeySmall } from "@/ui/theme/controls.css";
import { useShipDesigns } from "@/ui/hooks/storage";
import { usePinchZoom } from "@/ui/hooks/usePinchZoom";
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
import {
  actionBar,
  actionBarLeft,
  actionBarRight,
  controlRow,
  designerCentre,
  designerConsole,
  designerGridChassis,
  designerRouteRoot,
  designerTitleStrip,
  designerWing,
  designerWingBody,
  zoomInner,
  zoomScreen,
  zoomViewport,
} from "./ShipDesignerRoute.css";

/** Zoom range for the pan/zoom viewport, as a fraction of natural size. */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.1;
const ZOOM_DEFAULT = 1;

/** Nominal cell pitch (cell + 2px gap) used to size the zoomable inner wrapper. */
const CELL_PITCH_PX = 44;

export function ShipDesignerRoute() {
  const designs = useShipDesigns();
  const factions = catalog().factions();
  const [working, setWorking] = useState<WorkingDesign>(() => blankDesign());
  const [brush, setBrush] = useState<Brush>({ kind: "substrate-deck" });
  const [selected, setSelected] = useState<{ col: number; row: number } | null>(
    null,
  );
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  // Trackpad pinch-to-zoom; two-finger scroll pans via the viewport's native
  // overflow. The ref attaches to the scroll viewport below.
  const viewportRef = usePinchZoom(setZoom, ZOOM_MIN, ZOOM_MAX, zoom);
  const [showAirtightness, setShowAirtightness] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revisions, setRevisions] = useState<ShipDesign[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  /** Modules available for the current design's faction. */
  const moduleDefs = catalog().modulesForFaction(working.faction);

  /** Whether the working design is read-only (a preset). Copy is the only way
   *  to make changes to a preset. */
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

  /** Breached-compartment cells, derived from the layered-cell flood-fill. */
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

  /** Paint a whole cell with the active cell-brush. */
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

  /** Paint an edge of the cell at (col, row) on side `dir`. */
  function paintEdge(col: number, row: number, dir: "n" | "e" | "s" | "w") {
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
      const connections = prev.grid.connections.filter(
        (cn) =>
          cn.from.col < cols &&
          cn.from.row < rows &&
          cn.to.col < cols &&
          cn.to.row < rows,
      );
      return { ...prev, grid: { cols, rows, cells, connections } };
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

  /** Load a design into the working state, preserving its provenance. */
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

  /** Copy the working design to a new editable user record. */
  async function copyAndLoad() {
    const sourceId = working.id;
    if (sourceId === null) {
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
    const list = await listDesignRevisions(id);
    setRevisions(list);
    setHistoryLoading(false);
  }

  async function restoreRevision(revision: number) {
    if (working.id === null) return;
    const restored = await restoreDesignRevision(working.id, revision);
    load(restored);
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

  const innerWidthPx = grid.cols * CELL_PITCH_PX * zoom;

  // Delete action rendered per-card in the ShipBrowser (user designs only).
  function renderDeleteAction(design: ShipDesign) {
    if (design.source === "preset") return null;
    return (
      <Tooltip label="Delete">
        <ActionIcon
          className={hardwareKeySmall}
          color="red"
          variant="subtle"
          size="sm"
          aria-label={`Delete design ${design.name}`}
          onClick={() => void remove(design.id)}
        >
          <IconTrash size={12} />
        </ActionIcon>
      </Tooltip>
    );
  }

  /** Left wing content: grouped ship browser + New button. */
  const leftWing = (
    <Stack gap="sm" h="100%">
      <Button
        className={hardwareKey}
        size="xs"
        variant="default"
        leftSection={<IconPlus size={14} />}
        onClick={() => setWorking(blankDesign())}
        fullWidth
      >
        New
      </Button>
      <ScrollArea.Autosize mah={600} offsetScrollbars style={{ flex: 1 }}>
        <ShipBrowser
          designs={designs}
          selectedId={working.id}
          onSelect={load}
          renderAction={renderDeleteAction}
          emptyLabel="No saved designs yet. Build one and save it."
        />
      </ScrollArea.Autosize>
    </Stack>
  );

  /** Right wing content: palette + behaviour + stats/faults + selected-cell config. */
  const rightWing = (
    <Stack gap="md">
      <div className={panelLabel}>Palette</div>
      <DesignerPalette
        brush={brush}
        onChange={setBrush}
        modules={moduleDefs}
        readOnly={readOnly}
      />
      <div className={panelLabel} style={{ marginTop: 8 }}>Behaviour</div>
      <BehaviourPanel
        shipStance={working.shipStance}
        crewPriority={working.crewPriority}
        rules={working.rules}
        readOnly={readOnly}
        onStanceChange={(s) => setWorking((prev) => ({ ...prev, shipStance: s }))}
        onPriorityChange={(p) => setWorking((prev) => ({ ...prev, crewPriority: p }))}
        onRulesChange={(r) => setWorking((prev) => ({ ...prev, rules: r }))}
      />

      {/* Selected-cell config panels */}
      {readOnly && (
        <Text size="xs" c="grape">
          This is a bundled preset. Use Copy to edit a duplicate.
        </Text>
      )}
      {selectedCell !== undefined &&
        selectedCell.kind === "solid" &&
        selectedCell.equipment !== undefined &&
        selectedFacing !== undefined && (
          <Stack gap={4}>
            <Text size="xs" c="dimmed">Facing of selected equipment cell</Text>
            <SegmentedControl
              size="xs"
              data={FACINGS}
              value={`${selectedFacing}`}
              onChange={(v) => setSelectedFacing(Number(v))}
            />
          </Stack>
        )}
      {selectedCell !== undefined &&
        selectedCell.kind === "solid" &&
        selectedCell.equipment !== undefined &&
        selectedModuleDef?.effect.kind === "comms" && (
          <CommsConfig
            cell={selectedCell.equipment}
            effect={selectedModuleDef.effect}
            onChannelChange={setSelectedCommsChannel}
            onBearingChange={setSelectedCommsBearing}
            onRangeChange={setSelectedCommsRange}
          />
        )}
      {selectedCell !== undefined &&
        selectedCell.kind === "solid" &&
        selectedCell.equipment !== undefined &&
        selectedModuleDef?.effect.kind === "sensor" && (
          <SensorConfig
            cell={selectedCell.equipment}
            effect={selectedModuleDef.effect}
            onBearingChange={setSelectedSensorBearing}
            onRangeChange={setSelectedSensorRangeSetting}
          />
        )}

      {/* Stats */}
      <CassettePanel label="Stats">
        <StatReadout stats={analysis.stats} />
      </CassettePanel>

      {/* Faults */}
      <CassettePanel label="Faults">
        <FaultList faults={analysis.faults} />
      </CassettePanel>

      {/* Version history */}
      <Collapse expanded={historyOpen}>
        <VersionHistoryPanel
          loading={historyLoading}
          revisions={revisions}
          onRestore={(revision) => void restoreRevision(revision)}
          entityLabel="design"
        />
      </Collapse>
    </Stack>
  );

  /** Centre content: name/faction row + grid chassis (fills) + action bar. */
  const centre = (
    <div className={designerCentre}>
      {/* Name / faction inputs above the chassis */}
      <Group grow align="flex-start" style={{ flexShrink: 0 }}>
        <TextInput
          label="Name"
          value={working.name}
          onChange={(e) => setWorking((prev) => ({ ...prev, name: e.target.value }))}
          placeholder="e.g. Sabre Mk II"
          disabled={readOnly}
        />
        {/* Faction rendered as a segmented picker derived from the faction list */}
        <Stack gap={4}>
          <Text size="xs" c="dimmed">Faction</Text>
          <SegmentedControl
            size="xs"
            data={factions.map((f) => ({ value: f, label: f }))}
            value={working.faction}
            disabled={readOnly}
            onChange={(f) => {
              setBrush((prev) => {
                if (prev.kind !== "equipment") return prev;
                const mod = catalog().module(prev.moduleId);
                if (mod === undefined || mod.faction !== f) {
                  return { kind: "substrate-deck" };
                }
                return prev;
              });
              setWorking((prev) => ({ ...prev, faction: f }));
            }}
          />
        </Stack>
      </Group>

      {/* Grid chassis — fills the available height between the name row and action bar */}
      <Box className={`${screenChassis} ${panelScrews} ${designerGridChassis}`}>
        {/* The scrollable, zoomable grid viewport */}
        <div className={`${zoomScreen} ${screenPowerOn}`}>
          <div ref={viewportRef} className={zoomViewport} style={{ touchAction: "none" }}>
            <div
              className={zoomInner}
              style={{ transform: `scale(${zoom})`, width: innerWidthPx }}
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
          {/* CRT screen effects pinned over the viewport. */}
          <CrtScreen />
        </div>

        {/* Bezel strip — dimension controls + zoom buttons */}
        <Box className={bezelStrip} style={{ flexShrink: 0 }}>
          <div className={`${bezelGroup} ${controlRow}`}>
            <NumberInput
              label="Cols"
              size="xs"
              min={1}
              max={MAX_DIM}
              value={grid.cols}
              disabled={readOnly}
              onChange={(v) => resize(clampDim(v, grid.cols), grid.rows)}
              style={{ width: 70 }}
            />
            <NumberInput
              label="Rows"
              size="xs"
              min={1}
              max={MAX_DIM}
              value={grid.rows}
              disabled={readOnly}
              onChange={(v) => resize(grid.cols, clampDim(v, grid.rows))}
              style={{ width: 70 }}
            />
            <Checkbox
              size="xs"
              label="Airtight"
              checked={showAirtightness}
              onChange={(e) => setShowAirtightness(e.currentTarget.checked)}
            />
          </div>

          <div className={bezelGroup}>
            <Text size="xs" c="dimmed" style={{ fontVariantNumeric: "tabular-nums" }}>
              {zoom.toFixed(1)}×
            </Text>
            <Tooltip label="Zoom out">
              <AnnunciatorButton
                icon={<IconMinus size={12} />}
                aria-label="Zoom out"
                tint="cyan"
                onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
              />
            </Tooltip>
            <Tooltip label="Zoom in">
              <AnnunciatorButton
                icon={<IconPlus size={12} />}
                aria-label="Zoom in"
                tint="cyan"
                onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}
              />
            </Tooltip>
          </div>
        </Box>
      </Box>

      {/* Action bar — pinned at the bottom of the centre column */}
      <div className={actionBar} style={{ flexShrink: 0 }}>
        <div className={actionBarLeft}>
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
              className={hardwareKey}
              variant="filled"
              color="grape"
              leftSection={<IconCopy size={16} />}
              onClick={() => void copyAndLoad()}
            >
              Copy to edit
            </Button>
          ) : (
            <Button
              className={hardwareKey}
              variant="default"
              leftSection={<IconCopy size={16} />}
              onClick={() => void copyAndLoad()}
            >
              Copy design
            </Button>
          )}
        </div>

        {!readOnly && (
          <div className={actionBarRight}>
            {working.id !== null && (
              <Tooltip label="View version history">
                <Button
                  className={hardwareKey}
                  variant="default"
                  data-active={historyOpen ? "true" : undefined}
                  leftSection={<IconHistory size={16} />}
                  onClick={() => void openHistory()}
                >
                  History
                </Button>
              </Tooltip>
            )}
            <Button
              className={hardwareKey}
              variant="default"
              leftSection={<IconDeviceFloppy size={16} />}
              onClick={() => void save()}
            >
              Save design
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className={designerRouteRoot}>
      {/* Slim title strip — replaces the large h1 */}
      <div className={designerTitleStrip}>
        <span>Ship Designer</span>
        {readOnly && (
          <Badge size="sm" color="grape" leftSection={<IconLock size={12} />}>
            Preset — read only
          </Badge>
        )}
      </div>

      {/* Console row: left wing + centre + right wing */}
      <div className={designerConsole}>
        {/* Left wing: ship browser */}
        <CassettePanel label="Your Designs" className={designerWing}>
          <div className={designerWingBody}>{leftWing}</div>
        </CassettePanel>

        {/* Centre: name/faction + grid + action bar */}
        {centre}

        {/* Right wing: palette + behaviour + stats/faults + cell config */}
        <CassettePanel label="Tools" className={designerWing}>
          <div className={designerWingBody}>{rightWing}</div>
        </CassettePanel>
      </div>
    </div>
  );
}

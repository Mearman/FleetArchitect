import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Checkbox,
  Collapse,
  Group,
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
import { useEffect, useMemo, useRef, useState } from "react";
import { computeCompartments } from "@/domain/interior";
import { analyseShipDesign } from "@/domain/stats";
import { growArmourHull } from "@/domain/hull-armour";
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
import type { ShipDesign } from "@/schema/ship";
import type { TileGrid } from "@/schema/grid";
import { type WorkingDesign, FACINGS } from "./designerConstants";
import { blankDesign, contentBox, fitGridCentered, moduleFits } from "./designerGrid";
import { BehaviourPanel } from "./BehaviourPanel";
import { DesignerPalette } from "./DesignerPalette";
import { type BreachSet, GridBoard } from "./GridBoard";
import { useDesignerBrush } from "./useDesignerBrush";
import { useShipDesignUrlSync } from "./useShipDesignUrlSync";
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

/**
 * Zoom range for the grid, as a fraction of natural cell size. Zoom sets the
 * cell pitch; the grid then auto-grows/shrinks to fill the viewport at that
 * pitch, so zooming out expands the buildable area (more, smaller cells) and
 * zooming in contracts it (fewer, larger cells). `ZOOM_MIN` bounds how far the
 * grid can grow on zoom-out.
 */
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.1;
const ZOOM_DEFAULT = 1;

/** Nominal cell pitch used to size the zoomable inner wrapper. */
const CELL_PITCH_PX = 44;

/** Extra empty cells padded around the viewport-covering grid, so the board
 *  always overhangs the viewport by ~1 cell on each side. That overhang gives
 *  the centring transform room to pin the content centre exactly without
 *  exposing a gap at the board edge. */
const FIT_PAD_CELLS = 2;

export function ShipDesignerRoute() {
  const designs = useShipDesigns();
  const factions = catalog().factions();
  const [working, setWorking] = useState<WorkingDesign>(() => blankDesign());
  /** Whether the working design is read-only (a preset). Copy is the only way
   *  to make changes to a preset. Declared early so the brush hook (which the
   *  viewport-fit effect below depends on via `setSelected`) can use it. */
  const readOnly = working.source === "preset";
  // Brush, selection, hover, and the multi-cell-aware paint/erase handlers.
  const {
    brush,
    setBrush,
    selected,
    setSelected,
    hovered,
    setHovered,
    paint,
    paintEdge,
    updateSelectedEquipment,
  } = useDesignerBrush(setWorking, readOnly);
  const [zoom, setZoom] = useState(ZOOM_DEFAULT);
  // Trackpad pinch-to-zoom (two-finger scroll pans natively) plus the viewport's
  // measured size, so the grid can fit-to-fill it at the current cell pitch.
  // View transform inputs: the zoomed cell pitch and the built-content box (its
  // centre keeps the ship centred; its extent bounds panning to the ship edges).
  const cellPx = CELL_PITCH_PX * zoom;
  const {
    ref: attachGridViewport,
    width: viewportW,
    height: viewportH,
    zoomByStep,
    boardTx,
    boardTy,
    resetPan,
  } = usePinchZoom({
    setZoom,
    min: ZOOM_MIN,
    max: ZOOM_MAX,
    cellPx,
    grid: { cols: working.grid.cols, rows: working.grid.rows },
    contentExtent: contentBox(working.grid),
  });
  // Auto-size the grid to fill the viewport (no manual cols/rows): fit it to as
  // many cells as cover the viewport at the current zoomed cell pitch (ceil, so
  // the board fully covers the viewport with no leftover strip), keeping the
  // built content centred. Depends on zoom so zooming out expands the grid (more,
  // smaller cells) and zooming in contracts it (fewer, larger cells), never below
  // the built content. Reads the design via a ref so it doesn't re-fit on every
  // paint (which would yank the content back to centre mid-edit).
  const workingRef = useRef(working);
  useEffect(() => {
    workingRef.current = working;
  });
  useEffect(() => {
    if (viewportW <= 0 || viewportH <= 0) return;
    const cellPx = CELL_PITCH_PX * zoom;
    const cols = Math.max(1, Math.ceil(viewportW / cellPx) + FIT_PAD_CELLS);
    const rows = Math.max(1, Math.ceil(viewportH / cellPx) + FIT_PAD_CELLS);
    const cur = workingRef.current;
    const { grid: fitted, dx, dy } = fitGridCentered(cur.grid, cols, rows);
    if (
      fitted.cols === cur.grid.cols &&
      fitted.rows === cur.grid.rows &&
      dx === 0 &&
      dy === 0
    ) {
      return;
    }
    setWorking({ ...cur, grid: fitted });
    if (dx !== 0 || dy !== 0) {
      setSelected((s) => (s === null ? null : { col: s.col + dx, row: s.row + dy }));
    }
  }, [viewportW, viewportH, zoom, setSelected]);
  // Mirror the working design to/from the URL so the address bar is the
  // shareable design (`load` is a hoisted declaration below).
  useShipDesignUrlSync(working, load);
  const [showAirtightness, setShowAirtightness] = useState(true);
  // Flat top-down editing vs an isometric 2.5D tilt (GridBoard applies the CSS
  // transform and inverts the same matrix when hit-testing paints).
  const [view, setView] = useState<"2d" | "iso">("2d");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revisions, setRevisions] = useState<ShipDesign[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  /** Modules available for the current design's faction. */
  const moduleDefs = catalog().modulesForFaction(working.faction);

  /** The active equipment brush's polyomino footprint (1+ cells), or null when
   *  no equipment brush is active. Drag-paint is suppressed for multi-cell
   *  modules (footprint > 1) so a drag stroke cannot stamp overlapping
   *  polyominoes; single-cell modules keep drag-paint. */
  const equipmentFootprint = brush.kind === "equipment"
    ? catalog().module(brush.moduleId)?.footprint
    : undefined;
  const dragPaints = equipmentFootprint === undefined || equipmentFootprint.length === 1;

  /** Placement preview ghost: the cells the active equipment module would
   *  occupy anchored at the hovered cell, and whether they fit. Null when no
   *  equipment brush is active or nothing is hovered. The fit check runs against
   *  the authored `working.grid` (not the armour-padded display grid). */
  const ghost = useMemo(() => {
    if (brush.kind !== "equipment" || hovered === null) return null;
    const def = catalog().module(brush.moduleId);
    if (def === undefined) return null;
    return {
      cells: def.footprint.map(({ dx, dy }) => ({ col: hovered.col + dx, row: hovered.row + dy })),
      fits: moduleFits(working.grid, hovered.col, hovered.row, def),
    };
  }, [brush, hovered, working.grid]);

  // Display grid: armour grown in-place (no padding, same coordinate space as
  // working.grid) so GridBoard shows the auto-derived armour ring. Painting and
  // saving still target `working.grid` directly — the armour is never persisted.
  const displayGrid = useMemo(() => growArmourHull(working.grid), [working.grid]);

  const analysis = useMemo(() => {
    // analyseShipDesign reads only grid and faction; the remaining ShipDesign
    // fields are required by the type but ignored by the analysis, so stable
    // placeholders keep the dependency array narrow. Keying on the whole working
    // object would recompute on every keystroke (name) and doctrine-panel change.
    const design: ShipDesign = {
      id: "draft",
      name: "Draft",
      faction: working.faction || "Unaligned",
      grid: working.grid,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      source: "user",
      revision: 1,
      doctrine: { base: {}, rules: [] },
    };
    return analyseShipDesign(design, catalog());
  }, [working.grid, working.faction]);

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
      doctrine: working.doctrine,
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

  /** Re-fit a grid to fill the current viewport at the zoomed cell pitch, centred.
   *  No-op until the viewport has been measured. Shared by `load` and `newDesign` so
   *  both land a viewport-filling grid instead of showing at the design's own size. */
  function fitToViewport(grid: TileGrid): TileGrid {
    if (viewportW <= 0 || viewportH <= 0) return grid;
    return fitGridCentered(
      grid,
      Math.max(1, Math.ceil(viewportW / cellPx) + FIT_PAD_CELLS),
      Math.max(1, Math.ceil(viewportH / cellPx) + FIT_PAD_CELLS),
    ).grid;
  }

  /** Start a fresh blank design, fitted to the viewport like a loaded one. */
  function newDesign() {
    const blank = blankDesign();
    setWorking({ ...blank, grid: fitToViewport(blank.grid) });
    setSelected(null);
    resetPan();
  }

  /** Load a design into the working state, preserving its provenance. The grid
   *  is re-fit to the current viewport (centred) so a loaded design fills the
   *  canvas like a new one, instead of showing at its saved size. */
  function load(design: ShipDesign) {
    setWorking({
      id: design.id,
      createdAt: design.createdAt,
      name: design.name,
      faction: design.faction,
      grid: fitToViewport(design.grid),
      source: design.source,
      doctrine: design.doctrine,
    });
    setSelected(null);
    resetPan();
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
    selectedCell?.kind === "solid" && selectedCell.equipment?.moduleId !== undefined
      ? catalog().module(selectedCell.equipment.moduleId)
      : undefined;
  const selectedFacing =
    selectedCell?.kind === "solid" && selectedCell.equipment?.moduleId !== undefined
      ? selectedCell.equipment.facing
      : undefined;

  // The grid auto-sizes to cover the viewport at the zoomed cell pitch (see the
  // fit effect above), so the inner wrapper is exactly the grid's pixel width.
  // `boardTx`/`boardTy` (from usePinchZoom) centre the board and apply the pan.
  const innerWidthPx = displayGrid.cols * cellPx;

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
        onClick={() => {
          newDesign();
        }}
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
        doctrine={working.doctrine}
        readOnly={readOnly}
        onDoctrineChange={(d) => setWorking((prev) => ({ ...prev, doctrine: d }))}
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
              onChange={(v) => updateSelectedEquipment({ facing: Number(v) })}
            />
          </Stack>
        )}
      {selectedCell !== undefined &&
        selectedCell.kind === "solid" &&
        selectedCell.equipment?.moduleId !== undefined &&
        selectedModuleDef?.effect.kind === "comms" && (
          <CommsConfig
            cell={selectedCell.equipment}
            effect={selectedModuleDef.effect}
            onChannelChange={(channel) => updateSelectedEquipment({ channel })}
            onBearingChange={(commsBearing) => updateSelectedEquipment({ commsBearing })}
            onRangeChange={(commsRange) => updateSelectedEquipment({ commsRange })}
          />
        )}
      {selectedCell !== undefined &&
        selectedCell.kind === "solid" &&
        selectedCell.equipment?.moduleId !== undefined &&
        selectedModuleDef?.effect.kind === "sensor" && (
          <SensorConfig
            cell={selectedCell.equipment}
            effect={selectedModuleDef.effect}
            onBearingChange={(sensorBearing) => updateSelectedEquipment({ sensorBearing })}
            onRangeChange={(sensorRangeSetting) => updateSelectedEquipment({ sensorRangeSetting })}
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
          <div
            ref={attachGridViewport}
            className={zoomViewport}
            style={{ touchAction: "none" }}
          >
            <div
              className={zoomInner}
              style={{ width: innerWidthPx, transform: `translate(${boardTx}px, ${boardTy}px)` }}
            >
              <GridBoard
                grid={displayGrid}
                selected={selected}
                breached={breached}
                showAirtightness={showAirtightness}
                view={view}
                cellPx={cellPx}
                dragPaints={dragPaints}
                ghost={ghost}
                onPaint={paint}
                onEdge={paintEdge}
                onMoveCursor={(col, row) => setSelected({ col, row })}
                onHover={setHovered}
              />
            </div>
          </div>
          {/* CRT screen effects pinned over the viewport. */}
          <CrtScreen />
        </div>

        {/* Bezel strip — view controls (grid auto-sizes to the viewport). */}
        <Box className={bezelStrip} style={{ flexShrink: 0 }}>
          <div className={`${bezelGroup} ${controlRow}`}>
            <Checkbox
              size="xs"
              label="Airtight"
              checked={showAirtightness}
              onChange={(e) => setShowAirtightness(e.currentTarget.checked)}
            />
            <SegmentedControl
              size="xs"
              value={view}
              onChange={(v) => {
                setView(v === "iso" ? "iso" : "2d");
              }}
              data={[
                { label: "2D", value: "2d" },
                { label: "2.5D", value: "iso" },
              ]}
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
                onClick={() => zoomByStep(-ZOOM_STEP)}
              />
            </Tooltip>
            <Tooltip label="Zoom in">
              <AnnunciatorButton
                icon={<IconPlus size={12} />}
                aria-label="Zoom in"
                tint="cyan"
                onClick={() => zoomByStep(ZOOM_STEP)}
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
                doctrine: working.doctrine,
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

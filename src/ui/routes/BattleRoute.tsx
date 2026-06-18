import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Center,
  Collapse,
  Group,
  Loader,
  NativeSelect,
  NumberInput,
  Paper,
  Progress,
  SegmentedControl,
  Slider,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconArrowsShuffle,
  IconFocus2,
  IconLayoutSidebarRightExpand,
  IconMaximize,
  IconPlayerPause,
  IconPlayerPlay,
  IconRefresh,
  IconSettings,
  IconSwords,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { resolveFleetToCombatShips } from "@/domain/resolve";
import { CELL_SIZE } from "@/domain/grid";
import { DEFAULT_MAX_TICKS, TICKS_PER_SECOND } from "@/domain/simulation/types";
import { battleRunner } from "@/ui/battleRunner";
import { catalog } from "@/data/catalog";
import { useFleets, useShipDesigns } from "@/ui/hooks/storage";
import { storage } from "@/storage/db";
import { BattleAnomaly } from "@/schema/battle";
import type { BattleAnomaly as BattleAnomalyType, BattleFrame, BattleResult } from "@/schema/battle";
import type { Fleet } from "@/schema/fleet";
import type { WeaponType } from "@/schema/module";
import { interpolateFrame } from "@/ui/interpolateFrame";
import { drawAnomaly } from "./battleAnomaly";
import {
  clampZoom,
  DEFAULT_CAMERA,
  pickShipAt,
  resolveTransform,
  screenToWorld,
} from "./battleCamera";
import type { Bounds, Camera } from "./battleCamera";
import * as styles from "./BattleRoute.css";

const PROJECTILE_COLOUR: Record<WeaponType, string> = {
  beam: "#ffe066",
  cannon: "#e8e8f5",
  missile: "#ff9a3c",
  torpedo: "#ff5a5a",
  plasma: "#e06bff",
};

/** Per-module part colour, by module kind, for the battle canvas. */
const MODULE_COLOUR: Record<string, string> = {
  weapon: "#ff8c5a",
  shield: "#6ea8ff",
  armour: "#b0b0c0",
  engine: "#7bd88f",
  power: "#ffe066",
  crew: "#c792ff",
  hull: "#5a6172",
  magazine: "#e8a550",
  pointDefense: "#ff8c5a",
  repair: "#80d4a0",
};

/**
 * Crew dot colour by state, drawn in ship-local space.
 * Walking and hauling use a brighter tint to make movement legible;
 * manning shows green (on-station); injured shows red.
 */
const CREW_COLOUR: Record<string, string> = {
  idle: "#b0b0b8",
  walking: "#a0d4ff",
  hauling: "#ffe066",
  manning: "#7bd88f",
  injured: "#ff5a5a",
};

/** Accent dot colour for what a hauling crew member is carrying. */
const CARRYING_COLOUR: Record<string, string> = {
  power: "#ffe066",
  ammo: "#ff9a3c",
};

const DEFAULT_BOUNDS: Bounds = { minX: -700, maxX: 700, minY: -430, maxY: 430 };

/**
 * Exponential-moving-average weight for the measured simulation rate (ticks
 * computed per real second). Each batch nudges the estimate towards its instant
 * rate by this fraction, smoothing the spiky per-batch timings without lagging
 * far behind a genuine change in compute speed.
 */
const SIM_RATE_EMA_WEIGHT = 0.3;

/**
 * How many real seconds of uninterrupted playback to buffer for before resuming
 * once playback has stalled at the leading edge. When the simulation is slower
 * than playback this sets how much lead to accumulate, trading a longer single
 * rebuffer for fewer stop-start stutters (the streaming-video rebuffer model).
 */
const REBUFFER_TARGET_SECONDS = 3;

/**
 * Minimum lead (in playback seconds) required to (re)start playback at the
 * leading edge when the simulation is keeping up. A small cushion so a single
 * slow batch does not immediately stall playback again.
 */
const MIN_RESUME_LEAD_SECONDS = 0.3;

/**
 * Resume threshold in playback seconds: how far the streamed leading edge must
 * be ahead of the playhead before playback (re)starts. Driven by the measured
 * simulation rate versus the playback consumption rate. When the sim keeps up
 * (rate >= playback rate) a minimal cushion suffices; when it lags, buffer
 * enough lead to sustain `REBUFFER_TARGET_SECONDS` of smooth playback before the
 * playhead would next catch the edge.
 */
function resumeLeadSeconds(simTickRate: number, playbackTickRate: number): number {
  if (simTickRate <= 0 || simTickRate >= playbackTickRate) {
    return MIN_RESUME_LEAD_SECONDS;
  }
  // Net ticks the buffer drains per real second while playing (playback consumes
  // faster than the sim produces). The lead must cover the whole rebuffer window.
  const drainPerSecond = playbackTickRate - simTickRate;
  const neededTicks = drainPerSecond * REBUFFER_TARGET_SECONDS;
  return Math.max(MIN_RESUME_LEAD_SECONDS, neededTicks / TICKS_PER_SECOND);
}

const ANOMALY_LABEL: Record<BattleAnomalyType, string> = {
  none: "Open space",
  asteroidField: "Asteroid field",
  nebula: "Nebula",
  blackHole: "Black hole",
};

const MODULE_LABEL: Record<string, string> = {
  weapon: "Weapon",
  shield: "Shield",
  armour: "Armour",
  engine: "Engine",
  power: "Power",
  crew: "Crew",
};

/**
 * Per-module status readout for the current frame: each ship's modules as a
 * row of HP bars, so you can watch systems fail as the battle wears on.
 */
function ModuleStatusPanel({ frame }: { frame: BattleFrame }) {
  const withModules = frame.ships.filter((s) => s.modules !== undefined && s.modules.length > 0);
  if (withModules.length === 0) return null;
  return (
    <Paper p="sm" withBorder>
      <Stack gap={6}>
        <Text size="xs" c="dimmed" fw={600}>
          Modules
        </Text>
        {withModules.map((s) => {
          const sideColour = s.side === "attacker" ? "#ff6b5a" : "#5ab0ff";
          return (
            <Group key={s.instanceId} gap="xs" wrap="nowrap" align="center">
              <Box
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: s.alive ? sideColour : "transparent",
                  border: `1px solid ${sideColour}`,
                  flex: "0 0 auto",
                }}
              />
              <Group gap={4} wrap="wrap" style={{ flex: 1 }}>
                {s.modules?.map((m) => {
                  const frac = m.maxHp > 0 ? Math.max(0, m.hp / m.maxHp) : 0;
                  return (
                    <Tooltip
                      key={m.slotId}
                      label={`${MODULE_LABEL[m.kind] ?? m.kind}: ${Math.round(m.hp)}/${m.maxHp}`}
                    >
                      <Box style={{ width: 34 }}>
                        <Progress
                          size={5}
                          value={m.alive ? frac * 100 : 0}
                          color={m.alive ? "teal" : "gray"}
                        />
                      </Box>
                    </Tooltip>
                  );
                })}
              </Group>
            </Group>
          );
        })}
      </Stack>
    </Paper>
  );
}

export function BattleRoute() {
  const fleets = useFleets();
  const designs = useShipDesigns();
  const [attackerId, setAttackerId] = useState<string | null>(null);
  const [defenderId, setDefenderId] = useState<string | null>(null);
  const [anomaly, setAnomaly] = useState<BattleAnomalyType>("none");
  const [seed, setSeed] = useState(1);

  /**
   * The full, final BattleResult. Set only when the run promise resolves; used
   * for the winner badge, persistence, and the terminal stop-at-end behaviour.
   * Playback no longer waits on this — it reads streamed frames from `framesRef`
   * as soon as the first batch lands.
   */
  const [result, setResult] = useState<BattleResult | null>(null);

  /**
   * Streamed frames, accumulated batch by batch as the worker produces them.
   * Held in a ref (not state) so appending a batch is O(batch) and never forces
   * an array copy; the rAF loop, pointer handlers, and redraw effects read
   * `framesRef.current` directly (all non-render contexts, where reading a ref
   * is legitimate). Render never touches the ref: the facts render needs are
   * mirrored into state below as each batch lands.
   */
  const framesRef = useRef<BattleFrame[]>([]);

  /**
   * Number of frames streamed so far, mirrored from `framesRef` on each batch.
   * Drives `hasFrames` and bounds-checks in the render path without reading the
   * ref during render.
   */
  const [frameCount, setFrameCount] = useState(0);

  /**
   * The tick-0 deployment frame, captured once when the first batch lands. The
   * full per-ship structure/shield maxima are taken from it for the HP bars, so
   * render reads this state rather than indexing `framesRef.current[0]`.
   */
  const [deploymentFrame, setDeploymentFrame] = useState<BattleFrame | null>(null);

  /**
   * Highest tick streamed so far. While computing this is the leading edge of
   * playable time; once the final `result` lands the authoritative tick count
   * is `result.ticks` (the two agree at completion).
   */
  const [computedTicks, setComputedTicks] = useState(0);

  /**
   * True when the playback clock has caught up to the streamed leading edge and
   * is waiting for more frames to compute. Distinct from paused: the clock is
   * clamped to the leading edge but playback is still "on" and resumes
   * automatically as soon as more frames arrive.
   */
  const [buffering, setBuffering] = useState(false);

  /**
   * Running world bounds (raw, unpadded), expanded as each batch arrives so the
   * camera widens to follow the spreading battle rather than snapping to the
   * final extent. Held in state so the padded `bounds` memo recomputes whenever
   * the extent grows; the `onFrames` handler reads the current value and sets a
   * fresh object when the extent changes. The padded transform applies the same
   * 8% + 40 padding as the original all-frames pass.
   */
  const [rawBounds, setRawBounds] = useState<Bounds | null>(null);

  /**
   * AbortController for the in-flight run. Aborted when a new battle starts so a
   * stale stream can never feed frames into the new run's accumulator.
   */
  const runAbortRef = useRef<AbortController | null>(null);

  /**
   * Measured simulation rate in ticks computed per real second, as an EMA over
   * batch arrivals (0 until two batches have landed). Compared against the
   * playback consumption rate to decide how much lead to buffer before resuming
   * playback at the streamed leading edge.
   */
  const simTickRateRef = useRef(0);
  /** Arrival time (ms) and tick count of the previous batch, for the rate EMA. */
  const lastBatchRef = useRef<{ timeMs: number; ticks: number } | null>(null);
  /**
   * Whether playback is currently stalled at the leading edge waiting for the
   * buffer to refill. Held in a ref so the rAF loop carries the buffering state
   * across frames (hysteresis): once stalled it stays stalled until the lead
   * reaches `resumeLeadSeconds`, rather than flip-flopping every frame.
   */
  const bufferingRef = useRef(false);

  /**
   * Playback clock: elapsed playback-time in seconds, independent of rAF rate
   * and display refresh. Fractional sim-tick = playbackTime × TICKS_PER_SECOND.
   * Stored in a ref so the rAF callback reads the live value without needing a
   * re-render on every frame. Updated in effects only (never during render).
   */
  const playbackTimeRef = useRef(0);
  /**
   * playbackTime mirrored as state so the seeker Slider and tick counter stay
   * in sync with the playback clock without an additional ref-to-state dance.
   */
  const [playbackTime, setPlaybackTime] = useState(0);

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [computing, setComputing] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);

  /**
   * Camera state drives the world-to-display transform. `zoom` multiplies the
   * auto-fit scale; `panX`/`panY` shift the focus; `followId` pins the focus to
   * a ship. Kept in a ref as well so the rAF draw loop reads the live camera
   * without the effect needing `camera` in its dependency list (which would
   * restart the loop and reset the frame clock on every wheel tick or drag).
   */
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  const cameraRef = useRef<Camera>(camera);
  // Mirror the live camera into a ref so the rAF draw loop and pointer handlers
  // read the current value without `camera` in their dependency lists. Synced in
  // an effect (never during render) per the react-hooks/refs rule.
  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  // Abort any in-flight run when the route unmounts so a stream can't keep
  // appending frames into a torn-down component.
  useEffect(() => () => runAbortRef.current?.abort(), []);

  /** Whether the setup panel and module-status overlay are shown. */
  const [setupOpen, setSetupOpen] = useState(true);
  const [statusOpen, setStatusOpen] = useState(false);

  /** Pointer-drag state for panning, tracked in a ref to avoid re-renders. */
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  const fleetOptions = useMemo(
    () => (fleets ?? []).map((f) => ({ value: f.id, label: f.name })),
    [fleets],
  );

  /**
   * Whether any frames have streamed in yet. The canvas stage and all the
   * draw/playback machinery key off this rather than `result`, so playback can
   * begin the moment the first batch arrives — long before the final result
   * resolves. Derived from `frameCount` state, which the first batch flips from
   * zero, rather than reading the frames ref during render.
   */
  const hasFrames = frameCount > 0;

  /** Authoritative max tick: the streamed leading edge while computing, the
   *  final tick count once the result has landed. */
  const maxTick = result !== null ? result.ticks : computedTicks;

  // Padded view bounds, derived from the running min/max accumulated in the
  // onFrames handler. Recomputed whenever the raw extent grows (a fresh
  // `rawBounds` object), so the camera expands as the battle spreads instead of
  // being computed once over all frames. Same 8% + 40 padding as the original
  // all-frames pass.
  const bounds = useMemo<Bounds>(() => {
    if (rawBounds === null || !Number.isFinite(rawBounds.minX)) return DEFAULT_BOUNDS;
    const padX = (rawBounds.maxX - rawBounds.minX) * 0.08 + 40;
    const padY = (rawBounds.maxY - rawBounds.minY) * 0.08 + 40;
    return {
      minX: rawBounds.minX - padX,
      maxX: rawBounds.maxX + padX,
      minY: rawBounds.minY - padY,
      maxY: rawBounds.maxY + padY,
    };
  }, [rawBounds]);

  /**
   * The anomaly baked into the running replay. Captured at battle start (the
   * value passed to `startBattle`) so the rendered anomaly matches the simulated
   * physics from the first streamed frame, before the final result — with its
   * `config.anomaly` — has landed. Reconciled against the result on completion.
   */
  const [runningAnomaly, setRunningAnomaly] = useState<BattleAnomalyType>("none");
  const activeAnomaly: BattleAnomalyType = result?.config.anomaly ?? runningAnomaly;

  /**
   * Per-ship full structure/shield, taken from the deployment frame captured on
   * the first batch. Re-derived only when that frame changes (a fresh run), so
   * the HP bars are correct from the moment progressive playback begins.
   */
  const maxHp = useMemo(() => {
    const map = new Map<string, { structure: number; shield: number }>();
    if (deploymentFrame !== null) {
      for (const s of deploymentFrame.ships) {
        map.set(s.instanceId, { structure: s.structure, shield: s.shield });
      }
    }
    return map;
  }, [deploymentFrame]);

  // Derive the integer tick for the Slider and tick counter from playbackTime,
  // clamped to the playable ceiling: the streamed leading edge while computing,
  // the final tick count once the result has landed.
  const currentTick = hasFrames
    ? Math.min(maxTick, Math.floor(playbackTime * TICKS_PER_SECOND))
    : 0;

  // The status panel uses the discrete-nearest frame since it shows system HP
  // values, not positions — there is no meaningful interpolation for HP. It is
  // selected inside the rAF loop below (a legitimate non-render context for
  // reading `framesRef`) and mirrored here, updated only when the integer tick
  // changes so it does not re-render every animation frame. It is left stale
  // while the panel is closed — render gates on `statusOpen` — and refreshed
  // within one frame of reopening.
  const [statusFrame, setStatusFrame] = useState<BattleFrame | null>(null);

  // Keep the canvas backing store matched to its CSS display size, with a DPR
  // multiplier for crisp lines. Without this the backing is the HTML default
  // 300×150 regardless of how big the canvas renders, and the browser scales
  // that tiny bitmap up to fill the box — a blurry smear. The effect depends
  // on `hasFrames` so it (re)runs when the canvas first mounts as the first
  // streamed batch lands.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const setBacking = () => {
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (cw === 0 || ch === 0) return;
      const desiredW = cw * dpr;
      const desiredH = ch * dpr;
      // Only resize the backing when it actually changed — assigning to
      // canvas.width clears the bitmap, so guarding avoids a blank flash
      // when a new battle reuses the same-sized canvas element.
      if (canvas.width !== desiredW) canvas.width = desiredW;
      if (canvas.height !== desiredH) canvas.height = desiredH;
    };
    setBacking();
    const observer = new ResizeObserver(() => {
      setBacking();
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (cw === 0 || ch === 0) return;
      setCanvasSize({ width: cw, height: ch });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [hasFrames]);

  /**
   * Pure draw function: renders `frame` onto the canvas. Separated from the
   * clock-advance so resize events and seek operations can redraw without
   * advancing the playback clock.
   *
   * Closes over `bounds`, `maxHp` and `anomaly` from the enclosing render
   * scope, plus the live camera via `cameraRef`. `bounds`/`maxHp`/`anomaly` are
   * stable for a given `result`, so `drawFrame` is re-created only when those
   * change; reading the camera from the ref keeps drawing responsive to zoom and
   * pan without re-creating the callback (and so without restarting the loop).
   */
  const drawFrame = useCallback(
    (frame: BattleFrame) => {
      const canvas = canvasRef.current;
      if (canvas === null) return;
      const ctx = canvas.getContext("2d");
      if (ctx === null) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0) return;
      ctx.clearRect(0, 0, width, height);

      // When following a ship, the focus point is that ship's live position in
      // this frame, so the camera tracks it. The follow ship may have died or
      // not yet appeared; fall back to centre-pan in that case.
      const cam = cameraRef.current;
      const followPos =
        cam.followId !== null
          ? frame.ships.find((s) => s.instanceId === cam.followId)
          : undefined;
      const t = resolveTransform(width, height, bounds, cam, followPos);
      const scale = t.scale;
      const sx = t.sx;
      const sy = t.sy;

      // Anomaly is drawn first, in world space, beneath everything else.
      drawAnomaly(ctx, activeAnomaly, t, bounds);

      for (const p of frame.projectiles) {
        const colour = PROJECTILE_COLOUR[p.kind];
        if (colour === undefined) continue;
        ctx.fillStyle = colour;
        ctx.fillRect(sx(p.x) - 1, sy(p.y) - 1, 2.5, 2.5);
      }

      for (const s of frame.ships) {
        const px = sx(s.x);
        const py = sy(s.y);
        const base = s.side === "attacker" ? "#ff6b5a" : "#5ab0ff";
        const max = maxHp.get(s.instanceId);

        if (!s.alive) {
          ctx.globalAlpha = 0.2;
          ctx.fillStyle = base;
          ctx.beginPath();
          ctx.arc(px, py, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          continue;
        }

        // Shield bubble radius: encircle the hull, so a big ship's shield ring
        // sits outside its cells rather than buried inside them. Derived from
        // the farthest cell from the ship centre (display pixels), falling back
        // to a small fixed ring for legacy ships with no cell data.
        let hullRadiusPx = 11;
        if (s.modules !== undefined && s.modules.length > 0) {
          let maxDistSq = 0;
          for (const m of s.modules) {
            const d = m.x * m.x + m.y * m.y;
            if (d > maxDistSq) maxDistSq = d;
          }
          hullRadiusPx = (Math.sqrt(maxDistSq) + CELL_SIZE) * scale + 3;
        }

        const maxShield = max?.shield ?? s.shield;
        if (maxShield > 0) {
          const frac = Math.max(0, s.shield / maxShield);
          if (frac > 0) {
            ctx.strokeStyle = "rgba(120,200,255,0.65)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(px, py, hullRadiusPx, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
            ctx.stroke();
          }
        }

        // Per-cell hull: each module/hull cell is drawn as a square the true
        // size of a grid cell (CELL_SIZE world units), positioned at its world
        // location (ship centre + the cell's local offset rotated by the ship's
        // facing) and rotated to match. This makes a ship read as its actual
        // sculpted silhouette and scale rather than a dot — a dreadnought
        // genuinely dwarfs a fighter on the canvas. Cells are tinted toward the
        // side colour so faction allegiance stays legible at a glance. Destroyed
        // cells go dark with a cross; turreted weapons draw a tracking barrel.
        if (s.modules !== undefined && s.facing !== undefined) {
          // Cell edge length in display pixels (world CELL_SIZE through the
          // current world-to-display scale). Floored so distant fleets still
          // show a visible hull rather than collapsing to sub-pixel specks.
          const cellPx = Math.max(2, CELL_SIZE * scale);
          const half = cellPx / 2;
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(s.facing);
          for (const m of s.modules) {
            // Cell centre in ship-local display space (local world offset times
            // the scale); the surrounding translate/rotate places it in world.
            const lx = m.x * scale;
            const ly = m.y * scale;
            const colour = MODULE_COLOUR[m.kind];
            if (colour === undefined) continue;

            // Supply/manning dimming: a crewed station that is unmanned, or a
            // module that has run out of ammo or charge, is rendered at reduced
            // opacity so the player can see supply problems at a glance. Only
            // applied to alive modules — destroyed cells use the existing 0.18 path.
            const hasCrewReq =
              m.kind === "weapon" ||
              m.kind === "engine" ||
              m.kind === "shield" ||
              m.kind === "power" ||
              m.kind === "pointDefense" ||
              m.kind === "repair";
            const starvedAmmo = m.ammo !== undefined && m.ammo === 0;
            const starvedCharge = m.charge !== undefined && m.charge === 0;
            const unmanned = hasCrewReq && m.manned === false;
            const isStarved = starvedAmmo || starvedCharge || unmanned;

            ctx.globalAlpha = m.alive ? (isStarved ? 0.45 : 1) : 0.18;
            ctx.fillStyle = colour;
            ctx.fillRect(lx - half, ly - half, cellPx, cellPx);

            // A faint side-coloured inset keeps adjacent cells distinct and
            // tints the whole hull toward its allegiance colour.
            ctx.globalAlpha = m.alive ? (isStarved ? 0.1 : 0.22) : 0.1;
            ctx.fillStyle = base;
            ctx.fillRect(lx - half, ly - half, cellPx, cellPx);

            if (!m.alive) {
              ctx.globalAlpha = 0.35;
              ctx.strokeStyle = "rgba(255,255,255,0.4)";
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(lx - half * 0.6, ly - half * 0.6);
              ctx.lineTo(lx + half * 0.6, ly + half * 0.6);
              ctx.moveTo(lx + half * 0.6, ly - half * 0.6);
              ctx.lineTo(lx - half * 0.6, ly + half * 0.6);
              ctx.stroke();
            } else if (m.turretAngle !== undefined) {
              // Turret barrel: drawn in the local frame, so the ship's own
              // rotation is already applied by the surrounding transform; only
              // the turret's slew angle is added here.
              ctx.globalAlpha = 1;
              ctx.strokeStyle = colour;
              ctx.lineWidth = 1.5;
              ctx.beginPath();
              ctx.moveTo(lx, ly);
              ctx.lineTo(
                lx + Math.cos(m.turretAngle) * cellPx,
                ly + Math.sin(m.turretAngle) * cellPx,
              );
              ctx.stroke();
            }
          }

          // Crew dots: drawn on top of cells in ship-local space so they are
          // correctly positioned and rotate with the ship. Dot radius scales
          // with zoom (half a cell) but is floored at 2 px so crew remain
          // visible on distant ships.
          if (s.crew !== undefined) {
            const dotR = Math.max(2, cellPx * 0.28);
            for (const c of s.crew) {
              const cx = c.x * scale;
              const cy = c.y * scale;
              const dotColour = CREW_COLOUR[c.state] ?? "#b0b0b8";
              ctx.globalAlpha = 0.92;
              ctx.fillStyle = dotColour;
              ctx.beginPath();
              ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
              ctx.fill();
              // Carrying accent: a tiny inner dot in the cargo colour.
              if (c.carrying !== undefined) {
                const accentColour = CARRYING_COLOUR[c.carrying];
                if (accentColour !== undefined) {
                  ctx.globalAlpha = 1;
                  ctx.fillStyle = accentColour;
                  ctx.beginPath();
                  ctx.arc(cx, cy, Math.max(1, dotR * 0.45), 0, Math.PI * 2);
                  ctx.fill();
                }
              }
            }
          }

          ctx.restore();
          ctx.globalAlpha = 1;
        } else {
          // Legacy aggregated ship with no per-cell data: a simple blob.
          ctx.fillStyle = base;
          ctx.beginPath();
          ctx.arc(px, py, 7, 0, Math.PI * 2);
          ctx.fill();
        }

        // Heading indicator: a short line along the ship's velocity vector,
        // so direction and momentum are visible. Length scales with speed,
        // capped so very fast ships don't get a huge line.
        if (s.vx !== undefined && s.vy !== undefined) {
          const vx = s.vx;
          const vy = s.vy;
          const vLen = Math.hypot(vx, vy);
          if (vLen > 0.01) {
            const lineLen = Math.min(20, 4 + vLen * 8);
            const ux = vx / vLen;
            const uy = vy / vLen;
            ctx.strokeStyle = base;
            ctx.globalAlpha = 0.85;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(px + ux * 9, py + uy * 9);
            ctx.lineTo(px + ux * (9 + lineLen), py + uy * (9 + lineLen));
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }

        const maxStructure = max?.structure ?? s.structure;
        const frac = maxStructure > 0 ? Math.max(0, s.structure / maxStructure) : 0;
        const barW = 18;
        ctx.fillStyle = "rgba(255,255,255,0.15)";
        ctx.fillRect(px - barW / 2, py + 10, barW, 3);
        ctx.fillStyle =
          frac > 0.5 ? "#7bd88f" : frac > 0.25 ? "#ffcc5a" : "#ff5a5a";
        ctx.fillRect(px - barW / 2, py + 10, barW * frac, 3);
      }
    },
    [bounds, maxHp, activeAnomaly],
  );

  /**
   * Main rAF loop: advances the playback clock by the real wall-clock delta
   * (multiplied by the speed factor), derives the fractional sim-tick position,
   * interpolates between the two bracketing frames, and draws on every rAF
   * regardless of display refresh rate.
   *
   * Pausing, seeking, and stepping all operate on `playbackTimeRef` directly;
   * this loop runs regardless of `playing` so that seek/resize redraws work.
   */
  useEffect(() => {
    if (!hasFrames) return;

    let rafId = 0;
    let lastTimestamp: number | null = null;
    // Tracks the last integer tick mirrored into `statusFrame`, so the panel's
    // state is updated only when the discrete tick changes, not every frame.
    let lastStatusTick = -1;

    const loop = (now: number) => {
      if (lastTimestamp !== null) {
        const realDt = (now - lastTimestamp) / 1000;
        // Guard against very large dt values from hidden-tab pauses (browser
        // suspends rAF; on resume the first dt can be seconds). Clamp to 200 ms.
        const clampedDt = Math.min(realDt, 0.2);

        if (playing) {
          // Reading `result`/`computedTicks` from the closure: the effect re-runs
          // when either changes, so the closure always sees current values.
          const final = result !== null;
          const newTime = playbackTimeRef.current + clampedDt * speed;

          if (final) {
            // The whole battle is computed. Play straight through to the
            // authoritative end, then stop.
            const maxTime = result.ticks / TICKS_PER_SECOND;
            if (newTime >= maxTime) {
              playbackTimeRef.current = maxTime;
              setPlaybackTime(maxTime);
              setPlaying(false);
              setBuffering(false);
              bufferingRef.current = false;
            } else {
              playbackTimeRef.current = newTime;
              setPlaybackTime(newTime);
              if (bufferingRef.current) {
                bufferingRef.current = false;
                setBuffering(false);
              }
            }
          } else {
            // Still computing: gate playback on the streamed leading edge using
            // the measured sim rate. Switch to buffering when the playhead
            // catches the edge; resume only once enough lead has built up that
            // playback can run smoothly given how fast the sim is producing
            // frames (the rebuffer model — fewer, longer stalls over constant
            // micro-stutter when the sim is slower than playback).
            const edgeTime = computedTicks / TICKS_PER_SECOND;
            const playbackTickRate = TICKS_PER_SECOND * speed;
            const resumeLead = resumeLeadSeconds(simTickRateRef.current, playbackTickRate);

            if (bufferingRef.current) {
              // Hold at the edge until the buffer has refilled to the target lead.
              if (edgeTime - playbackTimeRef.current >= resumeLead) {
                bufferingRef.current = false;
                setBuffering(false);
                playbackTimeRef.current = newTime;
                setPlaybackTime(newTime);
              } else {
                playbackTimeRef.current = Math.min(playbackTimeRef.current, edgeTime);
                setPlaybackTime(playbackTimeRef.current);
              }
            } else if (newTime >= edgeTime) {
              // Caught the leading edge — clamp and start buffering.
              playbackTimeRef.current = edgeTime;
              setPlaybackTime(edgeTime);
              bufferingRef.current = true;
              setBuffering(true);
            } else {
              playbackTimeRef.current = newTime;
              setPlaybackTime(newTime);
            }
          }
        }
      }

      lastTimestamp = now;

      // Draw on every rAF regardless of whether the clock advanced.
      const fractionalTick = playbackTimeRef.current * TICKS_PER_SECOND;
      const frames = framesRef.current;
      const frame = interpolateFrame(frames, fractionalTick);
      drawFrame(frame);

      // Mirror the discrete-nearest frame into state for the status panel, but
      // only when the panel is open and the integer tick has moved — avoiding a
      // re-render on every animation frame. Reading the ref here is legitimate:
      // the rAF callback is not the render path.
      if (statusOpen && frames.length > 0) {
        const tick = Math.min(frames.length - 1, Math.floor(fractionalTick));
        if (tick !== lastStatusTick) {
          lastStatusTick = tick;
          setStatusFrame(frames[tick] ?? null);
        }
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  // Restart the loop when: the first batch lands, playing toggles, speed
  // changes, the streamed leading edge grows, the final result arrives, or
  // drawFrame is recreated (bounds/maxHp changed), or the status panel opens or
  // closes (so the loop begins/stops mirroring the status frame). All are
  // legitimate reasons to reset `lastTimestamp` so the first dt after each
  // change is not inflated.
  }, [hasFrames, playing, speed, drawFrame, result, computedTicks, statusOpen]);

  // Redraw when the canvas is resized (canvasSize changes). The draw itself is
  // purely a side-effect of the current playbackTime; no clock advance needed.
  // The rAF loop above handles the drawing during normal playback; this covers
  // the paused-then-resize case.
  useEffect(() => {
    if (!hasFrames) return;
    const fractionalTick = playbackTimeRef.current * TICKS_PER_SECOND;
    const frame = interpolateFrame(framesRef.current, fractionalTick);
    drawFrame(frame);
  }, [canvasSize, hasFrames, drawFrame]);

  /**
   * Resolve the transform exactly as `drawFrame` does, for pointer-space
   * conversions in the input handlers. Returns undefined when there is nothing
   * to draw or the canvas has no size yet.
   */
  const currentTransform = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas === null || framesRef.current.length === 0) return undefined;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return undefined;
    const cam = cameraRef.current;
    const fractionalTick = playbackTimeRef.current * TICKS_PER_SECOND;
    const frame = interpolateFrame(framesRef.current, fractionalTick);
    const followPos =
      cam.followId !== null ? frame.ships.find((s) => s.instanceId === cam.followId) : undefined;
    return { t: resolveTransform(width, height, bounds, cam, followPos), frame };
  }, [bounds]);

  /** Canvas-relative pointer position from a pointer event. */
  const pointerPos = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { px: e.clientX - rect.left, py: e.clientY - rect.top };
  };

  // Wheel-to-zoom is attached as a NON-passive native listener (not a React
  // onWheel prop): React registers wheel handlers as passive, so a synthetic
  // handler cannot call preventDefault, and the page would scroll while zooming.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || !hasFrames) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const resolved = currentTransform();
      if (resolved === undefined) return;
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const before = screenToWorld(resolved.t, px, py);
      setCamera((cam) => {
        const factor = Math.exp(-e.deltaY * 0.0015);
        const nextZoom = clampZoom(cam.zoom * factor);
        if (nextZoom === cam.zoom) return cam;
        // While following, keep the ship centred (zoom toward it, not the
        // cursor). Otherwise zoom toward the cursor: keep the world point under
        // it fixed by deriving the pan that maps `before` back to the cursor.
        if (cam.followId !== null) return { ...cam, zoom: nextZoom };
        const worldCentreX = (bounds.minX + bounds.maxX) / 2;
        const worldCentreY = (bounds.minY + bounds.maxY) / 2;
        const ratio = cam.zoom / nextZoom;
        const newCentreX = before.x - (before.x - resolved.t.centreX) * ratio;
        const newCentreY = before.y - (before.y - resolved.t.centreY) * ratio;
        return {
          ...cam,
          zoom: nextZoom,
          panX: newCentreX - worldCentreX,
          panY: newCentreY - worldCentreY,
        };
      });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [hasFrames, currentTransform, bounds]);

  const handlePointerDown = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { px, py } = pointerPos(e);
    dragRef.current = { pointerId: e.pointerId, startX: px, startY: py, moved: false };
  }, []);

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      if (drag === null || drag.pointerId !== e.pointerId) return;
      const resolved = currentTransform();
      if (resolved === undefined) return;
      const { px, py } = pointerPos(e);
      const dxPx = px - drag.startX;
      const dyPx = py - drag.startY;
      if (!drag.moved && Math.hypot(dxPx, dyPx) < 4) return;
      drag.moved = true;
      setDragging(true);
      drag.startX = px;
      drag.startY = py;
      // Convert the pixel delta to a world delta and shift the focus. Dragging
      // releases any follow lock so the player can free-look.
      const worldDx = dxPx / resolved.t.scale;
      const worldDy = dyPx / resolved.t.scale;
      setCamera((cam) => {
        const base = cam.followId !== null
          ? { panX: resolved.t.centreX - (bounds.minX + bounds.maxX) / 2, panY: resolved.t.centreY - (bounds.minY + bounds.maxY) / 2 }
          : { panX: cam.panX, panY: cam.panY };
        return {
          ...cam,
          followId: null,
          panX: base.panX - worldDx,
          panY: base.panY - worldDy,
        };
      });
    },
    [currentTransform, bounds],
  );

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      setDragging(false);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      if (drag === null || drag.moved) return;
      // A click without drag: pick a ship to follow, or clear follow on empty space.
      const resolved = currentTransform();
      if (resolved === undefined) return;
      const { px, py } = pointerPos(e);
      const world = screenToWorld(resolved.t, px, py);
      const hit = pickShipAt(resolved.frame, world);
      setCamera((cam) => ({ ...cam, followId: hit?.instanceId ?? null }));
    },
    [currentTransform],
  );

  const resetCamera = useCallback(() => setCamera(DEFAULT_CAMERA), []);

  if (fleets === undefined || designs === undefined) {
    return <Text c="dimmed">Loading…</Text>;
  }
  const allFleets = fleets;
  const allDesigns = designs;

  /**
   * Resolve the chosen fleets, run the engine, and start the replay. The
   * caller passes fleet objects directly so both the manual and auto-rolled
   * code paths can drive the same pipeline without going through state.
   */
  async function startBattle(
    attacker: Fleet,
    defender: Fleet,
    chosenAnomaly: BattleAnomalyType,
    chosenSeed: number,
  ): Promise<void> {
    const designMap = new Map(allDesigns.map((d) => [d.id, d]));
    const attackers = resolveFleetToCombatShips(attacker, designMap, catalog(), "attacker");
    const defenders = resolveFleetToCombatShips(defender, designMap, catalog(), "defender");
    if (attackers.length === 0 || defenders.length === 0) {
      notifications.show({
        title: "Nothing to fight",
        message: "One fleet has no ships that resolve against the catalog.",
        color: "red",
      });
      return;
    }
    // Compute off the main thread via the BattleRunner contract. Frames stream
    // in batch by batch through `onFrames`; playback starts on the first batch
    // and runs along the streamed leading edge while later batches compute. The
    // final `result` only lands when the run resolves — used for the winner
    // badge, persistence, and the terminal stop-at-end.

    // Abort any run still in flight so its stale stream can't feed this one.
    runAbortRef.current?.abort();
    const controller = new AbortController();
    runAbortRef.current = controller;

    // Reset every streaming accumulator for the fresh run.
    framesRef.current = [];
    setFrameCount(0);
    setDeploymentFrame(null);
    setRawBounds(null);
    setComputedTicks(0);
    setBuffering(false);
    simTickRateRef.current = 0;
    lastBatchRef.current = null;
    bufferingRef.current = false;
    setResult(null);
    setRunningAnomaly(chosenAnomaly);
    setComputing(true);
    setPlaying(false);

    let firstBatch = true;
    const onFrames = (frames: readonly BattleFrame[], streamedTicks: number) => {
      // Ignore late batches from a run that has since been superseded.
      if (controller.signal.aborted) return;

      // Update the measured simulation rate (ticks computed per real second) as
      // an EMA over batch arrivals. The rAF loop uses it to decide how much lead
      // to buffer before resuming playback at the leading edge.
      const nowMs = performance.now();
      const prevBatch = lastBatchRef.current;
      if (prevBatch !== null) {
        const dtSeconds = (nowMs - prevBatch.timeMs) / 1000;
        const dTicks = streamedTicks - prevBatch.ticks;
        if (dtSeconds > 0 && dTicks > 0) {
          const instantRate = dTicks / dtSeconds;
          simTickRateRef.current =
            simTickRateRef.current === 0
              ? instantRate
              : SIM_RATE_EMA_WEIGHT * instantRate +
                (1 - SIM_RATE_EMA_WEIGHT) * simTickRateRef.current;
        }
      }
      lastBatchRef.current = { timeMs: nowMs, ticks: streamedTicks };

      // Capture the very first streamed frame (the tick-0 deployment snapshot)
      // before appending, so the HP-bar maxima can be taken from it.
      const firstFrame = framesRef.current.length === 0 ? frames[0] : undefined;

      // Append the batch into the ref the rAF loop reads from. The runner hands
      // us a readonly view; push each frame reference into the accumulator.
      for (const frame of frames) {
        framesRef.current.push(frame);
      }

      // Expand the running world extent with this batch's ships and projectiles,
      // growing the camera view as the battle spreads. Folded into the previous
      // bounds state so render reads a reactive value, never the ref. Only emit
      // a fresh object when the extent actually grew, so the bounds memo stays
      // stable across batches that add nothing new.
      setRawBounds((prev) => {
        let minX = prev?.minX ?? Infinity;
        let maxX = prev?.maxX ?? -Infinity;
        let minY = prev?.minY ?? Infinity;
        let maxY = prev?.maxY ?? -Infinity;
        for (const frame of frames) {
          for (const s of frame.ships) {
            if (s.x < minX) minX = s.x;
            if (s.x > maxX) maxX = s.x;
            if (s.y < minY) minY = s.y;
            if (s.y > maxY) maxY = s.y;
          }
          for (const p of frame.projectiles) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
          }
        }
        if (
          prev !== null &&
          minX === prev.minX &&
          maxX === prev.maxX &&
          minY === prev.minY &&
          maxY === prev.maxY
        ) {
          return prev;
        }
        return { minX, maxX, minY, maxY };
      });

      setFrameCount(framesRef.current.length);
      setComputedTicks(streamedTicks);

      if (firstFrame !== undefined) {
        // Capture the tick-0 deployment frame for the HP-bar maxima.
        setDeploymentFrame(firstFrame);
      }

      if (firstBatch) {
        firstBatch = false;
        // Start playback from the top of the fresh battle and hand the stage the
        // full width once the first frames are on screen.
        playbackTimeRef.current = 0;
        setPlaybackTime(0);
        setCamera(DEFAULT_CAMERA);
        setSetupOpen(false);
        setPlaying(true);
      }
    };

    try {
      const battle = await battleRunner.run(
        {
          ships: [...attackers, ...defenders],
          attackerFleetId: attacker.id,
          defenderFleetId: defender.id,
          anomaly: chosenAnomaly,
          seed: chosenSeed,
          maxTicks: DEFAULT_MAX_TICKS,
        },
        { signal: controller.signal, onFrames },
      );
      // A superseded run that resolves anyway must not clobber the current one.
      if (controller.signal.aborted) return;
      void storage().battles.save(battle);
      setResult(battle);
      setBuffering(false);
    } catch (error) {
      notifications.show({
        title: "Battle failed to compute",
        message: error instanceof Error ? error.message : "The simulation worker did not return a result.",
        color: "red",
      });
    } finally {
      if (runAbortRef.current === controller) setComputing(false);
    }
  }

  function engage() {
    const attacker = allFleets.find((f) => f.id === attackerId);
    const defender = allFleets.find((f) => f.id === defenderId);
    if (attacker === undefined || defender === undefined) {
      notifications.show({
        title: "Pick both fleets",
        message: "Choose an attacker and a defender before engaging.",
        color: "red",
      });
      return;
    }
    void startBattle(attacker, defender, anomaly, seed);
  }

  /**
   * Auto-roll a matchup: pick two (different, when possible) fleets, a random
   * anomaly, and a random seed, reflect the picks in the setup UI, and start
   * the battle. This is the "AI vs AI" mode — both sides are commanded by
   * their doctrine and the player is a spectator.
   */
  function randomBattle() {
    if (allFleets.length === 0) {
      notifications.show({
        title: "No fleets to roll",
        message: "Build or import a fleet first.",
        color: "red",
      });
      return;
    }
    const ai = Math.floor(Math.random() * allFleets.length);
    let di: number;
    if (allFleets.length === 1) {
      di = ai;
    } else {
      di = Math.floor(Math.random() * (allFleets.length - 1));
      if (di >= ai) di += 1;
    }
    const attacker = allFleets[ai];
    const defender = allFleets[di];
    if (attacker === undefined || defender === undefined) return;

    const anomalies = BattleAnomaly.options;
    const chosenAnomaly = anomalies[Math.floor(Math.random() * anomalies.length)];
    if (chosenAnomaly === undefined) return;
    const chosenSeed = Math.floor(Math.random() * 0xffffffff);

    setAttackerId(attacker.id);
    setDefenderId(defender.id);
    setAnomaly(chosenAnomaly);
    setSeed(chosenSeed);
    void startBattle(attacker, defender, chosenAnomaly, chosenSeed);
    notifications.show({
      title: "AI vs AI",
      message: `${attacker.name} vs ${defender.name} on ${ANOMALY_LABEL[chosenAnomaly] ?? chosenAnomaly}.`,
      color: "indigo",
    });
  }

  const winnerColour =
    result?.winner === "attacker"
      ? "#ff6b5a"
      : result?.winner === "defender"
        ? "#5ab0ff"
        : "gray";

  const setupForm = (
    <Stack gap="sm">
      <Group gap="sm" grow align="flex-start">
        <NativeSelect
          label="Attacker"
          value={attackerId ?? ""}
          onChange={(e) => setAttackerId(e.target.value || null)}
        >
          <option value="">— select —</option>
          {fleetOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          label="Defender"
          value={defenderId ?? ""}
          onChange={(e) => setDefenderId(e.target.value || null)}
        >
          <option value="">— select —</option>
          {fleetOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </NativeSelect>
      </Group>

      <Stack gap={4}>
        <Text size="sm" fw={500}>
          Spatial anomaly
        </Text>
        <SegmentedControl
          fullWidth
          size="xs"
          data={BattleAnomaly.options.map((a) => ({
            value: a,
            label: ANOMALY_LABEL[a],
          }))}
          value={anomaly}
          onChange={(val) => setAnomaly(BattleAnomaly.parse(val))}
        />
      </Stack>

      <Group align="flex-end">
        <NumberInput
          label="Seed"
          value={seed}
          onChange={(val) => setSeed(typeof val === "number" ? val : 1)}
          style={{ flex: 1 }}
        />
        <Button
          variant="light"
          leftSection={<IconRefresh size={16} />}
          onClick={() => setSeed(Math.floor(Math.random() * 1_000_000_000))}
        >
          Random
        </Button>
      </Group>

      <Group grow>
        <Button
          size="md"
          leftSection={<IconSwords size={18} />}
          onClick={engage}
          loading={computing}
        >
          Engage
        </Button>
        <Tooltip label="Auto-roll attacker, defender, anomaly and seed, then watch.">
          <Button
            variant="light"
            leftSection={<IconArrowsShuffle size={16} />}
            onClick={randomBattle}
            disabled={allFleets.length === 0 || computing}
          >
            AI vs AI
          </Button>
        </Tooltip>
      </Group>
    </Stack>
  );

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center">
        <Title order={2}>Battle Arena</Title>
        <Group gap="xs">
          {result !== null && (
            <Badge size="lg" color="gray" style={{ color: winnerColour }}>
              {result.winner === "draw" ? "Draw" : `${result.winner.toUpperCase()} WINS`}
            </Badge>
          )}
          <Button
            variant={setupOpen ? "filled" : "light"}
            size="sm"
            leftSection={<IconSettings size={16} />}
            onClick={() => setSetupOpen((o) => !o)}
          >
            Setup
          </Button>
        </Group>
      </Group>

      <Collapse expanded={setupOpen}>
        <Paper p="md" withBorder>
          {setupForm}
        </Paper>
      </Collapse>

      {!hasFrames ? (
        <Paper p="xl" withBorder>
          <Center h={360}>
            {computing ? (
              <Stack align="center" gap="xs">
                <Loader />
                <Text c="dimmed">Computing battle…</Text>
              </Stack>
            ) : (
              <Stack align="center" gap="xs">
                <IconSwords size={40} color="#6b7280" />
                <Text c="dimmed">Pick two fleets and engage to watch the battle.</Text>
              </Stack>
            )}
          </Center>
        </Paper>
      ) : (
        <Stack gap="sm">
          <Paper p={0} withBorder className={styles.stage}>
            <Box className={styles.canvasBox}>
              <canvas
                ref={canvasRef}
                className={`${styles.canvas}${dragging ? ` ${styles.canvasGrabbing}` : ""}`}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
              />

              <Badge
                className={styles.anomalyLegend}
                size="sm"
                variant="filled"
                color={activeAnomaly === "none" ? "gray" : "grape"}
              >
                {ANOMALY_LABEL[activeAnomaly]}
                {camera.followId !== null ? " · following" : ""}
              </Badge>

              <Group className={styles.cameraControls} gap={4}>
                <Tooltip label="Zoom in">
                  <ActionIcon
                    variant="default"
                    onClick={() => setCamera((c) => ({ ...c, zoom: clampZoom(c.zoom * 1.4) }))}
                  >
                    +
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Zoom out">
                  <ActionIcon
                    variant="default"
                    onClick={() => setCamera((c) => ({ ...c, zoom: clampZoom(c.zoom / 1.4) }))}
                  >
                    −
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Fit whole battle (reset camera)">
                  <ActionIcon variant="default" onClick={resetCamera}>
                    <IconMaximize size={16} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label={statusOpen ? "Hide module panel" : "Show module panel"}>
                  <ActionIcon
                    variant={statusOpen ? "filled" : "default"}
                    onClick={() => setStatusOpen((o) => !o)}
                  >
                    <IconLayoutSidebarRightExpand size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>

              {statusOpen && statusFrame !== null && (
                <Box className={styles.statusOverlay}>
                  <ModuleStatusPanel frame={statusFrame} />
                </Box>
              )}

              {/* Streaming progress: shown while the run is still computing (the
                  final result has not yet landed). A thin progress bar tracks the
                  streamed leading edge against the safety cap, with a badge that
                  flips to 'buffering' when playback has outrun the streamed
                  frames. Vanishes the moment the final result arrives. */}
              {result === null && computing && (
                <Box
                  style={{
                    position: "absolute",
                    bottom: 8,
                    left: 8,
                    zIndex: 3,
                    width: "min(260px, 60%)",
                    pointerEvents: "none",
                  }}
                >
                  <Stack gap={4}>
                    <Group gap={6} align="center">
                      <Loader size={12} />
                      <Badge size="sm" variant="filled" color={buffering ? "yellow" : "indigo"}>
                        {buffering ? "Buffering" : "Computing"}
                      </Badge>
                    </Group>
                    <Progress
                      size="xs"
                      value={Math.min(100, (computedTicks / DEFAULT_MAX_TICKS) * 100)}
                      color={buffering ? "yellow" : "indigo"}
                    />
                  </Stack>
                </Box>
              )}
            </Box>
          </Paper>

          <Group gap="md" align="center">
            <Button
              variant="light"
              leftSection={playing ? <IconPlayerPause size={16} /> : <IconPlayerPlay size={16} />}
              onClick={() => {
                // Restart from the top only when we are paused at the true end of
                // a finished battle. Mid-stream the "end" is just the leading edge,
                // so a play press there resumes rather than rewinds.
                if (result !== null && currentTick >= result.ticks) {
                  playbackTimeRef.current = 0;
                  setPlaybackTime(0);
                }
                setPlaying((p) => !p);
              }}
            >
              {playing ? "Pause" : "Play"}
            </Button>
            <Tooltip
              label={
                camera.followId !== null
                  ? "Following a ship — click empty space or Fit to release"
                  : "Click a ship to follow it; scroll to zoom, drag to pan"
              }
            >
              <Badge
                size="sm"
                variant="light"
                color={camera.followId !== null ? "grape" : "gray"}
                leftSection={<IconFocus2 size={12} />}
              >
                {Math.round(camera.zoom * 100)}%
              </Badge>
            </Tooltip>
            <Text size="sm" c="dimmed" style={{ flex: 1 }}>
              Tick {currentTick} / {maxTick}
              {result === null ? "…" : ""}
            </Text>
            <SegmentedControl
              size="xs"
              data={[
                { value: "0.25", label: "0.25x" },
                { value: "0.5", label: "0.5x" },
                { value: "1", label: "1x" },
                { value: "2", label: "2x" },
              ]}
              value={String(speed)}
              onChange={(val) => setSpeed(Number(val))}
            />
          </Group>
          <Slider
            min={0}
            max={maxTick}
            value={currentTick}
            onChange={(val) => {
              setPlaying(false);
              setBuffering(false);
              const newTime = val / TICKS_PER_SECOND;
              playbackTimeRef.current = newTime;
              setPlaybackTime(newTime);
              const frame = interpolateFrame(framesRef.current, val);
              drawFrame(frame);
            }}
          />
        </Stack>
      )}
    </Stack>
  );
}

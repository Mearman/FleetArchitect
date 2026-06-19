import { useCallback } from "react";
import { CELL_SIZE } from "@/domain/grid";
import type { BattleFrame, BattleResult } from "@/schema/battle";
import { interpolateFrame } from "@/ui/interpolateFrame";
import { orderShipsForRender } from "@/ui/renderOrder";
import { drawAnomaly } from "./battleAnomaly";
import { drawFogAndAwareness } from "./battleFog";
import type { ShipScreenPositions } from "./battleFog";
import type { Bounds, Camera } from "./battleCamera";
import { resolveTransform } from "./battleCamera";
import {
  CARRYING_COLOUR,
  CREW_COLOUR,
  FACTION_PALETTE,
  MODULE_COLOUR,
  PROJECTILE_COLOUR,
} from "./battleConstants";
import { OVERLAYS, OVER_SHIP_IDS, UNDER_SHIP_IDS } from "./overlays";
import type { OverlayScope } from "./overlays";

/** Per-overlay on/scope state held by the route. */
export type OverlayState = Record<string, { on: boolean; scope: OverlayScope }>;

/**
 * Props for {@link useBattleCanvas}. The draw callback closes over the current
 * view bounds, per-ship HP maxima, the active anomaly and seed, the fog toggle,
 * the per-ship faction map, and the per-overlay on/scope state — all owned by
 * sibling hooks. It reads the live camera via `cameraRef` so it stays
 * responsive to zoom/pan without re-creating the callback.
 */
export interface UseBattleCanvasProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  cameraRef: React.RefObject<Camera>;
  bounds: Bounds;
  maxHp: Map<string, { structure: number; shield: number }>;
  activeAnomaly: BattleResult["config"]["anomaly"];
  activeSeed: number;
  showFog: boolean;
  factionByInstance: Map<string, string>;
  overlays: OverlayState;
}

/**
 * The pure draw callback for the BattleRoute canvas: renders a single
 * (possibly interpolated) frame. Separated into its own hook so resize/seek
 * can call it directly without owning the rAF loop, and so the rAF loop hook
 * can depend on `drawFrame` identity rather than the whole render scope.
 *
 * `drawFrame` is re-created only when one of its closure values changes
 * (bounds, maxHp, anomaly, seed, fog, faction map, overlays); reading the
 * camera from the ref keeps drawing responsive to zoom/pan without
 * re-creating the callback (and so without restarting the loop).
 */
export function useBattleCanvas({
  canvasRef,
  cameraRef,
  bounds,
  maxHp,
  activeAnomaly,
  activeSeed,
  showFog,
  factionByInstance,
  overlays,
}: UseBattleCanvasProps) {
  return useCallback(
    (frame: BattleFrame, tick: number, frames: readonly BattleFrame[]) => {
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
      // The seed is threaded through so asteroid rocks match the engine's
      // canonical occluder positions (single source of truth).
      drawAnomaly(ctx, activeAnomaly, t, bounds, activeSeed);

      // Fog-of-war overlay: drawn after the anomaly but before ships so the
      // fog shroud sits under hull graphics. Perimeters, ghost markers, links,
      // and dish indicators are drawn as part of this call and can be layered
      // on top of the fog layer but still under ships (caller controls depth by
      // splitting drawFogAndAwareness, but a single call keeps the API simple).
      if (showFog) {
        // Build a screen-position map for the current frame's ships so links
        // and dish indicators connect to real hull positions.
        const shipScreenPos: Map<string, { x: number; y: number }> = new Map();
        for (const s of frame.ships) {
          if (s.alive) {
            shipScreenPos.set(s.instanceId, { x: t.sx(s.x), y: t.sy(s.y) });
          }
        }
        const shipPos: ShipScreenPositions = shipScreenPos;
        drawFogAndAwareness(ctx, frame.awareness, t, bounds, shipPos);
      }

      // Battle overlays: dispatched by layer relative to the ship loop. Each
      // enabled overlay's draw is called with a fresh OverlayCtx carrying the
      // frame, transform, integer tick, frame history, follow id, and an
      // inScope predicate built from the overlay's current scope + follow id.
      // Overlays are pure draw consumers; they never touch BattleRoute state
      // directly, which keeps the overlay layer the single seam later agents
      // extend. Reading `overlays` from the closure here re-creates drawFrame
      // only when overlay state changes (mirrors the showFog pattern).
      const followId = cameraRef.current.followId;
      const drawOverlays = (ids: ReadonlySet<string>): void => {
        for (const def of OVERLAYS) {
          if (!ids.has(def.id)) continue;
          const state = overlays[def.id];
          if (state === undefined || !state.on) continue;
          const scope = state.scope;
          def.draw({
            ctx,
            frame,
            t,
            followId,
            tick,
            frames,
            inScope: (ship) => scope === "all" || ship.instanceId === followId,
          });
        }
      };

      // Under-ship layer: focus ring, sensor coverage, movement trail.
      drawOverlays(UNDER_SHIP_IDS);

      for (const p of frame.projectiles) {
        const colour = PROJECTILE_COLOUR[p.kind];
        if (colour === undefined) continue;
        ctx.fillStyle = colour;
        ctx.fillRect(sx(p.x) - 1, sy(p.y) - 1, 2.5, 2.5);
      }

      // Back-to-front by world-y so closer (lower) ships overlap further ones,
      // rather than the snapshot's attackers-then-defenders array order.
      for (const s of orderShipsForRender(frame.ships)) {
        const px = sx(s.x);
        const py = sy(s.y);
        // Faction accent tints the hull; the side colour is shown separately as
        // an outline ring so allegiance stays legible in a mirror match. Falls
        // back to the side colour for replays recorded before the factions update.
        const faction = factionByInstance.get(s.instanceId);
        const palette = faction !== undefined ? FACTION_PALETTE[faction] : undefined;
        const base = palette?.accent ?? (s.side === "attacker" ? "#ff6b5a" : "#5ab0ff");
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

        // Side outline ring (factions update): with hulls tinted by faction, a
        // thin ring in the side colour keeps attacker/defender legible at a
        // glance, including same-faction mirror matches.
        ctx.strokeStyle = s.side === "attacker" ? "#ff6b5a" : "#5ab0ff";
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.arc(px, py, hullRadiusPx + 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;

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

      // Over-ship layer: target lock, damage pulse.
      drawOverlays(OVER_SHIP_IDS);
    },
    [bounds, maxHp, activeAnomaly, activeSeed, showFog, factionByInstance, overlays, canvasRef, cameraRef],
  );
}

// Re-exported so the route can draw on seek without re-deriving the helper.
export { interpolateFrame };

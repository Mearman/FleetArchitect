import { useCallback, useRef } from "react";
import { CELL_SIZE } from "@/domain/grid";
import type { BattleFrame, BattleResult } from "@/schema/battle";
import type { DescriptorMap } from "@/ui/cellLayout";
import { hullRadiusWorld, renderCells } from "@/ui/cellLayout";
import { interpolateFrame } from "@/ui/interpolateFrame";
import { orderShipsForRender } from "@/ui/renderOrder";
import { NEON_MAGENTA, PHOSPHOR_AMBER, PHOSPHOR_GREEN } from "@/ui/theme/tokens";
import { drawAnomaly } from "./battleAnomaly";
import { drawBackdrop } from "./battleBackdrop";
import { drawFogAndAwareness } from "./battleFog";
import type { ShipScreenPositions } from "./battleFog";
import { appendWorldArc, pathWorldCircle } from "./battleProject";
import type { Bounds, Camera } from "./battleCamera";
import { resolveViewTransform } from "./battleCamera";
import {
  CARRYING_COLOUR,
  CREW_COLOUR,
  FACTION_PALETTE,
  MODULE_COLOUR,
  PROJECTILE_COLOUR,
  SIDE_COLOUR,
} from "./battleConstants";
import { appearanceOf } from "@/ui/render/moduleAppearance";
import { glyphPath2D } from "@/ui/render/moduleGlyphs";
import { drawIsoShipCells } from "./isoShipCells";
import { OVERLAYS, OVER_SHIP_IDS, UNDER_SHIP_IDS } from "./overlays";
import type { OverlayScope } from "./overlays";
import { SPRITE_PX_PER_WORLD, rasteriseShipSprite, spriteKey } from "./shipSprite";
import type { ShipSprite } from "./shipSprite";

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
  /** Static per-ship layout (cells + outline), keyed by instance id. The draw
   *  callback reads it to reconstruct each cell's world position from the ship
   *  pose, since the per-tick frames carry only dynamic cell state. */
  descriptors: DescriptorMap;
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
  descriptors,
}: UseBattleCanvasProps) {
  // Per-ship cache of the rasterised static cell layer. Survives across frames
  // (a ref, not state, so it never triggers a re-render) and is re-rasterised
  // for a ship only when its alive-cell set or base colour changes. Keyed by
  // instance id; a stale entry whose ship has left the battle is simply never
  // read again (the map is small — one entry per live ship).
  const spriteCache = useRef<Map<string, ShipSprite>>(new Map());
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

      // Resolve the view transform. In auto-fit mode the camera frames this
      // frame's live ships; otherwise it honours the manual zoom/pan and, when
      // following a ship, tracks that ship's live position (falling back to
      // centre-pan if it has died or not yet appeared).
      const cam = cameraRef.current;
      const t = resolveViewTransform(width, height, bounds, cam, frame, descriptors);
      const scale = t.scale;

      // Backdrop: base gradient, parallax grid, and seeded starfield, drawn
      // first so everything else sits on top of the atmosphere.
      drawBackdrop(ctx, width, height, t);

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
            shipScreenPos.set(s.instanceId, t.project(s.x, s.y));
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
            descriptors,
            inScope: (ship) => scope === "all" || ship.instanceId === followId,
          });
        }
      };

      // Under-ship layer: focus ring, sensor coverage, movement trail.
      drawOverlays(UNDER_SHIP_IDS);

      for (const p of frame.projectiles) {
        const colour = PROJECTILE_COLOUR[p.kind];
        if (colour === undefined) continue;
        const pp = t.project(p.x, p.y);
        ctx.fillStyle = colour;
        ctx.fillRect(pp.x - 1, pp.y - 1, 2.5, 2.5);
      }

      // The projection's pure 2x2 delta map (its basis vectors): the screen
      // delta for one world unit along x and along y. For the flat projection
      // this is the identity, so the composed ship transform below reduces to
      // scale * rotate(facing) and reproduces the old top-down draw exactly.
      const mx = t.projection.project(1, 0);
      const my = t.projection.project(0, 1);

      // Back-to-front by projected depth so nearer ships overlap further ones,
      // rather than the snapshot's attackers-then-defenders array order. Flat
      // depth is world-y; iso depth is x+y along the tilted plane.
      for (const s of orderShipsForRender(frame.ships, t.projection.depth)) {
        const origin = t.project(s.x, s.y);
        const px = origin.x;
        const py = origin.y;
        // Static layout for this ship (cell offsets + outline), emitted once per
        // battle; the cells are reconstructed in world space from the ship pose.
        const descriptor = descriptors.get(s.instanceId);
        const cells = renderCells(s, descriptor);
        // Faction accent tints the hull; the side colour is shown separately as
        // an outline ring so allegiance stays legible in a mirror match. Falls
        // back to the side colour for replays recorded before the factions update.
        const faction = factionByInstance.get(s.instanceId);
        const palette = faction !== undefined ? FACTION_PALETTE[faction] : undefined;
        const base = palette?.accent ?? SIDE_COLOUR[s.side];
        const max = maxHp.get(s.instanceId);

        // World extent of the hull (farthest cell from the centre), driving the
        // ship rings and the wreck marker as world circles so they tilt into
        // ellipses on the ship plane under iso. Legacy ships with no cell data
        // fall back to a small world radius (a couple of cells).
        const hullRadius = hullRadiusWorld(descriptor);
        const hullR = hullRadius === undefined ? CELL_SIZE * 2 : hullRadius;

        if (!s.alive) {
          // Wreck marker: a faint disc the size of the dead ship's hull, so it
          // tilts and scales with the world rather than sitting as a flat dot.
          ctx.globalAlpha = 0.2;
          ctx.fillStyle = base;
          pathWorldCircle(ctx, t, s.x, s.y, hullR * 0.5);
          ctx.fill();
          ctx.globalAlpha = 1;
          continue;
        }

        // Side outline ring (factions update): with hulls tinted by faction, a
        // thin ring in the side colour keeps attacker/defender legible at a
        // glance, including same-faction mirror matches. A world circle (the
        // small pixel gap mapped to world units) so it tilts under iso.
        ctx.strokeStyle = SIDE_COLOUR[s.side];
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.8;
        pathWorldCircle(ctx, t, s.x, s.y, hullR + 5 / scale);
        ctx.stroke();
        ctx.globalAlpha = 1;

        const maxShield = max?.shield ?? s.shield;
        if (maxShield > 0) {
          const frac = Math.max(0, s.shield / maxShield);
          if (frac > 0) {
            ctx.strokeStyle = "rgba(0,229,255,0.65)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            const a0 = -Math.PI / 2;
            const a1 = a0 + Math.PI * 2 * frac;
            appendWorldArc(ctx, t, s.x, s.y, hullR + 3 / scale, a0, a1);
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
        if (cells !== undefined && s.facing !== undefined) {
          // Whether the cell size is being floored (distant zoom): in that
          // regime cells overlap to keep a tiny hull legible, which the baked
          // sprite (drawn at the natural scale) cannot reproduce, so we fall
          // back to the live per-cell fill. At normal/close zoom the sprite blit
          // is pixel-equivalent to the live fill, so it is used.
          const floored = CELL_SIZE * scale < 2;
          const cosF = Math.cos(s.facing);
          const sinF = Math.sin(s.facing);

          // The dynamic dimming/manning flags are needed by both draw paths.
          const cellState = (m: (typeof cells)[number]) => {
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
            return { isStarved: starvedAmmo || starvedCharge || unmanned };
          };

          const isoExtruded = !floored && t.projection.mode === "isometric";

          if (isoExtruded) {
            // Isometric 2.5D: draw each cell as an extruded box (lit top, shaded
            // sides, glyph on top) with per-kind height, so components read as
            // 3-D parts. Drawn live in screen space (the projection has no
            // z-axis), painter-sorted inside the helper.
            drawIsoShipCells(
              ctx,
              t,
              { x: s.x, y: s.y, facing: s.facing },
              cells,
              base,
              (m) => cellState(m).isStarved,
            );
          } else if (floored) {
            // Distant-zoom fallback: the cells are below the legibility floor,
            // so the matrix path would collapse them to sub-pixel specks. Each
            // cell is instead projected from its world centre (ship pose plus
            // the facing-rotated local offset) and drawn as a small floored,
            // screen-axis-aligned square — legible under both projections.
            const cellPx = Math.max(2, CELL_SIZE * scale);
            const half = cellPx / 2;
            for (const m of cells) {
              const colour = MODULE_COLOUR[m.kind];
              if (colour === undefined) continue;
              // Local offset rotated into world, then projected to screen.
              const wx = s.x + (m.ox * cosF - m.oy * sinF);
              const wy = s.y + (m.ox * sinF + m.oy * cosF);
              const cp = t.project(wx, wy);
              const { isStarved } = cellState(m);

              ctx.globalAlpha = m.alive ? (isStarved ? 0.45 : 1) : 0.18;
              ctx.fillStyle = colour;
              ctx.fillRect(cp.x - half, cp.y - half, cellPx, cellPx);

              ctx.globalAlpha = m.alive ? (isStarved ? 0.1 : 0.22) : 0.1;
              ctx.fillStyle = base;
              ctx.fillRect(cp.x - half, cp.y - half, cellPx, cellPx);

              if (!m.alive) {
                ctx.globalAlpha = 0.35;
                ctx.strokeStyle = "rgba(255,255,255,0.4)";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(cp.x - half * 0.6, cp.y - half * 0.6);
                ctx.lineTo(cp.x + half * 0.6, cp.y + half * 0.6);
                ctx.moveTo(cp.x + half * 0.6, cp.y - half * 0.6);
                ctx.lineTo(cp.x - half * 0.6, cp.y + half * 0.6);
                ctx.stroke();
              } else if (m.turretAngle !== undefined) {
                // Turret barrel: its slew angle is in the ship-local frame, so
                // the world direction adds the ship facing. Both ends are
                // projected; the barrel reads as a short floored stub.
                const wa = m.turretAngle + s.facing;
                const tip = t.project(
                  wx + Math.cos(wa) * CELL_SIZE,
                  wy + Math.sin(wa) * CELL_SIZE,
                );
                ctx.globalAlpha = 1;
                ctx.strokeStyle = colour;
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(cp.x, cp.y);
                ctx.lineTo(tip.x, tip.y);
                ctx.stroke();
              }
            }

            // Crew dots: each crew offset is in ship-local units; rotate into
            // world and draw as world circles (half-cell radius) so they tilt
            // and scale with the view like the main-path crew dots.
            if (s.crew !== undefined) {
              const dotR = CELL_SIZE * 0.28;
              for (const c of s.crew) {
                const cwx = s.x + (c.x * cosF - c.y * sinF);
                const cwy = s.y + (c.x * sinF + c.y * cosF);
                const dotColour = CREW_COLOUR[c.state] ?? "#b0b0b8";
                ctx.globalAlpha = 0.92;
                ctx.fillStyle = dotColour;
                pathWorldCircle(ctx, t, cwx, cwy, dotR);
                ctx.fill();
                if (c.carrying !== undefined) {
                  const accentColour = CARRYING_COLOUR[c.carrying];
                  if (accentColour !== undefined) {
                    ctx.globalAlpha = 1;
                    ctx.fillStyle = accentColour;
                    pathWorldCircle(ctx, t, cwx, cwy, dotR * 0.45);
                    ctx.fill();
                  }
                }
              }
            }

            // Hull outline: vertices are in ship-local units; rotate into world
            // and project each so the shell traces correctly under the tilt.
            const outlineF = descriptor?.outline;
            if (outlineF !== undefined) {
              ctx.strokeStyle = SIDE_COLOUR[s.side];
              ctx.lineWidth = 1;
              ctx.globalAlpha = 0.5;
              for (const loop of outlineF) {
                if (loop.length < 2) continue;
                const first = loop[0];
                if (first === undefined) continue;
                const f = t.project(
                  s.x + (first.x * cosF - first.y * sinF),
                  s.y + (first.x * sinF + first.y * cosF),
                );
                ctx.beginPath();
                ctx.moveTo(f.x, f.y);
                for (let i = 1; i < loop.length; i += 1) {
                  const v = loop[i];
                  if (v === undefined) continue;
                  const vp = t.project(
                    s.x + (v.x * cosF - v.y * sinF),
                    s.y + (v.x * sinF + v.y * cosF),
                  );
                  ctx.lineTo(vp.x, vp.y);
                }
                ctx.closePath();
                ctx.stroke();
              }
            }
            ctx.globalAlpha = 1;
          } else {
            // Normal/close zoom: compose a single affine that places the ship's
            // local-world coordinate space onto the screen —
            //   screen = project(s.x, s.y) + scale * M * R(facing) * local
            // where M is the projection's pure 2x2 delta map (columns are the
            // screen deltas for one world unit along x and along y). Everything
            // below is then drawn in LOCAL WORLD UNITS; the matrix carries the
            // scale and the projection tilt. For the flat projection M is the
            // identity, so A reduces to scale * R(facing) and the result is the
            // old top-down draw exactly.
            const r00 = cosF;
            const r01 = -sinF;
            const r10 = sinF;
            const r11 = cosF;
            // M * R, then * scale. M = [[mx.x, my.x], [mx.y, my.y]].
            const a00 = scale * (mx.x * r00 + my.x * r10);
            const a01 = scale * (mx.x * r01 + my.x * r11);
            const a10 = scale * (mx.y * r00 + my.y * r10);
            const a11 = scale * (mx.y * r01 + my.y * r11);
            ctx.save();
            ctx.translate(px, py);
            // ctx.transform(a, b, c, d, e, f): x' = a*x + c*y, y' = b*x + d*y.
            ctx.transform(a00, a10, a01, a11, 0, 0);

            // Static cell layer: blit the cached sprite (a flat plate the matrix
            // tilts), re-rasterising only on a topology/colour change. The
            // dynamic per-cell bits (starvation dimming, dead crosses, turret
            // barrels) are always drawn live on top, so the visible result
            // matches the live path.
            const key = spriteKey(cells, base);
            const cached = spriteCache.current.get(s.instanceId);
            let sprite: ShipSprite | undefined;
            if (cached !== undefined && cached.key === key) {
              sprite = cached;
            } else {
              sprite = rasteriseShipSprite(cells, base, key, descriptor?.outline);
              if (sprite !== undefined) spriteCache.current.set(s.instanceId, sprite);
            }

            if (sprite !== undefined) {
              // The sprite drew CELL_SIZE world units as SPRITE_PX_PER_WORLD
              // pixels; the composed matrix already carries the display scale,
              // so the blit only needs to undo the sprite's own pixel density to
              // land in local world units.
              const blitScale = 1 / SPRITE_PX_PER_WORLD;
              ctx.globalAlpha = 1;
              ctx.drawImage(
                sprite.canvas,
                -sprite.originX * blitScale,
                -sprite.originY * blitScale,
                sprite.canvas.width * blitScale,
                sprite.canvas.height * blitScale,
              );
            }

            // A cell square is one world CELL_SIZE on each side, in local units.
            const half = CELL_SIZE / 2;
            // The composed matrix carries the display scale, so a stroke meant
            // to read as N screen pixels must be authored as N / scale local
            // units. (The projection skew makes this exact only for the flat
            // mode; under iso it is the correct first-order width.)
            const strokePx = (px2: number) => px2 / scale;
            for (const m of cells) {
              // Cell centre in ship-local world units; the composed matrix
              // places it in screen space (with the projection tilt applied).
              const lx = m.ox;
              const ly = m.oy;
              const colour = MODULE_COLOUR[m.kind];
              if (colour === undefined) continue;

              // Supply/manning dimming: a crewed station that is unmanned, or a
              // module out of ammo or charge, renders at reduced opacity so
              // supply problems read at a glance. Only on alive modules —
              // destroyed cells use the 0.18 path.
              const { isStarved } = cellState(m);

              // An alive, non-starved cell at natural zoom is already painted by
              // the sprite blit above — skip re-filling it. Every other cell
              // (dead, starved, or any cell when the sprite is not in use) is
              // filled live, identically to the original path.
              const paintedBySprite = sprite !== undefined && m.alive && !isStarved;
              if (!paintedBySprite) {
                // A starved/dead cell baked into the sprite must be knocked out
                // before its dimmed version is drawn, or the bright baked fill
                // would show through the lower-opacity overlay.
                if (sprite !== undefined && sprite.aliveSlots.has(m.slotId)) {
                  ctx.globalCompositeOperation = "destination-out";
                  ctx.globalAlpha = 1;
                  ctx.fillStyle = "#000";
                  ctx.fillRect(lx - half, ly - half, CELL_SIZE, CELL_SIZE);
                  ctx.globalCompositeOperation = "source-over";
                }

                ctx.globalAlpha = m.alive ? (isStarved ? 0.45 : 1) : 0.18;
                ctx.fillStyle = colour;
                ctx.fillRect(lx - half, ly - half, CELL_SIZE, CELL_SIZE);

                // A faint side-coloured inset keeps adjacent cells distinct and
                // tints the whole hull toward its allegiance colour.
                ctx.globalAlpha = m.alive ? (isStarved ? 0.1 : 0.22) : 0.1;
                ctx.fillStyle = base;
                ctx.fillRect(lx - half, ly - half, CELL_SIZE, CELL_SIZE);
              }

              if (!m.alive) {
                ctx.globalAlpha = 0.35;
                ctx.strokeStyle = "rgba(255,255,255,0.4)";
                ctx.lineWidth = strokePx(1);
                ctx.beginPath();
                ctx.moveTo(lx - half * 0.6, ly - half * 0.6);
                ctx.lineTo(lx + half * 0.6, ly + half * 0.6);
                ctx.moveTo(lx + half * 0.6, ly - half * 0.6);
                ctx.lineTo(lx - half * 0.6, ly + half * 0.6);
                ctx.stroke();
              } else if (m.turretAngle !== undefined) {
                // Turret barrel: drawn in local units; the composed matrix
                // applies the ship's facing and the projection, so only the
                // turret's slew angle is added here.
                ctx.globalAlpha = 1;
                ctx.strokeStyle = colour;
                ctx.lineWidth = strokePx(1.5);
                ctx.beginPath();
                ctx.moveTo(lx, ly);
                ctx.lineTo(
                  lx + Math.cos(m.turretAngle) * CELL_SIZE,
                  ly + Math.sin(m.turretAngle) * CELL_SIZE,
                );
                ctx.stroke();
              }

              // Glyph: engrave the module's mark on the cell, in local units so
              // the composed matrix scales it with the hull. Only on alive cells
              // big enough on screen to read it.
              if (m.alive && CELL_SIZE * scale > 12) {
                ctx.save();
                ctx.translate(lx, ly);
                ctx.scale(CELL_SIZE, CELL_SIZE);
                ctx.globalAlpha = 0.78;
                ctx.strokeStyle = "rgba(8, 10, 8, 1)";
                ctx.lineWidth = 0.08;
                ctx.lineJoin = "round";
                ctx.lineCap = "round";
                ctx.stroke(glyphPath2D(appearanceOf(m.kind).glyph));
                ctx.restore();
                ctx.globalAlpha = 1;
              }
            }

            // Crew dots: drawn over the cells in ship-local world units, so they
            // sit on the hull and follow the ship's facing and the projection.
            // Radius is half a cell in world units.
            if (s.crew !== undefined) {
              const dotR = CELL_SIZE * 0.28;
              for (const c of s.crew) {
                const cx = c.x;
                const cy = c.y;
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
                    ctx.arc(cx, cy, dotR * 0.45, 0, Math.PI * 2);
                    ctx.fill();
                  }
                }
              }
            }

            // Chamfered hull outline: drawn over the cells as a semi-transparent
            // side-colour stroke through the shell's corner vertices. Vertices
            // are in ship-local world units; the composed matrix places them on
            // screen (with the projection tilt applied).
            const outline = descriptor?.outline;
            if (outline !== undefined) {
              ctx.strokeStyle = SIDE_COLOUR[s.side];
              ctx.lineWidth = strokePx(1);
              ctx.globalAlpha = 0.5;
              for (const loop of outline) {
                if (loop.length < 2) continue;
                const first = loop[0];
                if (first === undefined) continue;
                ctx.beginPath();
                ctx.moveTo(first.x, first.y);
                for (let i = 1; i < loop.length; i += 1) {
                  const v = loop[i];
                  if (v !== undefined) ctx.lineTo(v.x, v.y);
                }
                ctx.closePath();
                ctx.stroke();
              }
              ctx.globalAlpha = 1;
            }

            ctx.restore();
            ctx.globalAlpha = 1;
          }
        } else {
          // Legacy aggregated ship with no per-cell data: a simple blob, drawn
          // as a world disc (a couple of cells) so it tilts and scales too.
          ctx.fillStyle = base;
          pathWorldCircle(ctx, t, s.x, s.y, CELL_SIZE * 1.4);
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
        ctx.fillStyle = "rgba(28,38,32,0.7)";
        ctx.fillRect(px - barW / 2, py + 10, barW, 3);
        ctx.fillStyle =
          frac > 0.5 ? PHOSPHOR_GREEN : frac > 0.25 ? PHOSPHOR_AMBER : NEON_MAGENTA;
        ctx.fillRect(px - barW / 2, py + 10, barW * frac, 3);
      }

      // Boarding pods: rendered as small block grids on top of ships. Each pod
      // carries its current position and, when the snapshot includes cells, its
      // grid shape. Fall back to a simple 3×3 block centred on the pod when
      // cells are absent (older frames or pods with no grid data).
      if (frame.pods !== undefined) {
        const POD_CELL_SIZE = Math.max(1.5, CELL_SIZE * 0.5 * scale);
        const POD_HALF = POD_CELL_SIZE / 2;
        for (const pod of frame.pods) {
          const podCentre = t.project(pod.x, pod.y);
          const px = podCentre.x;
          const py = podCentre.y;
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = SIDE_COLOUR[pod.side];

          if (pod.cells !== undefined && pod.cells.length > 0) {
            // Block-grid path: each cell is drawn at its (q, r) offset from the
            // pod centre, scaled by half the normal cell size (pods are small).
            for (const cell of pod.cells) {
              const cx = px + cell.q * POD_CELL_SIZE;
              const cy = py + cell.r * POD_CELL_SIZE;
              ctx.fillRect(cx - POD_HALF, cy - POD_HALF, POD_CELL_SIZE, POD_CELL_SIZE);
            }
          } else {
            // Fallback: a 3×3 block grid centred on the pod position.
            for (let dq = -1; dq <= 1; dq += 1) {
              for (let dr = -1; dr <= 1; dr += 1) {
                const cx = px + dq * POD_CELL_SIZE;
                const cy = py + dr * POD_CELL_SIZE;
                ctx.fillRect(cx - POD_HALF, cy - POD_HALF, POD_CELL_SIZE, POD_CELL_SIZE);
              }
            }
          }

          ctx.globalAlpha = 1;
        }
      }

      // Client-space vignette: darkens the frame edges to focus the eye on the
      // action and seat the battle in the cassette-cyberpunk atmosphere.
      ctx.save();
      const vig = ctx.createRadialGradient(width / 2, height / 2, height * 0.3, width / 2, height / 2, height * 0.85);
      vig.addColorStop(0, "transparent");
      vig.addColorStop(1, "rgba(0,0,0,0.45)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();

      // Over-ship layer: target lock, damage pulse, sensor pulses, boarding/debris.
      drawOverlays(OVER_SHIP_IDS);
    },
    [bounds, maxHp, activeAnomaly, activeSeed, showFog, factionByInstance, overlays, descriptors, canvasRef, cameraRef],
  );
}

// Re-exported so the route can draw on seek without re-deriving the helper.
export { interpolateFrame };

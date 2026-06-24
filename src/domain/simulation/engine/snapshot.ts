/**
 * Per-tick snapshot serialisation: turns the live simulation state (ships,
 * projectiles, mines, pods, pulses, emissions, debris, awareness) into the
 * immutable `BattleFrame` the renderer and replay consume. Pure — it reads the
 * sim state and emits a plain frame, mutating only the transient `brokeOff`
 * marker it clears after recording. Extracted from the tick loop so the loop
 * file stays within the module-size budget.
 */

import { CELL_SIZE } from "@/domain/grid";
import type { AwarenessSnapshot, BattleFrame, ShipDescriptor } from "@/schema/battle";
import { CREW_HP } from "./config";
import { STANDARD_CELL_GAS_MASS_KG, CREW_VACUUM_SURVIVABLE_FRACTION } from "./lifesupport";
import type { SimCrew } from "../types";

import { crewCellKey } from "./crew-pathfinding";
import type { Debris } from "./debris";
import type { Emission } from "./emissions";
import type { SimPulse } from "./pulses";
import type { SimMine, SimModule, SimPod, SimProjectile, SimShip } from "./types";

/**
 * The resource block (thermal/propellant/atmosphere/powerBuffer) changes slowly
 * relative to per-tick motion: thermal diffuses, propellant depletes, atmosphere
 * vents over many ticks. Emitting it on every tick bloats the heaviest frames.
 * The snapshot emits the resource only every {@link RESOURCE_EVERY} ticks; on
 * off-ticks the field is omitted entirely (the schema's `resource` is optional).
 *
 * This is a render-side cadence only. The engine's `resourceStep` still runs and
 * advances the resource every tick and enforces overheat/flame-out per tick —
 * only the SNAPSHOT's emission is subsampled. The renderer's resource overlays
 * hold the last-known resource per ship (updated when the field is present,
 * rendered from the held value on off-ticks) so the overlay stays continuous.
 */
const RESOURCE_EVERY = 6;

export function snapshot(
  tick: number,
  ships: readonly SimShip[],
  projectiles: readonly SimProjectile[],
  awareness: AwarenessSnapshot,
  mines: readonly SimMine[],
  pods: readonly SimPod[],
  pulses: readonly SimPulse[],
  emissions: readonly Emission[],
  debris: readonly Debris[],
): BattleFrame {
  // Partition real ships from phantoms (drones/decoys) so phantoms never appear
  // in the `ships` array — they render from their own dedicated arrays instead.
  const realShips = ships.filter((s) => s.phantom === undefined);
  const drones = ships.filter((s) => s.phantom?.kind === "drone" && s.alive);
  const decoys = ships.filter((s) => s.phantom?.kind === "decoy" && s.alive);
  return {
    tick,
    awareness,
    ships: realShips.map((s) => {
      const base = {
        instanceId: s.instanceId,
        side: s.side,
        x: s.x,
        y: s.y,
        vx: s.velX,
        vy: s.velY,
        facing: s.facing,
        structure: s.structure,
        shield: s.shield,
        alive: s.alive,
        // Record the split frame, then clear so subsequent snapshots
        // don't carry a stale "freshly broken" marker.
        ...(s.brokeOff === true ? { brokeOff: true } : {}),
        // Centre of mass in ship-local coordinates. Omitted when at the
        // origin so legacy replays stay byte-compatible with pre-rigid-body
        // recordings; modular ships with offset CoM always emit it.
        ...(s.comX !== 0 || s.comY !== 0 ? { comX: s.comX, comY: s.comY } : {}),
        // Current targeting decision (the instance id of the ship this ship is
        // aiming at this tick, or undefined when it has no live target). Emitted
        // from the deterministic pickTarget result so frame determinism is
        // preserved; omitted when there is no target so frames recorded before
        // this field stay byte-identical.
        ...(s.target !== undefined ? { targetId: s.target } : {}),
      };
      if (s.brokeOff === true) s.brokeOff = false;
      if (s.modules === undefined) return base;
      // Per-cell DYNAMIC state only. The static layout (kind, ship-local offset,
      // surface kind, max HP, turret presence) lives once per battle in the
      // ship descriptor (see `shipDescriptor` below), keyed by slotId. The
      // dynamic cells below are emitted in s.modules order, which is the SAME
      // order as the static descriptor's cells, so CellState[i] corresponds to
      // ShipCellLayout.cells[i] — the renderer joins them by INDEX rather than
      // carrying a redundant slotId on every cell of every frame.
      const withModules = {
        ...base,
        cells: s.modules.map((m) => ({
          surfaceHp: m.surfaceHp,
          hp: m.hp,
          alive: m.alive,
          // Emit the live barrel angle for turrets so the renderer can draw
          // the barrel tracking the target. Omitted on fixed mounts and
          // non-weapon cells (their barrel always points along the mount
          // facing) to keep legacy replays byte-compatible.
          ...(m.turretTurnRate > 0 ? { turretAngle: m.turretAngle } : {}),
          // Manning state — only emitted for stations that need crew, so
          // crewless cells stay byte-identical to pre-crew replays.
          ...(m.crewRequired > 0 ? { manned: m.manned } : {}),
          // Remaining rounds — only for weapons with a finite local magazine
          // (an ammoCapacity); unlimited weapons and non-weapons omit it.
          ...(m.effect.kind === "weapon" && m.effect.ammoCapacity !== undefined
            ? { ammo: m.ammo }
            : {}),
          // Local charge buffer — only for power-drawing modules; draw-free
          // cells omit it so simple designs stay byte-compatible.
          ...(m.powerDraw > 0 ? { charge: m.charge } : {}),
          // Door states — only emitted when the module has at least one door
          // edge, so ships without doors stay byte-identical to pre-door replays.
          ...(Object.keys(m.edges.doorStates).length > 0
            ? { doorStates: m.edges.doorStates }
            : {}),
        })),
      };
      // Crew positions and state, in ship-local coordinates. Each crew member
      // sits on the cell of the module at its (col, row); that module's x/y is
      // the cell's ship-local centre, plus the fractional render offset. Omitted
      // when the ship carries no crew so crewless replays stay byte-compatible.
      // Resource state — emitted when the ship has run the resource step AND
      // we are on a resource-emission tick (tick % RESOURCE_EVERY === 0), so the
      // renderer and analytics can read thermal, propellant, atmosphere and
      // power-buffer values. On off-ticks the field is omitted: the resource
      // changes slowly (diffusion/depletion/venting), and the renderer holds the
      // last-known resource between emissions. Absent on phantoms and legacy
      // ships. The engine computes the resource every tick regardless — this is
      // a snapshot-emission cadence, not a sim change.
      const resource = s.resource;
      const withResource =
        resource !== undefined && tick % RESOURCE_EVERY === 0
          ? {
              ...withModules,
              resource: {
                thermal: resource.thermal,
                propellant: resource.propellant,
                atmosphere: resource.atmosphere,
                powerBuffer: {
                  energy: resource.powerBuffer.energy,
                  capacityJoules: resource.powerBuffer.capacityJoules,
                },
              },
            }
          : withModules;
      if (s.crew === undefined || s.crew.length === 0) return withResource;
      const moduleByCell = new Map<string, SimModule>();
      for (const m of s.modules) moduleByCell.set(crewCellKey(m.col, m.row), m);
      return {
        ...withResource,
        crew: s.crew.map((c) => {
          const cell = moduleByCell.get(crewCellKey(c.col, c.row));
          const cx = cell !== undefined ? cell.x : 0;
          const cy = cell !== undefined ? cell.y : 0;
          return {
            id: c.id,
            x: cx + c.ox * CELL_SIZE,
            y: cy + c.oy * CELL_SIZE,
            state: crewState(c),
            hp: c.hp,
            ...(c.carrying !== undefined ? { carrying: c.carrying } : {}),
          };
        }),
      };
    }),
    projectiles: projectiles.map((p) => ({ id: p.id, x: p.x, y: p.y, kind: p.kind })),
    // Deployed mines (factions update). Omitted when none are live so frames
    // for battles without mine-layers stay byte-identical to baseline.
    ...(mines.length > 0
      ? {
          mines: mines.map((mine) => ({
            instanceId: mine.id,
            side: mine.side,
            x: mine.x,
            y: mine.y,
            armed: mine.armingLeft <= 0,
          })),
        }
      : {}),
    // In-flight boarding pods (factions update). Omitted when none are live so
    // frames for battles without boarding modules stay byte-identical to baseline.
    ...(pods.length > 0
      ? {
          pods: pods.map((pod) => ({
            instanceId: pod.id,
            side: pod.side,
            x: pod.x,
            y: pod.y,
            targetId: pod.targetInstanceId,
          })),
        }
      : {}),
    // Active drones (factions update). Omitted when none are live.
    ...(drones.length > 0
      ? {
          drones: drones.map((s) => ({
            instanceId: s.instanceId,
            ownerId: s.phantom?.ownerId ?? "",
            side: s.side,
            x: s.x,
            y: s.y,
            facing: s.facing,
            hp: s.structure,
            maxHp: s.maxStructure,
            alive: s.alive,
          })),
        }
      : {}),
    // Active decoys (factions update). Omitted when none are live.
    ...(decoys.length > 0
      ? {
          decoys: decoys.map((s) => ({
            instanceId: s.instanceId,
            ownerId: s.phantom?.ownerId ?? "",
            side: s.side,
            x: s.x,
            y: s.y,
            hp: s.structure,
            ticksLeft: s.phantom?.ticksLeft ?? 0,
          })),
        }
      : {}),
    // Active-radar pulses (Phase 8). Omitted when none are live so frames for
    // battles without active sensors stay byte-identical to baseline.
    ...(pulses.length > 0
      ? {
          pulses: pulses.map((p) => ({
            id: p.id,
            emitterId: p.emitterId,
            ...(p.reflectedFrom !== undefined ? { reflectedFrom: p.reflectedFrom } : {}),
            x: p.originX,
            y: p.originY,
            radius: p.radius,
            bearing: p.bearing,
            arc: p.arc,
            // Strength at the pulse front: enables the renderer to alpha-blend
            // the ring so a strong/fresh pulse is opaque and a weak/distant one
            // fades. Emitted unconditionally (always defined on SimPulse).
            strength: p.strength,
          })),
        }
      : {}),
    // Continuous EM emissions this tick (Phase 9). Omitted when empty so frames
    // for battles with no live ships (or recorded before EM reception) stay
    // byte-identical to baseline. The renderer can draw these as expanding EM
    // rings the same way it draws active-radar pulses.
    ...(emissions.length > 0
      ? {
          emissions: emissions.map((e) => ({
            sourceId: e.sourceId,
            x: e.x,
            y: e.y,
            strength: e.strength,
            t0: e.t0,
          })),
        }
      : {}),
    // Drifting wreckage (Phase 12). Omitted when none has spawned so frames for
    // battles before the first kill stay byte-identical to baseline. Emitted in
    // the order debris was spawned (id order within a tick), which is stable.
    ...(debris.length > 0
      ? {
          debris: debris.map((d) => ({
            id: d.id,
            x: d.x,
            y: d.y,
            vx: d.velX,
            vy: d.velY,
            mass: d.mass,
            radius: d.radius,
            // The engine flags every coherent fragment salvageable on spawn
            // (salvage mechanics); the salvage step collects it for whichever ship
            // sweeps over it.
            salvageable: d.salvageable,
          })),
        }
      : {}),
    // Per-ship atmosphere/breach summary. Computed from the resource state that
    // the resource step maintains; omitted when no ship has a resource state so
    // frames for battles without life-support stay byte-identical to baseline.
    // `breachedCells` counts cells below the survivable gas-mass threshold;
    // `atmosphereLevel` is the mean normalised gas mass across all module cells.
    ...atmosphereSnapshot(tick, realShips),
  };
}

/**
 * Compute the per-ship atmosphere/breach summary from the resource state of
 * every real ship that runs the resource step. Returns an object spread that
 * includes `atmosphere` only when at least one ship has resource state,
 * so frames for battles without life-support stay byte-identical to baseline.
 *
 * Subsampled on the same {@link RESOURCE_EVERY} cadence as the per-ship
 * `resource` block: the summary is derived from the same resource state, so
 * emitting it on off-ticks would drift ahead of the (omitted) resource field
 * and double the savings. The renderer's atmosphere overlay holds the
 * last-known summary between emissions.
 */
function atmosphereSnapshot(
  tick: number,
  ships: readonly SimShip[],
): { atmosphere: { shipId: string; breachedCells: number; atmosphereLevel: number }[] } | object {
  if (tick % RESOURCE_EVERY !== 0) return {};
  const survivableGasMass = STANDARD_CELL_GAS_MASS_KG * CREW_VACUUM_SURVIVABLE_FRACTION;
  const entries: { shipId: string; breachedCells: number; atmosphereLevel: number }[] = [];
  for (const s of ships) {
    if (!s.alive) continue;
    if (s.resource === undefined) continue;
    const atmo = s.resource.atmosphere;
    const n = atmo.length;
    if (n === 0) continue;
    let breached = 0;
    let totalMass = 0;
    for (let i = 0; i < n; i += 1) {
      const mass = atmo[i] ?? 0;
      totalMass += mass;
      if (mass < survivableGasMass) breached += 1;
    }
    const meanMass = totalMass / n;
    const level = STANDARD_CELL_GAS_MASS_KG > 0
      ? Math.max(0, Math.min(1, meanMass / STANDARD_CELL_GAS_MASS_KG))
      : 1;
    entries.push({ shipId: s.instanceId, breachedCells: breached, atmosphereLevel: level });
  }
  if (entries.length === 0) return {};
  return { atmosphere: entries };
}

/**
 * Build the STATIC descriptor for one ship instance: the cell layout (kind,
 * ship-local offset, surface, max HP, turret presence) and the chamfered hull
 * outline. Emitted ONCE per instance for the whole battle rather than per tick,
 * so per-tick frames carry only dynamic cell state and the renderer
 * reconstructs each cell's world position from the ship pose plus the static
 * offset here. A legacy aggregated ship with no modules gets a descriptor with
 * no `cells` (and no `outline` unless one was resolved).
 */
export function shipDescriptor(s: SimShip): ShipDescriptor {
  const base: ShipDescriptor = { instanceId: s.instanceId, side: s.side };
  if (s.outline !== undefined) base.outline = s.outline;
  if (s.modules === undefined) return base;
  return {
    ...base,
    cells: s.modules.map((m) => ({
      slotId: m.slotId,
      kind: m.kind,
      ox: m.x,
      oy: m.y,
      surface: m.surface,
      maxSurfaceHp: m.maxSurfaceHp,
      maxHp: m.maxHp,
      // Turret presence mirrors the per-frame `turretAngle` emission: the
      // renderer draws a tracking barrel only on cells flagged here.
      ...(m.turretTurnRate > 0 ? { hasTurret: true } : {}),
    })),
  };
}

/**
 * Map a crew member's internal job to the snapshot's state enum the renderer
 * reads. Injured takes priority over movement and job state — a crew member
 * below full HP has taken vacuum damage and is shown incapacitated regardless
 * of their current assignment. A walking member (one with steps left on its
 * path) shows as `walking`; an arrived hauler as `hauling`; an arrived gunner
 * as `manning`; an idle member as `idle`.
 */
export function crewState(crew: SimCrew): "idle" | "walking" | "manning" | "hauling" | "injured" {
  // Vacuum damage reduces hp below CREW_HP; the resource step removes dead crew
  // (hp <= 0) before the snapshot runs, so any crew with hp > 0 and hp < CREW_HP
  // is alive but injured.
  if (crew.hp < CREW_HP) return "injured";
  if (crew.path.length - crew.pathIndex > 0) return "walking";
  if (crew.job === "haulAmmo" || crew.job === "haulPower") return "hauling";
  if (crew.job === "manning") return "manning";
  return "idle";
}

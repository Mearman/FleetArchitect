/**
 * Per-tick snapshot serialisation: turns the live simulation state (ships,
 * projectiles, mines, pods, pulses, emissions, debris, awareness) into the
 * immutable `BattleFrame` the renderer and replay consume. Pure — it reads the
 * sim state and emits a plain frame, mutating only the transient `brokeOff`
 * marker it clears after recording. Extracted from the tick loop so the loop
 * file stays within the module-size budget.
 */

import { CELL_SIZE } from "@/domain/grid";
import type { AwarenessSnapshot, BattleFrame, CellStateArrays, MediumSnapshot, ShipDescriptor, ShipSnapshot } from "@/schema/battle";
import { CREW_HP } from "./config";
import { STANDARD_CELL_GAS_MASS_KG, CREW_VACUUM_SURVIVABLE_FRACTION } from "./lifesupport";
import type { MediumField, MediumState } from "./medium-field";
import type { SimCrew } from "../types";

import { crewCellKey } from "./crew-pathfinding";
import type { Debris } from "./debris";
import type { Emission } from "./emissions";
import type { SimPulse } from "./pulses";
import type { SimBeam } from "./beams";
import type { ExhaustParticle } from "./exhaust-particles";
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

/**
 * Per-ship cache of `crewCellKey(col, row)` → `SimModule` for the crew
 * snapshot. Lifetime-stable: a module's `col`/`row`/`x`/`y` are immutable
 * post-construction, dead modules stay in `ship.modules` marked dead (never
 * removed), and break-apart builds a fresh `SimShip` whose cache rebuilds once
 * on first snapshot. WeakMap-keyed by ship so the entry is collected with the
 * ship; checkpoint resume and break-apart create new ship objects, giving an
 * automatic cache miss → rebuild identical to a cold start.
 */
const moduleByCellCache = new WeakMap<SimShip, Map<string, SimModule>>();

function moduleByCellFor(
  ship: SimShip,
  modules: readonly SimModule[],
): Map<string, SimModule> {
  const cached = moduleByCellCache.get(ship);
  if (cached !== undefined) return cached;
  const built = new Map<string, SimModule>();
  for (const m of modules) built.set(crewCellKey(m.col, m.row), m);
  moduleByCellCache.set(ship, built);
  return built;
}

/**
 * Build one ship's per-tick {@link ShipSnapshot} in a single pass, appending
 * optional fields by direct assignment rather than nested object spreads.
 *
 * Frame serialisation (`JSON.stringify`, hashed for the lossless digest and
 * replay) is key-INSERTION-order sensitive, so the assignment order here is
 * load-bearing: it must match the order the previous `...base / ...withModules /
 * ...withResource` spreads produced — always-present core first, then brokeOff,
 * comX/comY, targetId, cells, resource, crew. Direct property assignment on a
 * plain object appends own enumerable string keys in assignment order, which is
 * byte-identical to spreading a fresh object carrying those keys in the same
 * sequence. Building one accumulator (instead of three nested intermediates)
 * removes two container allocations and two full property-copy passes per ship
 * per tick; the typed arrays and crew list are referenced once, never copied.
 */
function snapshotShip(tick: number, s: SimShip): ShipSnapshot {
  const ship: ShipSnapshot = {
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
  };
  // Record the split frame, then clear so subsequent snapshots don't carry a
  // stale "freshly broken" marker.
  if (s.brokeOff === true) {
    ship.brokeOff = true;
    s.brokeOff = false;
  }
  // Centre of mass in ship-local coordinates. Omitted when at the origin so
  // legacy replays stay byte-compatible with pre-rigid-body recordings; modular
  // ships with offset CoM always emit it.
  if (s.comX !== 0 || s.comY !== 0) {
    ship.comX = s.comX;
    ship.comY = s.comY;
  }
  // Current targeting decision (the instance id of the ship this ship is aiming
  // at this tick, or undefined when it has no live target). Emitted from the
  // deterministic pickTarget result so frame determinism is preserved; omitted
  // when there is no target so frames recorded before this field stay
  // byte-identical.
  if (s.target !== undefined) ship.targetId = s.target;
  if (s.modules === undefined) return ship;
  // Per-cell DYNAMIC state as NAMED TYPED ARRAYS. The static layout (kind,
  // ship-local offset, surface kind, max HP, turret presence) lives once per
  // battle in the ship descriptor (see `shipDescriptor` below), keyed by index.
  // The dynamic arrays are emitted in s.modules order, which is the SAME order
  // as the static descriptor's cells, so cellHp[i] corresponds to
  // ShipCellLayout.cells[i] — the renderer joins them by INDEX. The typed arrays
  // are transferred zero-copy across the worker boundary (the worker collects
  // every .buffer into the postMessage transfer list), eliminating the
  // structured-clone cost that was the source of the `[Violation] 'message'
  // handler` warnings on the heaviest frames. Float64Array holds the same
  // IEEE-754 doubles the engine uses.
  ship.cells = buildCellArrays(s.modules);
  // Resource state — emitted when the ship has run the resource step AND we are
  // on a resource-emission tick (tick % RESOURCE_EVERY === 0), so the renderer
  // and analytics can read thermal, propellant, atmosphere and power-buffer
  // values. On off-ticks the field is omitted: the resource changes slowly
  // (diffusion/depletion/venting), and the renderer holds the last-known
  // resource between emissions. Absent on phantoms and legacy ships. The arrays
  // are fresh Float64Array copies so the snapshot does not alias the live arrays
  // the engine mutates next tick. The engine computes the resource every tick
  // regardless — this is a snapshot-emission cadence, not a sim change.
  const resource = s.resource;
  if (resource !== undefined && tick % RESOURCE_EVERY === 0) {
    ship.resource = {
      thermal: Float64Array.from(resource.thermal),
      propellant: Float64Array.from(resource.propellant),
      atmosphere: Float64Array.from(resource.atmosphere),
      powerBuffer: {
        energy: resource.powerBuffer.energy,
        capacityJoules: resource.powerBuffer.capacityJoules,
      },
    };
  }
  // Crew positions and state, in ship-local coordinates. Each crew member sits
  // on the cell of the module at its (col, row); that module's x/y is the cell's
  // ship-local centre, plus the fractional render offset. Omitted when the ship
  // carries no crew so crewless replays stay byte-compatible.
  if (s.crew === undefined || s.crew.length === 0) return ship;
  const moduleByCell = moduleByCellFor(s, s.modules);
  ship.crew = s.crew.map((c) => {
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
  });
  return ship;
}

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
  beams: readonly SimBeam[],
  particles: readonly ExhaustParticle[],
  medium: { field: MediumField; state: MediumState },
): BattleFrame {
  // Partition real ships from phantoms (drones/decoys) so phantoms never appear
  // in the `ships` array — they render from their own dedicated arrays instead.
  const realShips = ships.filter((s) => s.phantom === undefined);
  const drones = ships.filter((s) => s.phantom?.kind === "drone" && s.alive);
  const decoys = ships.filter((s) => s.phantom?.kind === "decoy" && s.alive);
  return {
    tick,
    awareness,
    ships: realShips.map((s) => snapshotShip(tick, s)),
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
    // Active energy-weapon beam emissions (hitscan visuals). Omitted when empty
    // so frames for battles without beam weapons — or ticks where no beam is
    // still lingering — stay byte-identical to baseline. Each entry is the pure
    // render state for one beam: source cell world position, strike point,
    // weapon kind (for colour), and remaining emission ticks (for fade).
    ...(beams.length > 0
      ? {
          beams: beams.map((b) => ({
            sourceId: b.sourceId,
            sourceX: b.sourceX,
            sourceY: b.sourceY,
            targetX: b.targetX,
            targetY: b.targetY,
            kind: b.kind,
            emissionTicks: b.emissionTicks,
          })),
        }
      : {}),
    // Exhaust/plume particles — the live glow. Subsampled on the same
    // RESOURCE_EVERY cadence as the medium field: a long battle carries every
    // tick's live set, and emitting it every tick (thousands of frames × the live
    // count) exhausts the heap. The renderer holds the most recent emission
    // between subsamples (as the medium overlay does), so the glow stays
    // continuous. Tick 0 is always emitted (RESOURCE_EVERY divides 0). Omitted
    // when none are live so particle-free frames stay byte-identical to baseline.
    ...(tick % RESOURCE_EVERY === 0 && particles.length > 0
      ? {
          particles: particles.map((p) => ({
            x: p.x,
            y: p.y,
            vx: p.vx,
            vy: p.vy,
            intensity: p.intensity,
            age: p.age,
          })),
        }
      : {}),
    // Arena medium field (ρ + ε). Subsampled on the same RESOURCE_EVERY cadence
    // as the per-ship resource block: the medium diffuses / decays over many
    // ticks, and emitting two Float64Arrays (length widthM·heightM) every tick
    // bloats the heaviest frames for no render-side gain — the medium overlay
    // holds the last-known field between emissions exactly as the resource
    // overlay does. The engine steps the medium every tick regardless; this is
    // a snapshot-emission cadence, not a sim change. Tick 0 is always emitted
    // (RESOURCE_EVERY divides 0) so the opening frame carries the ISM baseline.
    ...(tick % RESOURCE_EVERY === 0 ? { medium: mediumSnapshot(medium) } : {}),
  };
}

/**
 * Build the {@link MediumSnapshot} for one tick: fresh Float64Array copies of
 * the ρ and ε state (so the snapshot does not alias the live arrays the engine
 * mutates in place next tick), plus the grid shape. The typed arrays are
 * transferred zero-copy across the worker boundary — `collectTransferables`
 * walks every frame's `medium.rho` / `medium.eps` and pushes the underlying
 * buffer into the postMessage transfer list, alongside the cell and resource
 * buffers.
 */
function mediumSnapshot(medium: {
  field: MediumField;
  state: MediumState;
}): MediumSnapshot {
  return {
    rho: Float64Array.from(medium.state.rho),
    eps: Float64Array.from(medium.state.eps),
    epsVis: Float64Array.from(medium.state.epsVis),
    widthM: medium.field.config.widthM,
    heightM: medium.field.config.heightM,
    pitchM: medium.field.config.pitchM,
  };
}

/**
 * Build the per-cell DYNAMIC state as NAMED TYPED ARRAYS from the ship's live
 * modules. The arrays are INDEX-MATCHED to the static {@link ShipCellLayout}
 * (both s.modules order). One pass decides which optional fields are present
 * (at least one module carries the field); a second pass allocates and fills.
 *
 * Always-present arrays: `cellHp` (Float64Array), `cellAlive` (Uint8Array 0/1).
 * Optional arrays (allocated only when at least one module has the field):
 *  - `cellSurfaceHp` (Float64Array) — 0 for bare cells.
 *  - `cellTurretAngle` (Float64Array) — NaN for non-turret cells.
 *  - `cellManned` (Uint8Array 0/1) — only for crewed modules.
 *  - `cellAmmo` (Int32Array) — -1 for cells without ammo.
 *  - `cellCharge` (Float64Array) — NaN for cells without charge.
 *  - `cellDoorN/E/S/W` (Uint8Array) — 0=no door, 1=open, 2=closed. Allocated
 *    only when the ship has at least one door.
 *  - `cellReactiveHp` (Float64Array) — NaN for non-reactive cells.
 */
function buildCellArrays(modules: readonly SimModule[]): CellStateArrays {
  const n = modules.length;
  const cellHp = new Float64Array(n);
  const cellAlive = new Uint8Array(n);
  // surfaceHp is always present: every SimModule carries a surfaceHp number
  // (0 for bare cells), and the original snapshot emitted it unconditionally.
  const cellSurfaceHp = new Float64Array(n);

  // First pass: detect which optional fields are present on at least one module.
  let hasTurret = false;
  let hasManned = false;
  let hasAmmo = false;
  let hasCharge = false;
  let hasDoors = false;
  let hasReactiveHp = false;
  for (let i = 0; i < n; i += 1) {
    const m = modules[i];
    if (m === undefined) continue;
    if (m.turretTurnRate > 0) hasTurret = true;
    if (m.crewRequired > 0) hasManned = true;
    if (m.effect.kind === "weapon" && m.effect.ammoCapacity !== undefined) hasAmmo = true;
    if (m.powerDraw > 0) hasCharge = true;
    if (m.reactiveReduction > 0) hasReactiveHp = true;
    const ds = m.edges.doorStates;
    if (ds.n !== undefined || ds.e !== undefined || ds.s !== undefined || ds.w !== undefined)
      hasDoors = true;
  }

  // Allocate the optional arrays (filled with sentinels by default).
  const cellTurretAngle = hasTurret ? new Float64Array(n) : undefined;
  if (cellTurretAngle !== undefined) cellTurretAngle.fill(NaN);
  const cellManned = hasManned ? new Uint8Array(n) : undefined;
  const cellAmmo = hasAmmo ? new Int32Array(n) : undefined;
  if (cellAmmo !== undefined) cellAmmo.fill(-1);
  const cellCharge = hasCharge ? new Float64Array(n) : undefined;
  if (cellCharge !== undefined) cellCharge.fill(NaN);
  const cellReactiveHp = hasReactiveHp ? new Float64Array(n) : undefined;
  if (cellReactiveHp !== undefined) cellReactiveHp.fill(NaN);
  const cellDoorN = hasDoors ? new Uint8Array(n) : undefined;
  const cellDoorE = hasDoors ? new Uint8Array(n) : undefined;
  const cellDoorS = hasDoors ? new Uint8Array(n) : undefined;
  const cellDoorW = hasDoors ? new Uint8Array(n) : undefined;

  // Second pass: write each module's values into its index slot.
  for (let i = 0; i < n; i += 1) {
    const m = modules[i];
    if (m === undefined) continue;
    cellHp[i] = m.hp;
    cellAlive[i] = m.alive ? 1 : 0;
    cellSurfaceHp[i] = m.surfaceHp;
    if (cellTurretAngle !== undefined && m.turretTurnRate > 0) {
      cellTurretAngle[i] = m.turretAngle;
    }
    if (cellManned !== undefined && m.crewRequired > 0) {
      cellManned[i] = m.manned ? 1 : 0;
    }
    if (cellAmmo !== undefined && m.effect.kind === "weapon" && m.effect.ammoCapacity !== undefined) {
      cellAmmo[i] = m.ammo;
    }
    if (cellCharge !== undefined && m.powerDraw > 0) {
      cellCharge[i] = m.charge;
    }
    if (cellReactiveHp !== undefined && m.reactiveReduction > 0) {
      cellReactiveHp[i] = m.reactiveHp;
    }
    if (cellDoorN !== undefined && cellDoorE !== undefined && cellDoorS !== undefined && cellDoorW !== undefined) {
      const ds = m.edges.doorStates;
      if (ds.n !== undefined) cellDoorN[i] = ds.n === "open" ? 1 : 2;
      if (ds.e !== undefined) cellDoorE[i] = ds.e === "open" ? 1 : 2;
      if (ds.s !== undefined) cellDoorS[i] = ds.s === "open" ? 1 : 2;
      if (ds.w !== undefined) cellDoorW[i] = ds.w === "open" ? 1 : 2;
    }
  }

  const result: CellStateArrays = { cellHp, cellAlive, cellSurfaceHp };
  if (cellTurretAngle !== undefined) result.cellTurretAngle = cellTurretAngle;
  if (cellManned !== undefined) result.cellManned = cellManned;
  if (cellAmmo !== undefined) result.cellAmmo = cellAmmo;
  if (cellCharge !== undefined) result.cellCharge = cellCharge;
  if (cellReactiveHp !== undefined) result.cellReactiveHp = cellReactiveHp;
  if (cellDoorN !== undefined) {
    result.cellDoorN = cellDoorN;
    result.cellDoorE = cellDoorE;
    result.cellDoorS = cellDoorS;
    result.cellDoorW = cellDoorW;
  }
  return result;
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
  const base: ShipDescriptor = {
    instanceId: s.instanceId,
    side: s.side,
    // Formation identity (formation overhaul): carried once per battle on the
    // descriptor so the renderer can group ships by formation without bloating
    // per-tick frames. Conditional spread — a ship with no formation identity
    // (legacy/test ships that never had it stamped) keeps a byte-identical
    // descriptor with the keys absent.
    ...(s.formationId !== undefined
      ? { formationId: s.formationId, role: s.role }
      : {}),
  };
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

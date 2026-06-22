import { analyseShipDesign } from "@/domain/stats";
import { cellToLocal, deriveClassification, deriveRadius, footprint } from "@/domain/grid";
import { computeOutline, extractShell } from "@/domain/outline";
import type { Catalog } from "@/domain/catalog";
import type {
  CombatShip,
  ResolvedHardwire,
  ResolvedModule,
} from "@/domain/simulation/types";
import type { Fleet } from "@/schema/fleet";
import type { CellEdges, GridCell, SurfaceKind } from "@/schema/grid";
import type { ModuleEffect, WeaponEffect } from "@/schema/module";
import type { ShipDesign } from "@/schema/ship";

/**
 * Resolve a fleet's deployed ships into combat-ready ships. The caller supplies
 * the saved designs keyed by id (typically loaded from storage). A deployed
 * ship whose design cannot be found is skipped — it has nothing to fight with —
 * so callers should validate fleet completeness beforehand.
 *
 * Fleets are authored in "attacker" coordinates (left side of the arena,
 * facing right). When a fleet is used as the defender we mirror it to the
 * opposite side — negating x and rotating facing by π — so the two sides
 * actually meet across the map instead of stacking up.
 *
 * Each resolved ship carries the per-cell module instances (with initial hit
 * points, surface/edges, and the module effect) and its classification,
 * derived from the grid, so the engine can run the per-module damage / fire /
 * regen model and the grid-exact break-apart.
 */

/**
 * Vertical clear space (metres) between adjacent ships' hull circles in the
 * deployment column. Derived from the cell grid: one cell-width
 * (`CELL_SIZE = 12 m`) plus half a cell of slack so adjacent hulls never clip
 * at tick 0. An explicit deployment-rate spec.
 */
const DEPLOY_SHIP_MARGIN_M = 18;

/**
 * Target sim-time (seconds) within which a representative ship should close from
 * its deployment line to contact with the enemy line. The deployment separation
 * is sized so an engagement reaches weapon range and fights to a conclusion in a
 * watchable span rather than the ships drifting apart for minutes.
 *
 * Why a fixed seconds target rather than a distance. With the thrust→acceleration
 * units corrected (see `ACCEL_PER_TICK_FROM_SI` in simulation/types), catalogue
 * ships accelerate at a realistic ~0.1-0.4 m/s² — three orders of magnitude below
 * the pre-fix figure. Against the old "deploy just outside max weapon range"
 * rule (which put fleets ~1 km apart) those ships could not close the gap inside
 * the battle watchdog at all: they drifted, never reached range, and the battle
 * timed out as a draw. Sizing the deployment from a kinematic CLOSING BUDGET
 * instead keeps the engagement paced to real thrust.
 *
 * 45 s sits in the middle of the intended 20-60 s engagement-onset window; at the
 * fleet's representative acceleration it yields a separation a ship can actually
 * cover. Derived as a sim-time constant; the tick conversion uses
 * `TICKS_PER_SECOND` (no magic distance literal).
 */
const DEPLOY_CLOSE_TIME_S = 45;

/**
 * Median of a list of numbers, used to pick a fleet's representative ship
 * acceleration robustly (so one outlier hull does not set the deployment pace).
 * Returns 0 for an empty list — the caller treats a zero representative
 * acceleration as "no closing budget" and falls back to the weapon reach.
 * Sorts a copy (does not mutate the input) and narrows the middle elements
 * explicitly rather than asserting them non-undefined.
 */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    const m = sorted[mid];
    return m === undefined ? 0 : m;
  }
  const lo = sorted[mid - 1];
  const hi = sorted[mid];
  if (lo === undefined || hi === undefined) return 0;
  return (lo + hi) / 2;
}

/**
 * Compute the deployment edge inset (metres from the arena midline) for ONE
 * fleet from its ship sizes, weapon reach, and — crucially — its representative
 * acceleration.
 *
 * Two opposing fleets are placed at `±edgeInset`, so the face-to-face separation
 * is `attackerEdgeInset + defenderEdgeInset` and, because both fleets accelerate
 * toward the midline, each side closes its own `edgeInset` worth of distance. The
 * inset is the SMALLER of:
 *
 *  1. The classic "just outside weapon range" reach, `maxShipRadius +
 *     maxWeaponRange` — the physically meaningful "start just out of range, then
 *     close" condition, preserved whenever ships are fast enough to honour it.
 *  2. A KINEMATIC CLOSING BUDGET: the distance a representative ship covers in
 *     `DEPLOY_CLOSE_TIME_S` while accelerating from rest at `a` (m/s²) under a
 *     stop-in-time profile (accelerate the first half, brake the second). That
 *     distance is `a · (T/2)²` per side. Sizing from this guarantees the fleet
 *     can actually reach contact in a watchable span at its real catalogue
 *     thrust — without it, the corrected (~0.1-0.4 m/s²) ships never close the
 *     kilometre-scale weapon-range separation and the battle times out.
 *
 * Taking the min means: when weapon ranges are modest relative to ship thrust the
 * old behaviour is unchanged (ships still start just out of range); when weapon
 * ranges out-reach what the ships can close in time, deployment is pulled in to
 * the closable distance so an engagement still happens. The representative `a` is
 * the fleet's MEDIAN ship acceleration (robust to a single sluggish capital or
 * nimble fighter skewing the line).
 *
 * A fleet with no weapons falls back to `fallbackRange` for the weapon-reach
 * term so an unarmed fleet still deploys at a sensible separation. Whichever term
 * wins, the result is floored at `2·maxRadius` so the largest hull's leading edge
 * never crosses the midline onto the enemy's side (see the floor below).
 *
 * The closing budget is computed entirely in SI (acceleration in m/s², time in
 * seconds → distance in metres); no tick conversion is needed because the
 * profile depends only on real-world acceleration and a real-world target time.
 */
function computeEdgeInsetM(
  ships: ReadonlyArray<{
    radius: number;
    weapons: readonly WeaponEffect[];
    accelMps2: number;
  }>,
  fallbackRange: number,
): number {
  let maxRadius = 0;
  let maxRange = 0;
  for (const s of ships) {
    if (s.radius > maxRadius) maxRadius = s.radius;
    for (const w of s.weapons) {
      if (w.range > maxRange) maxRange = w.range;
    }
  }
  const range = maxRange > 0 ? maxRange : fallbackRange;
  const weaponReach = maxRadius + range;

  // Representative acceleration: the median across the fleet's ships, so one
  // outlier (a heavy capital or a light interceptor) does not set the pace for
  // the whole line. Empty fleets never reach here (the caller filters them).
  const medianAccel = median(ships.map((s) => s.accelMps2));

  // Kinematic closing budget per side: distance covered from rest in
  // DEPLOY_CLOSE_TIME_S under a symmetric accelerate-then-brake profile, where
  // peak speed is reached at the half-time. d = a · (T/2)². A zero-thrust fleet
  // (no engines) has no budget; fall back to the weapon reach so it still
  // deploys at a finite separation (it cannot close, but neither can it freeze
  // the geometry to nothing).
  const halfTimeS = DEPLOY_CLOSE_TIME_S / 2;
  const kinematicBudget = medianAccel * halfTimeS * halfTimeS;

  // Non-crossing floor: a ship is placed with its centre at `dir·(edgeInset -
  // radius)`, so its leading (inner) hull edge sits at `2·radius - edgeInset`
  // from the midline. Keeping that edge on the fleet's own side therefore needs
  // `edgeInset >= 2·maxRadius`. The kinematic budget can fall well below this for
  // a large, sluggish hull (slow ships cover little ground in DEPLOY_CLOSE_TIME_S),
  // which would otherwise spawn the line straddling — even past — the midline.
  // Flooring at `2·maxRadius` places such a fleet as close as it can get without
  // crossing (inner edges just meeting at x=0); it cannot honour the closing
  // budget because the hull is wider than the ground it can cover, but it stays
  // on its own side. Fast fleets keep the smaller closing-budget inset unchanged.
  const minSeparation = 2 * maxRadius;
  const raw = kinematicBudget <= 0 ? weaponReach : Math.min(weaponReach, kinematicBudget);
  return Math.max(raw, minSeparation);
}

export function resolveFleetToCombatShips(
  fleet: Fleet,
  designs: ReadonlyMap<string, ShipDesign>,
  catalog: Catalog,
  side: "attacker" | "defender",
): CombatShip[] {
  // Resolve every deployable design first, carrying its radius and weapon
  // effects so the column can be spaced by actual ship size and the edge
  // inset derived from the fleet's longest weapon reach.
  const resolved = fleet.ships
    .map((deployed) => {
      const design = designs.get(deployed.designId);
      if (design === undefined) return undefined;
      const { stats } = analyseShipDesign(design, catalog);
      return {
        deployed,
        design,
        stats,
        radius: deriveRadius(design.grid),
        weapons: stats.weapons.map((w) => w.effect),
        // SI acceleration (m/s²) = thrust[N] / mass[kg]. Feeds the deployment
        // kinematic closing budget so the line is placed where this ship can
        // actually close it at real catalogue thrust. Mass is floored at 1 to
        // mirror the engine's `Math.max(ship.mass, 1)` divide-by-zero guard.
        accelMps2: stats.thrust / Math.max(stats.mass, 1),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);

  // Edge inset derived from ship sizes + weapon range (see computeEdgeInsetM).
  // The fallback for a weaponless fleet is SIM.defaultRange, now grounded
  // (Phase 9) as the EM-derived visual radius (~140 m) plus the muzzle clearance
  // (6 m). Importing SIM here would couple domain/resolve to the engine leaf, so
  // the same derivation is mirrored: visualLosRadius is the inverse-square
  // continuous-emission range sqrt(ambient / (4·PI · floor)) = 140 m (ambient is
  // anchored to 4·PI·140^2·floor), giving 140 + 6 = 146.
  const edgeInset = computeEdgeInsetM(resolved, 146);

  // Total column height: every ship's diameter plus a margin between each pair.
  const totalHeight =
    resolved.reduce((sum, e) => sum + e.radius * 2, 0) +
    Math.max(0, resolved.length - 1) * DEPLOY_SHIP_MARGIN_M;

  // Attackers face right (+x) from the left edge; defenders mirror to the right
  // edge facing left (π). Lay the column out top (most negative y) to bottom,
  // centred on y = 0.
  const dir = side === "attacker" ? -1 : 1;
  const facing = side === "attacker" ? 0 : Math.PI;
  let cursorY = -totalHeight / 2;

  const ships: CombatShip[] = [];
  for (const entry of resolved) {
    const { deployed, design, stats, radius } = entry;
    const modules = resolveModules(design, catalog);
    const hardwires = resolveHardwires(design, modules);
    const outline = computeOutline(extractShell(design.grid));
    const x = dir * (edgeInset - radius);
    const y = cursorY + radius;
    cursorY += radius * 2 + DEPLOY_SHIP_MARGIN_M;
    ships.push({
      // Stable across independent resolutions of the same fleet: side + index
      // in the array being built gives a deterministic id without crypto.randomUUID.
      instanceId: `ship_${side}_${ships.length}`,
      designId: design.id,
      faction: design.faction,
      side,
      stats,
      position: { x, y },
      facing,
      orders: deployed.orders,
      classification: deriveClassification(design.grid),
      crewPriority: design.crewPriority,
      shipStance: design.shipStance,
      rules: design.rules,
      ...(modules.length > 0 ? { modules } : {}),
      ...(hardwires.length > 0 ? { hardwires } : {}),
      ...(outline.length > 0 ? { outline } : {}),
    });
  }
  return ships;
}

/**
 * Build the per-cell module instances for a ship design. Every solid cell
 * becomes a `ResolvedModule` carrying its `surface` and `edges`, substrate HP
 * (from the substrate material) and surface HP (from the surface material: 0
 * for `bare`, the deck material's HP for `deck`, the armor material's HP for
 * `armor). Cells with equipment also carry the module effect and its
 * per-instance config. Each module's `(x, y)` is the cell's ship-local centre
 * from `cellToLocal`, and its integer `(col, row)` are carried through so
 * break-apart can union over exact 4-connected neighbours.
 */
function resolveModules(design: ShipDesign, catalog: Catalog): ResolvedModule[] {
  const grid = design.grid;
  const out: ResolvedModule[] = [];
  for (const { col, row } of footprint(grid)) {
    const cell = grid.cells[row * grid.cols + col];
    if (cell === undefined || cell.kind !== "solid") continue;
    const local = cellToLocal(col, row, grid);
    const slotId = `cell-${col}-${row}`;

    const substrate = catalog.substrateMaterial(design.faction);
    const surface = surfaceMaterialFor(cell.surface, catalog, design.faction);
    const maxSurfaceHp = surface?.hp ?? 0;
    const maxSubstrateHp = substrate?.hp ?? 0;
    const surfaceMass = surface?.mass ?? 0;
    const substrateMass = substrate?.mass ?? 0;
    // The cell's surface (armour) damage-reduction and reactive-armour fields,
    // carried so the per-cell damage pipeline can absorb a fraction of each hit
    // and spend a reactive charge. Zero for bare/deck cells and for armour
    // materials with no reactive plating.
    const surfaceReduction = surface?.damageReduction ?? 0;
    const reactiveReduction = surface?.reactiveReduction ?? 0;
    const reactiveWindow = surface?.reactiveWindow ?? 0;

    const equipment = cell.equipment;
    const moduleDef = equipment !== undefined ? catalog.module(equipment.moduleId) : undefined;
    if (equipment !== undefined && moduleDef === undefined) {
      // Unknown equipment is reported as a fault by analyseShipDesign; here we
      // still emit a module so the cell exists in the engine's grid, with a
      // hull-effect placeholder carrying the layer masses/HPs.
      out.push({
        slotId,
        moduleId: equipment.moduleId,
        kind: "hull",
        col,
        row,
        x: local.x,
        y: local.y,
        surface: cell.surface,
        edges: cell.edges,
        maxSurfaceHp,
        maxSubstrateHp,
        surfaceReduction,
        reactiveReduction,
        reactiveWindow,
        mass: surfaceMass + substrateMass,
        powerDraw: 0,
        crewRequired: 0,
        effect: { kind: "hull" },
        command: false,
        repairRate: 0,
        shieldArc: Math.PI * 2,
        shieldFacing: 0,
        facing: 0,
        weaponFacing: 0,
        turretArc: 0,
        turretTurnRate: 0,
        channel: 0,
        commsBearing: 0,
        sensorBearing: 0,
      });
      continue;
    }

    if (moduleDef === undefined) {
      // No equipment: a structural-only cell (substrate + surface). Carries a
      // hull-effect placeholder so the engine treats it as a connectivity
      // anchor with the layer masses/HPs.
      out.push({
        slotId,
        moduleId: `cell-${cell.surface}`,
        kind: "hull",
        col,
        row,
        x: local.x,
        y: local.y,
        surface: cell.surface,
        edges: cell.edges,
        maxSurfaceHp,
        maxSubstrateHp,
        surfaceReduction,
        reactiveReduction,
        reactiveWindow,
        mass: surfaceMass + substrateMass,
        powerDraw: 0,
        crewRequired: 0,
        effect: { kind: "hull" },
        command: false,
        repairRate: 0,
        shieldArc: Math.PI * 2,
        shieldFacing: 0,
        facing: 0,
        weaponFacing: 0,
        turretArc: 0,
        turretTurnRate: 0,
        channel: 0,
        commsBearing: 0,
        sensorBearing: 0,
      });
      continue;
    }

    out.push({
      slotId,
      moduleId: moduleDef.id,
      kind: moduleDef.effect.kind,
      col,
      row,
      x: local.x,
      y: local.y,
      surface: cell.surface,
      edges: cell.edges,
      maxSurfaceHp,
      maxSubstrateHp,
      surfaceReduction,
      reactiveReduction,
      reactiveWindow,
      mass: moduleDef.mass + surfaceMass + substrateMass,
      powerDraw: moduleDef.powerDraw,
      crewRequired: moduleDef.crewRequired,
      // Deep-clone so engine mutations during a battle tick do not bleed back
      // into the shared catalog singleton across separate battles.
      effect: structuredClone(moduleDef.effect),
      command: moduleDef.command === true,
      repairRate: repairRateFor(moduleDef.effect),
      shieldArc: moduleDef.shieldArc ?? Math.PI * 2,
      shieldFacing: moduleDef.shieldFacing ?? 0,
      facing: engineFacingFor(moduleDef.effect, cell),
      weaponFacing: weaponFacingFor(moduleDef.effect, cell),
      turretArc: turretArcFor(moduleDef.effect),
      turretTurnRate: turretTurnRateFor(moduleDef.effect),
      channel: commsChannelFor(moduleDef.effect, cell),
      commsBearing: commsBearingFor(moduleDef.effect, cell),
      ...(commsRangeFor(cell) !== undefined
        ? { commsRange: commsRangeFor(cell) }
        : {}),
      sensorBearing: sensorBearingFor(moduleDef.effect, cell),
      ...(sensorRangeSettingFor(cell) !== undefined
        ? { sensorRangeSetting: sensorRangeSettingFor(cell) }
        : {}),
    });
  }
  return out;
}

/** Resolve the surface material for a cell's surface kind in the given faction.
 *  `bare` resolves to undefined (no surface layer; substrate is the only
 *  structural layer). `deck` and `armor` resolve to the faction's deck /
 *  armor material respectively. The reactive fields are carried only by armour
 *  (deck and substrate never have reactive plating), so the damage pipeline can
 *  consume them per cell. */
function surfaceMaterialFor(
  surface: SurfaceKind,
  catalog: Catalog,
  faction: string,
):
  | {
      hp: number;
      mass: number;
      damageReduction: number;
      reactiveReduction: number;
      reactiveWindow: number;
    }
  | undefined {
  if (surface === "bare") return undefined;
  if (surface === "deck") {
    const deck = catalog.deckMaterial(faction);
    if (deck === undefined) return undefined;
    return {
      hp: deck.hp,
      mass: deck.mass,
      damageReduction: deck.damageReduction,
      reactiveReduction: 0,
      reactiveWindow: 0,
    };
  }
  const armor = catalog.armorMaterial(faction);
  if (armor === undefined) return undefined;
  return {
    hp: armor.hp,
    mass: armor.mass,
    damageReduction: armor.damageReduction,
    reactiveReduction: armor.reactiveReduction ?? 0,
    reactiveWindow: armor.reactiveWindow ?? 0,
  };
}

/**
 * Resolve the design grid's hardwire `connections` into per-ship link data the
 * engine can consume. Each connection's `from`/`to` cell coordinates are mapped
 * to the slot id of the module occupying that cell (the same `cell-<col>-<row>`
 * convention `resolveModules` uses). Only connections whose endpoints are both
 * equipment cells (present in `modules`) are resolved; the schema already
 * guarantees the endpoints are in-bounds and distinct, and the design validator
 * reports incompatible source/sink pairings, so well-formed links are resolved
 * directly here. A design with no connections yields an empty array, so an
 * unhardwired ship carries no hardwire data and the engine behaves identically.
 */
function resolveHardwires(
  design: ShipDesign,
  modules: readonly ResolvedModule[],
): ResolvedHardwire[] {
  const connections = design.grid.connections;
  if (connections.length === 0) return [];

  const slotByCell = new Map<string, string>();
  for (const m of modules) slotByCell.set(`${m.col},${m.row}`, m.slotId);

  const out: ResolvedHardwire[] = [];
  for (const c of connections) {
    const sourceSlotId = slotByCell.get(`${c.from.col},${c.from.row}`);
    const sinkSlotId = slotByCell.get(`${c.to.col},${c.to.row}`);
    if (sourceSlotId === undefined || sinkSlotId === undefined) continue;
    out.push({ sourceSlotId, sinkSlotId, resource: c.resource });
  }
  return out;
}

/** Read the per-tick HP-heal rate off a module's effect. Only repair modules
 *  have one; every other kind contributes 0. */
function repairRateFor(effect: ModuleEffect): number {
  if (effect.kind === "repair") return effect.repairRate;
  return 0;
}

/** Engine thrust direction (radians, ship-local): the cell equipment's facing
 *  for an engine, 0 for everything else (their facing is unused by the engine). */
function engineFacingFor(effect: ModuleEffect, cell: GridCell): number {
  if (effect.kind !== "engine") return 0;
  return cell.kind === "solid" && cell.equipment !== undefined ? cell.equipment.facing : 0;
}

/** Weapon fire direction (radians, ship-local): the cell equipment's facing
 *  for a weapon, 0 for everything else. */
function weaponFacingFor(effect: ModuleEffect, cell: GridCell): number {
  if (effect.kind !== "weapon") return 0;
  return cell.kind === "solid" && cell.equipment !== undefined ? cell.equipment.facing : 0;
}

/** Turret traverse half-arc (radians) for a weapon; 0 (fixed mount) otherwise. */
function turretArcFor(effect: ModuleEffect): number {
  if (effect.kind !== "weapon") return 0;
  return effect.turretArc ?? 0;
}

/** Turret slew speed (radians per tick) for a weapon; 0 (fixed) otherwise. */
function turretTurnRateFor(effect: ModuleEffect): number {
  if (effect.kind !== "weapon") return 0;
  return effect.turretTurnRate ?? 0;
}

/** Comms channel: the cell equipment's per-instance override when set, else
 *  the comms effect's own channel. 0 for non-comms modules (never read). */
function commsChannelFor(effect: ModuleEffect, cell: GridCell): number {
  if (effect.kind !== "comms") return 0;
  if (cell.kind === "solid" && cell.equipment?.channel !== undefined) return cell.equipment.channel;
  return effect.channel;
}

/** Comms mount bearing (radians, ship-local): the cell equipment's per-instance
 *  override when set, else the comms effect's bearing. 0 for non-comms modules. */
function commsBearingFor(effect: ModuleEffect, cell: GridCell): number {
  if (effect.kind !== "comms") return 0;
  if (cell.kind === "solid" && cell.equipment?.commsBearing !== undefined) {
    return cell.equipment.commsBearing;
  }
  return effect.bearing;
}

/** Per-instance variable-comms range setting from the cell equipment, or
 *  undefined when none was set. Only meaningful for variable comms modules;
 *  the engine ignores it on every other kind. */
function commsRangeFor(cell: GridCell): number | undefined {
  if (cell.kind !== "solid" || cell.equipment === undefined) return undefined;
  return cell.equipment.commsRange;
}

/** Sensor mount bearing (radians, ship-local): the cell equipment's per-instance
 *  override when set, else the sensor effect's bearing. 0 for non-sensor modules. */
function sensorBearingFor(effect: ModuleEffect, cell: GridCell): number {
  if (effect.kind !== "sensor") return 0;
  if (cell.kind === "solid" && cell.equipment?.sensorBearing !== undefined) {
    return cell.equipment.sensorBearing;
  }
  return effect.bearing;
}

/** Per-instance variable-sensor range setting from the cell equipment, or
 *  undefined when none was set. Only meaningful for variable sensor modules;
 *  the engine ignores it on every other kind. */
function sensorRangeSettingFor(cell: GridCell): number | undefined {
  if (cell.kind !== "solid" || cell.equipment === undefined) return undefined;
  return cell.equipment.sensorRangeSetting;
}

/**
 * Minimal per-cell descriptor used for thumbnail rendering. Each entry
 * corresponds to one solid cell in the design grid, with its ship-local
 * position and the `kind` used to colour it (the same `kind` the battle
 * renderer uses via `MODULE_COLOUR`).
 *
 * `ox` / `oy` are ship-local offsets in metres (from `cellToLocal`, the same
 * origin the simulation uses) so callers can position each cell relative to
 * the ship's centre without re-walking the grid.
 *
 * `maxHp` is the combined starting HP of the surface and substrate layers,
 * used by the thumbnail to initialise each cell's HP fraction at 1.0 (all
 * alive, full health).
 */
export interface DesignCell {
  slotId: string;
  ox: number;
  oy: number;
  kind: ResolvedModule["kind"];
  maxHp: number;
}

/**
 * Return the per-cell layout for a ship design as a flat array of
 * `DesignCell`s, reusing `resolveModules` as the single source of truth for
 * cell kind, position, and HP values. The caller does not need to walk the
 * grid or duplicate the kind-derivation logic.
 *
 * Pure: no side effects, no DOM, no storage.
 */
export function designCellLayout(design: ShipDesign, catalog: Catalog): DesignCell[] {
  return resolveModules(design, catalog).map((m) => ({
    slotId: m.slotId,
    ox: m.x,
    oy: m.y,
    kind: m.kind,
    maxHp: m.maxSubstrateHp + m.maxSurfaceHp,
  }));
}

// Re-exported for engine consumers that need the edge shape.
export type { CellEdges };

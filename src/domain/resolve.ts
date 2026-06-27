import { analyseShipDesign } from "@/domain/stats";
import { CELL_SIZE, cellToLocal, deriveClassification, deriveRadius, footprint } from "@/domain/grid";
import { computeOutline, extractShell } from "@/domain/outline";
import { cellCoverageFractions } from "@/domain/hull-outline";
import { growArmourHull, padGrid } from "@/domain/hull-armour";
import { hasPatternLayout, placeByPattern } from "@/domain/deploy";
import type { ResolvedEntry, ShipBuilder } from "@/domain/deploy";
import type { Catalog } from "@/domain/catalog";
import type {
  CombatShip,
  ResolvedHardwire,
  ResolvedModule,
} from "@/domain/simulation/types";
import type { Fleet } from "@/schema/fleet";
import { collectFormationLeaves } from "@/schema/formation";
import type { Doctrine } from "@/schema/ai";
import type { CellEdges, GridCell, SurfaceKind } from "@/schema/grid";
import type { ModuleEffect, WeaponEffect } from "@/schema/module";
import type { ShipDesign } from "@/schema/ship";

/**
 * Resolve a ship's effective doctrine: the fleet-ship leaf doctrine overrides
 * the design doctrine axis-by-axis (most-specific wins — a per-ship `stance`
 * beats the design's), and the rule lists concatenate leaf-first then design
 * (the more specific scope is evaluated before it falls through). Pure.
 */
function overlayDoctrine(
  design: Doctrine | undefined,
  leaf: Doctrine | undefined,
): Doctrine {
  const base = { ...(design?.base ?? {}), ...(leaf?.base ?? {}) };
  const rules = [...(leaf?.rules ?? []), ...(design?.rules ?? [])];
  return { base, rules };
}

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
 * deployment column. DERIVED from the cell grid as one ship-length of slack:
 * `DEPLOY_SHIP_MARGIN_CELLS × CELL_SIZE`, so adjacent hulls never clip at tick 0
 * and the column has visible breathing room at the km combat scale. Following
 * the cell scale keeps it grounded rather than a bare metre literal.
 */
const DEPLOY_SHIP_MARGIN_CELLS = 30;
const DEPLOY_SHIP_MARGIN_M = DEPLOY_SHIP_MARGIN_CELLS * CELL_SIZE;

/**
 * The innate visual line-of-sight radius (metres) a sensorless ship has — the
 * weaponless-fleet deployment fallback's dominant term. This MIRRORS the engine's
 * `SIM.visualLosRadius` (the EM-derived `VISUAL_LOS_REFERENCE_M` in
 * `engine/config.ts`): importing the engine config here would couple the pure
 * `domain/resolve` layer to the engine leaf, so the anchor is restated rather than
 * imported. It MUST track that config anchor — both are the same km-combat innate
 * sight reference. A weaponless fleet has no weapon reach to stand off by, so it
 * deploys at the range its own baseline receiver can keep a fix (this radius)
 * plus the half-cell muzzle clearance.
 */
const VISUAL_LOS_REFERENCE_M = 5_000;

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
 * Re-grounded for km combat (Phase 3). Three coupled terms now bound deployment
 * (see `computeEdgeInsetM`): weapon reach, this kinematic closing budget, and a
 * SIGHT CAP (a fleet must form up within mutual detection range — ~5 km for a
 * sensorless ship — or it cannot acquire a target and engage). The close-time is
 * set so a representative fleet's closing budget (`a · (T/2)²`) lands at the
 * KILOMETRE sight scale — at the catalogue's representative ~0.14 m/s²
 * acceleration, `a · (T/2)²` at 270 s is ~2.5 km per side (~5 km line-to-line) —
 * so a myopic fleet forms up right at the edge of its ~5 km sight, which is ALSO
 * where its desired engagement range is now capped (the held range cannot exceed
 * sight; see `sightReach` in `translation.ts`). The deployment range and the
 * desired hold range therefore coincide, so the slow catalogue ships neither
 * charge in nor back off — they hold at sight and brawl decisively while their
 * long-reach guns (a beam ~52 km, the kinetics ~12-30 km) fire from the opening
 * tick. A shorter close-time spawned them inside that hold range, where they
 * milled and drifted apart trying to back off to it; a faster or sensor-equipped
 * fleet has a larger budget or longer sight, so its weapon-reach or sight cap
 * binds first and it stands off further. Derived as a sim-time constant; the tick
 * conversion uses `TICKS_PER_SECOND` (no magic distance literal).
 */
const DEPLOY_CLOSE_TIME_S = 270;

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
 * The longest distance (metres) at which a design can detect an enemy: the
 * greater of the innate naked-eye visual radius ({@link VISUAL_LOS_REFERENCE_M},
 * mirroring `SIM.visualLosRadius`) and its best sensor module's `detectionRange`.
 * A design with no sensor module sees only as far as its naked eye; a sensor
 * extends that reach. Walks the design's equipment cells and reads each sensor
 * module's range from the catalogue. Used to cap the deployment separation so
 * ships are never placed beyond mutual sight at tick 0 (a fleet that cannot see
 * an enemy cannot steer toward it, and would stalemate where it stands).
 */
function maxSightReach(design: ShipDesign, catalog: Catalog): number {
  let reach = VISUAL_LOS_REFERENCE_M;
  const grid = design.grid;
  for (const { col, row } of footprint(grid)) {
    const cell = grid.cells[row * grid.cols + col];
    if (cell === undefined || cell.kind !== "solid") continue;
    const equipment = cell.equipment;
    if (equipment === undefined) continue;
    const moduleDef = catalog.module(equipment.moduleId);
    if (moduleDef === undefined) continue;
    const effect = moduleDef.effect;
    if (effect.kind !== "sensor") continue;
    if (effect.detectionRange > reach) reach = effect.detectionRange;
  }
  return reach;
}

/**
 * Compute the deployment edge inset (metres from the arena midline) for ONE
 * fleet from its ship sizes, weapon reach, sight reach, and — crucially — its
 * representative acceleration.
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
 *  3. A SIGHT CAP: `maxRadius + fleetSightReach / 2`, so the two opposing fleet
 *     lines are placed within mutual detection range at tick 0. A fleet that
 *     cannot SEE the enemy cannot steer toward it (targeting reads the awareness
 *     map, which is empty beyond sight), so it would stalemate where it stands.
 *     With km-scale weapon reach now far exceeding a sensorless ship's ~5 km
 *     innate sight, this cap is what keeps a myopic fleet engaging at all: it
 *     forms up inside its sight and fights close, while a sensor-equipped fleet
 *     (whose `fleetSightReach` is its sensor `detectionRange`) may deploy out at
 *     the longer reach and open fire across the larger gap — sensors literally
 *     extending the engagement range, exactly as intended.
 *
 * Taking the min means: when weapon ranges are modest relative to ship thrust the
 * old behaviour is unchanged (ships still start just out of range); when weapon
 * ranges out-reach what the ships can close in time OR see across, deployment is
 * pulled in to the closable, visible distance so an engagement still happens. The
 * representative `a` is the fleet's MEDIAN ship acceleration (robust to a single
 * sluggish capital or nimble fighter skewing the line); the sight reach is the
 * fleet's BEST detection range (its longest-seeing ship sets how far the line can
 * stand off, since one spotter feeds the comms net).
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
    sightReachM: number;
    accelMps2: number;
  }>,
  fallbackRange: number,
): number {
  let maxRadius = 0;
  let maxRange = 0;
  let maxSight = 0;
  for (const s of ships) {
    if (s.radius > maxRadius) maxRadius = s.radius;
    if (s.sightReachM > maxSight) maxSight = s.sightReachM;
    for (const w of s.weapons) {
      if (w.range > maxRange) maxRange = w.range;
    }
  }
  const range = maxRange > 0 ? maxRange : fallbackRange;
  const weaponReach = maxRadius + range;

  // Sight cap (term 3): place opposing lines within mutual detection at tick 0.
  // Two ships' centres sit `2·(edgeInset - radius)` apart, so keeping that
  // centre-to-centre gap within the fleet's best detection reach needs
  // `edgeInset <= maxRadius + maxSight / 2`. A myopic fleet (sight = innate
  // ~5 km) is held close; a sensor-equipped fleet may stand off at its sensor
  // reach.
  const sightCap = maxRadius + maxSight / 2;

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
  // Stand off no further than the closest of: just-outside-weapon-range, the
  // kinematic closing budget, and mutual sight. A zero-thrust fleet has no
  // closing budget, so it is held at the smaller of weapon reach and sight.
  const reachCap = kinematicBudget <= 0
    ? Math.min(weaponReach, sightCap)
    : Math.min(weaponReach, kinematicBudget, sightCap);
  return Math.max(reachCap, minSeparation);
}

/**
 * Build a {@link CombatShip} from a resolved entry at a given position and
 * facing. This is the shared per-ship builder: it runs the per-cell module
 * resolution, hardwire and outline derivation, and stamps the formation
 * identity (formationId/chain/role) from the leaf. Both deployment paths call
 * it (the legacy column directly; the pattern walk via a {@link ShipBuilder}
 * closure) so a ship resolved through either path carries identical data —
 * only `position` and `facing` differ, computed by each path's geometry.
 */
function buildCombatShip(
  entry: ResolvedEntry,
  position: { x: number; y: number },
  facing: number,
  side: "attacker" | "defender",
  instanceIndex: number,
  catalog: Catalog,
): CombatShip {
  const { leaf, design, grownDesign, stats } = entry;
  const modules = resolveModules(grownDesign, catalog);
  const hardwires = resolveHardwires(grownDesign, modules);
  const outline = computeOutline(extractShell(grownDesign.grid));
  // Formation identity, threaded from the leaf's formation context. Stamped
  // via conditional spread so a direct-constructed CombatShip (a test fixture)
  // without them keeps an unchanged cache key; resolve-built ships always
  // carry them.
  const { formationId, formationChain, role } = leaf;
  return {
    // Stable across independent resolutions of the same fleet: side + index
    // in the array being built gives a deterministic id without crypto.randomUUID.
    instanceId: `ship_${side}_${instanceIndex}`,
    designId: design.id,
    faction: design.faction,
    side,
    stats,
    position,
    facing,
    classification: deriveClassification(grownDesign.grid),
    // The resolved authored doctrine (design overlaid by the leaf). Source of
    // truth for the engine.
    doctrine: overlayDoctrine(design.doctrine, leaf.ship.doctrine),
    ...(modules.length > 0 ? { modules } : {}),
    ...(hardwires.length > 0 ? { hardwires } : {}),
    ...(outline.length > 0 ? { outline } : {}),
    ...(formationId !== undefined ? { formationId, formationChain, role } : {}),
  };
}

export function resolveFleetToCombatShips(
  fleet: Fleet,
  designs: ReadonlyMap<string, ShipDesign>,
  catalog: Catalog,
  side: "attacker" | "defender",
): CombatShip[] {
  // Resolve every deployable design first, carrying its radius and weapon
  // effects so the column can be spaced by actual ship size and the edge
  // inset derived from the fleet's longest weapon reach. The formation tree is
  // walked in pre-order DFS via `collectFormationLeaves` — for a flat root of
  // ship leaves (no layout) this yields exactly the legacy `fleet.ships` order,
  // so the column and every instanceId are byte-identical to the pre-formation
  // resolve. Each leaf also carries its formation identity (formationId, chain,
  // role), stamped onto the resolved CombatShip below.
  const leaves = collectFormationLeaves(fleet.formation);
  const resolved: ResolvedEntry[] = leaves
    .map((leaf): ResolvedEntry | undefined => {
      const design = designs.get(leaf.ship.designId);
      if (design === undefined) return undefined;
      // Derive the grown design once per ship so stats, radius, and the main
      // loop all work from the same expanded grid.
      const grownDesign = { ...design, grid: growArmourHull(padGrid(design.grid, 1)) };
      // Pass the raw design: analyseShipDesign grows once internally, so feeding
      // it the grown grid would double-grow. resolveModules below takes the
      // already-grown grid (single-grow on both paths).
      const { stats } = analyseShipDesign(design, catalog);
      return {
        leaf,
        design,
        grownDesign,
        stats,
        radius: deriveRadius(grownDesign.grid),
        weapons: stats.weapons.map((w) => w.effect),
        sightReachM: maxSightReach(design, catalog),
        accelMps2: stats.thrust / Math.max(stats.mass, 1),
      };
    })
    .filter((entry): entry is ResolvedEntry => entry !== undefined);

  // Edge inset derived from ship sizes + weapon range (see computeEdgeInsetM).
  // The fallback for a weaponless fleet is SIM.defaultRange, grounded as the
  // EM-derived innate visual radius (now ~5 km at the km combat scale) plus the
  // half-cell muzzle clearance. Importing SIM here would couple domain/resolve to
  // the engine leaf, so the same derivation is mirrored from the same anchors:
  // visualLosRadius = sqrt(ambient / (4·PI · floor)) = VISUAL_LOS_REFERENCE_M
  // (5000 m, since ambient is anchored to 4·PI·5000^2·floor), giving
  // 5000 + CELL_SIZE / 2 — the same value SIM.defaultRange evaluates to.
  const edgeInset = computeEdgeInsetM(resolved, VISUAL_LOS_REFERENCE_M + CELL_SIZE / 2);

  // Pattern branch: if any formation in the tree carries a `pattern` layout,
  // walk the tree and place each leaf by its authored geometry (pattern offset
  // or explicit slot override). The ship builder is threaded as a closure so
  // `placeByPattern` (in `deploy.ts`) stays independent of this module's
  // per-ship helpers — no import cycle. A fleet with no pattern layouts
  // anywhere falls through to the legacy column below, byte-identical to the
  // pre-formation resolve (the preset path).
  if (hasPatternLayout(fleet.formation)) {
    const buildShip: ShipBuilder = (entry, position, facing, instanceIndex) =>
      buildCombatShip(entry, position, facing, side, instanceIndex, catalog);
    return placeByPattern(fleet.formation, resolved, edgeInset, side, buildShip);
  }

  // Legacy column branch (byte-identical for flat/column fleets).
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
    const { radius } = entry;
    const x = dir * (edgeInset - radius);
    const y = cursorY + radius;
    cursorY += radius * 2 + DEPLOY_SHIP_MARGIN_M;
    ships.push(buildCombatShip(entry, { x, y }, facing, side, ships.length, catalog));
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
  // Fraction of each cell inside the bevelled hull outline: a cell the render
  // crop truncates to a partial tile carries proportional HP and proportional
  // layer mass, so a corner cut to half its area hits like half a plate and
  // carries half the substrate + surface mass. Equipment (module) mass stays
  // whole — a module is wholly present regardless of the cell clip.
  const coverage = cellCoverageFractions(grid);
  const out: ResolvedModule[] = [];
  for (const { col, row } of footprint(grid)) {
    const cell = grid.cells[row * grid.cols + col];
    if (cell === undefined || cell.kind !== "solid") continue;
    const local = cellToLocal(col, row, grid);
    const slotId = `cell-${col}-${row}`;

    const substrate = catalog.substrateMaterial(design.faction);
    const surface = surfaceMaterialFor(cell.surface, catalog, design.faction);
    const frac = coverage[row * grid.cols + col]!;
    const maxSurfaceHp = (surface?.hp ?? 0) * frac;
    const maxSubstrateHp = (substrate?.hp ?? 0) * frac;
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
        mass: (surfaceMass + substrateMass) * frac,
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
        mass: (surfaceMass + substrateMass) * frac,
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
      mass: moduleDef.mass + (surfaceMass + substrateMass) * frac,
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

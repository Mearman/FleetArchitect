import type { ModuleEffect } from "@/schema/module";
import { recomputeAggregates } from "./physics";
import type { SimModule, SimShip } from "./types";

/**
 * Effect scaling for multi-cell (polyomino) modules: a module's output magnitudes
 * scale with its SURVIVING covered cells. Today the anchor keeps full capability
 * until it dies; covered cells are ablative only. Scaling makes a stripped lance
 * fire weaker, a stripped drive thrust less, etc. — the gameplay payoff for big
 * footprints.
 *
 * Mechanism: each tick, AFTER deaths and BEFORE `recomputeAggregates` folds the
 * ship aggregates, {@link applyEffectScaling} overwrites each alive anchor's
 * `m.effect` magnitude fields with `base × fraction`, where `fraction =
 * (1 + aliveCovers) / totalCells` (the anchor counts as one cell). Every engine
 * consumer reads the live `m.effect`, so it picks up the scaled value
 * automatically — no per-read-site multiplication. The unscaled `base` is held
 * in {@link AnchorScalingMeta}, captured at setup from the anchor's resolved
 * effect (the engine never mutates its input, so it is a stable base).
 *
 * Determinate: `fraction` is a pure function of the alive set (already in the
 * frame via `cellAlive`), computed once per anchor per topology change. The
 * scaling metadata lives on `SimShip.scalingMeta`, captured by the checkpoint,
 * so resume is byte-identical. A single-cell module (footprint `[{0,0}]`) has no
 * `scalingMeta` entry, so an all-1×1 fleet is a no-op — byte-identical to today.
 */

/** The scaling metadata for one multi-cell anchor, keyed by its `slotId`. */
export interface AnchorScalingMeta {
  /** The anchor cell's `slotId` (`"cell-{col}-{row}"`). */
  slotId: string;
  /** Total cells the module occupies (anchor + covers) = `coverSlotIds.length + 1`. */
  totalCells: number;
  /** `slotId` of each covered cell (footprint offsets ≠ {0,0}, resolved to coords). */
  coverSlotIds: string[];
  /** The module's unscaled effect (a clone of the resolved effect at setup). The
   *  engine mutates the anchor's own `m.effect`, never this object. */
  base: ModuleEffect;
}

/**
 * Recompute each alive anchor's effect magnitudes from its surviving covers, then
 * fold the aggregates. Runs at every site that currently calls
 * `recomputeAggregates` (the per-tick recompute at step 4b, after overcharge, and
 * after break-apart). The scaling MUST precede the fold: `recomputeAggregates`
 * reads `effect.capacity`/`output`/`thrust` during its single pass, so the
 * mutation has to land first. Gated together so a skipped recompute (no
 * aggregate change) also skips the scaling — the previous tick's mutation is
 * still valid for an unchanged alive set.
 */
export function recomputeAggregatesWithScaling(ship: SimShip): void {
  applyEffectScaling(ship);
  recomputeAggregates(ship);
}

/**
 * Per-ship slotId → module lookup for effect scaling, keyed on the identity of
 * `ship.modules`. The mapping is invariant for the lifetime of a given array
 * reference: module objects are mutated in place but never removed, reordered,
 * or re-keyed, and `slotId` is authored once and never reassigned. A WeakMap
 * keys on the array object, so the survivor path (which keeps the same
 * `ship.modules` reference through break-apart) reuses the cached Map, while a
 * fresh chunk array (break-apart's `chunkModules`) naturally misses and rebuilds
 * once. Mirrors the WeakMap precedent in `directional-shield-cache.ts`. Only
 * used for point lookups (`.get`), never iterated, so its construction order has
 * no bearing on the fold's arithmetic — pure allocation removal.
 */
const slotIndexCache = new WeakMap<readonly SimModule[], Map<string, SimModule>>();

/**
 * Overwrite each alive anchor's effect magnitudes with `base × fraction`, where
 * `fraction = (1 + aliveCovers) / totalCells`. No-op when the ship carries no
 * multi-cell modules (the all-1×1 case) so existing fleets are byte-identical.
 * Pure function of the alive set; idempotent.
 */
export function applyEffectScaling(ship: SimShip): void {
  const meta = ship.scalingMeta;
  if (meta === undefined || meta.length === 0) return;
  const modules = ship.modules;
  if (modules === undefined) return;
  // slotId → module lookup, cached per modules-array identity (see above).
  let bySlot = slotIndexCache.get(modules);
  if (bySlot === undefined) {
    bySlot = new Map<string, SimModule>();
    for (const m of modules) bySlot.set(m.slotId, m);
    slotIndexCache.set(modules, bySlot);
  }
  for (const entry of meta) {
    const anchor = bySlot.get(entry.slotId);
    // A dead anchor is an inert cell; its effect is not read by consumers, so
    // leave it untouched (no functional change, and avoids mutating a module
    // whose capability no longer matters).
    if (anchor === undefined || !anchor.alive) continue;
    let aliveCovers = 0;
    for (const coverSlotId of entry.coverSlotIds) {
      const cover = bySlot.get(coverSlotId);
      if (cover !== undefined && cover.alive) aliveCovers += 1;
    }
    const fraction = (1 + aliveCovers) / entry.totalCells;
    scaleEffectByKind(anchor, entry.base, fraction);
  }
}

/**
 * Scale a multi-cell anchor's output magnitudes by `fraction`, reading the
 * unscaled values from `base`. Only the magnitude fields per kind are scaled —
 * never the identity/flag fields (`kind`, `weaponType`, `powered`, `guided`,
 * arcs, bearings), which the engine discriminates on. Each case narrows both
 * `base` (via the switch) and `anchor.effect` (via the kind guard) without a
 * type assertion. Repair is the one module-field output (`m.repairRate`, read at
 * `index.ts`'s repair step) rather than an effect field.
 */
function scaleEffectByKind(
  anchor: SimModule,
  base: ModuleEffect,
  fraction: number,
): void {
  const effect = anchor.effect;
  switch (base.kind) {
    case "weapon":
      if (effect.kind === "weapon") effect.damage = base.damage * fraction;
      break;
    case "pointDefense":
      if (effect.kind === "pointDefense") effect.damage = base.damage * fraction;
      break;
    case "shield":
      if (effect.kind === "shield") {
        effect.capacity = base.capacity * fraction;
        effect.rechargeRate = base.rechargeRate * fraction;
      }
      break;
    case "deflector":
      if (effect.kind === "deflector") {
        effect.capacity = base.capacity * fraction;
        effect.rechargeRate = base.rechargeRate * fraction;
      }
      break;
    case "power":
      if (effect.kind === "power") effect.output = base.output * fraction;
      break;
    case "engine":
      if (effect.kind === "engine") effect.thrust = base.thrust * fraction;
      break;
    case "sensor":
      if (effect.kind === "sensor") {
        effect.detectionRange = base.detectionRange * fraction;
        if (base.emitStrength !== undefined && effect.emitStrength !== undefined) {
          effect.emitStrength = base.emitStrength * fraction;
        }
      }
      break;
    case "comms":
      if (effect.kind === "comms") {
        effect.range = base.range * fraction;
        effect.bandwidth = Math.round(base.bandwidth * fraction);
      }
      break;
    case "rcs":
    case "reactionWheel":
      if (effect.kind === base.kind) effect.torque = base.torque * fraction;
      break;
    case "repair":
      // repairRate is a module field (read at the repair step), not the effect.
      anchor.repairRate = base.repairRate * fraction;
      break;
    case "hangar":
      if (effect.kind === "hangar") {
        effect.droneHp = base.droneHp * fraction;
        effect.droneDamage = base.droneDamage * fraction;
        effect.droneRange = base.droneRange * fraction;
        effect.droneSpeed = base.droneSpeed * fraction;
      }
      break;
    case "mineLayer":
      if (effect.kind === "mineLayer") effect.mineDamage = base.mineDamage * fraction;
      break;
    case "boarding":
      if (effect.kind === "boarding") effect.troops = Math.max(1, Math.round(base.troops * fraction));
      break;
    // Kinds with no scaled output (crew capacity and magazine ammoStored are
    // stores, not outputs; hull is inert; blink/afterburner/overcharge/cloak/
    // signature/ecm/eccm/decoy/commandAura are single-cell by design and never
    // appear here) need no case.
    default:
      break;
  }
}

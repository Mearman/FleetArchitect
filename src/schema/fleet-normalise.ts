import { Fleet } from "./fleet";
import { flatFormation } from "./formation";

/**
 * One-time migration of a stored fleet record into the formation-tree shape.
 *
 * A fleet persisted before the formation overhaul carries a flat `ships[]`
 * array; the current schema carries a `formation` tree. This lifts the legacy
 * body to a flat root formation (ship leaves, no layout ⇒ the deployment
 * column), so a record written under the old shape parses under the new one and
 * resolves byte-identically. It is a data-migration transform at the storage
 * read boundary — the same pattern as the grid's `scaffold → substrate` parse
 * migration — not legacy support: after this runs every Fleet in the running
 * app is in the formation shape, and no domain code branches on the old form.
 *
 * Narrowing uses only `typeof` / `in` / `Array.isArray` (no type assertions).
 * Idempotent: a record already carrying `formation` is returned unchanged, so
 * re-reading a migrated record is a no-op.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The legacy `engageRange` fraction of max weapon range. Mirrors
 * `SIM.rangeFraction` in `engine/config.ts` (short 0.3 / medium 0.55 / long
 * 0.85); restated here because the schema layer cannot import engine config.
 * `hold` is handled separately (it is not a fraction).
 */
function engageFraction(engageRange: string): number | undefined {
  switch (engageRange) {
    case "short":
      return 0.3;
    case "medium":
      return 0.55;
    case "long":
      return 0.85;
    default:
      return undefined;
  }
}

/**
 * Compile a legacy `orders` object into a doctrine `base` action. The scalar
 * axes map directly; the weapon-relative range intent compiles to a spatial
 * objective relative to the `target` reference (the ship's current elected
 * target — the legacy range-keeping semantics). Only fields present on the
 * legacy record are carried; a well-formed `orders` populates every axis.
 */
export function compileOrdersToBase(orders: unknown): Record<string, unknown> {
  const base: Record<string, unknown> = {};
  if (!isRecord(orders)) return base;
  if (typeof orders.stance === "string") base.stance = orders.stance;
  const targeting: Record<string, unknown> = {};
  if (typeof orders.targetPriority === "string") {
    targeting.mode = { kind: orders.targetPriority };
  }
  if (typeof orders.vulnerableTargetWeight === "number") {
    targeting.vulnerableWeight = orders.vulnerableTargetWeight;
  }
  if (typeof orders.focusFire === "boolean") targeting.focusFire = orders.focusFire;
  if (Object.keys(targeting).length > 0) base.targeting = targeting;
  if (typeof orders.formationKeeping === "number") base.cohesion = orders.formationKeeping;
  if (typeof orders.retreatThreshold === "number") base.retreat = orders.retreatThreshold;
  if (typeof orders.engageRange === "string" && typeof orders.rangeKeepingBand === "number") {
    const range =
      orders.engageRange === "hold"
        ? { kind: "hold", band: orders.rangeKeepingBand }
        : engageRangeToRange(orders.engageRange, orders.rangeKeepingBand);
    if (range !== undefined) {
      base.spatial = { reference: { kind: "target" }, range, bearing: { kind: "free" } };
    }
  }
  return base;
}

function engageRangeToRange(
  engageRange: string,
  rangeKeepingBand: number,
): { kind: "engage"; fraction: number; tolerance: number } | undefined {
  const fraction = engageFraction(engageRange);
  if (fraction === undefined) return undefined;
  return { kind: "engage", fraction, tolerance: rangeKeepingBand };
}

/** Lift one legacy fleet ship: keep `orders`, add a `doctrine` compiled from it. */
function normaliseFleetShipInput(ship: unknown): unknown {
  if (!isRecord(ship)) return ship;
  if ("doctrine" in ship) return ship;
  if (!("orders" in ship)) return ship;
  return { ...ship, doctrine: { base: compileOrdersToBase(ship.orders), rules: [] } };
}

/** Walk a formation tree, compiling each ship leaf's `orders` → `doctrine`. */
function normaliseFormationTree(formation: unknown): unknown {
  if (!isRecord(formation) || !Array.isArray(formation.children)) return formation;
  return { ...formation, children: formation.children.map(normaliseFormationNode) };
}

function normaliseFormationNode(node: unknown): unknown {
  if (!isRecord(node)) return node;
  if (node.kind === "ship") {
    return { ...node, ship: normaliseFleetShipInput(node.ship) };
  }
  if (node.kind === "formation") {
    return { ...node, formation: normaliseFormationTree(node.formation) };
  }
  // kind === "template": expanded before resolve; nothing to normalise here.
  return node;
}

export function normaliseFleetInput(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  // Resolve the formation: use the existing one, or lift a legacy `ships[]`.
  let formation: unknown;
  if ("formation" in raw) {
    formation = raw.formation;
  } else if ("ships" in raw && Array.isArray(raw.ships)) {
    formation = flatFormation(raw.ships);
  } else {
    return raw;
  }
  // Walk the tree so every ship leaf carries a doctrine (compiled from `orders`
  // when it lacks one). The stray legacy `ships` key is stripped by Zod on parse.
  return { ...raw, formation: normaliseFormationTree(formation) };
}

/**
 * Parse a stored fleet record through the normaliser then the schema, so every
 * read boundary (Dexie load/list/restore/copy, revision history) returns a
 * validated formation-shaped Fleet. Centralised here so no read path can skip
 * the migration. A record that is neither legacy nor new (truly corrupt) fails
 * loudly at `Fleet.parse` — the project's contract for unparseable input.
 */
export function parseFleetRecord(record: unknown): Fleet {
  return Fleet.parse(normaliseFleetInput(record));
}

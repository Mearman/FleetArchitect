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

export function normaliseFleetInput(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  // Already migrated: nothing to do.
  if ("formation" in raw) return raw;
  if (!("ships" in raw)) return raw;
  const ships = raw.ships;
  if (!Array.isArray(ships)) return raw;
  // Spread the legacy body and add the formation; the stray `ships` key is
  // stripped by Zod on parse (unknown keys are removed by default), so it
  // cannot shadow the formation.
  return { ...raw, formation: flatFormation(ships) };
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

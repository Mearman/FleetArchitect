import Dexie, { type DexieOptions, type Table } from "dexie";
import type { BattleResult } from "@/schema/battle";
import type { Fleet } from "@/schema/fleet";
import { z } from "zod";
import { ShipDesign, DesignSource } from "@/schema/ship";
import { EntityId } from "@/schema/primitives";
import {
  compactDesignForSerialization,
  type SerializedShipDesign,
} from "@/schema/grid-compact";
import { createId, nowIso } from "@/domain/id";
import type { Repository, Storage } from "./contract";

/** Internal key-value record, used for one-time boot tasks like seeding. */
export interface MetaRecord {
  key: string;
  value: unknown;
}

/**
 * A snapshot of a ShipDesign at a specific revision, stored for history.
 * The composite key is { id, revision }. Stored in the compacted
 * serialisation shape (solid cells may omit all-open `edges`), reparsed to a
 * full `ShipDesign` on read.
 */
export type DesignRevisionRecord = SerializedShipDesign;

/**
 * A snapshot of a Fleet at a specific revision, stored for history.
 * The composite key is { id, revision }.
 */
export type FleetRevisionRecord = Fleet;

/**
 * One cached deterministic battle result. The composite content `key` (see
 * `src/domain/cache/key.ts`) addresses the entry; `bytes` is the serialised size
 * for the byte-budget eviction; `lastAccess` is an epoch-ms timestamp bumped on
 * read for LRU eviction. This table is SEPARATE from the write-only `battles`
 * history (which is keyed by random id and records every play): the cache is a
 * memoisation tier read back by content hash, the history is an audit log.
 */
export interface SimCacheRecord {
  key: string;
  result: BattleResult;
  bytes: number;
  lastAccess: number;
}

/**
 * Dexie-backed IndexedDB database. The schema version lives here; bump it and
 * add a `.version(n).upgrade()` step when the stored shape changes. Stores not
 * mentioned in a newer version are inherited unchanged.
 */
class FleetArchitectDatabase extends Dexie {
  ships!: Table<SerializedShipDesign, string>;
  fleets!: Table<Fleet, string>;
  battles!: Table<BattleResult, string>;
  meta!: Table<MetaRecord, string>;
  design_revisions!: Table<DesignRevisionRecord, [string, number]>;
  fleet_revisions!: Table<FleetRevisionRecord, [string, number]>;
  simCache!: Table<SimCacheRecord, string>;

  constructor(name = "fleet-architect", options?: DexieOptions) {
    super(name, options);
    this.version(1).stores({
      ships: "id, name, updatedAt",
      fleets: "id, name, updatedAt",
      battles: "id, playedAt",
    });
    // Adds the meta key-value store for boot-time bookkeeping.
    this.version(2).stores({
      meta: "key",
    });
    // Grid model: ShipDesign is now an authoritative tile grid (no hullId /
    // placements). The stored indexes are unchanged (id / name / updatedAt),
    // so this bump only marks the record-shape change. No data migration —
    // old slot-based records are abandoned (acceptable in alpha) and new
    // designs are written in the grid shape.
    this.version(3).stores({
      ships: "id, name, updatedAt",
    });
    // Phase 9: version history stores. Composite key [id, revision] lets us
    // efficiently list all revisions for a given id and retrieve a specific one.
    this.version(4).stores({
      design_revisions: "[id+revision], id",
      fleet_revisions: "[id+revision], id",
    });
    // Deterministic battle result cache (Part 1 of the cache plan). Keyed by the
    // content hash; `lastAccess` and `bytes` are indexed for LRU + byte-budget
    // eviction. Separate from the write-only `battles` history.
    this.version(5).stores({
      simCache: "key, lastAccess, bytes",
    });
  }
}

let db: FleetArchitectDatabase | undefined;

function database(): FleetArchitectDatabase {
  if (db === undefined) {
    db = new FleetArchitectDatabase();
  }
  return db;
}

/**
 * Replace the singleton database instance. Used in tests to inject a
 * fake-indexeddb-backed instance so tests do not share state. Also clears the
 * `storage()` singleton so code that reads through the repository contract
 * (e.g. `seedPresets`) rebinds to the injected database rather than a stale
 * wrapper around a previous one.
 */
export function _setDatabaseForTesting(instance: FleetArchitectDatabase): void {
  db = instance;
  singleton = undefined;
}

/**
 * Expose the database constructor for test helpers that need to spin up a
 * fresh instance against a fake IndexedDB.
 */
export { FleetArchitectDatabase };

function makeRepository<T extends { id: string }>(
  table: Table<T, string>,
): Repository<T> {
  return {
    list: () => table.toArray(),
    get: (id) => table.get(id),
    save: async (entity) => {
      await table.put(entity);
    },
    remove: async (id) => {
      await table.delete(id);
    },
  };
}

/**
 * Repository over ship designs. Designs are stored in the compacted
 * serialisation shape (solid cells may omit all-open `edges`) and reparsed
 * through `ShipDesign` on read so consumers always see a full design with its
 * defaults filled in.
 */
function makeShipRepository(
  table: Table<SerializedShipDesign, string>,
): Repository<ShipDesign> {
  return {
    list: async () => (await table.toArray()).map((d) => ShipDesign.parse(d)),
    get: async (id) => {
      const record = await table.get(id);
      return record === undefined ? undefined : ShipDesign.parse(record);
    },
    save: async (entity) => {
      await table.put(compactDesignForSerialization(entity));
    },
    remove: async (id) => {
      await table.delete(id);
    },
  };
}

export function createStorage(): Storage {
  const instance = database();
  return {
    ships: makeShipRepository(instance.ships),
    fleets: makeRepository(instance.fleets),
    battles: makeRepository(instance.battles),
  };
}

let singleton: Storage | undefined;

/** Process-wide storage singleton (one Dexie instance per tab). */
export function storage(): Storage {
  if (singleton === undefined) {
    singleton = createStorage();
  }
  return singleton;
}

/**
 * The `simCache` Dexie table on the singleton database, for the IndexedDB
 * durable tier of the result cache. Exposed so `DexieSimCache` can be composed
 * at the UI edge without the storage internals leaking; tests rebind the
 * database via `_setDatabaseForTesting`, so this always resolves the current
 * instance.
 */
export function simCacheTable(): Table<SimCacheRecord, string> {
  return database().simCache;
}

/** Read a meta value, or undefined if the key has never been set. Callers
 *  narrow the `unknown` value with a type guard — meta stores untyped flags. */
export async function getMeta(key: string): Promise<unknown> {
  const record = await database().meta.get(key);
  return record?.value;
}

/** Write a meta value. */
export async function setMeta(key: string, value: unknown): Promise<void> {
  await database().meta.put({ key, value });
}

// ---------------------------------------------------------------------------
// Ship design operations
// ---------------------------------------------------------------------------

/**
 * Save a ship design. Throws if the design is a preset — presets are read-only.
 * If a record already exists at this id, the current HEAD is archived to
 * design_revisions and the revision counter is incremented on the new record.
 */
export async function saveShipDesign(design: ShipDesign): Promise<void> {
  if (design.source === "preset") {
    throw new Error(
      `Cannot overwrite preset design "${design.name}" (id: ${design.id}). Copy it first.`,
    );
  }
  const instance = database();
  const stored = await instance.ships.get(design.id);
  const existing = stored === undefined ? undefined : ShipDesign.parse(stored);
  if (existing !== undefined && existing.source !== "preset") {
    await instance.design_revisions.put(
      compactDesignForSerialization(existing),
    );
  }
  const nextRevision =
    existing !== undefined ? existing.revision + 1 : design.revision;
  await instance.ships.put(
    compactDesignForSerialization({ ...design, revision: nextRevision }),
  );
}

/**
 * Load a ship design by id. Returns undefined if not found.
 */
export async function loadShipDesign(id: string): Promise<ShipDesign | undefined> {
  const record = await database().ships.get(id);
  return record === undefined ? undefined : ShipDesign.parse(record);
}

/**
 * List all ship designs.
 */
export async function listShipDesigns(): Promise<ShipDesign[]> {
  const records = await database().ships.toArray();
  return records.map((record) => ShipDesign.parse(record));
}

/**
 * The minimal id + provenance projection of a stored ship record. Read without
 * a full `ShipDesign.parse` so that stale or legacy-shaped records — which by
 * design no longer parse — can still be enumerated for reseed. Reseed only ever
 * needs to know which ids the player owns; it must not choke on a record whose
 * grid shape predates the current schema.
 */
const ShipSummary = z.object({
  id: EntityId,
  source: DesignSource.optional(),
});
export type ShipSummary = z.infer<typeof ShipSummary>;

/**
 * List every stored ship record as an { id, source } summary, tolerating
 * legacy/invalid full-record shapes. Rows whose id cannot be read are skipped
 * (they cannot be addressed for replacement in any case).
 */
export async function listShipSummaries(): Promise<ShipSummary[]> {
  const records = await database().ships.toArray();
  const summaries: ShipSummary[] = [];
  for (const record of records) {
    const parsed = ShipSummary.safeParse(record);
    if (parsed.success) summaries.push(parsed.data);
  }
  return summaries;
}

/**
 * Delete a ship design by id.
 */
export async function deleteShipDesign(id: string): Promise<void> {
  await database().ships.delete(id);
}

/**
 * Copy a ship design: loads the original, assigns a new id, sets source to
 * "user" and revision to 1, clears any revision history context, and saves
 * the copy. Returns the new record.
 */
export async function copyDesign(id: string): Promise<ShipDesign> {
  const stored = await database().ships.get(id);
  if (stored === undefined) {
    throw new Error(`Ship design not found: ${id}`);
  }
  const original = ShipDesign.parse(stored);
  const copy: ShipDesign = {
    ...original,
    id: createId("design"),
    source: "user",
    revision: 1,
    name: `${original.name} (copy)`,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await database().ships.put(compactDesignForSerialization(copy));
  return copy;
}

// ---------------------------------------------------------------------------
// Fleet operations
// ---------------------------------------------------------------------------

/**
 * Save a fleet. Throws if the fleet is a preset — presets are read-only.
 * If a record already exists at this id, the current HEAD is archived to
 * fleet_revisions and the revision counter is incremented on the new record.
 */
export async function saveFleet(fleet: Fleet): Promise<void> {
  if (fleet.source === "preset") {
    throw new Error(
      `Cannot overwrite preset fleet "${fleet.name}" (id: ${fleet.id}). Copy it first.`,
    );
  }
  const instance = database();
  const existing = await instance.fleets.get(fleet.id);
  if (existing !== undefined && existing.source !== "preset") {
    await instance.fleet_revisions.put(existing);
  }
  const nextRevision =
    existing !== undefined ? existing.revision + 1 : fleet.revision;
  await instance.fleets.put({ ...fleet, revision: nextRevision });
}

/**
 * Load a fleet by id. Returns undefined if not found.
 */
export async function loadFleet(id: string): Promise<Fleet | undefined> {
  return database().fleets.get(id);
}

/**
 * List all fleets.
 */
export async function listFleets(): Promise<Fleet[]> {
  return database().fleets.toArray();
}

/**
 * Delete a fleet by id.
 */
export async function deleteFleet(id: string): Promise<void> {
  await database().fleets.delete(id);
}

/**
 * Copy a fleet: loads the original, assigns a new id, sets source to "user"
 * and revision to 1, and saves the copy. Returns the new record.
 */
export async function copyFleet(id: string): Promise<Fleet> {
  const original = await database().fleets.get(id);
  if (original === undefined) {
    throw new Error(`Fleet not found: ${id}`);
  }
  const copy: Fleet = {
    ...original,
    id: createId("fleet"),
    source: "user",
    revision: 1,
    name: `${original.name} (copy)`,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await database().fleets.put(copy);
  return copy;
}

// ---------------------------------------------------------------------------
// Revision history
// ---------------------------------------------------------------------------

/**
 * List all archived revisions of a ship design, sorted newest first.
 * The current HEAD is not included — only prior snapshots.
 */
export async function listDesignRevisions(id: string): Promise<ShipDesign[]> {
  const revisions = await database()
    .design_revisions.where("id")
    .equals(id)
    .toArray();
  return revisions
    .map((record) => ShipDesign.parse(record))
    .sort((a, b) => b.revision - a.revision);
}

/**
 * Restore a ship design to a prior revision. Loads the snapshot from the
 * revisions store, saves it as the new HEAD (which archives the current HEAD
 * and bumps the revision again), and returns the restored record.
 */
export async function restoreDesignRevision(
  id: string,
  revision: number,
): Promise<ShipDesign> {
  const stored = await database().design_revisions.get([id, revision]);
  if (stored === undefined) {
    throw new Error(`No revision ${revision} found for ship design ${id}`);
  }
  const snapshot = ShipDesign.parse(stored);
  // saveShipDesign archives the current HEAD and bumps the revision.
  await saveShipDesign({ ...snapshot, updatedAt: nowIso() });
  const restored = await database().ships.get(id);
  if (restored === undefined) {
    throw new Error(`Ship design ${id} not found after restore`);
  }
  return ShipDesign.parse(restored);
}

/**
 * List all archived revisions of a fleet, sorted newest first.
 * The current HEAD is not included — only prior snapshots.
 */
export async function listFleetRevisions(id: string): Promise<Fleet[]> {
  const revisions = await database()
    .fleet_revisions.where("id")
    .equals(id)
    .toArray();
  return revisions.sort((a, b) => b.revision - a.revision);
}

/**
 * Restore a fleet to a prior revision. Loads the snapshot from the
 * revisions store, saves it as the new HEAD (which archives the current HEAD
 * and bumps the revision again), and returns the restored record.
 */
export async function restoreFleetRevision(
  id: string,
  revision: number,
): Promise<Fleet> {
  const snapshot = await database().fleet_revisions.get([id, revision]);
  if (snapshot === undefined) {
    throw new Error(`No revision ${revision} found for fleet ${id}`);
  }
  await saveFleet({ ...snapshot, updatedAt: nowIso() });
  const restored = await database().fleets.get(id);
  if (restored === undefined) {
    throw new Error(`Fleet ${id} not found after restore`);
  }
  return restored;
}

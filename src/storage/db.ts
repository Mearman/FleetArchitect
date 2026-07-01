import Dexie, { type DexieOptions, type Table } from "dexie";
import type { BattleFrame, BattleResult } from "@/schema/battle";
import type { EngineCheckpoint } from "@/schema/checkpoint";
import type { Fleet } from "@/schema/fleet";
import { parseFleetRecord } from "@/schema/fleet-normalise";
import { FormationTemplate } from "@/schema/formation-template";
import { z } from "zod";
import { type ShipDesign, DesignSource } from "@/schema/ship";
import { parseDesignRecord } from "@/schema/ship-normalise";
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
 * A snapshot of a FormationTemplate at a specific revision, stored for history.
 * The composite key is { id, revision }. Reparsed through `FormationTemplate`
 * on read so consumers always see a validated template.
 */
export type FormationTemplateRevisionRecord = FormationTemplate;

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
 * One in-progress battle checkpoint, the resume state for an interrupted run.
 * Keyed by the same content `key` as {@link SimCacheRecord} (one latest
 * checkpoint per matchup — overwrite on each capture). `checkpoint` is the
 * engine snapshot to resume from; `preFrames` are the frames up to and including
 * `checkpoint.tick`, which the resume decorator stitches onto the resumed run's
 * tail (the resumed engine yields only frames `tick+1..end`) to reconstruct the
 * full `BattleResult`. `updatedAt` is an epoch-ms timestamp for diagnostics.
 * Stored via `structuredClone` semantics (Dexie / IndexedDB), never JSON, so
 * the checkpoint's `±Infinity` / `-0` fields survive exactly.
 */
export interface CheckpointRecord {
  key: string;
  checkpoint: EngineCheckpoint;
  preFrames: BattleFrame[];
  updatedAt: number;
  /** Serialised size estimate (typed-array bytes + coarse overhead) for the
   *  byte-budget eviction, mirroring `SimCacheRecord.bytes`. */
  bytes: number;
}

/**
 * Dexie-backed IndexedDB database. The schema version lives here; bump it and
 * add a `.version(n).upgrade()` step when the stored shape changes. Stores not
 * mentioned in a newer version are inherited unchanged.
 */
class FleetArchitectDatabase extends Dexie {
  ships!: Table<SerializedShipDesign, string>;
  fleets!: Table<Fleet, string>;
  formationTemplates!: Table<FormationTemplate, string>;
  meta!: Table<MetaRecord, string>;
  design_revisions!: Table<DesignRevisionRecord, [string, number]>;
  fleet_revisions!: Table<FleetRevisionRecord, [string, number]>;
  formation_template_revisions!: Table<FormationTemplateRevisionRecord, [string, number]>;
  simCache!: Table<SimCacheRecord, string>;
  checkpoints!: Table<CheckpointRecord, string>;

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
    // In-progress battle checkpoints (Part 2 of the cache plan, Phase 10). One
    // latest checkpoint per content key (overwrite on capture); `updatedAt` is
    // indexed for diagnostics. The resume decorator deletes the entry once the
    // full result is computed (and cached by the result-cache tier).
    this.version(6).stores({
      checkpoints: "key, updatedAt",
    });
    // Drop the write-only battles history. Nothing read it, and after SI
    // re-grounding inflated per-tick frames the structured clone of the full
    // BattleResult threw DataCloneError out of memory. Dexie deletes a store
    // only when a newer version sets it to null; version(1)'s declaration is
    // left intact so the upgrade chain stays consistent.
    this.version(7).stores({ battles: null });
    // Phase F: formation templates — the by-reference formation subtree asset
    // a fleet's `template` node links to. Indexed by id (primary), name (for
    // lookup lists), and updatedAt (for recency sorts). The version-history
    // store uses the same composite [id+revision] key as the ship/fleet
    // revision stores so prior snapshots can be listed and restored.
    this.version(8).stores({
      formationTemplates: "id, name, updatedAt",
      formation_template_revisions: "[id+revision], id",
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
    list: async () => (await table.toArray()).map((d) => parseDesignRecord(d)),
    get: async (id) => {
      const record = await table.get(id);
      return record === undefined ? undefined : parseDesignRecord(record);
    },
    save: async (entity) => {
      await table.put(compactDesignForSerialization(entity));
    },
    remove: async (id) => {
      await table.delete(id);
    },
  };
}

/**
 * Repository over fleets. Each record is parsed through {@link parseFleetRecord}
 * on read so a legacy `ships[]` record (written before the formation overhaul)
 * is lifted to the formation-tree shape and validated, and every consumer sees a
 * current-shape Fleet. Mirrors the ship repository's parse-on-read contract.
 */
function makeFleetRepository(table: Table<Fleet, string>): Repository<Fleet> {
  return {
    list: async () => (await table.toArray()).map(parseFleetRecord),
    get: async (id) => {
      const record = await table.get(id);
      return record === undefined ? undefined : parseFleetRecord(record);
    },
    save: async (entity) => {
      await table.put(entity);
    },
    remove: async (id) => {
      await table.delete(id);
    },
  };
}

/**
 * Repository over formation templates. Each record is parsed through
 * {@link FormationTemplate} on read so consumers always see a validated
 * template (the recursive Formation subtree is re-validated at every read).
 * Mirrors the ship/fleet parse-on-read contract.
 */
function makeFormationTemplateRepository(
  table: Table<FormationTemplate, string>,
): Repository<FormationTemplate> {
  return {
    list: async () => (await table.toArray()).map((r) => FormationTemplate.parse(r)),
    get: async (id) => {
      const record = await table.get(id);
      return record === undefined ? undefined : FormationTemplate.parse(record);
    },
    save: async (entity) => {
      await table.put(entity);
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
    fleets: makeFleetRepository(instance.fleets),
    formationTemplates: makeFormationTemplateRepository(instance.formationTemplates),
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

/**
 * The `checkpoints` Dexie table on the singleton database, for the IndexedDB
 * tier of the in-progress-run resume store. Exposed so `DexieCheckpointStore`
 * can be composed at the UI edge without the storage internals leaking; tests
 * rebind the database via `_setDatabaseForTesting`, so this always resolves the
 * current instance.
 */
export function checkpointsTable(): Table<CheckpointRecord, string> {
  return database().checkpoints;
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
  const existing = stored === undefined ? undefined : parseDesignRecord(stored);
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
  return record === undefined ? undefined : parseDesignRecord(record);
}

/**
 * List all ship designs.
 */
export async function listShipDesigns(): Promise<ShipDesign[]> {
  const records = await database().ships.toArray();
  return records.map((record) => parseDesignRecord(record));
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
  const original = parseDesignRecord(stored);
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
  // Parse the existing row before reading .revision / .source: a legacy row can
  // store revision in a shape that reads as NaN off the raw record, corrupting
  // the next-revision counter. The revision archive stores the raw row (the
  // history is format-faithful); the parsed Fleet drives the logic.
  const existingRaw = await instance.fleets.get(fleet.id);
  const existing =
    existingRaw === undefined ? undefined : parseFleetRecord(existingRaw);
  if (existingRaw !== undefined && existing?.source !== "preset") {
    await instance.fleet_revisions.put(existingRaw);
  }
  const nextRevision =
    existing !== undefined ? existing.revision + 1 : fleet.revision;
  await instance.fleets.put({ ...fleet, revision: nextRevision });
}

/**
 * Load a fleet by id. Returns undefined if not found.
 */
export async function loadFleet(id: string): Promise<Fleet | undefined> {
  const record = await database().fleets.get(id);
  return record === undefined ? undefined : parseFleetRecord(record);
}

/**
 * List all fleets.
 */
export async function listFleets(): Promise<Fleet[]> {
  const records = await database().fleets.toArray();
  return records.map(parseFleetRecord);
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
  const stored = await database().fleets.get(id);
  if (stored === undefined) {
    throw new Error(`Fleet not found: ${id}`);
  }
  const original = parseFleetRecord(stored);
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
    .map((record) => parseDesignRecord(record))
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
  const snapshot = parseDesignRecord(stored);
  // saveShipDesign archives the current HEAD and bumps the revision.
  await saveShipDesign({ ...snapshot, updatedAt: nowIso() });
  const restored = await database().ships.get(id);
  if (restored === undefined) {
    throw new Error(`Ship design ${id} not found after restore`);
  }
  return parseDesignRecord(restored);
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
  return revisions
    .map(parseFleetRecord)
    .sort((a, b) => b.revision - a.revision);
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
  const snapshotRecord = await database().fleet_revisions.get([id, revision]);
  if (snapshotRecord === undefined) {
    throw new Error(`No revision ${revision} found for fleet ${id}`);
  }
  const snapshot = parseFleetRecord(snapshotRecord);
  await saveFleet({ ...snapshot, updatedAt: nowIso() });
  const restored = await database().fleets.get(id);
  if (restored === undefined) {
    throw new Error(`Fleet ${id} not found after restore`);
  }
  return parseFleetRecord(restored);
}

// ---------------------------------------------------------------------------
// Formation template operations
// ---------------------------------------------------------------------------

/**
 * Save a formation template. Throws if the template is a preset — presets are
 * read-only. If a record already exists at this id, the current HEAD is
 * archived to formation_template_revisions and the revision counter is
 * incremented on the new record. Mirrors {@link saveFleet}.
 */
export async function saveFormationTemplate(
  template: FormationTemplate,
): Promise<void> {
  if (template.source === "preset") {
    throw new Error(
      `Cannot overwrite preset formation template "${template.name}" (id: ${template.id}). Copy it first.`,
    );
  }
  const instance = database();
  // Parse the existing row before reading .revision / .source (see saveFleet):
  // a legacy row can read as NaN off the raw record and corrupt the counter.
  const existingRaw = await instance.formationTemplates.get(template.id);
  const existing =
    existingRaw === undefined ? undefined : FormationTemplate.parse(existingRaw);
  if (existingRaw !== undefined && existing?.source !== "preset") {
    await instance.formation_template_revisions.put(existingRaw);
  }
  const nextRevision =
    existing !== undefined ? existing.revision + 1 : template.revision;
  await instance.formationTemplates.put({ ...template, revision: nextRevision });
}

/**
 * Load a formation template by id. Returns undefined if not found.
 */
export async function loadFormationTemplate(
  id: string,
): Promise<FormationTemplate | undefined> {
  const record = await database().formationTemplates.get(id);
  return record === undefined ? undefined : FormationTemplate.parse(record);
}

/**
 * List all formation templates.
 */
export async function listFormationTemplates(): Promise<FormationTemplate[]> {
  const records = await database().formationTemplates.toArray();
  return records.map((r) => FormationTemplate.parse(r));
}

/**
 * Delete a formation template by id.
 */
export async function deleteFormationTemplate(id: string): Promise<void> {
  await database().formationTemplates.delete(id);
}

/**
 * Copy a formation template: loads the original, assigns a new id, sets source
 * to "user" and revision to 1, and saves the copy. Returns the new record.
 */
export async function copyFormationTemplate(
  id: string,
): Promise<FormationTemplate> {
  const stored = await database().formationTemplates.get(id);
  if (stored === undefined) {
    throw new Error(`Formation template not found: ${id}`);
  }
  const original = FormationTemplate.parse(stored);
  const copy: FormationTemplate = {
    ...original,
    id: createId("ftpl"),
    source: "user",
    revision: 1,
    name: `${original.name} (copy)`,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await database().formationTemplates.put(copy);
  return copy;
}

/**
 * List all archived revisions of a formation template, sorted newest first.
 * The current HEAD is not included — only prior snapshots.
 */
export async function listFormationTemplateRevisions(
  id: string,
): Promise<FormationTemplate[]> {
  const revisions = await database()
    .formation_template_revisions.where("id")
    .equals(id)
    .toArray();
  return revisions
    .map((r) => FormationTemplate.parse(r))
    .sort((a, b) => b.revision - a.revision);
}

/**
 * Restore a formation template to a prior revision. Loads the snapshot from the
 * revisions store, saves it as the new HEAD (which archives the current HEAD
 * and bumps the revision again), and returns the restored record.
 */
export async function restoreFormationTemplateRevision(
  id: string,
  revision: number,
): Promise<FormationTemplate> {
  const snapshotRecord = await database().formation_template_revisions.get([
    id,
    revision,
  ]);
  if (snapshotRecord === undefined) {
    throw new Error(
      `No revision ${revision} found for formation template ${id}`,
    );
  }
  const snapshot = FormationTemplate.parse(snapshotRecord);
  await saveFormationTemplate({ ...snapshot, updatedAt: nowIso() });
  const restored = await database().formationTemplates.get(id);
  if (restored === undefined) {
    throw new Error(`Formation template ${id} not found after restore`);
  }
  return FormationTemplate.parse(restored);
}

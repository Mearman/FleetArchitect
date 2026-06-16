import Dexie, { type Table } from "dexie";
import type { BattleResult } from "@/schema/battle";
import type { Fleet } from "@/schema/fleet";
import type { ShipDesign } from "@/schema/ship";
import type { Repository, Storage } from "./contract";

/** Internal key-value record, used for one-time boot tasks like seeding. */
export interface MetaRecord {
  key: string;
  value: unknown;
}

/**
 * Dexie-backed IndexedDB database. The schema version lives here; bump it and
 * add a `.version(n).upgrade()` step when the stored shape changes. Stores not
 * mentioned in a newer version are inherited unchanged.
 */
class FleetArchitectDatabase extends Dexie {
  ships!: Table<ShipDesign, string>;
  fleets!: Table<Fleet, string>;
  battles!: Table<BattleResult, string>;
  meta!: Table<MetaRecord, string>;

  constructor() {
    super("fleet-architect");
    this.version(1).stores({
      ships: "id, name, updatedAt",
      fleets: "id, name, updatedAt",
      battles: "id, playedAt",
    });
    // Adds the meta key-value store for boot-time bookkeeping.
    this.version(2).stores({
      meta: "key",
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

export function createStorage(): Storage {
  const instance = database();
  return {
    ships: makeRepository(instance.ships),
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

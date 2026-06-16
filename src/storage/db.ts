import Dexie, { type Table } from "dexie";
import type { BattleResult } from "@/schema/battle";
import type { Fleet } from "@/schema/fleet";
import type { ShipDesign } from "@/schema/ship";
import type { Repository, Storage } from "./contract";

/**
 * Dexie-backed IndexedDB database. The schema version lives here; bump it and
 * add a `.version(n).upgrade()` step when the stored shape changes.
 */
class FleetArchitectDatabase extends Dexie {
  ships!: Table<ShipDesign, string>;
  fleets!: Table<Fleet, string>;
  battles!: Table<BattleResult, string>;

  constructor() {
    super("fleet-architect");
    this.version(1).stores({
      ships: "id, name, updatedAt",
      fleets: "id, name, updatedAt",
      battles: "id, playedAt",
    });
  }
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
  const db = new FleetArchitectDatabase();
  return {
    ships: makeRepository(db.ships),
    fleets: makeRepository(db.fleets),
    battles: makeRepository(db.battles),
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

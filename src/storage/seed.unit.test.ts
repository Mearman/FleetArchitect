/**
 * Reseed tests: a record written before the `source` field existed (a sourceless
 * legacy preset with the old cell shape and no `grid.connections`) must be
 * force-replaced by the current bundled preset, while a genuine player-authored
 * (`source: "user"`) record at a preset id is preserved. The old skip logic
 * keyed on `source !== "preset"`, which wrongly protected the sourceless legacy
 * records and left them in the store to crash the resolver.
 *
 * Uses fake-indexeddb. Legacy records are inserted through the raw IndexedDB API
 * so the deliberately schema-invalid shape does not need a type assertion.
 */
import { beforeEach, describe, expect, it } from "vitest";
import fakeIndexedDB, { IDBKeyRange } from "fake-indexeddb";
import {
  FleetArchitectDatabase,
  _setDatabaseForTesting,
  loadShipDesign,
  saveShipDesign,
} from "@/storage/db";
import { seedPresets } from "@/storage/seed";
import { presetDesigns } from "@/data/presets";
import { nowIso } from "@/domain/id";

let dbCounter = 0;

function freshDatabase(): FleetArchitectDatabase {
  dbCounter += 1;
  const db = new FleetArchitectDatabase(`seed-test-db-${dbCounter}`, {
    indexedDB: fakeIndexedDB,
    IDBKeyRange,
  });
  _setDatabaseForTesting(db);
  return db;
}

/** Insert a record straight into the object store via the raw IndexedDB API,
 *  bypassing Dexie's typing so a legacy (schema-invalid) shape can be written. */
function putRaw(db: FleetArchitectDatabase, store: string, value: object): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.backendDB().transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

describe("seedPresets — legacy record migration", () => {
  beforeEach(() => {
    freshDatabase();
  });

  it("force-replaces a sourceless legacy preset record with the current bundled design", async () => {
    const db = freshDatabase();
    await db.open();
    const preset = presetDesigns[0];
    if (preset === undefined) throw new Error("no preset designs bundled");

    // A pre-`source` legacy record at the same id: old cell kinds, no
    // `grid.connections`, no `source`. Exactly the shape that lingered in real
    // stores and crashed `resolveHardwires`.
    await putRaw(db, "ships", {
      id: preset.id,
      name: "Stale Legacy Ship",
      grid: {
        cols: 1,
        rows: 1,
        cells: [{ kind: "hull" }],
        shape: { outlineMode: "octilinear" },
      },
    });

    await seedPresets();

    const replaced = await loadShipDesign(preset.id);
    expect(replaced).toBeDefined();
    expect(replaced?.source).toBe("preset");
    expect(Array.isArray(replaced?.grid.connections)).toBe(true);
    expect(replaced?.name).toBe(preset.name);
    expect(replaced?.grid.cells.every((c) => c.kind === "empty" || c.kind === "solid")).toBe(true);
  });

  it("preserves a player-authored design at a preset id", async () => {
    freshDatabase();
    const preset = presetDesigns[0];
    if (preset === undefined) throw new Error("no preset designs bundled");
    // A real user design occupying a preset id (a copy made before the preset
    // changed). saveShipDesign writes a valid `source: "user"` record.
    await saveShipDesign({
      id: preset.id,
      name: "My Custom Ship",
      faction: "Terran",
      grid: {
        cols: 1,
        rows: 1,
        cells: [
          {
            kind: "solid",
            substrate: true,
            surface: "deck",
            edges: { n: "wall", e: "wall", s: "wall", w: "wall", doorStates: {} },
          },
        ],
        connections: [],
        shape: { outlineMode: "octilinear" },
      },
      createdAt: nowIso(),
      updatedAt: nowIso(),
      source: "user",
      revision: 1,
      shipStance: "balanced",
      crewPriority: "combat",
      rules: [],
    });

    await seedPresets();

    const kept = await loadShipDesign(preset.id);
    expect(kept?.source).toBe("user");
    expect(kept?.name).toBe("My Custom Ship");
  });
});

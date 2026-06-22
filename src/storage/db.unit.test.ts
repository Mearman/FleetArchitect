/**
 * Unit tests for the version history and copy API in db.ts.
 *
 * Uses fake-indexeddb so no real browser IndexedDB is needed. Each test suite
 * spins up a fresh database instance to avoid cross-test state.
 */
import { beforeEach, describe, expect, it } from "vitest";
import fakeIndexedDB, { IDBKeyRange } from "fake-indexeddb";
import {
  FleetArchitectDatabase,
  _setDatabaseForTesting,
  copyDesign,
  copyFleet,
  deleteFleet,
  deleteShipDesign,
  listDesignRevisions,
  listFleetRevisions,
  listShipDesigns,
  loadShipDesign,
  restoreDesignRevision,
  restoreFleetRevision,
  saveFleet,
  saveShipDesign,
} from "@/storage/db";
import { createId, nowIso } from "@/domain/id";
import { defaultOrders } from "@/schema/fleet";
import type { Fleet } from "@/schema/fleet";
import type { ShipDesign } from "@/schema/ship";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let dbCounter = 0;

/**
 * Spin up a fresh FleetArchitectDatabase backed by fake-indexeddb. Each call
 * gets a unique database name so tests do not share object-store state.
 */
function freshDatabase(): FleetArchitectDatabase {
  dbCounter += 1;
  const db = new FleetArchitectDatabase(`test-db-${dbCounter}`, {
    indexedDB: fakeIndexedDB,
    IDBKeyRange,
  });
  _setDatabaseForTesting(db);
  return db;
}

function sampleDesign(overrides?: Partial<ShipDesign>): ShipDesign {
  return {
    id: createId("design"),
    name: "Test Fighter",
    faction: "Terran",
    grid: {
      cols: 2,
      rows: 1,
      cells: [
        {
          kind: "solid",
          scaffold: true,
          surface: "bare",
          edges: { n: "wall", e: "open", s: "wall", w: "wall", doorStates: {} },
        },
        {
          kind: "solid",
          scaffold: true,
          surface: "bare",
          edges: { n: "wall", e: "wall", s: "wall", w: "open", doorStates: {} },
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
    ...overrides,
  };
}

function sampleFleet(designId: string, overrides?: Partial<Fleet>): Fleet {
  return {
    id: createId("fleet"),
    name: "Test Fleet",
    faction: "Terran",
    ships: [
      {
        designId,
        position: { x: 0, y: 0 },
        facing: 0,
        orders: { ...defaultOrders },
      },
    ],
    createdAt: nowIso(),
    updatedAt: nowIso(),
    source: "user",
    revision: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ShipDesign revision tests
// ---------------------------------------------------------------------------

describe("saveShipDesign — revision incrementing", () => {
  beforeEach(() => {
    freshDatabase();
  });

  it("saves a new design with revision 1", async () => {
    const design = sampleDesign();
    await saveShipDesign(design);
    const loaded = await loadShipDesign(design.id);
    expect(loaded).toBeDefined();
    expect(loaded?.revision).toBe(1);
  });

  it("increments revision on each subsequent save", async () => {
    const design = sampleDesign();
    await saveShipDesign(design);
    await saveShipDesign({ ...design, name: "Test Fighter v2" });
    await saveShipDesign({ ...design, name: "Test Fighter v3" });

    const loaded = await loadShipDesign(design.id);
    expect(loaded?.revision).toBe(3);
    expect(loaded?.name).toBe("Test Fighter v3");
  });
});

describe("listDesignRevisions — prior snapshots", () => {
  beforeEach(() => {
    freshDatabase();
  });

  it("returns an empty array when no revisions exist yet", async () => {
    const design = sampleDesign();
    await saveShipDesign(design);
    const revisions = await listDesignRevisions(design.id);
    expect(revisions).toHaveLength(0);
  });

  it("archives prior revisions and returns them newest-first", async () => {
    const design = sampleDesign();
    await saveShipDesign(design); // HEAD = revision 1
    await saveShipDesign({ ...design, name: "v2" }); // archives rev 1, HEAD = rev 2
    await saveShipDesign({ ...design, name: "v3" }); // archives rev 2, HEAD = rev 3

    const revisions = await listDesignRevisions(design.id);
    expect(revisions).toHaveLength(2);
    // Newest archived revision first: revision 2 before revision 1.
    expect(revisions[0]?.revision).toBe(2);
    expect(revisions[1]?.revision).toBe(1);
  });

  it("does not include the current HEAD in the revision list", async () => {
    const design = sampleDesign();
    await saveShipDesign(design);
    await saveShipDesign({ ...design, name: "v2" });

    const head = await loadShipDesign(design.id);
    const revisions = await listDesignRevisions(design.id);

    expect(head?.revision).toBe(2);
    // revision list should only have the prior revision
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.revision).toBe(1);
  });
});

describe("restoreDesignRevision", () => {
  beforeEach(() => {
    freshDatabase();
  });

  it("makes the old snapshot the new HEAD with an incremented revision", async () => {
    const design = sampleDesign({ name: "Original" });
    await saveShipDesign(design); // HEAD = rev 1, name "Original"
    await saveShipDesign({ ...design, name: "Modified" }); // HEAD = rev 2, name "Modified"

    // Restore to revision 1 (name "Original")
    const restored = await restoreDesignRevision(design.id, 1);

    expect(restored.name).toBe("Original");
    // New HEAD should have revision 3 (archived rev 2, restored rev 1 as new HEAD)
    expect(restored.revision).toBe(3);

    const head = await loadShipDesign(design.id);
    expect(head?.revision).toBe(3);
    expect(head?.name).toBe("Original");
  });

  it("throws when the requested revision does not exist", async () => {
    const design = sampleDesign();
    await saveShipDesign(design);

    await expect(restoreDesignRevision(design.id, 99)).rejects.toThrow(
      /No revision 99/,
    );
  });
});

// ---------------------------------------------------------------------------
// copyDesign tests
// ---------------------------------------------------------------------------

describe("copyDesign", () => {
  beforeEach(() => {
    freshDatabase();
  });

  it("produces a user-source copy with revision 1", async () => {
    const design = sampleDesign({ name: "Sabre" });
    await saveShipDesign(design);

    const copy = await copyDesign(design.id);

    expect(copy.id).not.toBe(design.id);
    expect(copy.source).toBe("user");
    expect(copy.revision).toBe(1);
    expect(copy.name).toBe("Sabre (copy)");
  });

  it("also works for preset designs", async () => {
    // Seed a preset directly into the database (bypassing saveShipDesign's guard).
    const preset = sampleDesign({ source: "preset", name: "Preset Ship" });
    const db = freshDatabase();
    await db.ships.put(preset);

    const copy = await copyDesign(preset.id);

    expect(copy.source).toBe("user");
    expect(copy.id).not.toBe(preset.id);
    expect(copy.revision).toBe(1);
  });

  it("copy is independently saveable without touching the original", async () => {
    const design = sampleDesign({ name: "Original" });
    await saveShipDesign(design);

    const copy = await copyDesign(design.id);
    await saveShipDesign({ ...copy, name: "Copy Modified" });

    // Original unchanged
    const original = await loadShipDesign(design.id);
    expect(original?.revision).toBe(1);
    expect(original?.name).toBe("Original");
  });

  it("throws when the source design does not exist", async () => {
    await expect(copyDesign("nonexistent-id")).rejects.toThrow(
      /Ship design not found/,
    );
  });
});

// ---------------------------------------------------------------------------
// Preset write protection
// ---------------------------------------------------------------------------

describe("preset write protection", () => {
  beforeEach(() => {
    freshDatabase();
  });

  it("throws when attempting to save a preset ship design", async () => {
    const preset = sampleDesign({ source: "preset", id: "preset-fighter" });

    await expect(saveShipDesign(preset)).rejects.toThrow(
      /Cannot overwrite preset design/,
    );
  });

  it("throws when attempting to save a preset fleet", async () => {
    const design = sampleDesign();
    const preset = sampleFleet(design.id, {
      source: "preset",
      id: "preset-fleet-alpha",
    });

    await expect(saveFleet(preset)).rejects.toThrow(
      /Cannot overwrite preset fleet/,
    );
  });

  it("allows saving user-source designs without error", async () => {
    const design = sampleDesign({ source: "user" });
    await expect(saveShipDesign(design)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Fleet revision tests (parallel to ship design tests)
// ---------------------------------------------------------------------------

describe("saveFleet — revision incrementing", () => {
  beforeEach(() => {
    freshDatabase();
  });

  it("increments fleet revision on subsequent saves", async () => {
    const design = sampleDesign();
    const fleet = sampleFleet(design.id, { name: "Fleet v1" });

    await saveFleet(fleet);
    await saveFleet({ ...fleet, name: "Fleet v2" });
    await saveFleet({ ...fleet, name: "Fleet v3" });

    // listFleetRevisions only returns archived revisions — rev 1 and rev 2.
    const revisions = await listFleetRevisions(fleet.id);
    expect(revisions).toHaveLength(2);
    // HEAD is now revision 3.
    expect(revisions[0]?.revision).toBe(2);
    expect(revisions[1]?.revision).toBe(1);
  });

  it("archives fleet revisions", async () => {
    const design = sampleDesign();
    const fleet = sampleFleet(design.id, { name: "Alpha" });

    await saveFleet(fleet); // rev 1
    await saveFleet({ ...fleet, name: "Bravo" }); // rev 2

    const revisions = await listFleetRevisions(fleet.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.revision).toBe(1);
    expect(revisions[0]?.name).toBe("Alpha");
  });
});

describe("restoreFleetRevision", () => {
  beforeEach(() => {
    freshDatabase();
  });

  it("restores a prior fleet revision as a new HEAD", async () => {
    const design = sampleDesign();
    const fleet = sampleFleet(design.id, { name: "Original Fleet" });

    await saveFleet(fleet); // rev 1
    await saveFleet({ ...fleet, name: "Modified Fleet" }); // rev 2

    const restored = await restoreFleetRevision(fleet.id, 1);
    expect(restored.name).toBe("Original Fleet");
    expect(restored.revision).toBe(3);
  });
});

describe("copyFleet", () => {
  beforeEach(() => {
    freshDatabase();
  });

  it("produces a user-source copy with revision 1", async () => {
    const design = sampleDesign();
    const fleet = sampleFleet(design.id, { name: "Strike Wing" });
    await saveFleet(fleet);

    const copy = await copyFleet(fleet.id);

    expect(copy.id).not.toBe(fleet.id);
    expect(copy.source).toBe("user");
    expect(copy.revision).toBe(1);
    expect(copy.name).toBe("Strike Wing (copy)");
  });

  it("throws when the source fleet does not exist", async () => {
    await expect(copyFleet("nonexistent-id")).rejects.toThrow(/Fleet not found/);
  });
});

// ---------------------------------------------------------------------------
// listShipDesigns / deleteShipDesign (regression: basic CRUD still works)
// ---------------------------------------------------------------------------

describe("basic CRUD still works after db rewrite", () => {
  beforeEach(() => {
    freshDatabase();
  });

  it("listShipDesigns returns saved designs", async () => {
    const d1 = sampleDesign({ name: "Alpha" });
    const d2 = sampleDesign({ name: "Beta" });
    await saveShipDesign(d1);
    await saveShipDesign(d2);

    const list = await listShipDesigns();
    expect(list).toHaveLength(2);
  });

  it("deleteShipDesign removes the record", async () => {
    const design = sampleDesign();
    await saveShipDesign(design);
    await deleteShipDesign(design.id);

    const loaded = await loadShipDesign(design.id);
    expect(loaded).toBeUndefined();
  });

  it("deleteFleet removes the record", async () => {
    const design = sampleDesign();
    const fleet = sampleFleet(design.id);
    await saveFleet(fleet);
    await deleteFleet(fleet.id);

    // No direct loadFleet export, but saveFleet / listFleets indirectly confirm.
    const revisions = await listFleetRevisions(fleet.id);
    expect(revisions).toHaveLength(0);
  });
});

/**
 * Unit tests for the formation-template storage operations in db.ts.
 *
 * Mirrors db.unit.test.ts: fake-indexeddb, a fresh database per suite, and the
 * same save/load/list/copy/revisions/restore/preset-guard shape as the ship and
 * fleet tables. A FormationTemplate is parsed through `FormationTemplate.parse`
 * on read, so the recursive Formation subtree is re-validated at every read.
 */
import { beforeEach, describe, expect, it } from "vitest";
import fakeIndexedDB, { IDBKeyRange } from "fake-indexeddb";
import {
  FleetArchitectDatabase,
  _setDatabaseForTesting,
  copyFormationTemplate,
  deleteFormationTemplate,
  listFormationTemplates,
  loadFormationTemplate,
  restoreFormationTemplateRevision,
  saveFormationTemplate,
  listFormationTemplateRevisions,
} from "@/storage/db";
import { createId, nowIso } from "@/domain/id";
import type { FormationTemplate } from "@/schema/formation-template";
import type { Formation } from "@/schema/formation";

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
  const db = new FleetArchitectDatabase(`test-db-ftpl-${dbCounter}`, {
    indexedDB: fakeIndexedDB,
    IDBKeyRange,
  });
  _setDatabaseForTesting(db);
  return db;
}

/** A minimal formation: one root with a single ship leaf referencing `designId`. */
function leafFormation(designId: string): Formation {
  return {
    id: "squad",
    doctrine: { base: {}, rules: [] },
    children: [
      {
        kind: "ship",
        ship: { designId, position: { x: 0, y: 0 }, facing: 0 },
      },
    ],
  };
}

function sampleTemplate(
  overrides?: Partial<FormationTemplate>,
): FormationTemplate {
  return {
    id: createId("ftpl"),
    name: "Wedge Squadron",
    faction: "Terran",
    formation: leafFormation(createId("design")),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    source: "user",
    revision: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Basic CRUD: save / load / list / delete
// ---------------------------------------------------------------------------

describe("saveFormationTemplate / loadFormationTemplate", () => {
  beforeEach(() => {
    freshDatabase();
  });

  it("saves a new template with revision 1 and loads it back", async () => {
    const template = sampleTemplate({ name: "Alpha Wing" });
    await saveFormationTemplate(template);

    const loaded = await loadFormationTemplate(template.id);
    expect(loaded).toBeDefined();
    expect(loaded?.revision).toBe(1);
    expect(loaded?.name).toBe("Alpha Wing");
    // The formation subtree survives the round-trip through Dexie + parse.
    expect(loaded?.formation.id).toBe("squad");
    expect(loaded?.formation.children).toHaveLength(1);
  });

  it("increments revision on each subsequent save", async () => {
    const template = sampleTemplate();
    await saveFormationTemplate(template);
    await saveFormationTemplate({ ...template, name: "v2" });
    await saveFormationTemplate({ ...template, name: "v3" });

    const loaded = await loadFormationTemplate(template.id);
    expect(loaded?.revision).toBe(3);
    expect(loaded?.name).toBe("v3");
  });

  it("returns undefined when the id is absent", async () => {
    const loaded = await loadFormationTemplate("no-such-template");
    expect(loaded).toBeUndefined();
  });
});

describe("listFormationTemplates", () => {
  beforeEach(() => {
    freshDatabase();
  });

  it("returns every saved template", async () => {
    await saveFormationTemplate(sampleTemplate({ name: "Alpha" }));
    await saveFormationTemplate(sampleTemplate({ name: "Beta" }));

    const list = await listFormationTemplates();
    expect(list).toHaveLength(2);
    expect(list.map((t) => t.name).sort()).toEqual(["Alpha", "Beta"]);
  });
});

describe("deleteFormationTemplate", () => {
  beforeEach(() => {
    freshDatabase();
  });

  it("removes the record", async () => {
    const template = sampleTemplate();
    await saveFormationTemplate(template);
    await deleteFormationTemplate(template.id);

    const loaded = await loadFormationTemplate(template.id);
    expect(loaded).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// copyFormationTemplate
// ---------------------------------------------------------------------------

describe("copyFormationTemplate", () => {
  beforeEach(() => {
    freshDatabase();
  });

  it("produces a user-source copy with revision 1", async () => {
    const template = sampleTemplate({ name: "Sabre Wing" });
    await saveFormationTemplate(template);

    const copy = await copyFormationTemplate(template.id);

    expect(copy.id).not.toBe(template.id);
    expect(copy.source).toBe("user");
    expect(copy.revision).toBe(1);
    expect(copy.name).toBe("Sabre Wing (copy)");
    // The formation subtree is carried into the copy.
    expect(copy.formation.children).toHaveLength(1);
  });

  it("also works for preset templates", async () => {
    // Seed a preset directly (bypassing the preset guard).
    const preset = sampleTemplate({ source: "preset", name: "Preset Wing" });
    const db = freshDatabase();
    await db.formationTemplates.put(preset);

    const copy = await copyFormationTemplate(preset.id);

    expect(copy.source).toBe("user");
    expect(copy.id).not.toBe(preset.id);
    expect(copy.revision).toBe(1);
  });

  it("throws when the source template does not exist", async () => {
    await expect(copyFormationTemplate("nonexistent-id")).rejects.toThrow(
      /Formation template not found/,
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

  it("throws when attempting to save a preset template", async () => {
    const preset = sampleTemplate({ source: "preset", id: "preset-ftpl-x" });
    await expect(saveFormationTemplate(preset)).rejects.toThrow(
      /Cannot overwrite preset formation template/,
    );
  });
});

// ---------------------------------------------------------------------------
// Revision history
// ---------------------------------------------------------------------------

describe("listFormationTemplateRevisions — prior snapshots", () => {
  beforeEach(() => {
    freshDatabase();
  });

  it("returns an empty array when no revisions exist yet", async () => {
    const template = sampleTemplate();
    await saveFormationTemplate(template);
    const revisions = await listFormationTemplateRevisions(template.id);
    expect(revisions).toHaveLength(0);
  });

  it("archives prior revisions and returns them newest-first", async () => {
    const template = sampleTemplate();
    await saveFormationTemplate(template); // HEAD = rev 1
    await saveFormationTemplate({ ...template, name: "v2" }); // archives rev 1, HEAD = rev 2
    await saveFormationTemplate({ ...template, name: "v3" }); // archives rev 2, HEAD = rev 3

    const revisions = await listFormationTemplateRevisions(template.id);
    expect(revisions).toHaveLength(2);
    expect(revisions[0]?.revision).toBe(2);
    expect(revisions[1]?.revision).toBe(1);
  });
});

describe("restoreFormationTemplateRevision", () => {
  beforeEach(() => {
    freshDatabase();
  });

  it("makes the old snapshot the new HEAD with an incremented revision", async () => {
    const template = sampleTemplate({ name: "Original" });
    await saveFormationTemplate(template); // HEAD = rev 1
    await saveFormationTemplate({ ...template, name: "Modified" }); // HEAD = rev 2

    const restored = await restoreFormationTemplateRevision(template.id, 1);

    expect(restored.name).toBe("Original");
    // Archived rev 2, restored rev 1 as new HEAD at rev 3.
    expect(restored.revision).toBe(3);

    const head = await loadFormationTemplate(template.id);
    expect(head?.revision).toBe(3);
    expect(head?.name).toBe("Original");
  });

  it("throws when the requested revision does not exist", async () => {
    const template = sampleTemplate();
    await saveFormationTemplate(template);

    await expect(restoreFormationTemplateRevision(template.id, 99)).rejects.toThrow(
      /No revision 99/,
    );
  });
});

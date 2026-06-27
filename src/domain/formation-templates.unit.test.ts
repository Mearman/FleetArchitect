/**
 * Integration test for the formation-template expansion wiring.
 *
 * Exercises the full edge path a battle-start takes: load the template
 * catalogue through `loadTemplateTable` (the Storage contract, backed here by
 * fake-indexeddb), expand a fleet whose formation tree contains a `template`
 * node into a concrete tree, and resolve the result to combat ships. A fleet
 * with no template nodes must resolve byte-identically (the same ship count and
 * design ids as the equivalent fleet authored without a template).
 */
import { beforeEach, describe, expect, it } from "vitest";
import fakeIndexedDB, { IDBKeyRange } from "fake-indexeddb";
import {
  FleetArchitectDatabase,
  _setDatabaseForTesting,
  saveFormationTemplate,
  storage,
} from "@/storage/db";
import { createId, nowIso } from "@/domain/id";
import { loadTemplateTable } from "@/domain/formation-templates";
import { expandTemplates } from "@/schema/expand-templates";
import { resolveFleetToCombatShips } from "@/domain/resolve";
import { catalog } from "@/data/catalog";
import { presetDesigns } from "@/data/presets";
import { flattenShipLeaves } from "@/schema/formation";
import type { Fleet } from "@/schema/fleet";
import type { Formation, FormationNode } from "@/schema/formation";
import type { FormationTemplate } from "@/schema/formation-template";
import type { ShipDesign } from "@/schema/ship";

let dbCounter = 0;

function freshDatabase(): FleetArchitectDatabase {
  dbCounter += 1;
  const db = new FleetArchitectDatabase(`test-db-ftpl-int-${dbCounter}`, {
    indexedDB: fakeIndexedDB,
    IDBKeyRange,
  });
  _setDatabaseForTesting(db);
  return db;
}

/** A real preset design that resolves against the catalog. */
function resolvableDesign(): ShipDesign {
  const design = presetDesigns[0];
  if (design === undefined) {
    throw new Error("presetDesigns is empty — cannot build a resolvable fixture");
  }
  return design;
}

function templateAsset(
  id: string,
  formation: Formation,
): FormationTemplate {
  return {
    id,
    name: id,
    faction: "Terran",
    formation,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    source: "user",
    revision: 1,
  };
}

function fleet(
  formation: Formation,
  overrides?: Partial<Fleet>,
): Fleet {
  return {
    id: createId("fleet"),
    name: "F",
    faction: resolvableDesign().faction,
    formation,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    source: "user",
    revision: 1,
    ...overrides,
  };
}

describe("loadTemplateTable + expandTemplates + resolve (battle-start wiring)", () => {
  beforeEach(() => {
    freshDatabase();
  });

  it("resolves a fleet with a template node after expansion", async () => {
    const design = resolvableDesign();
    // A template whose formation is a two-ship squad referencing the design.
    const squadFormation: Formation = {
      id: "squad",
      doctrine: { base: {}, rules: [] },
      children: [
        {
          kind: "ship",
          ship: { designId: design.id, position: { x: 0, y: 0 }, facing: 0 },
        },
        {
          kind: "ship",
          ship: {
            designId: design.id,
            position: { x: 40, y: 0 },
            facing: 0,
          },
        },
      ],
    };
    const asset = templateAsset("ftpl-squad", squadFormation);
    await saveFormationTemplate(asset);

    // A fleet whose root has one template node plus one direct ship leaf.
    const directLeaf: FormationNode = {
      kind: "ship",
      ship: { designId: design.id, position: { x: -40, y: 0 }, facing: 0 },
    };
    const root: Formation = {
      id: "root",
      doctrine: { base: {}, rules: [] },
      children: [
        directLeaf,
        { kind: "template", templateId: "ftpl-squad" },
      ],
    };
    const source = fleet(root);

    // Edge: load the template catalogue through the Storage contract.
    const table = await loadTemplateTable(storage());
    expect(table.get("ftpl-squad")?.formation.children).toHaveLength(2);

    // Expand: the template node is replaced by its cloned subtree.
    const expanded = expandTemplates(source, table);
    // Three ship leaves total: one direct + two from the inlined template.
    expect(flattenShipLeaves(expanded.formation)).toHaveLength(3);

    // Resolve the expanded fleet against the catalog. The template id never
    // reaches the resolver — only the concrete, inlined tree does.
    const designMap = new Map<string, ShipDesign>([[design.id, design]]);
    const resolved = resolveFleetToCombatShips(
      expanded,
      designMap,
      catalog(),
      "attacker",
    );
    expect(resolved).toHaveLength(3);
  });

  it("a template-free fleet resolves byte-identically with and without expansion", async () => {
    const design = resolvableDesign();
    const root: Formation = {
      id: "root",
      doctrine: { base: {}, rules: [] },
      children: [
        {
          kind: "ship",
          ship: { designId: design.id, position: { x: 0, y: 0 }, facing: 0 },
        },
        {
          kind: "ship",
          ship: {
            designId: design.id,
            position: { x: 50, y: 0 },
            facing: 0,
          },
        },
      ],
    };
    const source = fleet(root);
    const designMap = new Map<string, ShipDesign>([[design.id, design]]);

    // Resolve without expansion (the legacy path).
    const baseline = resolveFleetToCombatShips(
      source,
      designMap,
      catalog(),
      "attacker",
    );

    // Resolve through the expansion wiring. expandTemplates returns the same
    // fleet reference (byte-identical fast path), so the resolved ships match.
    const table = await loadTemplateTable(storage());
    const expanded = expandTemplates(source, table);
    expect(expanded).toBe(source);

    const throughExpand = resolveFleetToCombatShips(
      expanded,
      designMap,
      catalog(),
      "attacker",
    );
    expect(throughExpand).toHaveLength(baseline.length);
    // Same instance ids in the same order — the deployment column is unchanged.
    expect(throughExpand.map((s) => s.instanceId)).toEqual(
      baseline.map((s) => s.instanceId),
    );
  });
});

import { describe, expect, it } from "vitest";
import { expandTemplates } from "@/schema/expand-templates";
import { flatFormation } from "@/schema/formation";
import type { FormationTemplate } from "@/schema/formation-template";
import type { Fleet } from "@/schema/fleet";
import type { Formation } from "@/schema/formation";
import { nowIso } from "@/domain/id";

/** A minimal FleetShip leaf referencing the given design. */
function ship(designId = "d-1"): { designId: string; position: { x: number; y: number }; facing: number } {
  return { designId, position: { x: 0, y: 0 }, facing: 0 };
}

/** A `ship` formation node wrapping a minimal leaf. */
function shipNode(designId = "d-1"): { kind: "ship"; ship: { designId: string; position: { x: number; y: number }; facing: number } } {
  return { kind: "ship", ship: ship(designId) };
}

/** Build a FormationTemplate whose formation is the given subtree. */
function template(id: string, formation: Formation): FormationTemplate {
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

/** A flat root fleet wrapping a formation as its tree. */
function fleet(formation: Formation): Fleet {
  return {
    id: "f-1",
    name: "F",
    faction: "Terran",
    formation,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    source: "user",
    revision: 1,
  };
}

describe("expandTemplates", () => {
  it("inlines a single template node as a formation subtree", () => {
    // root -> [template t1] ; t1.formation = { id: "squad", children: [leaf] }
    const t1 = template(
      "t1",
      {
        id: "squad",
        doctrine: { base: {}, rules: [] },
        children: [shipNode()],
      },
    );
    const root: Formation = {
      id: "root",
      doctrine: { base: {}, rules: [] },
      children: [{ kind: "template", templateId: "t1" }],
    };
    const expanded = expandTemplates(fleet(root), new Map([["t1", t1]]));
    const only = expanded.formation.children[0];
    expect(only?.kind).toBe("formation");
    if (only?.kind !== "formation") return;
    // The template node has been replaced by its cloned formation; the
    // formation's id is namespaced under the deterministic instance path.
    expect(only.formation.id).toBe("root>t1#0#squad");
    // The ship leaf survives the clone.
    expect(only.formation.children).toHaveLength(1);
    expect(only.formation.children[0]?.kind).toBe("ship");
  });

  it("gives two instances of the same template distinct formation ids", () => {
    // Two sibling template references to the same asset must produce two
    // inlined subtrees whose formation ids do not collide.
    const t1 = template(
      "t1",
      {
        id: "squad",
        doctrine: { base: {}, rules: [] },
        children: [shipNode()],
      },
    );
    const root: Formation = {
      id: "root",
      doctrine: { base: {}, rules: [] },
      children: [
        { kind: "template", templateId: "t1" },
        { kind: "template", templateId: "t1" },
      ],
    };
    const expanded = expandTemplates(fleet(root), new Map([["t1", t1]]));
    const first = expanded.formation.children[0];
    const second = expanded.formation.children[1];
    expect(first?.kind).toBe("formation");
    expect(second?.kind).toBe("formation");
    if (first?.kind !== "formation" || second?.kind !== "formation") return;
    // Distinct ids: child index 0 vs 1 distinguishes the two instances.
    expect(first.formation.id).toBe("root>t1#0#squad");
    expect(second.formation.id).toBe("root>t1#1#squad");
    expect(first.formation.id).not.toBe(second.formation.id);
  });

  it("expands a template nested inside another template", () => {
    // t-outer references t-inner inside its formation. Expanding t-outer must
    // also expand the inner template reference, producing a fully concrete tree
    // with namespaced ids at both levels.
    const tInner = template(
      "t-inner",
      {
        id: "pair",
        doctrine: { base: {}, rules: [] },
        children: [shipNode("d-inner-a"), shipNode("d-inner-b")],
      },
    );
    const tOuter = template(
      "t-outer",
      {
        id: "wing",
        doctrine: { base: {}, rules: [] },
        children: [
          shipNode("d-outer"),
          { kind: "template", templateId: "t-inner" },
        ],
      },
    );
    const root: Formation = {
      id: "root",
      doctrine: { base: {}, rules: [] },
      children: [{ kind: "template", templateId: "t-outer" }],
    };
    const expanded = expandTemplates(
      fleet(root),
      new Map([
        ["t-outer", tOuter],
        ["t-inner", tInner],
      ]),
    );
    const outer = expanded.formation.children[0];
    expect(outer?.kind).toBe("formation");
    if (outer?.kind !== "formation") return;
    // The outer template's formation id is namespaced at depth 0.
    expect(outer.formation.id).toBe("root>t-outer#0#wing");
    // The outer formation has two children: a ship leaf and the inlined inner.
    expect(outer.formation.children).toHaveLength(2);
    const innerNode = outer.formation.children[1];
    expect(innerNode?.kind).toBe("formation");
    if (innerNode?.kind !== "formation") return;
    // The inner template's formation id is namespaced under the outer instance,
    // then under its own child index — a deeper, still-unique id.
    expect(innerNode.formation.id).toBe(
      "root>t-outer#0#wing>t-inner#1#pair",
    );
    expect(innerNode.formation.children).toHaveLength(2);
  });

  it("throws when a referenced templateId is missing from the map", () => {
    const root: Formation = {
      id: "root",
      doctrine: { base: {}, rules: [] },
      children: [{ kind: "template", templateId: "no-such-template" }],
    };
    expect(() => expandTemplates(fleet(root), new Map())).toThrow(
      /not found.*no-such-template/,
    );
  });

  it("throws on a template cycle", () => {
    // t-a references t-b; t-b references t-a. A cycle is an authoring error.
    const tA = template(
      "t-a",
      {
        id: "a",
        doctrine: { base: {}, rules: [] },
        children: [{ kind: "template", templateId: "t-b" }],
      },
    );
    const tB = template(
      "t-b",
      {
        id: "b",
        doctrine: { base: {}, rules: [] },
        children: [{ kind: "template", templateId: "t-a" }],
      },
    );
    const root: Formation = {
      id: "root",
      doctrine: { base: {}, rules: [] },
      children: [{ kind: "template", templateId: "t-a" }],
    };
    expect(() =>
      expandTemplates(
        fleet(root),
        new Map([
          ["t-a", tA],
          ["t-b", tB],
        ]),
      ),
    ).toThrow(/cycle.*t-a/);
  });

  it("returns a template-free fleet structurally unchanged (byte-identical)", () => {
    // A flat root of ship leaves has no template node; the same fleet reference
    // is returned, so resolve and the cache key are unaffected.
    const f = fleet(flatFormation([ship(), ship()]));
    const result = expandTemplates(f, new Map());
    expect(result).toBe(f);
    expect(result.formation).toBe(f.formation);
  });

  it("preserves DFS ship-leaf order across an expanded template", () => {
    // A template inlined between two direct ship leaves must not reorder the
    // leaves the resolver sees: the direct leaves keep their positions and the
    // template's leaves slot in at the template's child position.
    const t1 = template(
      "t1",
      {
        id: "squad",
        doctrine: { base: {}, rules: [] },
        children: [shipNode("d-t-a"), shipNode("d-t-b")],
      },
    );
    const root: Formation = {
      id: "root",
      doctrine: { base: {}, rules: [] },
      children: [
        shipNode("d-before"),
        { kind: "template", templateId: "t1" },
        shipNode("d-after"),
      ],
    };
    const expanded = expandTemplates(fleet(root), new Map([["t1", t1]]));
    // Walk ship leaves in DFS order and collect design ids.
    const designIds: string[] = [];
    const walk = (formation: Formation): void => {
      for (const child of formation.children) {
        if (child.kind === "ship") {
          designIds.push(child.ship.designId);
        } else if (child.kind === "formation") {
          walk(child.formation);
        }
      }
    };
    walk(expanded.formation);
    expect(designIds).toEqual([
      "d-before",
      "d-t-a",
      "d-t-b",
      "d-after",
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { resolveFleetToCombatShips } from "@/domain/resolve";
import { expandTemplates } from "@/schema/expand-templates";
import { FormationTemplate } from "@/schema/formation-template";
import { collectTemplateRefs, flattenShipLeaves } from "@/schema/formation";
import { catalog } from "@/data/catalog";
import { presetDesigns } from "@/data/presets";
import { inputs, targetDummy } from "./engine.factions-tech-helpers";
import type { Fleet } from "@/schema/fleet";
import type { FormationNode } from "@/schema/formation";
import type { ShipDesign } from "@/schema/ship";

/**
 * Integration coverage for the formation-template expansion wiring through to a
 * real battle: a fleet whose formation tree carries a `template` reference is
 * expanded, resolved, and fought. Guards the full edge path a battle-start
 * takes when a fleet is composed from a reusable template asset:
 *
 *  - `expandTemplates` inlines the `template` node, deep-cloning the referenced
 *    template's formation subtree in place and rewriting every formation id in
 *    that clone into a deterministic, path-rooted namespace so two instances of
 *    the same template never collide. The template id itself never reaches the
 *    resolver or the engine.
 *  - `resolveFleetToCombatShips` walks the expanded tree and stamps each leaf's
 *    formation identity (formationId / chain / role) onto the resolved ship, so
 *    the namespaced inlined-subtree id — not the original template id — is what
 *    the formation-aware runtime sees.
 *  - `runBattle` runs the resolved fleet through the full tick loop without
 *    error, producing a valid frame stream and outcome.
 *
 * The template asset is a two-Sabre escort squad authored with an aggressive
 * leaf doctrine; the fleet references it once from its root. After expansion
 * the root has a single nested formation (the inlined squad) containing two
 * ship leaves, each carrying the namespaced formation id.
 */

const SEED = 42;
const MAX_TICKS = 200;
const TEMPLATE_ID = "test-escort-template";

/**
 * The namespaced formation id the inlined subtree carries after expansion. Per
 * `expand-templates.ts`: the template node sits at child index 0 of the fleet
 * root (id "root"), so its instance namespace is `root>test-escort-template#0`,
 * and `namespaceSubtreeIds` rewrites the cloned formation's own id "root" to
 * `root>test-escort-template#0#root`. This is the id that must reach the
 * resolved ships — never the bare template id.
 */
const NAMESPACED_FORMATION_ID = "root>test-escort-template#0#root";

/** Designs keyed by id, built once and shared across the tests in this file. */
const designs: ReadonlyMap<string, ShipDesign> = new Map(
  presetDesigns.map((d) => [d.id, d]),
);

/** The single shared catalog — `catalog()` returns a memoised singleton. */
const cat = catalog();

/** A reusable two-Sabre escort squad template, validated through its schema. */
const template = FormationTemplate.parse({
  id: TEMPLATE_ID,
  name: "Test Escort",
  faction: "Terran",
  formation: {
    id: "root",
    doctrine: { base: {}, rules: [] },
    children: [
      {
        kind: "ship",
        ship: {
          designId: "preset-ship-sabre",
          position: { x: 0, y: -30 },
          facing: 0,
          doctrine: { base: { stance: "aggressive" }, rules: [] },
        },
      },
      {
        kind: "ship",
        ship: {
          designId: "preset-ship-sabre",
          position: { x: 0, y: 30 },
          facing: 0,
          doctrine: { base: { stance: "aggressive" }, rules: [] },
        },
      },
    ],
  },
  createdAt: "2000-01-01T00:00:00.000Z",
  updatedAt: "2000-01-01T00:00:00.000Z",
  source: "user",
  revision: 1,
});

/** A fleet whose root carries a single template reference (expanded at resolve). */
const fleet: Fleet = {
  id: "test-fleet",
  name: "Template Fleet",
  faction: "Terran",
  formation: {
    id: "root",
    doctrine: { base: {}, rules: [] },
    children: [{ kind: "template", templateId: TEMPLATE_ID }],
  },
  createdAt: "2000-01-01T00:00:00.000Z",
  updatedAt: "2000-01-01T00:00:00.000Z",
  source: "user",
  revision: 1,
};

/** The template table the resolver-side expansion looks templates up in. */
const templateTable = new Map<string, FormationTemplate>([[TEMPLATE_ID, template]]);

/**
 * Collect every formation id in a subtree (pre-order DFS). Used to assert the
 * inlined, namespaced formation id is present in the expanded tree at the
 * formation level — not only on the resolved ships.
 */
function formationIdsIn(node: FormationNode): string[] {
  if (node.kind !== "formation") return [];
  const ids = [node.formation.id];
  for (const child of node.formation.children) {
    ids.push(...formationIdsIn(child));
  }
  return ids;
}

describe("formation-template expansion through to a battle", () => {
  it("inlines the template reference into a concrete, id-namespaced subtree", () => {
    const expanded = expandTemplates(fleet, templateTable);

    // The expanded tree carries no `template` node — every reference was
    // replaced by its inlined referent.
    expect(
      collectTemplateRefs(expanded.formation),
      "expanded fleet should have no template references",
    ).toEqual([]);

    // The two Sabre ship leaves from the template's formation are now direct
    // leaves of the expanded tree (two of them, in authoring order).
    expect(
      flattenShipLeaves(expanded.formation),
      "expanded fleet should contain the template's two ship leaves",
    ).toHaveLength(2);

    // The root's single child is the inlined template subtree as a nested
    // formation, carrying the namespaced id. The bare template id never
    // appears as a formation id.
    const child = expanded.formation.children[0];
    expect(child?.kind, "template node should become a formation child").toBe(
      "formation",
    );
    const allFormationIds = expanded.formation.children.flatMap(formationIdsIn);
    expect(
      allFormationIds,
      "inlined subtree should carry the namespaced formation id",
    ).toContain(NAMESPACED_FORMATION_ID);
    expect(
      allFormationIds,
      "the bare template id must never be a formation id",
    ).not.toContain(TEMPLATE_ID);
  });

  it("resolves the expanded fleet to combat ships carrying the inlined formation identity", () => {
    const expanded = expandTemplates(fleet, templateTable);
    const resolved = resolveFleetToCombatShips(expanded, designs, cat, "attacker");

    // Two Sabres resolved from the inlined template subtree.
    expect(
      resolved,
      "the template's two ship leaves should resolve to two combat ships",
    ).toHaveLength(2);
    expect(
      resolved.every((s) => s.designId === "preset-ship-sabre"),
      "every resolved ship should be a Sabre",
    ).toBe(true);

    for (const s of resolved) {
      // The formation identity is the namespaced inlined-subtree id, NOT the
      // bare template id — the template id never reaches the resolver.
      expect(
        s.formationId,
        `${s.instanceId} should carry the namespaced inlined formation id`,
      ).toBe(NAMESPACED_FORMATION_ID);
      expect(
        s.formationId,
        `${s.instanceId} must not carry the bare template id`,
      ).not.toBe(TEMPLATE_ID);
      expect(s.formationChain).toEqual(["root", NAMESPACED_FORMATION_ID]);
      // The leaf doctrine survived the resolve overlay: the Sabre's per-ship
      // aggressive stance wins over the design doctrine.
      expect(
        s.doctrine.base.stance,
        `${s.instanceId} should carry the inlined aggressive stance`,
      ).toBe("aggressive");
    }
  });

  it("runs the resolved template fleet through a full battle without error", () => {
    const expanded = expandTemplates(fleet, templateTable);
    const attacker = resolveFleetToCombatShips(expanded, designs, cat, "attacker");
    // A simple defender target for the two Sabres to engage. The dummy is
    // hittable and durable enough to keep the battle meaningful without making
    // it unwinnable.
    const defender = targetDummy({
      id: "target",
      side: "defender",
      x: 400,
      y: 0,
      structure: 500,
    });
    const result = runBattle(inputs([...attacker, defender], MAX_TICKS, SEED));

    // The battle ran the full tick loop and produced a valid frame stream and
    // outcome (any of the three terminal states is acceptable here — the
    // assertion is that the template-composed fleet fights without error).
    expect(result.frames.length, "battle must produce frames").toBeGreaterThan(0);
    expect(["attacker", "defender", "draw"]).toContain(result.winner);

    // Both Sabres are present on the opening frame — the resolved template
    // roster actually entered the battle.
    const opening = result.frames[0];
    expect(opening, "battle must have an opening frame").toBeDefined();
    const attackerIds = new Set(attacker.map((s) => s.instanceId));
    const presentAtStart = opening!.ships.filter((s) =>
      attackerIds.has(s.instanceId),
    );
    expect(
      presentAtStart,
      "both inlined Sabres should enter the battle",
    ).toHaveLength(2);
  });
});

/**
 * Schema-level gate for the formation/doctrine vocabulary introduced in the
 * formations overhaul. The recursive `z.lazy` + hand-written type alias types
 * (`Formation`, `FormationNode`, `Condition`, `FormationReference`) compile, but
 * recursive Zod can compile yet mis-parse; these tests prove the schemas
 * actually round-trip real nested structures — a flat legacy-like fleet, a
 * nested formation with per-child slots and a pattern layout, a doctrine with
 * bounded boolean conditions and a derived `between` reference, and a
 * formation template — and that defaults (absent doctrine, absent layout)
 * behave as the resolver and migration rely on.
 */
import { describe, expect, it } from "vitest";

import { Formation } from "@/schema/formation";
import { FormationTemplate } from "@/schema/formation-template";
import {
  type Condition,
  Doctrine,
  DoctrineAction,
  type FormationReference,
} from "@/schema/ai";
import type { FleetShip, Orders } from "@/schema/fleet";

const orders: Orders = {
  stance: "balanced",
  targetPriority: "nearest",
  engageRange: "medium",
  retreatThreshold: 0,
  focusFire: false,
  vulnerableTargetWeight: 0,
  formationKeeping: 0,
  rangeKeepingBand: 0.3,
};

function ship(designId: string): FleetShip {
  return { designId, position: { x: 0, y: 0 }, facing: 0, orders };
}

describe("formation schema", () => {
  it("parses a flat legacy-like root formation with column defaults", () => {
    const parsed = Formation.parse({
      id: "root",
      children: [
        { kind: "ship", ship: ship("d1") },
        { kind: "ship", ship: ship("d2") },
      ],
    });
    // Absent layout ⇒ undefined (resolver treats undefined as the column path).
    expect(parsed.layout).toBeUndefined();
    // Absent doctrine ⇒ defaulted to empty base, no rules.
    expect(parsed.doctrine.base).toEqual({});
    expect(parsed.doctrine.rules).toEqual([]);
    expect(parsed.children).toHaveLength(2);
  });

  it("parses a nested formation with per-child slots and a sub-formation", () => {
    const parsed = Formation.parse({
      id: "fleet",
      role: "main",
      layout: { kind: "pattern", pattern: "wedge", spacing: 80, facingAligned: true },
      children: [
        { kind: "ship", ship: ship("carrier"), slot: { forward: 0, lateral: 0 } },
        {
          kind: "formation",
          slot: { forward: -120, lateral: 200 },
          formation: {
            id: "escort-a",
            role: "escort",
            children: [{ kind: "ship", ship: ship("frigate") }],
          },
        },
      ],
    });
    expect(parsed.layout?.kind).toBe("pattern");
    const sub = parsed.children[1];
    expect(sub?.kind).toBe("formation");
    if (sub?.kind === "formation") {
      expect(sub.slot).toEqual({ forward: -120, lateral: 200 });
      expect(sub.formation.role).toBe("escort");
    }
  });

  it("rejects an unknown layout kind", () => {
    expect(() =>
      Formation.parse({ id: "x", children: [], layout: { kind: "orbital" } }),
    ).toThrow();
  });
});

describe("doctrine schema", () => {
  it("parses a doctrine with a recursive boolean condition and derived reference", () => {
    const ref: FormationReference = {
      kind: "between",
      a: { kind: "friendly", role: "carrier" },
      b: { kind: "enemy", role: "vanguard" },
      alpha: 0.5,
    };
    const condition: Condition = {
      kind: "all",
      of: [
        { kind: "formationStrength", reference: { kind: "self" }, threshold: 0.3, direction: "below" },
        { kind: "any", of: [{ kind: "tickAfter", tick: 600 }, { kind: "outclassed" }] },
        { kind: "range", a: ref, b: { kind: "enemyArchetype", archetype: "cruiser" }, min: 0, max: 1000 },
      ],
    };
    const parsed = Doctrine.parse({
      base: { stance: "balanced", cohesion: 0.3 },
      rules: [{ condition, then: { stance: "retreat", fire: "holdFire" } }],
    });
    expect(parsed.rules[0]?.condition.kind).toBe("all");
    expect(parsed.base.cohesion).toBe(0.3);
  });

  it("an action with no axes parses to an empty object", () => {
    const parsed = DoctrineAction.parse({});
    expect(parsed).toEqual({});
  });

  it("defaults base and rules when absent", () => {
    const parsed = Doctrine.parse({});
    expect(parsed.base).toEqual({});
    expect(parsed.rules).toEqual([]);
  });
});

describe("formation template schema", () => {
  it("parses a template wrapping a formation with provenance defaults", () => {
    const parsed = FormationTemplate.parse({
      id: "tpl-escort",
      name: "Escort squadron",
      faction: "Terran",
      formation: { id: "root", children: [{ kind: "ship", ship: ship("frigate") }] },
      createdAt: "2026-06-26T00:00:00Z",
      updatedAt: "2026-06-26T00:00:00Z",
    });
    expect(parsed.source).toBe("user");
    expect(parsed.revision).toBe(1);
    expect(parsed.formation.children[0]?.kind).toBe("ship");
  });
});

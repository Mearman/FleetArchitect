import { ShipDesign } from "./ship";

/**
 * One-time migration of a stored ship design into the unified-doctrine shape.
 *
 * A design persisted before the doctrine overhaul carries the legacy trio
 * `shipStance` / `crewPriority` / `rules`; the unified vocabulary carries a
 * single `doctrine`. This compiles the trio into a `doctrine` at the storage
 * read boundary, so a record written under the old shape parses under the new
 * one. It is a data-migration transform (the same pattern as
 * {@link normaliseFleetInput}), not legacy support: after it runs every design
 * carries a doctrine, and no domain code branches on the old trio.
 *
 * Narrowing uses only `typeof` / `in` (no type assertions). Idempotent: a record
 * already carrying `doctrine` is returned unchanged.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Compile a legacy trigger/action rule list into unified doctrine rules. The
 * legacy `Trigger` ship-self kinds are structurally identical to the unified
 * `Condition` ship-self kinds, so the trigger object passes through as the
 * condition (Zod validates it at parse); the legacy `Action` maps onto a
 * {@link DoctrineAction}-shaped fragment via {@link compileLegacyAction}.
 */
function compileLegacyRules(rules: unknown): unknown[] {
  if (!Array.isArray(rules)) return [];
  const out: unknown[] = [];
  for (const rule of rules) {
    if (!isRecord(rule)) continue;
    if (!("trigger" in rule) || !("action" in rule)) continue;
    out.push({ condition: rule.trigger, then: compileLegacyAction(rule.action) });
  }
  return out;
}

/**
 * Map a legacy `Action` onto a {@link DoctrineAction} fragment. `setStance` and
 * the fire/crew flags map directly; `focusFire` needs a targeting objective
 * (whose `mode` is required, so it defaults to `nearest`); `rally` has no
 * doctrine axis yet and maps to an empty action.
 */
function compileLegacyAction(action: unknown): Record<string, unknown> {
  if (!isRecord(action) || typeof action.kind !== "string") return {};
  switch (action.kind) {
    case "setStance":
      return { stance: action.stance };
    case "retreat":
      return { stance: "retreat" };
    case "focusFire":
      return { targeting: { mode: "nearest", focusFire: true } };
    case "prioritiseRepair":
      return { crew: "damageControl" };
    case "holdFire":
      return { fire: "holdFire" };
    case "fireAtWill":
      return { fire: "atWill" };
    case "rally":
      return {};
    default:
      return {};
  }
}

export function normaliseDesignInput(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  if ("doctrine" in raw) return raw;
  if (!("shipStance" in raw) && !("crewPriority" in raw) && !("rules" in raw)) {
    return raw;
  }
  const base: Record<string, unknown> = {};
  if ("shipStance" in raw) base.stance = raw.shipStance;
  if ("crewPriority" in raw) base.crew = raw.crewPriority;
  const rules = "rules" in raw ? compileLegacyRules(raw.rules) : [];
  return { ...raw, doctrine: { base, rules } };
}

/**
 * Parse a stored design record through the normaliser then the schema, so every
 * read boundary returns a validated doctrine-carrying design. Centralised here
 * so no read path can skip the migration. A record that is neither legacy nor
 * new fails loudly at `ShipDesign.parse`.
 */
export function parseDesignRecord(record: unknown): ShipDesign {
  return ShipDesign.parse(normaliseDesignInput(record));
}

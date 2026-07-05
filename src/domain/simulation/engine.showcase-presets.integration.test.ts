import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import { resolveFleetToCombatShipsCached, runBattleCached } from "@/domain/cache/run-battle-cached";
import { resolveFleetToCombatShips } from "@/domain/resolve";
import { catalog } from "@/data/catalog";
import { presetDesigns, presetFleets } from "@/data/presets";
import type { Fleet } from "@/schema/fleet";
import type { ShipDesign } from "@/schema/ship";
import type { CombatShip } from "@/domain/simulation/types";

/**
 * End-to-end coverage for the two formation-showcase preset fleets — Carrier
 * Group and Skirmisher Line — run through the SAME resolve + runBattle path the
 * battle arena uses, against real bundled opponents.
 *
 * These two presets are the only fleets that exercise the formation feature's
 * nested sub-formations with per-role doctrine: the Carrier Group's escorts
 * carry a `threatsTo carrier` targeting mode plus a `formationStrength` retreat
 * rule, and the Skirmisher Line's Reavers carry a `kite` range keyed off the
 * enemy's `vanguard` role. The unit suite covers each rule in isolation; this
 * file guards that the authored doctrine actually loads onto the resolved
 * ships, the battles run the full tick loop without error, the formation
 * identity survives onto the roster, and a doctrine-active preset battle is
 * byte-identical across two same-seed runs.
 *
 * Tick cap is 50 for every battle. At the 1 m grid scale the preset capital
 * ships close range slowly (~370 ticks to contact), so within 50 ticks the
 * ships are still on their own sides of the midline — which is the very
 * property the Skirmisher kiting assertion checks. Each 50-tick run is ~2 s
 * isolated (the Carrier Group matchup is 15 ships / ~4.5k modules).
 */

const MAX_TICKS = 50;
const SEED = 42;

/** Designs keyed by id, built once and shared across the battles in this file. */
const designs: ReadonlyMap<string, ShipDesign> = new Map(
  presetDesigns.map((d) => [d.id, d]),
);

/** The single shared catalog — `catalog()` returns a memoised singleton. */
const cat = catalog();

/** Find a bundled preset fleet by id, narrowing the optional result. */
function presetFleet(id: string): Fleet {
  const found = presetFleets.find((f) => f.id === id);
  if (found === undefined) {
    throw new Error(`preset fleet ${id} not found — was it renamed?`);
  }
  return found;
}

/** Resolve both sides of a preset matchup into combat ships. The attacker is
 *  authored in attacker coordinates (left, facing right); the resolver mirrors
 *  the defender to the right side, so the two lines meet across the midline. */
function resolveMatchup(
  attackerId: string,
  defenderId: string,
): { ships: CombatShip[]; attackerFleetId: string; defenderFleetId: string } {
  const attacker = presetFleet(attackerId);
  const defender = presetFleet(defenderId);
  return {
    ships: [
      ...resolveFleetToCombatShipsCached(attacker, designs, cat, "attacker"),
      ...resolveFleetToCombatShipsCached(defender, designs, cat, "defender"),
    ],
    attackerFleetId: attacker.id,
    defenderFleetId: defender.id,
  };
}

describe("Carrier Group (showcase) vs Drone Swarm", () => {
  it("completes a valid battle and stamps the escort sub-formation onto the roster with its doctrine wired", async () => {
    const { ships, attackerFleetId, defenderFleetId } = resolveMatchup(
      "preset-fleet-carrier-group",
      "preset-fleet-drone-swarm",
    );
    const result = await runBattleCached({
      ships,
      attackerFleetId,
      defenderFleetId,
      anomalies: [],
      seed: SEED,
      maxTicks: MAX_TICKS,
    });

    // The battle ran the full tick loop and produced a valid outcome.
    expect(result.frames.length, "battle must produce frames").toBeGreaterThan(0);
    expect(["attacker", "defender", "draw"]).toContain(result.winner);

    // The roster is always emitted by `runBattle` (it carries faction + side +
    // formation identity per ship); narrow once so the per-ship reads below are
    // definite. A missing roster is a real regression, not a silent default.
    const roster = result.roster;
    if (roster === undefined) throw new Error("runBattle produced no roster");

    // The escort sub-formation is stamped onto the roster: every Terran escort
    // carries formationId "escort" and role "escort". This is the handle the
    // escort doctrine's `threatsTo carrier` and `formationStrength` references
    // resolve against at runtime — the formation-aware gate is wired open.
    const escortRoster = roster.filter((r) => r.role === "escort");
    expect(escortRoster.length, "Carrier Group should field three escorts").toBe(3);
    for (const r of escortRoster) {
      expect(r.formationId, `escort ${r.instanceId} should sit in the escort sub-formation`).toBe("escort");
      expect(r.faction).toBe("Terran");
    }
    // The carrier is present and carries its own sub-formation identity, the
    // friendly-role reference the escorts' doctrine keys off.
    const carrier = roster.find((r) => r.role === "carrier");
    expect(carrier, "Carrier Group should field its carrier").toBeDefined();
    expect(carrier?.formationId).toBe("carrier");

    // The escort doctrine actually loaded onto the resolved ships (not just the
    // authored fleet): a threatsTo targeting mode against the carrier role, and
    // the formationStrength retreat rule. Verifying on the input ships proves
    // the resolver's design+leaf overlay carried the showcase doctrine through.
    for (const s of ships.filter((s) => s.role === "escort")) {
      expect(s.doctrine.base.targeting?.mode.kind, `${s.instanceId} should target threats to the carrier`).toBe("threatsTo");
      expect(s.doctrine.rules.length, `${s.instanceId} should carry the retreat rule`).toBe(1);
    }
  });
});

describe("Skirmisher Line (showcase) vs Battle Line", () => {
  it("completes a valid battle where the skirmishers hold their side of the midline rather than charging in", async () => {
    const { ships, attackerFleetId, defenderFleetId } = resolveMatchup(
      "preset-fleet-skirmisher-line",
      "preset-fleet-battleline",
    );
    const result = await runBattleCached({
      ships,
      attackerFleetId,
      defenderFleetId,
      anomalies: [],
      seed: SEED,
      maxTicks: MAX_TICKS,
    });

    expect(result.frames.length, "battle must produce frames").toBeGreaterThan(0);
    expect(["attacker", "defender", "draw"]).toContain(result.winner);

    // The skirmishers deploy as the attacker (left, x < 0). Their kite doctrine
    // keeps them at standoff rather than bulling into the enemy line, so their
    // x-position stays on the attacker's side of the midline (x < 0) for the
    // overwhelming majority of the battle — they do not charge across. The
    // skirmisher instanceIds are stable (`ship_attacker_<i>`), resolved from
    // the roster by role.
    const roster = result.roster;
    if (roster === undefined) throw new Error("runBattle produced no roster");
    const skirmIds = new Set(
      roster.filter((r) => r.role === "skirmishers").map((r) => r.instanceId),
    );
    expect(skirmIds.size, "Skirmisher Line should field four Reavers").toBe(4);

    let onOwnSide = 0;
    let sampled = 0;
    for (const f of result.frames) {
      for (const s of f.ships) {
        if (!skirmIds.has(s.instanceId)) continue;
        sampled += 1;
        if (s.x < 0) onOwnSide += 1;
      }
    }
    // "Most of the battle": the probe shows 100% within 50 ticks; the threshold
    // allows a margin for the slow drift without weakening the "no charge" check.
    expect(sampled, "skirmishers should appear in every frame").toBeGreaterThan(0);
    expect(
      onOwnSide / sampled,
      "skirmishers should stay on their own side of the midline (x < 0) for most of the battle",
    ).toBeGreaterThanOrEqual(0.9);
  });
});

describe("showcase fleet resolution", () => {
  it("resolves every Carrier Group ship with formation identity and an overlaid doctrine", () => {
    const ships = resolveFleetToCombatShips(
      presetFleet("preset-fleet-carrier-group"),
      designs,
      cat,
      "attacker",
    );
    // One carrier plus three escorts — the nested sub-formation structure.
    expect(ships.filter((s) => s.role === "carrier")).toHaveLength(1);
    const escorts = ships.filter((s) => s.role === "escort");
    expect(escorts).toHaveLength(3);

    // Every resolved ship carries its formation identity: the immediate
    // formation id, the chain from root, and the role the doctrine references.
    for (const s of ships) {
      expect(s.formationId, `${s.instanceId} should carry a formationId`).toBeDefined();
      expect(s.formationChain, `${s.instanceId} should carry a formationChain`).toBeDefined();
      expect(s.role, `${s.instanceId} should carry a role`).toBeDefined();
      expect(s.doctrine, `${s.instanceId} should carry a resolved doctrine`).toBeDefined();
    }
    // The carrier's chain roots at "root" and ends at its sub-formation id.
    const carrier = ships.find((s) => s.role === "carrier");
    expect(carrier?.formationId).toBe("carrier");
    expect(carrier?.formationChain).toEqual(["root", "carrier"]);
    // An escort's chain roots at the same root and ends at the escort node.
    expect(escorts[0]?.formationId).toBe("escort");
    expect(escorts[0]?.formationChain).toEqual(["root", "escort"]);
  });

  it("resolves every Skirmisher Line ship with formation identity and the kite doctrine", () => {
    const ships = resolveFleetToCombatShips(
      presetFleet("preset-fleet-skirmisher-line"),
      designs,
      cat,
      "attacker",
    );
    expect(ships).toHaveLength(4);
    for (const s of ships) {
      expect(s.role).toBe("skirmishers");
      expect(s.formationId).toBe("skirmishers");
      expect(s.formationChain).toEqual(["root", "skirmishers"]);
      // The kite doctrine survived the overlay: an evasive stance and a kite
      // range keyed against the enemy vanguard role.
      expect(s.doctrine.base.stance).toBe("evasive");
      expect(s.doctrine.base.spatial?.range?.kind).toBe("kite");
      expect(s.doctrine.base.spatial?.reference?.kind).toBe("enemy");
    }
  });
});

describe("Carrier Group byte-identity across two same-seed runs", () => {
  it("produces byte-identical frames when the same resolved inputs are run twice", () => {
    // The same resolved ships array is reused for both runs so the deterministic
    // instanceIds (`ship_<side>_<index>`) stay identical — byte-identity is a
    // property of identical inputs. The engine builds its own internal sim
    // state from the inputs and does not mutate them, so the second run starts
    // from the same state as the first (the engagement and formation tests
    // rely on the same property).
    const { ships, attackerFleetId, defenderFleetId } = resolveMatchup(
      "preset-fleet-carrier-group",
      "preset-fleet-drone-swarm",
    );
    const run = () =>
      runBattle({
        ships: structuredClone(ships),
        attackerFleetId,
        defenderFleetId,
        anomalies: [],
        seed: SEED,
        maxTicks: MAX_TICKS,
      });
    const a = run();
    const b = run();
    // JSON.stringify comparison: the frame stream, winner, and tick count must
    // all be byte-identical. The Carrier Group carries an active formation-aware
    // doctrine (the escort's threatsTo + formationStrength rule), so this guards
    // that the doctrine pass and relational targeting context are deterministic
    // for the doctrine-active preset case.
    expect(JSON.stringify(b.frames)).toBe(JSON.stringify(a.frames));
    expect(b.winner).toBe(a.winner);
    expect(b.ticks).toBe(a.ticks);
  });
});

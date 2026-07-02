import { describe, expect, it } from "vitest";
import { runBattleCached } from "@/domain/cache/run-battle-cached";
import { resolveFleetToCombatShips } from "@/domain/resolve";
import { catalog } from "@/data/catalog";
import { presetDesigns, presetFleets } from "@/data/presets";
import type { Fleet } from "@/schema/fleet";
import type { ShipDesign } from "@/schema/ship";
import type { BattleFrame, BattleResult, BattleSide } from "@/schema/battle";

/**
 * Cross-faction matrix: every representative preset fleet battled against every
 * other representative, plus the two formation-showcase presets exercised
 * against three opponents each. The assertion is not "who wins" — faction
 * balance shifts with every engine change — but that each matchup RESOLVES to a
 * well-formed outcome: the engine runs to a decision without crashing, both
 * sides field live ships at tick 0, the frame stream is non-empty, and the
 * declared winner is consistent with the final frame.
 *
 * Each fleet is resolved through the full `resolveFleetToCombatShips` pipeline
 * (design + doctrine + formation overlay) against the bundled catalog, so this
 * guards the resolve→engine chain against drift in faction modules, formation
 * templates, and doctrine resolution simultaneously — the integration gap a
 * per-faction unit test cannot cover.
 */

/** Tick cap per battle. Sized so the full 36-battle matrix completes well
 *  inside the CI window; ships deploy within mutual weapon/sight reach (see
 *  `computeEdgeInsetM`), so this is enough ticks for fleets to close, fire, and
 *  resolve within the cap. */
const MAX_TICKS = 300;
/** Shared seed so the matrix is reproducible run-to-run. */
const SEED = 42;

const designs: ReadonlyMap<string, ShipDesign> = new Map(
  presetDesigns.map((d) => [d.id, d]),
);

function fleetById(id: string): Fleet {
  const fleet = presetFleets.find((f) => f.id === id);
  if (fleet === undefined) {
    throw new Error(`preset fleet not found: ${id}`);
  }
  return fleet;
}

interface Matchup {
  name: string;
  attacker: string;
  defender: string;
}

/** One representative preset fleet per faction. */
const REPRESENTATIVE: { faction: string; fleetId: string }[] = [
  { faction: "Terran", fleetId: "preset-fleet-battleline" },
  { faction: "Swarm", fleetId: "preset-fleet-drone-swarm" },
  { faction: "Crystalline", fleetId: "preset-fleet-concord" },
  { faction: "Foundry", fleetId: "preset-fleet-foundry" },
  { faction: "Corsair", fleetId: "preset-fleet-reavers" },
  { faction: "Synthetic", fleetId: "preset-fleet-collective" },
];

/** Ordered cross-faction pairs (attacker vs defender, attacker faction ≠
 *  defender faction): 6 attackers × 5 defenders = 30 matchups. */
function buildCrossFactionMatrix(): Matchup[] {
  const out: Matchup[] = [];
  for (const att of REPRESENTATIVE) {
    for (const def of REPRESENTATIVE) {
      if (att.fleetId === def.fleetId) continue;
      out.push({
        name: `${fleetById(att.fleetId).name} vs ${fleetById(def.fleetId).name}`,
        attacker: att.fleetId,
        defender: def.fleetId,
      });
    }
  }
  return out;
}

/** The two formation-showcase presets, each battled against three opponents:
 *  Battle Line, Drone Swarm, and Raid Pack. 2 × 3 = 6 matchups. */
function buildShowcaseMatrix(): Matchup[] {
  const showcases = [
    "preset-fleet-carrier-group",
    "preset-fleet-skirmisher-line",
  ];
  const opponents = [
    "preset-fleet-battleline",
    "preset-fleet-drone-swarm",
    "preset-fleet-reavers",
  ];
  const out: Matchup[] = [];
  for (const show of showcases) {
    for (const opp of opponents) {
      out.push({
        name: `${fleetById(show).name} vs ${fleetById(opp).name}`,
        attacker: show,
        defender: opp,
      });
    }
  }
  return out;
}

function runMatchup(m: Matchup): Promise<BattleResult> {
  const attacker = fleetById(m.attacker);
  const defender = fleetById(m.defender);
  const ships = [
    ...resolveFleetToCombatShips(attacker, designs, catalog(), "attacker"),
    ...resolveFleetToCombatShips(defender, designs, catalog(), "defender"),
  ];
  return runBattleCached({
    ships,
    attackerFleetId: attacker.id,
    defenderFleetId: defender.id,
    anomalies: [],
    seed: SEED,
    maxTicks: MAX_TICKS,
  });
}

/** Count alive ships on a side in a frame. */
function aliveCount(frame: BattleFrame, side: BattleSide): number {
  if (side === "draw") return 0;
  return frame.ships.filter((s) => s.side === side && s.alive).length;
}

async function assertValidOutcome(m: Matchup): Promise<void> {
  const result = await runMatchup(m);

  // The engine always assigns a winner label; assert the runtime value really
  // is one of the declared outcomes (catches a crash that left it unset).
  expect(result.winner, `${m.name}: winner must be a valid side`).toBeOneOf([
    "attacker",
    "defender",
    "draw",
  ]);

  // The frame stream must carry the deployment frame plus at least one
  // simulated tick — a single-frame result means nothing actually ran.
  expect(
    result.frames.length,
    `${m.name}: battle must produce more than one frame`,
  ).toBeGreaterThan(1);

  const first = result.frames[0];
  const last = result.frames[result.frames.length - 1];
  if (first === undefined || last === undefined) {
    throw new Error(`${m.name}: frame stream missing head or tail`);
  }

  // Tick 0: both sides must field at least one live ship — a side with zero
  // ships at deployment indicates a resolve failure (a design that didn't
  // resolve, or a fleet with no deployable leaves).
  expect(
    aliveCount(first, "attacker"),
    `${m.name}: attacker must field live ships at tick 0`,
  ).toBeGreaterThan(0);
  expect(
    aliveCount(first, "defender"),
    `${m.name}: defender must field live ships at tick 0`,
  ).toBeGreaterThan(0);

  if (result.winner === "draw") {
    // A draw means neither side could finish the other. The engine's two draw
    // paths — mutual elimination on the same tick, or an exact-HP tie at the
    // tick cap — both require real combat, so each side must have lost at
    // least one ship relative to deployment. (HP totals are not a reliable
    // "damaged" signal here: adaptive shields regenerate and can ramp ABOVE
    // their starting capacity over a long battle.)
    expect(
      aliveCount(last, "attacker"),
      `${m.name}: a draw requires both sides to have taken losses`,
    ).toBeLessThan(aliveCount(first, "attacker"));
    expect(
      aliveCount(last, "defender"),
      `${m.name}: a draw requires both sides to have taken losses`,
    ).toBeLessThan(aliveCount(first, "defender"));
    return;
  }

  const winner: BattleSide = result.winner;
  const loser: BattleSide = winner === "attacker" ? "defender" : "attacker";

  // The winner's surviving force is at least as large as the loser's, UNLESS
  // the tick cap decided the battle on total HP (where a smaller but tankier
  // force can legitimately win without being wiped — `leadingSide` picks by
  // structure+shield, not headcount). `ticks` counts simulated ticks; a value
  // at the cap means the loop ran to completion without a decisive end.
  const winnerAlive = aliveCount(last, winner);
  const loserAlive = aliveCount(last, loser);
  const hitTickCap = result.ticks >= MAX_TICKS;
  expect(
    winnerAlive >= loserAlive || hitTickCap,
    `${m.name}: winner (${winner}) alive ${winnerAlive} < loser (${loser}) alive ${loserAlive} and battle did not hit the tick cap`,
  ).toBe(true);
}

const crossFaction = buildCrossFactionMatrix();
const showcases = buildShowcaseMatrix();

describe("faction matrix: representative preset fleet cross-battles", () => {
  for (const m of crossFaction) {
    it(`${m.name} produces a valid outcome`, async () => {
      await assertValidOutcome(m);
    }, 120000);
  }
});

describe("faction matrix: formation-showcase presets", () => {
  for (const m of showcases) {
    it(`${m.name} produces a valid outcome`, async () => {
      await assertValidOutcome(m);
    }, 120000);
  }
});

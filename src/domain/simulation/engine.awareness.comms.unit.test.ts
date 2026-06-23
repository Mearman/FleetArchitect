import { describe, expect, it } from "vitest";
import { runBattle } from "@/domain/simulation/engine";
import type {
  CombatShip,
  ResolvedModule,
} from "@/domain/simulation/types";
import type { CommsEffect } from "@/schema/module";
import {
  beam,
  comms,
  contactsOf,
  core,
  ghostsOf,
  inputs,
  linksOf,
  moduleOf,
  sensor,
  ship,
  statsFor,
  structureOf,
} from "@/domain/simulation/engine.awareness-helpers";
import { defaultOrders } from "@/schema/fleet";

// ---------------------------------------------------------------------------
// 3. Comms links: channel, arc, manning, laser LOS
// ---------------------------------------------------------------------------

describe("engine.awareness — comms links", () => {
  it("two omni units on the same channel within range form a link", () => {
    const result = runBattle(
      inputs([
        ship("a1", "attacker", -100, 0, [...core(), moduleOf("co", comms({ commsType: "omni", channel: 3 }), 1, 0, { channel: 3 })]),
        ship("a2", "attacker", -100, 40, [...core(), moduleOf("co", comms({ commsType: "omni", channel: 3 }), 1, 0, { channel: 3 })]),
        ship("d1", "defender", 800, 0, [...core()]),
      ]),
    );
    expect(linksOf(result, 0).length).toBe(1);
  });

  it("a channel mismatch forms no link", () => {
    const result = runBattle(
      inputs([
        ship("a1", "attacker", -100, 0, [...core(), moduleOf("co", comms({ commsType: "omni", channel: 1 }), 1, 0, { channel: 1 })]),
        ship("a2", "attacker", -100, 40, [...core(), moduleOf("co", comms({ commsType: "omni", channel: 2 }), 1, 0, { channel: 2 })]),
        ship("d1", "defender", 800, 0, [...core()]),
      ]),
    );
    expect(linksOf(result, 0).length).toBe(0);
  });

  it("a directional unit pointing away from its ally forms no link (arc miss)", () => {
    // a1's directional dish at bearing 0 points +x (toward the enemy side),
    // away from a2 which sits at bearing PI/2 (straight +y). A narrow arc misses.
    const result = runBattle(
      inputs([
        ship("a1", "attacker", 0, 0, [
          ...core(),
          moduleOf("co", comms({ commsType: "directional", channel: 5, arc: 0.2, bearing: 0 }), 1, 0, { channel: 5, commsBearing: 0 }),
        ]),
        ship("a2", "attacker", 0, 200, [
          ...core(),
          moduleOf("co", comms({ commsType: "directional", channel: 5, arc: 0.2, bearing: 0 }), 1, 0, { channel: 5, commsBearing: 0 }),
        ]),
        ship("d1", "defender", 800, 0, [...core()]),
      ]),
    );
    expect(linksOf(result, 0).length).toBe(0);
  });

  it("a laser link needs clear line of sight where an RF dish does not", () => {
    // Black hole disc at the origin between two allies on the x axis.
    // Build the same geometry twice: once with laser comms (LOS required, the
    // disc blocks it) and once with an omni RF link (passes through the disc).
    // Both ends crewless (crewRequired 0 => always manned) so the laser's
    // manning gate passes and only the LOS test distinguishes the two cases.
    const allyPair = (commsType: CommsEffect["commsType"]): CombatShip[] => [
      ship("a1", "attacker", -200, 0, [
        ...core(),
        moduleOf("co", comms({ commsType, channel: 9 }), 1, 0, { channel: 9 }),
      ]),
      ship("a2", "attacker", 200, 0, [
        ...core(),
        moduleOf("co", comms({ commsType, channel: 9 }), 1, 0, { channel: 9 }),
      ]),
      ship("d1", "defender", 0, 900, [...core()]),
    ];
    const rf = runBattle(inputs(allyPair("omni"), "blackHole"));
    const laser = runBattle(inputs(allyPair("laser"), "blackHole"));
    expect(linksOf(rf, 0).length).toBe(1);
    expect(linksOf(laser, 0).length).toBe(0);
  });

  it("a crewed dish forms no link while unmanned and a crewless one does", () => {
    // A dish with crewRequired 1 and no crew aboard is never manned, so the aim
    // pass skips it and no link forms. The identical pair with crewRequired 0
    // (always manned) links immediately.
    const dishPair = (crewRequired: number): CombatShip[] => [
      ship("a1", "attacker", -60, 0, [
        ...core(),
        moduleOf("co", comms({ commsType: "dish", channel: 4 }), 1, 0, { channel: 4, crewRequired }),
      ]),
      ship("a2", "attacker", 60, 0, [
        ...core(),
        moduleOf("co", comms({ commsType: "dish", channel: 4 }), 1, 0, { channel: 4, crewRequired }),
      ]),
      ship("d1", "defender", 0, 900, [...core()]),
    ];
    const unmanned = runBattle(inputs(dishPair(1)));
    const crewless = runBattle(inputs(dishPair(0)));
    expect(linksOf(unmanned, 0).length).toBe(0);
    expect(linksOf(crewless, 0).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Relay (needs 2 units) and bandwidth
// ---------------------------------------------------------------------------

describe("engine.awareness — relay and bandwidth", () => {
  it("a chain A—B—C only propagates a contact when the middle ship has two comms units", () => {
    // C sees the enemy; A is out of detection range of it. B is the relay. With
    // two omni units B forwards C's contact to A; with one unit B is a leaf and
    // A learns nothing.
    //
    // Geometry on the x axis: A at 0, B at 2500, C at 5500, enemy d1 at 8000.
    // C (innate ~5000 m baseline) sees d1 at 2500 m. Both A (8000 m from d1) and
    // B (5500 m from d1) are beyond their ~5000 m innate baseline, so neither
    // can see d1 directly. Any knowledge of d1 reaching A must travel via relay.
    //
    // Omni range 4000: A—B (2500) and B—C (3000) link, but A—C (5500) does NOT,
    // so the only path from C to A runs through B. That makes B's relay status
    // the decisive factor (a direct C—A link would let A see d1 regardless of B).
    const R = 4000;
    const build = (middleUnits: 1 | 2): CombatShip[] => {
      const middleComms: ResolvedModule[] =
        middleUnits === 2
          ? [
              moduleOf("co1", comms({ commsType: "omni", channel: 7, range: R }), 1, 0, { channel: 7 }),
              moduleOf("co2", comms({ commsType: "omni", channel: 7, range: R }), -1, 0, { channel: 7 }),
            ]
          : [moduleOf("co1", comms({ commsType: "omni", channel: 7, range: R }), 1, 0, { channel: 7 })];
      return [
        ship("A", "attacker", 0, 0, [...core(), moduleOf("co", comms({ commsType: "omni", channel: 7, range: R }), 1, 0, { channel: 7 })]),
        ship("B", "attacker", 2500, 0, [...core(), ...middleComms]),
        ship("C", "attacker", 5500, 0, [...core(), moduleOf("co", comms({ commsType: "omni", channel: 7, range: R }), -1, 0, { channel: 7 })]),
        ship("d1", "defender", 8000, 0, [...core()]),
      ];
    };
    const withRelay = runBattle(inputs(build(2)));
    const withoutRelay = runBattle(inputs(build(1)));
    expect(contactsOf(withRelay, 0, "A")).toContain("d1");
    expect(contactsOf(withoutRelay, 0, "A")).not.toContain("d1");
  });

  it("a bandwidth-1 relay forwards only the single highest-threat contact", () => {
    // C sees two enemies; the relay link B→A has bandwidth 1, so A learns about
    // exactly one — the higher-threat (nearer) of the two. d1 is nearer C than
    // d2, so d1 wins the single slot.
    // Omni range 4000 again so A links only through B (a direct A—C link would
    // hand A both contacts and defeat the bandwidth point). The link C→B is wide
    // (bandwidth 8) so B receives BOTH contacts; the link B→A is narrowed to 1
    // by A's unit, so the relay must drop the lower-priority (farther) contact.
    // Geometry: A at 0, B at 2500, C at 5500; enemies at 8000 (d1) and 8300 (d2).
    // Both enemies are beyond A's and B's ~5000 m innate baseline, so neither A
    // nor B can see them directly — all awareness must travel via the relay.
    const R = 4000;
    const WIDE = 8;
    const build = (): CombatShip[] => [
      ship("A", "attacker", 0, 0, [...core(), moduleOf("co", comms({ commsType: "omni", channel: 7, bandwidth: 1, range: R }), 1, 0, { channel: 7 })]),
      ship("B", "attacker", 2500, 0, [
        ...core(),
        moduleOf("co1", comms({ commsType: "omni", channel: 7, bandwidth: WIDE, range: R }), 1, 0, { channel: 7 }),
        moduleOf("co2", comms({ commsType: "omni", channel: 7, bandwidth: WIDE, range: R }), -1, 0, { channel: 7 }),
      ]),
      ship("C", "attacker", 5500, 0, [...core(), moduleOf("co", comms({ commsType: "omni", channel: 7, bandwidth: WIDE, range: R }), -1, 0, { channel: 7 })]),
      ship("d1", "defender", 8000, 0, [...core()]),
      ship("d2", "defender", 8300, 0, [...core()]),
    ];
    const result = runBattle(inputs(build()));
    // C sees both directly (2500 m and 2800 m away, within innate ~5000 m baseline).
    expect(contactsOf(result, 0, "C").sort()).toEqual(["d1", "d2"]);
    // A receives only the nearer (higher-threat) one through the 1-wide link.
    expect(contactsOf(result, 0, "A")).toEqual(["d1"]);
  });
});

// ---------------------------------------------------------------------------
// 5. Ghosts
// ---------------------------------------------------------------------------

describe("engine.awareness — ghosts", () => {
  it("a contact that dies leaves no ghost; a live contact carries a full-life ghost", () => {
    // a1 sees d1 directly every tick it is alive; while alive, a1 holds a
    // ghost at full life. Once d1 dies it is dropped from ghosts (dead target).
    const result = runBattle(
      inputs([
        ship("a1", "attacker", 0, 0, [
          ...core(),
          moduleOf("se", sensor(400), 1, 0),
          moduleOf("w", beam({ damage: 100_000, range: 600, cooldown: 1 }), 2, 0, { command: false }),
        ]),
        // A fragile defender that a1 will quickly destroy.
        {
          instanceId: "d1",
          designId: "dd1",
          faction: "Terran",side: "defender",
          stats: statsFor(1, 100),
          position: { x: 150, y: 0 },
          facing: Math.PI,
          orders: { ...defaultOrders, engageRange: "hold" },
          crewPriority: "combat",
          shipStance: "balanced",
          rules: [],
          classification: "fighter",
        },
      ]),
    );
    // While alive (tick 0), a1 has a live contact on d1 and a full-life ghost.
    expect(contactsOf(result, 0, "a1")).toContain("d1");
    const g0 = ghostsOf(result, 0, "a1").find((g) => g.enemyId === "d1");
    expect(g0?.ticksLeft).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// 6. Targeting gate
// ---------------------------------------------------------------------------

describe("engine.awareness — targeting gate", () => {
  it("a ship with comms but no sensor sees nothing and never fires; adding a sensor lets it fire", () => {
    // The shooter carries a comms unit (so it is on the fog-of-war path) but no
    // sensor and no ally to relay from — its awareness is empty beyond the ~5000 m
    // innate baseline, so it holds fire against a target at 6000 m. Adding a
    // sensor of range 8000 gives it a direct contact and it engages.
    const build = (withSensor: boolean): CombatShip[] => {
      const shooterModules: ResolvedModule[] = [
        ...core(),
        moduleOf("co", comms({ commsType: "omni", channel: 1 }), -1, 0, { channel: 1 }),
        moduleOf("w", beam({ damage: 500, range: 7000, cooldown: 1 }), 1, 0),
      ];
      if (withSensor) shooterModules.push(moduleOf("se", sensor(8000), 2, 0));
      return [
        ship("a1", "attacker", 0, 0, shooterModules),
        ship("d1", "defender", 6000, 0, [...core()]),
      ];
    };
    const blind = runBattle(inputs(build(false)));
    const seeing = runBattle(inputs(build(true)));

    // The blind shooter never damages the defender across the whole battle.
    const lastBlind = blind.frames.length - 1;
    expect(structureOf(blind, lastBlind, "d1")).toBe(structureOf(blind, 0, "d1"));

    // The seeing shooter does damage it.
    const lastSeeing = seeing.frames.length - 1;
    expect(structureOf(seeing, lastSeeing, "d1")).toBeLessThan(structureOf(seeing, 0, "d1"));
  });
});

// ---------------------------------------------------------------------------
// 7. Per-ship isolation
// ---------------------------------------------------------------------------

describe("engine.awareness — per-ship isolation", () => {
  it("same-side ships with no comms path share nothing; an omni link shares; a third component sees neither", () => {
    // Two same-side observers each see a different enemy directly. A separate
    // third observer (far away, its own component) sees neither.
    //
    // Layout: a1 at (0,0) sees d1 at (120,0). a2 at (0,6000) sees d2 at
    // (120,6000). a3 at (0,-11000) sees nothing in range. Observers are spaced
    // more than 5000 m apart so the innate baseline of each covers only its own
    // nearby enemy: a1→d2 and a2→d1 are ~6001 m apart, just beyond the ~5000 m
    // innate visual radius.
    const noLink: CombatShip[] = [
      ship("a1", "attacker", 0, 0, [...core(), moduleOf("se", sensor(200), 1, 0)]),
      ship("a2", "attacker", 0, 6000, [...core(), moduleOf("se", sensor(200), 1, 0)]),
      ship("a3", "attacker", 0, -11000, [...core(), moduleOf("se", sensor(200), 1, 0)]),
      ship("d1", "defender", 120, 0, [...core()]),
      ship("d2", "defender", 120, 6000, [...core()]),
    ];
    const result = runBattle(inputs(noLink));
    // Without any comms link a1 sees only d1, a2 only d2, a3 neither.
    expect(contactsOf(result, 0, "a1")).toEqual(["d1"]);
    expect(contactsOf(result, 0, "a2")).toEqual(["d2"]);
    expect(contactsOf(result, 0, "a3")).toEqual([]);

    // Now link a1 and a2 with an omni pair on a shared channel: they pool their
    // contacts and each sees both d1 and d2. a3 is in its own component and
    // still sees neither.
    const linked: CombatShip[] = [
      ship("a1", "attacker", 0, 0, [...core(), moduleOf("se", sensor(200), 1, 0), moduleOf("co", comms({ commsType: "omni", channel: 8, range: 8000 }), -1, 0, { channel: 8 })]),
      ship("a2", "attacker", 0, 6000, [...core(), moduleOf("se", sensor(200), 1, 0), moduleOf("co", comms({ commsType: "omni", channel: 8, range: 8000 }), -1, 0, { channel: 8 })]),
      ship("a3", "attacker", 0, -11000, [...core(), moduleOf("se", sensor(200), 1, 0), moduleOf("co", comms({ commsType: "omni", channel: 8, range: 8000 }), -1, 0, { channel: 8 })]),
      ship("d1", "defender", 120, 0, [...core()]),
      ship("d2", "defender", 120, 6000, [...core()]),
    ];
    const linkedResult = runBattle(inputs(linked));
    // a1 and a2 each carry a single comms unit, so neither is a relay (relay
    // needs >= 2 linked units). But a leaf still forwards its OWN direct
    // contacts across the link, so a1 gains d2 and a2 gains d1.
    expect(contactsOf(linkedResult, 0, "a1").sort()).toEqual(["d1", "d2"]);
    expect(contactsOf(linkedResult, 0, "a2").sort()).toEqual(["d1", "d2"]);
    // a3 at (0,-11000) is 11000 m from a1 and 17000 m from a2 — beyond the
    // 8000 m omni range of both, so it forms no link and stays its own
    // component, sharing nothing and seeing no enemy within its own visual reach.
    expect(contactsOf(linkedResult, 0, "a3")).toEqual([]);
  });
});
